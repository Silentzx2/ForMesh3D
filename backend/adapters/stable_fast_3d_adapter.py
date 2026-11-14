"""
Stable Fast 3D adapter for single-image textured mesh generation.

The adapter deliberately follows the upstream SF3D preprocessing and inference
contract. Native texture_baker and uv_unwrapper extensions are required; a
degraded UV fallback is not used because it can silently damage texture quality.
"""
from __future__ import annotations

import contextlib
import importlib
import logging
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover - SF3D itself requires torch
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891
DEFAULT_FOREGROUND_RATIO = 0.85
MIN_TEXTURE_RESOLUTION = 512
MAX_TEXTURE_RESOLUTION = 2048
SUPPORTED_REMESH_OPTIONS = {"none", "triangle", "quad"}


class StableFast3DAdapter(BaseModel):
    """Stable Fast 3D — image to UV-unwrapped, PBR-textured GLB."""

    # This key must match models.yaml and download_models.sh.
    MODEL_KEY = "stable-fast-3d"
    FEATURE_TYPE = "image_to_textured_mesh"
    supports_seed_variants = False

    def __init__(self, vram_requirement: int, **kwargs: Any):
        self.model_id = kwargs.get("model_id")
        self.model_path: Path | None = None
        self.vram_requirement = vram_requirement
        self.feature_type = kwargs.get("feature_type", self.FEATURE_TYPE)
        self.status = ModelStatus.UNLOADED
        self.gpu_id: int | None = None
        self.gpu_ids: list[int] = []
        self.resource_plan: dict[str, Any] = {}
        self.native_topology = False
        self.model: Any = None
        self.device = "cpu"
        self.dtype = None
        self.version = "1.0"
        self.experimental = False
        self._pipeline: Any = None
        self._rembg_session: Any = None
        self._remove_background: Any = None
        self._resize_foreground: Any = None

    def _load_model(self) -> Any:
        """Load the third-party SF3D source and local Hugging Face weights."""
        sf3d_root = (
            Path(__file__).resolve().parents[1] / "thirdparty" / "StableFast3D"
        ).resolve()
        if not (sf3d_root / "sf3d" / "system.py").is_file():
            raise FileNotFoundError(
                "Stable Fast 3D source is missing. Initialize the third-party "
                "submodule with: git submodule update --init --recursive backend/thirdparty"
            )
        if str(sf3d_root) not in sys.path:
            sys.path.insert(0, str(sf3d_root))

        # Both native packages live one directory above their import packages.
        texture_baker_root = sf3d_root / "texture_baker"
        if str(texture_baker_root) not in sys.path:
            sys.path.insert(0, str(texture_baker_root))

        # _C.so's PyInit() internally does `import texture_baker`, which hits the
        # partially-initialized parent package → circular import.
        # Fix: pre-load _C.so as a standalone module under the key "texture_baker._C"
        # in sys.modules BEFORE importing the package. When __init__ does
        # `from . import _C`, Python finds it already cached and skips PyInit.
        import importlib.util as _iutil

        pkg_dir = texture_baker_root / "texture_baker"
        _c_so = next(pkg_dir.glob("_C*.so"), None) if pkg_dir.is_dir() else None
        if _c_so is None:
            _c_so = next(texture_baker_root.glob("build/*/texture_baker/_C*.so"), None)
        if _c_so is None:
            raise RuntimeError(
                "Stable Fast 3D texture_baker native extension (_C.so) not found. "
                "Run backend/scripts/install.sh --gpu to build the SF3D extensions."
            )

        # Clear stale partial state then pre-inject _C before the package import.
        sys.modules.pop("texture_baker", None)
        sys.modules.pop("texture_baker._C", None)
        _spec = _iutil.spec_from_file_location("texture_baker._C", str(_c_so))
        _c_mod = _iutil.module_from_spec(_spec)
        sys.modules["texture_baker._C"] = _c_mod
        _spec.loader.exec_module(_c_mod)

        try:
            texture_baker = importlib.import_module("texture_baker")
        except ImportError as exc:
            raise RuntimeError(
                "Stable Fast 3D texture_baker native extension is unavailable. "
                "Run backend/scripts/install.sh --gpu to build the SF3D extensions."
            ) from exc
        if not callable(getattr(texture_baker, "TextureBaker", None)):
            raise RuntimeError(
                "Stable Fast 3D texture_baker package is incomplete; TextureBaker is required."
            )

        uv_unwrapper_root = sf3d_root / "uv_unwrapper"
        if str(uv_unwrapper_root) not in sys.path:
            sys.path.insert(0, str(uv_unwrapper_root))

        uv_pkg_dir = uv_unwrapper_root / "uv_unwrapper"
        _uv_c_so = next(uv_pkg_dir.glob("_C*.so"), None) if uv_pkg_dir.is_dir() else None
        if _uv_c_so is None:
            _uv_c_so = next(uv_unwrapper_root.glob("build/*/uv_unwrapper/_C*.so"), None)
        if _uv_c_so is None:
            raise RuntimeError(
                "Stable Fast 3D uv_unwrapper native extension (_C.so) not found. "
                "Run backend/scripts/install.sh --gpu to build the SF3D extensions."
            )

        sys.modules.pop("uv_unwrapper", None)
        sys.modules.pop("uv_unwrapper._C", None)
        _uv_spec = _iutil.spec_from_file_location("uv_unwrapper._C", str(_uv_c_so))
        _uv_c_mod = _iutil.module_from_spec(_uv_spec)
        sys.modules["uv_unwrapper._C"] = _uv_c_mod
        _uv_spec.loader.exec_module(_uv_c_mod)

        try:
            uv_unwrapper = importlib.import_module("uv_unwrapper")
        except ImportError as exc:
            raise RuntimeError(
                "Stable Fast 3D uv_unwrapper native extension is unavailable. "
                "Run backend/scripts/install.sh --gpu to build the SF3D extensions."
            ) from exc
        if not callable(getattr(uv_unwrapper, "Unwrapper", None)):
            raise RuntimeError(
                "Stable Fast 3D uv_unwrapper package is incomplete; its compiled _C extension is required."
            )

        try:
            from sf3d.system import SF3D
            from sf3d.utils import remove_background, resize_foreground
            import rembg
        except ImportError as exc:
            raise RuntimeError(
                f"Stable Fast 3D Python dependencies are incomplete: {exc}. "
                "Install backend/requirements-models.txt and the SF3D native extensions."
            ) from exc

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        weights_dir_path = Path(weights_dir)
        required_files = (
            weights_dir_path / "config.yaml",
            weights_dir_path / "model.safetensors",
        )
        missing = [str(path) for path in required_files if not path.is_file()]
        if missing:
            raise FileNotFoundError(
                "Stable Fast 3D checkpoint is incomplete; missing: "
                + ", ".join(missing)
                + ". Accept the gated Hugging Face model license and run "
                "backend/scripts/download_models.sh."
            )

        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        logger.info("Loading Stable Fast 3D from %s on %s", weights_dir_path, device)
        pipeline = SF3D.from_pretrained(
            str(weights_dir_path),
            config_name="config.yaml",
            weight_name="model.safetensors",
        )
        pipeline.to(device)
        pipeline.eval()

        try:
            rembg_session = rembg.new_session()
        except Exception as exc:
            raise RuntimeError(
                f"Could not initialize SF3D background-removal session: {exc}"
            ) from exc

        self.model_path = weights_dir_path
        self.device = device
        self._pipeline = pipeline
        self._rembg_session = rembg_session
        self._remove_background = remove_background
        self._resize_foreground = resize_foreground
        self.model = pipeline

        pipeline_cfg = getattr(pipeline, "cfg", None)
        logger.info(
            "Stable Fast 3D loaded on %s: conditioning_size=%s, "
            "isosurface_resolution=%s, isosurface_threshold=%s",
            device,
            getattr(pipeline_cfg, "cond_image_size", "unknown"),
            getattr(pipeline_cfg, "isosurface_resolution", "unknown"),
            getattr(pipeline_cfg, "isosurface_threshold", "unknown"),
        )
        logger.info(
            "Stable Fast 3D native extensions loaded: texture_baker=%s uv_unwrapper=%s",
            getattr(texture_baker, "__file__", "unknown"),
            getattr(uv_unwrapper, "__file__", "unknown"),
        )
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self._rembg_session = None
        self._remove_background = None
        self._resize_foreground = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Stable Fast 3D pipeline not loaded"}

        image_value = inputs.get("image_path") or inputs.get("image")
        if not image_value:
            return {"success": False, "error": "SF3D requires an image_path"}
        image_path = Path(image_value).expanduser()
        if not image_path.is_file():
            return {"success": False, "error": f"SF3D input image not found: {image_path}"}

        try:
            seed = int(inputs.get("seed", DEFAULT_SEED))
            texture_resolution = int(inputs.get("texture_resolution", 1024))
            native_target_polycount = int(
                inputs.get("native_target_polycount")
                or inputs.get("target_polycount")
                or 0
            )
            target_vertex_count = int(inputs.get("target_vertex_count", -1))
            if target_vertex_count <= 0 and native_target_polycount > 0:
                # Approximate vertex count budget from target triangle face count
                target_vertex_count = max(100, native_target_polycount // 2)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "SF3D seed, texture_resolution, native_target_polycount, and target_vertex_count must be integers"
            ) from exc

        remesh_option = str(inputs.get("remesh_option", "none") or "none").strip().lower()
        texture_enabled = bool(
            inputs.get("texture_enabled", True) and inputs.get("generate_texture", True)
        )
        if seed < 0:
            raise ValueError("SF3D seed must be >= 0")
        if not MIN_TEXTURE_RESOLUTION <= texture_resolution <= MAX_TEXTURE_RESOLUTION:
            raise ValueError(
                f"SF3D texture_resolution must be between "
                f"{MIN_TEXTURE_RESOLUTION} and {MAX_TEXTURE_RESOLUTION}"
            )
        if remesh_option not in SUPPORTED_REMESH_OPTIONS:
            raise ValueError(
                f"Invalid SF3D remesh_option {remesh_option!r}; "
                f"expected one of {sorted(SUPPORTED_REMESH_OPTIONS)}"
            )
        if target_vertex_count == 0 or target_vertex_count < -1:
            raise ValueError("SF3D target_vertex_count must be -1 or a positive integer")

        if self._remove_background is None or self._resize_foreground is None:
            raise RuntimeError("SF3D image preprocessing helpers are not initialized")
        if self._rembg_session is None:
            raise RuntimeError("SF3D background-removal session is not initialized")
        if torch is None:
            raise RuntimeError("PyTorch is required to run Stable Fast 3D")

        logger.info(
            "Stable Fast 3D inference started: device=%s texture_resolution=%d "
            "remesh=%s target_vertex_count=%d seed_metadata=%d",
            getattr(pipeline, "device", self.device),
            texture_resolution,
            remesh_option,
            target_vertex_count,
            seed,
        )
        if remesh_option == "none" and target_vertex_count > 0:
            logger.warning(
                "SF3D ignores target_vertex_count=%d when remesh_option='none'",
                target_vertex_count,
            )

        try:
            from PIL import Image

            with Image.open(image_path) as source_image:
                image = source_image.convert("RGBA")
        except Exception as exc:
            raise ValueError(f"Could not decode SF3D input image {image_path}: {exc}") from exc

        try:
            # Match the official SF3D CLI preprocessing: remove background,
            # then fit the foreground to the expected 0.85 canvas ratio.
            image = self._remove_background(image, self._rembg_session)
            image = self._resize_foreground(image, DEFAULT_FOREGROUND_RATIO)
            if image is None or getattr(image, "mode", None) != "RGBA":
                raise ValueError("SF3D preprocessing must return a valid RGBA image")
        except Exception as exc:
            raise ValueError(f"SF3D image preprocessing failed: {exc}") from exc

        device_value = getattr(pipeline, "device", self.device)
        device_type = getattr(device_value, "type", str(device_value).split(":", 1)[0])
        autocast_context = contextlib.nullcontext()
        is_pre_ampere = False

        if device_type == "cuda" and torch is not None and torch.cuda.is_available():
            try:
                dev_idx = (
                    device_value.index
                    if hasattr(device_value, "index") and device_value.index is not None
                    else torch.cuda.current_device()
                )
                major, _ = torch.cuda.get_device_capability(dev_idx)
                is_pre_ampere = (major < 8)
            except Exception:
                is_pre_ampere = False

            # BF16 is preferred where supported; FP16 keeps T4-class GPUs working.
            autocast_dtype = torch.float16
            try:
                if torch.cuda.is_bf16_supported():
                    autocast_dtype = torch.bfloat16
            except Exception:
                pass
            autocast_context = torch.autocast(
                device_type="cuda", dtype=autocast_dtype
            )

        # On pre-Ampere GPUs (sm < 80, e.g. T4), triplane sequence length (12288 tokens)
        # causes PyTorch SDPA Math fallback to allocate 5.09 GiB all at once, causing OOM.
        # We wrap scaled_dot_product_attention strictly for pre-Ampere devices with
        # chunked SDPA (chunk_size=1024), preserving 100% native upstream execution on sm >= 80.
        sdpa_orig = getattr(torch.nn.functional, "scaled_dot_product_attention", None) if torch is not None else None

        def _guarded_pre_ampere_sdpa(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None):
            token_dim = 2 if q.ndim == 4 else 1
            num_tokens = q.shape[token_dim]
            chunk_size = 1024
            if num_tokens <= chunk_size or dropout_p > 0.0 or is_causal or sdpa_orig is None:
                return sdpa_orig(q, k, v, attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale)

            sdpa_kwargs = {}
            if scale is not None:
                sdpa_kwargs["scale"] = scale

            chunks = []
            for i in range(0, num_tokens, chunk_size):
                if token_dim == 2:
                    qc = q[:, :, i : i + chunk_size, :]
                else:
                    qc = q[:, i : i + chunk_size, :]
                if attn_mask is not None:
                    mc = (
                        attn_mask[..., i : i + chunk_size, :]
                        if (attn_mask.ndim >= 2 and attn_mask.shape[-2] == num_tokens)
                        else attn_mask
                    )
                    chunks.append(sdpa_orig(qc, k, v, attn_mask=mc, **sdpa_kwargs))
                else:
                    chunks.append(sdpa_orig(qc, k, v, **sdpa_kwargs))
            return torch.cat(chunks, dim=token_dim).contiguous()

        if is_pre_ampere and torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

        try:
            if is_pre_ampere and sdpa_orig is not None:
                torch.nn.functional.scaled_dot_product_attention = _guarded_pre_ampere_sdpa
            with torch.no_grad(), autocast_context:
                mesh, _global_info = pipeline.run_image(
                    image,
                    bake_resolution=texture_resolution,
                    remesh=remesh_option,
                    vertex_count=target_vertex_count,
                )
        finally:
            if is_pre_ampere and sdpa_orig is not None:
                torch.nn.functional.scaled_dot_product_attention = sdpa_orig
            if is_pre_ampere and torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()

        if isinstance(mesh, (list, tuple)):
            if len(mesh) != 1:
                raise RuntimeError(
                    f"SF3D single-image inference returned {len(mesh)} meshes; expected exactly one"
                )
            mesh = mesh[0]

        # If user disabled texture, strip visual maps for clean untextured export
        if not texture_enabled:
            import trimesh
            mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh)

        # Direct polycount refinement: if user requested target polycount higher than
        # native extracted triangles, apply direct subdivision to reach target density
        if native_target_polycount > 0 and len(mesh.faces) > 0 and native_target_polycount > len(mesh.faces):
            target_faces = min(600_000, native_target_polycount)
            while len(mesh.faces) < target_faces:
                if len(mesh.faces) * 2 > target_faces and len(mesh.faces) >= (target_faces * 0.7):
                    break
                mesh = mesh.subdivide()
                if len(mesh.faces) >= target_faces:
                    break

        vertices = getattr(mesh, "vertices", None)
        faces = getattr(mesh, "faces", None)
        if vertices is None or faces is None or len(vertices) == 0 or len(faces) == 0:
            raise RuntimeError("SF3D produced an empty mesh; no GLB artifact was created")

        output_dir: Path | None = None
        try:
            output_dir = Path(tempfile.mkdtemp(prefix="sf3d_"))
            output_path = output_dir / f"stable_fast_3d_{uuid.uuid4().hex[:12]}.glb"
            mesh.export(str(output_path), include_normals=True)
            if not output_path.is_file() or output_path.stat().st_size < 12:
                raise RuntimeError("SF3D GLB export produced an empty or missing file")
            with output_path.open("rb") as exported_file:
                if exported_file.read(4) != b"glTF":
                    raise RuntimeError("SF3D output is not a valid binary GLB file")
        except Exception:
            if output_dir is not None:
                shutil.rmtree(output_dir, ignore_errors=True)
            raise

        logger.info(
            "Stable Fast 3D inference complete: vertices=%d faces=%d "
            "texture_resolution=%d texture_enabled=%s output=%s",
            len(vertices),
            len(faces),
            texture_resolution,
            texture_enabled,
            output_path,
        )
        return {
            "success": True,
            "output_mesh_path": str(output_path),
            "mesh_path": str(output_path),
            "textured_mesh_path": str(output_path) if texture_enabled else None,
            "texture_enabled": texture_enabled,
            "actual_face_count": len(faces),
            "actual_vertex_count": len(vertices),
            "generation_info": {
                "seed": seed,
                "seed_applied": False,
                "texture_resolution": texture_resolution,
                "native_target_polycount": native_target_polycount or None,
                "faces": len(faces),
                "vertices": len(vertices),
                "remesh_option": remesh_option if remesh_option != "none" else None,
            },
            # The scheduler removes this private temp directory after durable copy.
            "_temporary_output_dir": str(output_dir),
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": (
                        "Provenance value only; upstream SF3D run_image has no seed control"
                    ),
                    "default": DEFAULT_SEED,
                    "minimum": 0,
                    "required": False,
                },
                "texture_resolution": {
                    "type": "integer",
                    "description": "Output texture atlas resolution in pixels",
                    "default": 1024,
                    "minimum": MIN_TEXTURE_RESOLUTION,
                    "maximum": MAX_TEXTURE_RESOLUTION,
                    "required": False,
                },
                "remesh_option": {
                    "type": "string",
                    "description": "Upstream remeshing operation",
                    "default": "none",
                    "enum": sorted(SUPPORTED_REMESH_OPTIONS),
                    "required": False,
                },
                "target_vertex_count": {
                    "type": "integer",
                    "description": "Approximate remesh target; -1 disables vertex-count targeting",
                    "default": -1,
                    "minimum": -1,
                    "required": False,
                },
            }
        }
