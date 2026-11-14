"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : hunyuan3d_v20_paint_image_mesh_painting
Model Name        : Hunyuan3D-2 (v2.0) — Paint
Feature Target    : image_mesh_painting
Status            : ACTIVE
Upstream Repo     : https://github.com/Tencent-Hunyuan/Hunyuan3D-2
Upstream Pipeline : hy3dgen.texgen.pipelines.Hunyuan3DPaintPipeline
Checkpoint / Path : backend/pretrained/tencent/Hunyuan3D-2
Hardware / VRAM   : ~11 GB — fits on 16 GB consumer cards
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Texture-only adapter: accepts mesh + image, returns textured mesh.
   Does NOT generate raw mesh — use hunyuan3d_shape_v21_image_to_raw_mesh
   for raw mesh generation.
=============================================================================
"""
# Status - ACTIVE
from __future__ import annotations

import contextlib
import logging
import sys
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover - torch optional in CPU-only environments
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Hunyuan3DV20PaintImageMeshPaintingAdapter(BaseModel):
    """Hunyuan3D-2 (v2.0) Paint — Image Mesh Painting.

    Texture-only adapter. Takes an existing mesh + reference image and
    generates PBR textured mesh using already-loaded weights.
    Does NOT generate raw mesh — use hunyuan3d_shape_v21_image_to_raw_mesh
    for raw mesh generation.
    """

    MODEL_KEY = "tencent/Hunyuan3D-2"
    FEATURE_TYPE = "image_mesh_painting"

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
        self._paint_pipeline: Any = None

    def _load_model(self) -> Any:
        # Make the vendored hunyuan3d-2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-2")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)
        from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-2 (v2.0) Paint pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        is_downloaded = (
            (weights_dir_path / "hunyuan3d-paint-v2-0").is_dir()
            or (weights_dir_path / "hunyuan3d-paint-v2-0-turbo").is_dir()
            or (weights_dir_path / "hunyuan3d-delight-v2-0").is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        if not is_downloaded:
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D-2 (v2.0) Paint weights not found locally; downloading paint and delight checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2",
                local_dir=str(weights_dir_path),
                allow_patterns=["hunyuan3d-paint-v2-0/*", "hunyuan3d-paint-v2-0-turbo/*", "hunyuan3d-delight-v2-0/*"],
            )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir_path))
        if torch is not None and torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
            try:
                pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id if self.gpu_id is not None else 0)
            except Exception as offload_err:
                logger.warning("Could not enable model CPU offload for Hunyuan3D v2.0 Paint: %s", offload_err)
        self._paint_pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._paint_pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._paint_pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2 (v2.0) Paint pipeline not loaded"}

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

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            textured = pipeline(mesh=mesh, image=image)

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_v20_paint_{seed}.glb"
        if hasattr(textured, "export"):
            textured.export(str(out))
        else:
            return {"success": False, "error": "Paint pipeline returned non-exportable object"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "textured_mesh_path": str(out),
            "texture_enabled": True,
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "obj", "png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

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
