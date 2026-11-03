"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : hunyuan3d_paint_v21_image_mesh_painting
Model Name        : Hunyuan3D Paint v2.1 — Image Mesh Painting
Feature Target    : image_mesh_painting
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
Upstream Pipeline : hy3dgen.texgen.pipelines.Hunyuan3DPaintPipeline
Checkpoint / Path : backend/pretrained/tencent/Hunyuan3D-2.1
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Maintain input validation (mesh_path & image_path) and CPU offloading hooks.
=============================================================================
"""
# Status - BETA / ACTIVE

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


class Hunyuan3DPaintV21ImageMeshPaintingAdapter(BaseModel):
    """Hunyuan3D-2.1 Paint — Image Mesh Painting."""

    MODEL_KEY = "tencent/Hunyuan3D-2.1"
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
        self._pipeline: Any = None

    def _load_model(self) -> Any:
        # Make the vendored hunyuan3d-2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-2")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)
        from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-Paint pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        is_downloaded = (
            (weights_dir_path / "hunyuan3d-paintpbr-v2-1").is_dir()
            or (weights_dir_path / "hunyuan3d-dit-v2-1").is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        if not is_downloaded:
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D-Paint weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2.1..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2.1",
                local_dir=str(weights_dir_path),
            )
        try:
            pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir_path))
        except Exception as exc:
            logger.error(
                "Hunyuan3D-Paint failed to load (CUDA required): %s", exc
            )
            raise
        if torch is not None and torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
            try:
                pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id if self.gpu_id is not None else 0)
            except Exception as offload_err:
                logger.warning("Could not enable model CPU offload for Hunyuan3D-Paint: %s", offload_err)
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D-Paint pipeline not loaded"}

        mesh_path = inputs.get("mesh_path")
        image_path = inputs.get("image_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        import trimesh

        mesh = trimesh.load(mesh_path, process=False)
        from PIL import Image

        image = Image.open(image_path)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            textured = pipeline(mesh=mesh, image=image)

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"paint_v21_{seed}.glb"
        if hasattr(textured, "export"):
            textured.export(str(out))
        else:
            return {"success": False, "error": "Paint pipeline returned non-exportable object"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "texture_size": getattr(pipeline.config, "texture_size", 2048),
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "obj", "png", "jpg"], "output": ["glb", "obj"]}

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
