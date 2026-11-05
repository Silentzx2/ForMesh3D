"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : trellis2_image_to_3d / trellis2_image_to_raw_mesh / trellis2_image_to_textured_mesh
Model Name        : TRELLIS.2 — Image to 3D / Raw Mesh / Textured Mesh
Feature Target    : image_to_3d / image_to_raw_mesh / image_to_textured_mesh
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/microsoft/TRELLIS.2
Upstream Pipeline : trellis2.pipelines.trellis2_image_to_3d.Trellis2ImageTo3DPipeline
Checkpoint / Path : backend/pretrained/microsoft/TRELLIS.2-4B
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Inference schedules and sparse structures are adapter-owned.
=============================================================================
"""
# Status - BETA / ACTIVE
from __future__ import annotations

import contextlib
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover - torch optional in CPU-only environments
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir
from huggingface_hub import snapshot_download

from .trellis2_mesh_validation import validate_mesh_arrays

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Trellis2ImageToRawMeshAdapter(BaseModel):
    """TRELLIS.2 — Image to Raw Mesh."""

    MODEL_KEY = "TRELLIS.2"
    FEATURE_TYPE = "image_to_raw_mesh"

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

    def _load_model(self) -> Any:
        # Pre-Ampere detection (sm < 80, e.g. Tesla T4 sm_75):
        # Configure fallback attention backends ONLY on pre-Ampere GPUs.
        # Modern GPUs (sm >= 80, e.g. A100, RTX 4090, H100) MUST preserve native FlashAttention!
        device_is_pre_ampere = False
        if torch is not None and torch.cuda.is_available():
            try:
                gpu_idx = int(self.gpu_id) if self.gpu_id is not None else torch.cuda.current_device()
                device_is_pre_ampere = torch.cuda.get_device_capability(gpu_idx)[0] < 8
            except Exception:
                device_is_pre_ampere = False

        # Ensure sparse conv defaults to spconv if flex_gemm is not explicitly requested or available
        if not os.environ.get("SPARSE_CONV_BACKEND"):
            try:
                import flex_gemm  # noqa: F401
            except ImportError:
                os.environ["SPARSE_CONV_BACKEND"] = "spconv"

        if device_is_pre_ampere:
            # On pre-Ampere (T4 sm_75), prefer xFormers for sparse and SDPA for dense attention
            if not os.environ.get("SPARSE_ATTN_BACKEND"):
                try:
                    import xformers  # noqa: F401
                    os.environ["SPARSE_ATTN_BACKEND"] = "xformers"
                except ImportError:
                    pass
            if not os.environ.get("ATTN_BACKEND"):
                os.environ["ATTN_BACKEND"] = "sdpa"

        # Make the vendored TRELLIS.2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _trellis2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS.2")
        if _trellis2_root not in sys.path:
            sys.path.insert(0, _trellis2_root)
        from trellis2.pipelines.trellis2_image_to_3d import Trellis2ImageTo3DPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading TRELLIS.2 pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        # weights download to nested TRELLIS.2-4B/ subfolder per download_models.sh
        alt_weights_dir = weights_dir_path / "TRELLIS.2-4B"

        def _has_pipeline(d: Path) -> bool:
            return (d / "pipeline.json").is_file()

        if not _has_pipeline(weights_dir_path) and not _has_pipeline(alt_weights_dir):
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "TRELLIS.2 weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub microsoft/TRELLIS.2-4B..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="microsoft/TRELLIS.2-4B",
                local_dir=str(weights_dir_path),
            )
            pipeline_path = weights_dir_path
        elif _has_pipeline(alt_weights_dir):
            pipeline_path = alt_weights_dir
        else:
            pipeline_path = weights_dir_path

        pipeline = Trellis2ImageTo3DPipeline.from_pretrained(str(pipeline_path))
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch.cuda.is_available() else "cpu"

        # Determine whether to use low-VRAM CPU offload or keep all models resident in VRAM.
        # Across all stages, TRELLIS.2 weights total ~14.2 GB. Keeping everything in VRAM
        # without CPU offload requires >= 22 GB VRAM (e.g. RTX 3090/4090 24GB, A100 40GB/80GB).
        # On cards with < 22 GB VRAM (e.g. T4 16GB, P100 16GB, V100 16GB, 8-12GB consumer cards),
        # low_vram=True moves submodels CPU->GPU->CPU sequentially, keeping peak VRAM under 4 GB.
        total_vram_gb = 0.0
        is_pre_ampere = False
        if device.startswith("cuda") and torch is not None and torch.cuda.is_available():
            try:
                gpu_idx = int(self.gpu_id) if self.gpu_id is not None else torch.cuda.current_device()
                props = torch.cuda.get_device_properties(gpu_idx)
                total_vram_gb = props.total_memory / (1024 ** 3)
                is_pre_ampere = torch.cuda.get_device_capability(gpu_idx)[0] < 8
            except Exception:
                total_vram_gb = 0.0
                is_pre_ampere = False

        # Note: TRELLIS.2 models and conditioning remain in their native trained precision
        # (BFloat16 for DiT flow models, FP16 for decoders). full_attn.py handles SDPA
        # pre-Ampere acceleration safely at the kernel level without weight conversion drift.
        use_low_vram = (device == "cpu") or (total_vram_gb < 22.0)
        pipeline.low_vram = use_low_vram
        pipeline.to(device)

        self._pipeline = pipeline
        self.model = pipeline
        self.device = device
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TRELLIS.2 pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        from PIL import Image

        image = Image.open(image_path)
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in getattr(image, "info", {})):
            image = image.convert("RGBA")
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Retry on hollow-box output: the sparse-structure flow can under-converge
        # on some seeds, emitting a domain-cube instead of the input object.
        # TEMP TEST CONFIG: max_attempts=3 for hollow-box recovery; restore to 3 after stable.
        max_attempts = 3
        mesh = None
        used_seed = seed
        decoded_stats = None
        for attempt in range(max_attempts):
            attempt_seed = seed + attempt * 1337  # seed_step from quality.yaml
            ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
            with ctx:
                # TEMP TEST CONFIG: 1024_cascade + 10 steps for faster results.
                # Restore to 1536_cascade + 50 steps after stable.
                meshes = pipeline.run(
                    image,
                    seed=attempt_seed,
                    pipeline_type="1024_cascade",
                    max_num_tokens=49152,
                    generate_texture=False,
                    sparse_structure_sampler_params={
                        "steps": 10,
                        "guidance_strength": 7.5,
                        "guidance_rescale": 1.0,
                        "rescale_t": 1.0,
                    },
                    shape_slat_sampler_params={
                        "steps": 10,
                        "guidance_strength": 7.5,
                        "guidance_rescale": 1.0,
                        "rescale_t": 1.0,
                    },
                )

            mesh_list = meshes if isinstance(meshes, list) else [meshes]
            if not mesh_list:
                continue

            candidate = mesh_list[0]
            vertices = candidate.vertices.detach().cpu().numpy()
            faces = candidate.faces.detach().cpu().numpy()
            try:
                decoded_stats = validate_mesh_arrays(vertices, faces, stage="decoded mesh")
                mesh = candidate
                used_seed = attempt_seed
                break
            except ValueError as exc:
                if "hollow domain bounding box" not in str(exc) or attempt == max_attempts - 1:
                    logger.error("TRELLIS.2 rejected decoded mesh for seed %s: %s", attempt_seed, exc)
                    return {"success": False, "error": f"TRELLIS.2 mesh validation failed: {exc}"}
                logger.warning("TRELLIS.2 hollow box for seed %s, retrying with seed %s", attempt_seed, attempt_seed + 1337)

        if mesh is None:
            return {"success": False, "error": "TRELLIS.2 failed to produce valid mesh after all attempts"}
        assert decoded_stats is not None

        import tempfile
        import trimesh

        out = Path(tempfile.mkdtemp()) / f"trellis2_{used_seed}.glb"
        # Validate model-native arrays before trimesh processing can hide invalid geometry.
        vertices = mesh.vertices.detach().cpu().numpy()
        faces = mesh.faces.detach().cpu().numpy()
        raw_mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        raw_mesh.remove_unreferenced_vertices()
        try:
            processed_stats = validate_mesh_arrays(
                raw_mesh.vertices, raw_mesh.faces, stage="processed mesh"
            )
        except ValueError as exc:
            logger.error("TRELLIS.2 rejected processed mesh for seed %s: %s", used_seed, exc)
            return {"success": False, "error": f"TRELLIS.2 mesh processing produced invalid geometry: {exc}"}

        raw_mesh.export(str(out), file_type="glb")
        try:
            reloaded_mesh = trimesh.load(str(out), force="mesh", process=False)
            roundtrip_stats = validate_mesh_arrays(
                reloaded_mesh.vertices, reloaded_mesh.faces, stage="GLB round-trip"
            )
        except Exception as exc:
            logger.exception("TRELLIS.2 GLB round-trip validation failed for seed %s", used_seed)
            return {"success": False, "error": f"TRELLIS.2 exported GLB failed validation: {exc}"}

        logger.info(
            "TRELLIS.2 raw GLB validated: seed=%s vertices=%s faces=%s degenerate=%s "
            "bbox_extents=%s bytes=%s decoded_faces=%s roundtrip_faces=%s",
            used_seed,
            processed_stats["vertex_count"],
            processed_stats["face_count"],
            processed_stats["degenerate_faces"],
            processed_stats["bbox_extents"],
            out.stat().st_size,
            decoded_stats["face_count"],
            roundtrip_stats["face_count"],
        )

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": used_seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
                "pipeline_type": "1024_cascade",
                "max_num_tokens": 49152,
                "generate_texture": False,
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": DEFAULT_SEED,
                    "minimum": 0,
                    "required": False,
                }
            }
        }


class Trellis2ImageTo3DAdapter(Trellis2ImageToRawMeshAdapter):
    """TRELLIS.2 — Image to 3D (raw mesh alias)."""

    MODEL_KEY = "TRELLIS.2"
    FEATURE_TYPE = "image_to_raw_mesh"


class Trellis2ImageMeshPaintingAdapter(Trellis2ImageToRawMeshAdapter):
    """TRELLIS.2 — Image Mesh Painting."""

    MODEL_KEY = "TRELLIS.2"
    FEATURE_TYPE = "image_mesh_painting"

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TRELLIS.2 texturing pipeline not loaded"}

        mesh_path = inputs.get("mesh_path")
        image_path = inputs.get("image_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        import trimesh
        from PIL import Image

        mesh = trimesh.load(mesh_path, process=False)
        image = Image.open(image_path)
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in getattr(image, "info", {})):
            image = image.convert("RGBA")
        elif image.mode != "RGB":
            image = image.convert("RGB")

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            textured = pipeline(
                mesh=mesh,
                image=image,
                seed=seed,
            )

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"trellis2_paint_{seed}.glb"
        if hasattr(textured, "export"):
            textured.export(str(out))
        else:
            return {"success": False, "error": "Texturing pipeline returned non-exportable object"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
                "pipeline_type": "1024_cascade",
                "max_num_tokens": 49152,
            },
        }
