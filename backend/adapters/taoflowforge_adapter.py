"""TaoFlowForge adapter — thin integration over the official ThirdParty
inference API.

Wraps ``taoflowforge.pipeline.TaoFlowForgePipeline`` from
``backend/thirdparty/Taobao3D/TaoFlowForge``. TaoFlowForge is a progressive
native mesh generator (image -> mesh) whose CLI is
``taoflowforge.cli.main``. Weights resolved through
``backend.loader.get_model_weights_dir``. Disabled by default in
``models.yaml`` (``enabled: false``).
"""

from __future__ import annotations

import contextlib
import logging
import sys
import tempfile
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


class TaoFlowForgeImageToRawMeshAdapter(BaseModel):
    """TaoFlowForge — Image to Raw Mesh (progressive native mesh)."""

    MODEL_KEY = "Taobao3D/TaoFlowForge"
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
        self.native_topology = True
        self.model: Any = None
        self.device = "cpu"
        self.dtype = None
        self.version = "1.0"
        self.experimental = False
        self._pipeline: Any = None

    def _load_model(self) -> Any:
        # Make the vendored TaoFlowForge source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _tao_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Taobao3D" / "TaoFlowForge")
        if _tao_root not in sys.path:
            sys.path.insert(0, _tao_root)
        from taoflowforge.pipeline import TaoFlowForgePipeline
        from taoflowforge.config import (
            InferenceConfig,
            Stage0Config,
            Stage1Config,
            Stage2Config,
        )

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading TaoFlowForge pipeline from %s", weights_dir)
        config = InferenceConfig(
            stage0=Stage0Config(checkpoint=weights_dir / "stage0.pt", num_steps=50, cfg_scale=7.5),
            stage1=Stage1Config(checkpoint=weights_dir / "stage1.pt", num_steps=30, cfg_scale=7.0),
            stage2=Stage2Config(checkpoint=weights_dir / "stage2.pt", num_steps=50, cfg_scale=3.0),
            seed=DEFAULT_SEED,
            offload="auto",
            fill_holes=True,
            image_size=512,
            output_dir=str(Path(tempfile.gettempdir()) / "taoflowforge"),
        )
        pipeline = TaoFlowForgePipeline.from_config(config, device=f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu")
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TaoFlowForge pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        import tempfile

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            result = None
            for update in pipeline.iter_run(image_path, seed=seed, show_progress=False):
                if update.result is not None:
                    result = update.result
            if result is None or not result.glb_path:
                return {"success": False, "error": "TaoFlowForge produced no mesh"}

        out = Path(result.glb_path)
        if not out.is_file():
            return {"success": False, "error": f"TaoFlowForge output not found: {out}"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
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
