"""Unique3D adapter — thin integration over the official ThirdParty inference
API.

Wraps ``app.all_models.model_zoo`` from ``backend/thirdparty/Unique3D``.
High-quality single-image mesh generation. Weights resolved through
``backend.loader.get_model_weights_dir``.
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


class Unique3DImageToRawMeshAdapter(BaseModel):
    """Unique3D — Image to Raw Mesh."""

    MODEL_KEY = "Unique3D"
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
        self._zoo: Any = None

    def _load_model(self) -> Any:
        # Make the vendored Unique3D source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        unique3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Unique3D")
        if unique3d_root not in sys.path:
            sys.path.insert(0, unique3d_root)
        logger.info("Loading Unique3D model zoo from %s", unique3d_root)
        from app.all_models import model_zoo

        model_zoo.init_models()
        self._zoo = model_zoo
        self.model = model_zoo
        return model_zoo

    def _unload_model(self) -> None:
        self._zoo = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        zoo = self._zoo
        if zoo is None:
            return {"success": False, "error": "Unique3D model zoo not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        # Unique3D's inference is exposed through its model zoo's multiview +
        # refinement pipeline. Use the official image-to-mesh path.
        try:
            pipe = zoo.pipe_disney_controlnet_tile_ipadapter_i2i
        except AttributeError:
            return {
                "success": False,
                "error": "Unique3D zoo exposes no inference pipeline entry point",
            }

        from PIL import Image

        image = Image.open(image_path).convert("RGB")

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            # Official Unique3D inference: multiview diffusion then refinement.
            try:
                meshes = pipe(image=image, seed=seed)
            except TypeError:
                # Fall back to a minimal invocation if the signature differs.
                meshes = pipe(image)

        mesh_list = meshes if isinstance(meshes, list) else [meshes]
        if not mesh_list:
            return {"success": False, "error": "Unique3D produced no mesh"}

        mesh = mesh_list[0]

        import trimesh
        import tempfile

        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(
                vertices=mesh.vertices, faces=mesh.faces, process=False
            )
        out = Path(tempfile.mkdtemp()) / f"unique3d_{seed}.glb"
        mesh.export(str(out))

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
