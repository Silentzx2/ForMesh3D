"""FastMesh adapter — thin integration over the official ThirdParty inference
API.

Wraps ``models.MODELS[...].from_pretrained`` from ``backend/thirdparty/FastMesh``.
Neural quad retopology (V1K/V4K fixed-budget variants). Weights resolved
through ``backend.loader.get_model_weights_dir``.
"""

from __future__ import annotations

import contextlib
import logging
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


class FastMeshRetopologyAdapter(BaseModel):
    """FastMesh — Retopology (V1K/V4K fixed-budget variants)."""

    MODEL_KEY = "FastMesh-V1K"
    FEATURE_TYPE = "mesh_retopology"

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
        self._model: Any = None

    def _load_model(self) -> Any:
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading FastMesh model from %s", weights_dir)
        thirdparty_dir = Path(weights_dir).resolve().parent
        import sys

        if str(thirdparty_dir) not in sys.path:
            sys.path.insert(0, str(thirdparty_dir))
        from models import MODELS

        variant = self.MODEL_KEY.split("-")[-1]  # "V1K" / "V4K"
        model = MODELS["fastmesh"].from_pretrained(
            f"WopperSet/FastMesh-{variant}"
        )
        model.eval()
        self._model = model
        self.model = model
        return model

    def _unload_model(self) -> None:
        self._model = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        model = self._model
        if model is None:
            return {"success": False, "error": "FastMesh model not loaded"}

        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        target_vertex_count = int(inputs.get("target_vertex_count", 1000))

        import numpy as np
        import trimesh
        import tempfile

        # FastMesh retopology takes a point-cloud input (vertices + normals).
        mesh = trimesh.load(mesh_path, process=False)
        points, _ = mesh.sample(50000, return_index=True)
        np.random.seed(seed)
        normals = mesh.face_normals[
            np.random.choice(len(mesh.face_normals), len(points), replace=True)
        ]
        pc_normal = np.concatenate([points, normals], axis=-1).astype(np.float16)
        input_shape = torch.from_numpy(pc_normal).unsqueeze(0)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            recon_meshes = model({"pc_normal": input_shape}, is_eval=True)

        out_mesh = recon_meshes[0]

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"fastmesh_{seed}.obj"
        out_mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "target_vertex_count": target_vertex_count,
                "variant": self.MODEL_KEY,
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb", "ply", "stl"], "output": ["obj", "glb", "ply"]}

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
                "target_vertex_count": {
                    "type": "integer",
                    "description": "Target vertex count (must match V1K/V4K variant)",
                    "default": 1000,
                    "required": False,
                },
            }
        }
