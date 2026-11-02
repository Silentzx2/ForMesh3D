"""Pixal3D adapter — thin integration over the official ThirdParty inference
API.

Wraps ``pixal3d.pipelines.Pixal3DImageTo3DPipeline`` from
``backend/thirdparty/Pixal3D``. Pixel-aligned 3D generation from a single image
with PBR textures. Weights resolved through ``backend.loader.get_model_weights_dir``.
"""

from __future__ import annotations

import contextlib
import logging
import math
import sys
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Pixal3DImageToRawMeshAdapter(BaseModel):
    """Pixal3D — Image to Raw Mesh (pixel-aligned projection)."""

    MODEL_KEY = "Pixal3D"
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
        # Make the vendored Pixal3D source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _pixal3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Pixal3D")
        if _pixal3d_root not in sys.path:
            sys.path.insert(0, _pixal3d_root)
        from pixal3d.pipelines import Pixal3DImageTo3DPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Pixal3D pipeline from %s", weights_dir)
        pipeline = Pixal3DImageTo3DPipeline.from_pretrained(str(weights_dir))
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        dtype = torch.float16 if torch is not None and torch.cuda.is_available() else torch.float32
        pipeline.to(device, dtype)
        # Pixal3D's image_cond_model_* attributes must be loaded externally
        # (DinoV3ProjFeatureExtractor instances). Load them from HF if available.
        try:
            from pixal3d.models import DinoV3ProjFeatureExtractor
            pipeline.image_cond_model_ss = DinoV3ProjFeatureExtractor.from_pretrained(
                "facebook/dinov3-vitl16-pretrain-lvd1689m"
            ).to(device, dtype)
            pipeline.image_cond_model_shape_512 = DinoV3ProjFeatureExtractor.from_pretrained(
                "facebook/dinov3-vitl16-pretrain-lvd1689m"
            ).to(device, dtype)
            pipeline.image_cond_model_shape_1024 = DinoV3ProjFeatureExtractor.from_pretrained(
                "facebook/dinov3-vitl16-pretrain-lvd1689m"
            ).to(device, dtype)
            pipeline.image_cond_model_tex_1024 = DinoV3ProjFeatureExtractor.from_pretrained(
                "facebook/dinov3-vitl16-pretrain-lvd1689m"
            ).to(device, dtype)
        except Exception as exc:  # pragma: no cover - optional cond models
            logger.warning(
                "Pixal3D image_cond_model_* not loaded: %s; pipeline.run() "
                "will fail unless these are set externally.", exc
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
            return {"success": False, "error": "Pixal3D pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        resolution = int(inputs.get("resolution", 1024))

        from PIL import Image

        image = Image.open(image_path).convert("RGB")

        # Camera angle estimate matching the official app.py flow.
        width = image.size[0]
        camera_angle_x = 2 * math.atan(width / 32.0)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            mesh_list, _ = pipeline.run(
                image,
                camera_params={"camera_angle_x": camera_angle_x, "distance": 2.0},
                seed=seed,
                preprocess_image=False,
                return_latent=True,
                pipeline_type=f"{resolution}_cascade",
                max_num_tokens=49152,
            )

        mesh = mesh_list[0] if mesh_list else None
        if mesh is None:
            return {"success": False, "error": "Pixal3D produced no mesh"}

        import trimesh
        import tempfile

        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(
                vertices=mesh.vertices, faces=mesh.faces, process=False
            )
        out = Path(tempfile.mkdtemp()) / f"pixal3d_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "resolution": resolution,
                "camera_angle_x": camera_angle_x,
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
                },
                "resolution": {
                    "type": "integer",
                    "description": "Output resolution (512, 1024)",
                    "default": 1024,
                    "required": False,
                },
            }
        }
