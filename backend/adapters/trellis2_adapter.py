"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TRELLIS.2 Image-to-3D & Painting Adapter (Disabled by Default)              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/TRELLIS.2 (Trellis2ImageTo3DPipeline)         ║
║  Weights  : backend/pretrained/TRELLIS.2 (fail-fast; no auto-download)        ║
║  Patcher  : patcher.trellis2 (applied in worker process)                     ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import contextlib
import logging
import os
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from core.models.base import BaseModel, ModelStatus
from core.utils.upstream import resolve_pretrained, use_thirdparty
from .trellis2_mesh_validation import validate_mesh_arrays

logger = logging.getLogger(__name__)


# ── 1. Adapter Class ──────────────────────────────────────────────────────────

class Trellis2ImageToRawMeshAdapter(BaseModel):
    """TRELLIS.2 — Image to Raw Mesh."""

    MODEL_KEY = "TRELLIS.2"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=None,
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.status = ModelStatus.UNLOADED
        self.native_topology = False
        self.version = "1.0"
        self._pipeline: Any = None
        self._paint_pipeline: Any = None

    # ── 2. Lifecycle (Load / Unload) ──────────────────────────────────────────

    def _load_model(self) -> Any:
        is_pre_ampere, total_vram_gb = False, 0.0
        if torch is not None and torch.cuda.is_available():
            try:
                gpu_idx = int(self.gpu_id) if self.gpu_id is not None else torch.cuda.current_device()
                total_vram_gb = torch.cuda.get_device_properties(gpu_idx).total_memory / (1024 ** 3)
                is_pre_ampere = torch.cuda.get_device_capability(gpu_idx)[0] < 8
            except Exception:
                pass

        if not os.environ.get("SPARSE_CONV_BACKEND"):
            if is_pre_ampere:
                os.environ["SPARSE_CONV_BACKEND"] = "spconv"
            else:
                try:
                    import flex_gemm  # noqa: F401
                except ImportError:
                    os.environ["SPARSE_CONV_BACKEND"] = "spconv"
        if is_pre_ampere:
            if not os.environ.get("SPARSE_ATTN_BACKEND"):
                try:
                    import xformers  # noqa: F401
                    os.environ["SPARSE_ATTN_BACKEND"] = "xformers"
                except ImportError:
                    pass
            os.environ.setdefault("ATTN_BACKEND", "sdpa")

        weights_dir = resolve_pretrained(self.MODEL_KEY)
        pipeline_path = weights_dir / "TRELLIS.2-4B" if (weights_dir / "TRELLIS.2-4B" / "pipeline.json").is_file() else weights_dir
        if not (pipeline_path / "pipeline.json").is_file():
            raise FileNotFoundError(f"TRELLIS.2 pipeline.json missing under {weights_dir}")

        with use_thirdparty("TRELLIS.2", chdir=False):
            from trellis2.pipelines.trellis2_image_to_3d import Trellis2ImageTo3DPipeline

            pipeline = Trellis2ImageTo3DPipeline.from_pretrained(str(pipeline_path))
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch and torch.cuda.is_available() else "cpu"
            pipeline.low_vram = (device == "cpu") or (total_vram_gb < 22.0)
            pipeline.to(device)

        self._pipeline = self._paint_pipeline = self.model = pipeline
        self.device = device
        try:
            from patcher.trellis2 import apply_patch
            apply_patch()
        except Exception as exc:
            logger.warning("TRELLIS.2 patcher skipped: %s", exc)
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = self._paint_pipeline = self.model = None

    # ── 3. Inference & Export ─────────────────────────────────────────────────

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            return {"success": False, "error": "TRELLIS.2 pipeline not loaded"}
        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        from PIL import Image
        import trimesh

        seed = int(inputs["seed"])
        img = Image.open(image_path)
        image = img.convert("RGBA") if (img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in getattr(img, "info", {}))) else img.convert("RGB")

        mesh, used_seed = None, seed
        for attempt in range(3):
            used_seed = seed + attempt * 1337
            with (torch.no_grad() if torch is not None else contextlib.nullcontext()):
                meshes = self._pipeline.run(
                    image, seed=used_seed, pipeline_type="1536_cascade",
                    max_num_tokens=49152, generate_texture=False,
                    sparse_structure_sampler_params={"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.7, "guidance_interval": [0.6, 1.0], "rescale_t": 5.0},
                    shape_slat_sampler_params={"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.5, "guidance_interval": [0.6, 1.0], "rescale_t": 3.0},
                )
            candidate = meshes[0] if meshes else None
            if candidate is not None:
                try:
                    validate_mesh_arrays(candidate.vertices, candidate.faces, stage="decoded mesh")
                    mesh = candidate
                    break
                except ValueError:
                    continue

        if mesh is None:
            return {"success": False, "error": "TRELLIS.2 produced no valid mesh"}

        out = self._create_temporary_output_dir("trellis2") / f"trellis2_{used_seed}.glb"
        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=False)
        mesh.export(str(out))
        reloaded = trimesh.load(str(out), force="mesh", process=False)
        validate_mesh_arrays(reloaded.vertices, reloaded.faces, stage="GLB round-trip")
        return {
            "success": True, "output_mesh_path": str(out), "mesh_path": str(out),
            "generation_info": {"seed": used_seed, "pipeline_type": "1536_cascade", "max_num_tokens": 49152, "generate_texture": False},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {"seed": {"type": "integer", "minimum": 0, "required": False}}}


class Trellis2ImageTo3DAdapter(Trellis2ImageToRawMeshAdapter):
    """TRELLIS.2 — Image to 3D (raw mesh alias)."""


class Trellis2ImageMeshPaintingAdapter(Trellis2ImageToRawMeshAdapter):
    """TRELLIS.2 — Image Mesh Painting."""

    FEATURE_TYPE = "image_mesh_painting"

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            return {"success": False, "error": "TRELLIS.2 texturing pipeline not loaded"}
        mesh_path, image_path = inputs.get("mesh_path"), inputs.get("image_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        from PIL import Image
        import trimesh

        seed = int(inputs["seed"])
        mesh = trimesh.load(mesh_path, process=False)
        img = Image.open(image_path)
        image = img.convert("RGBA") if (img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in getattr(img, "info", {}))) else img.convert("RGB")

        with (torch.no_grad() if torch is not None else contextlib.nullcontext()):
            textured = self._pipeline(mesh=mesh, image=image, seed=seed)
        if not hasattr(textured, "export"):
            return {"success": False, "error": "Texturing pipeline returned non-exportable object"}

        out = self._create_temporary_output_dir("trellis2_paint") / f"trellis2_paint_{seed}.glb"
        textured.export(str(out))
        return {
            "success": True, "output_mesh_path": str(out), "mesh_path": str(out),
            "generation_info": {"seed": seed, "pipeline_type": "1024_cascade", "max_num_tokens": 49152},
        }
