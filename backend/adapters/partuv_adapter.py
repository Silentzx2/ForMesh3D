"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : partuv_uv_unwrapping
Model Name        : PartUV — UV Unwrapping
Feature Target    : uv_unwrapping
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/GAP-LAB-CUHK-SZ/PartUV
Upstream Pipeline : partuv.preprocess.preprocess (partuv._core)
Checkpoint / Path : backend/pretrained/PartUV
Hardware / VRAM   : 4096 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Unpacks 4-tuple preprocess return (mesh = result[0]) before export.
=============================================================================
"""
# Status - BETA / ACTIVE

from __future__ import annotations

import contextlib
import logging
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


class PartUVUnwrappingAdapter(BaseModel):
    """PartUV — UV Unwrapping."""

    MODEL_KEY = "PartUV"
    FEATURE_TYPE = "uv_unwrapping"

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
        self._preprocess: Any = None

    def _load_model(self) -> Any:
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading PartUV from %s", weights_dir)
        # Make the vendored PartUV source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _partuv_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "PartUV")
        if _partuv_root not in sys.path:
            sys.path.insert(0, _partuv_root)
        # The compiled C++ extension must be importable; fall back gracefully.
        try:
            from partuv import _core  # type: ignore
        except ImportError as exc:
            logger.warning("PartUV compiled extension not importable: %s", exc)
            _core = None
        from partuv.preprocess import preprocess

        self._preprocess = preprocess
        self.model = weights_dir
        return weights_dir

    def _unload_model(self) -> None:
        self._preprocess = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        weights_dir = self.model
        if weights_dir is None:
            return {"success": False, "error": "PartUV not loaded"}

        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        distortion_threshold = float(inputs.get("distortion_threshold", 1.25))

        import trimesh

        mesh = trimesh.load(mesh_path, process=False)

        ctx = contextlib.nullcontext()
        with ctx:
            try:
                result = self._preprocess(mesh_path)
            except TypeError:
                result = self._preprocess(mesh_path)

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"partuv_{seed}.obj"
        # preprocess returns a 4-tuple: (mesh, binary_file_path, tree_dict, preprocess_times)
        mesh_result = result[0] if isinstance(result, tuple) else result
        if hasattr(mesh_result, "export"):
            mesh_result.export(str(out))
        elif isinstance(mesh_result, trimesh.Trimesh):
            mesh_result.export(str(out))
        else:
            return {"success": False, "error": "PartUV produced no exportable mesh"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "distortion_threshold": distortion_threshold,
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb"], "output": ["obj"]}

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
                "distortion_threshold": {
                    "type": "number",
                    "description": "Allowed UV distortion (official default 1.25)",
                    "default": 1.25,
                    "required": False,
                },
            }
        }
