"""TRELLIS adapter — thin integration over the official ThirdParty inference API.

Wraps ``trellis.pipelines.trellis_image_to_3d.TrellisImageTo3DPipeline`` from
``backend/thirdparty/TRELLIS``. Weights are resolved through
``backend.loader.get_model_weights_dir``. Only the seed and image identity are
caller-controlled; inference schedules (steps, guidance, octree resolution,
samplers) are adapter-owned and stripped by the scheduler before reaching here.
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
from huggingface_hub import hf_hub_download

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class _TrellisBaseAdapter(BaseModel):
    """Shared base for TRELLIS adapters.

    Subclasses set ``MODEL_KEY`` (weights-dir key) and ``feature_type``.
    """

    MODEL_KEY: str = ""
    FEATURE_TYPE: str = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        # ModelFactory calls model_class(**init_params) where init_params holds
        # only vram_requirement (plus model-specific keys from models.yaml).
        # model_id / feature_type are assigned by the factory after
        # construction, so we initialise them here and let the factory override.
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
        # Make the vendored TRELLIS source importable in the worker subprocess,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _trellis_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS")
        if _trellis_root not in sys.path:
            sys.path.insert(0, _trellis_root)
        from trellis.pipelines.trellis_image_to_3d import TrellisImageTo3DPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        weights_dir_path = Path(weights_dir)
        logger.info("Loading TRELLIS pipeline from %s", weights_dir)

        # If the local weights directory is incomplete, download pipeline.json
        # from HuggingFace Hub so the vendored Pipeline.from_pretrained can
        # resolve everything locally afterwards.
        pipeline_json = weights_dir_path / "pipeline.json"
        if not pipeline_json.is_file():
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "TRELLIS pipeline.json not found locally; downloading from "
                "HuggingFace Hub microsoft/TRELLIS..."
            )
            hf_hub_download(
                repo_id="microsoft/TRELLIS.2-4B",
                filename="pipeline.json",
                local_dir=str(weights_dir_path),
            )

        pipeline = TrellisImageTo3DPipeline.from_pretrained(str(weights_dir))
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TRELLIS pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path:
            return {"success": False, "error": "image_path is required"}
        if not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        from PIL import Image

        image = Image.open(image_path)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            result = pipeline.run(image, seed=seed, formats=["mesh"])

        mesh = result.get("mesh") if isinstance(result, dict) else None
        if mesh is None:
            return {"success": False, "error": "TRELLIS produced no mesh"}

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"trellis_{seed}.glb"
        mesh.export(str(out))

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


class TrellisImageToRawMeshAdapter(_TrellisBaseAdapter):
    """TRELLIS — Image to Raw Mesh."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_to_raw_mesh"


class TrellisImageTo3DAdapter(_TrellisBaseAdapter):
    """TRELLIS — Image to 3D (raw mesh alias)."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_to_raw_mesh"


class TrellisTextMeshPaintingAdapter(_TrellisBaseAdapter):
    """TRELLIS — Text Mesh Painting (raw mesh output)."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "text_mesh_painting"


class TrellisImageMeshPaintingAdapter(_TrellisBaseAdapter):
    """TRELLIS — Image Mesh Painting (raw mesh output)."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_mesh_painting"
