"""Hi3D adapter — thin integration over the official ThirdParty inference API.

Wraps ``sparc3d.pipelines.sparc3d_pipeline.Sparc3DPipeline`` from
``backend/thirdparty/Hi3D``. Hi3D is a geometry refinement pipeline: it takes a
reference image *and* a coarse mesh, consistent with
``models.yaml`` (``supported_inputs: [image, mesh]``). Weights are resolved
through ``backend.loader.get_model_weights_dir``.
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


class Hi3DImageToRawMeshAdapter(BaseModel):
    """Adapter for Hi3D image-to-raw-mesh refinement."""

    MODEL_KEY = "Hi3D"
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
        self.experimental = True
        self._pipeline: Any = None

    def _load_model(self) -> Any:
        # Make the vendored Hi3D source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _hi3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Hi3D")
        if _hi3d_root not in sys.path:
            sys.path.insert(0, _hi3d_root)
        from sparc3d.pipelines.sparc3d_pipeline import Sparc3DPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hi3D pipeline from %s", weights_dir)
        pipeline = Sparc3DPipeline.from_pretrained(str(weights_dir))
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
            return {"success": False, "error": "Hi3D pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        # Hi3D refines an existing coarse mesh; for a raw generation request the
        # caller may supply one via inputs["mesh_path"], otherwise we cannot
        # refine and report a clear error rather than fabricating geometry.
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {
                "success": False,
                "error": "Hi3D requires a coarse mesh input (inputs['mesh_path'])",
            }

        seed = int(inputs.get("seed", DEFAULT_SEED))
        resolution = int(inputs.get("resolution", 1024))
        steps = int(inputs.get("num_inference_steps", 25))

        from PIL import Image

        image = Image.open(image_path)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            import trimesh

            coarse_mesh = trimesh.load(mesh_path, process=False)
            output = pipeline(
                image=image,
                coarse_mesh=coarse_mesh,
                resolution=resolution,
                num_inference_steps=steps,
                seed=seed,
            )

        mesh = getattr(output, "mesh", None) if output is not None else None
        if mesh is None:
            return {"success": False, "error": "Hi3D produced no mesh"}

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hi3d_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": steps,
                "resolution": resolution,
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp", "glb", "obj"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": DEFAULT_SEED,
                    "minimum": 0,
                    "required": False,
                },
                "resolution": {
                    "type": "integer",
                    "description": "Output resolution (512, 1024, or 1536)",
                    "default": 1024,
                    "required": False,
                },
            }
        }


class Hi3DImageToTexturedMeshAdapter(Hi3DImageToRawMeshAdapter):
    """Hi3D — Image to Textured Mesh (raw mesh output via alias)."""

    MODEL_KEY = "Hi3D"
    FEATURE_TYPE = "image_to_raw_mesh"
