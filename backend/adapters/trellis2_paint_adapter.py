"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : trellis2_image_mesh_painting
Model Name        : TRELLIS.2 Paint — Image Mesh Painting
Feature Target    : image_mesh_painting
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/microsoft/TRELLIS.2
Upstream Pipeline : trellis2.pipelines.trellis2_texturing.Trellis2TexturingPipeline
Checkpoint / Path : backend/pretrained/microsoft/TRELLIS.2-4B
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Uses official pipeline.run(mesh=mesh, image=image, seed=seed).
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


class Trellis2ImageMeshPaintingAdapter(BaseModel):
    """TRELLIS.2 — Image Mesh Painting."""

    MODEL_KEY = "TRELLIS.2"
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
        # Make the vendored TRELLIS.2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _trellis2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS.2")
        if _trellis2_root not in sys.path:
            sys.path.insert(0, _trellis2_root)
        from trellis2.pipelines.trellis2_texturing import Trellis2TexturingPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading TRELLIS.2 texturing pipeline from %s", weights_dir)
        pipeline = Trellis2TexturingPipeline.from_pretrained(str(weights_dir))
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline.to(device)
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

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
        image = Image.open(image_path).convert("RGB")

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            textured = pipeline.run(
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
