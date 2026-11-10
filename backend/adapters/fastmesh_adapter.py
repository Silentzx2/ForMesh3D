"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : fastmesh_v1k_retopology
Model Name        : FastMesh-V1K — Quad Retopology
Feature Target    : retopology
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/lucas-w-arnold/FastMesh
Upstream Pipeline : models.MODELS['MeshGen'].from_pretrained
Checkpoint / Path : backend/pretrained/FastMesh-V1K
Hardware / VRAM   : 6144 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Supports FastMesh-V1K fixed-budget quad retopology on GPU.
=============================================================================
"""
# Status - BETA / ACTIVE

from __future__ import annotations

import contextlib
import logging
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

import numpy as np
import trimesh

try:
    import torch
except ImportError:  # pragma: no cover - torch optional in CPU-only environments
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


def _prepare_fastmesh_point_cloud(
    mesh: "trimesh.Trimesh",
    seed: int,
    input_points: int = 8192,
    sample_points: int = 50000,
) -> "np.ndarray":
    """Prepare FastMesh's normalized point-cloud input using matching face normals.

    The upstream inference path normalizes the input mesh to a 1.9-unit longest
    extent, samples points with face indices, and feeds 8192 point/normal pairs.
    Keep this adapter contract aligned with that path without mutating the source.
    """
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected trimesh.Trimesh, got {type(mesh).__name__}")
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise ValueError("Cannot retopologize an empty mesh.")
    if input_points < 1 or sample_points < 1:
        raise ValueError("FastMesh point counts must be positive.")

    normalized = mesh.copy()
    bounds = np.asarray(normalized.bounds, dtype=np.float64)
    if bounds.shape != (2, 3) or not np.isfinite(bounds).all():
        raise ValueError("FastMesh input mesh has non-finite bounds.")
    center = (bounds[0] + bounds[1]) * 0.5
    scale = float(np.max(bounds[1] - bounds[0]))
    if not np.isfinite(scale) or scale <= np.finfo(np.float64).eps:
        raise ValueError("FastMesh input mesh has zero or invalid extent.")

    normalized.apply_translation(-center)
    normalized.apply_scale((2.0 * 0.95) / scale)

    points, face_indices = normalized.sample(int(sample_points), return_index=True)
    points = np.asarray(points, dtype=np.float64)
    face_indices = np.asarray(face_indices, dtype=np.int64)
    if len(points) == 0 or len(face_indices) != len(points):
        raise ValueError("FastMesh surface sampling returned an invalid point/face mapping.")

    # Critical: each sampled point gets the normal of the exact face it came from.
    normals = np.asarray(normalized.face_normals[face_indices], dtype=np.float64)
    count = min(int(input_points), len(points))
    selected = np.random.default_rng(int(seed)).choice(len(points), size=count, replace=False)
    point_cloud = np.concatenate((points[selected], normals[selected]), axis=1).astype(np.float16)
    if not np.isfinite(point_cloud).all():
        raise ValueError("FastMesh point-cloud preparation produced non-finite values.")
    return np.ascontiguousarray(point_cloud)


class FastMeshRetopologyAdapter(BaseModel):
    """FastMesh — Retopology using the fixed V1K checkpoint."""

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
        if torch is None:
            raise RuntimeError("FastMesh inference requires PyTorch, but torch is not installed.")

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading FastMesh model from %s", weights_dir)
        # Make the vendored FastMesh source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _fastmesh_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "FastMesh")
        if _fastmesh_root not in sys.path:
            sys.path.insert(0, _fastmesh_root)
        from models import MODELS

        model = MODELS["MeshGen"].from_pretrained(str(weights_dir))
        model.eval()
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        model.to(device)
        self.device = device
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
        if torch is None:
            return {"success": False, "error": "FastMesh inference requires PyTorch"}

        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        # FastMesh expects a normalized surface point cloud with the normal of
        # each sampled point's source face (not independently sampled face normals).
        mesh = trimesh.load(mesh_path, force="mesh", process=False)
        pc_normal = _prepare_fastmesh_point_cloud(mesh, seed=seed)
        input_shape = torch.from_numpy(pc_normal).unsqueeze(0).to(self.device)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            recon_meshes = model({"pc_normal": input_shape}, is_eval=True)

        out_mesh = recon_meshes[0]

        out = Path(tempfile.mkdtemp()) / f"fastmesh_{seed}.obj"
        # Vendored upstream inference.py exports the normalized model output directly;
        # keep that coordinate convention and do not apply an inverse input transform.
        out_mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "output_vertex_count": int(len(out_mesh.vertices)),
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
            }
        }
