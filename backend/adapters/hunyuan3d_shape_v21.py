"""Hunyuan3D-2.1 Shape adapter — thin integration over the official ThirdParty
inference API.

Wraps ``hy3dshape.hy3dshape.pipelines.Hunyuan3DDiTFlowMatchingPipeline`` from
``backend/thirdparty/Hunyuan3D-2.1``. Weights are resolved through
``backend.loader.get_model_weights_dir``. Inference schedules (steps, guidance,
octree resolution, chunks) are adapter-owned and stripped by the scheduler.
"""

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


class Hunyuan3DShapeV21ImageToRawMeshAdapter(BaseModel):
    """Adapter for Hunyuan3D-2.1 Shape image-to-raw-mesh generation."""

    MODEL_KEY = "tencent/Hunyuan3D-2.1"
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
        # Make the vendored hunyuan3d-2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Hunyuan3D-2.1")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)
        from hy3dshape.hy3dshape.pipelines import (
            Hunyuan3DDiTFlowMatchingPipeline,
        )

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-2.1 Shape pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        if not (weights_dir_path / "config.json").is_file():
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D-2.1 Shape weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2.1..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2.1",
                local_dir=str(weights_dir_path),
            )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            str(weights_dir_path),
            device=device,
        )
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2.1 Shape pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            outputs = pipeline(
                image=image_path,
                num_inference_steps=50,
                guidance_scale=7.5,
                octree_resolution=1300,
                num_chunks=8000,
                output_type="trimesh",
            )

        # pipeline returns List[List[trimesh.Trimesh]]
        meshes = outputs[0] if isinstance(outputs, list) and outputs else []
        if not meshes:
            return {"success": False, "error": "Hunyuan3D-2.1 Shape produced no mesh"}

        mesh = meshes[0]

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_shape_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": 50,
                "guidance_scale": 7.5,
                "octree_resolution": 1300,
                "num_chunks": 8000,
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
