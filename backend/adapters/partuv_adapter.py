"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : partuv_uv_unwrapping
Model Name        : PartUV — UV Unwrapping
Feature Target    : uv_unwrapping
Status            : STABLE / WORKING
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
# Status - STABLE / WORKING

from __future__ import annotations

import contextlib
import logging
import sys
import time
import types
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

        # Resolve checkpoint and expose via env var so thirdparty code can find it
        ckpt_path = weights_dir / "model_objaverse.ckpt"
        if not ckpt_path.is_file():
            # Try auto-download via huggingface_hub if available
            try:
                from huggingface_hub import hf_hub_download
                logger.info("model_objaverse.ckpt not found locally; downloading from HuggingFace...")
                hf_hub_download(
                    repo_id="mikaelaangel/partfield-ckpt",
                    filename="model_objaverse.ckpt",
                    local_dir=str(weights_dir),
                )
                logger.info("model_objaverse.ckpt downloaded to %s", ckpt_path)
            except Exception as exc:
                logger.warning(
                    "model_objaverse.ckpt not found at %s and auto-download failed: %s. "
                    "Run: ./manager.sh -> Models -> [12] PartUV",
                    ckpt_path, exc,
                )
        import os as _os
        _os.environ["PARTUV_CHECKPOINT_PATH"] = str(ckpt_path)

        # Ensure Trimesh 4/5 compatibility for legacy PartUV operations in worker
        try:
            import trimesh
            if not hasattr(trimesh.Trimesh, "remove_duplicate_faces"):
                def _remove_duplicate_faces(mesh_self):
                    if hasattr(mesh_self, "update_faces") and hasattr(mesh_self, "unique_faces"):
                        mesh_self.update_faces(mesh_self.unique_faces())
                trimesh.Trimesh.remove_duplicate_faces = _remove_duplicate_faces
            if not hasattr(trimesh.Trimesh, "remove_degenerate_faces"):
                def _remove_degenerate_faces(mesh_self):
                    if hasattr(mesh_self, "update_faces") and hasattr(mesh_self, "nondegenerate_faces"):
                        mesh_self.update_faces(mesh_self.nondegenerate_faces())
                trimesh.Trimesh.remove_degenerate_faces = _remove_degenerate_faces
        except Exception:
            pass

        # Make the vendored PartUV source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _partuv_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "PartUV")
        if _partuv_root not in sys.path:
            sys.path.insert(0, _partuv_root)
        if "partuv._core" not in sys.modules:
            try:
                from partuv import _core  # type: ignore
            except Exception as exc:
                logger.warning("PartUV compiled extension not importable, using stub: %s", exc)
                sys.modules["partuv._core"] = types.ModuleType("partuv._core")
        try:
            import preprocess_utils  # type: ignore
            sys.modules["partuv.preprocess_utils"] = preprocess_utils
            from partuv.preprocess import preprocess  # type: ignore
            self._preprocess = preprocess
        except Exception as exc:
            logger.warning("PartUV preprocess could not be imported: %s", exc)
            self._preprocess = None

        self.model = weights_dir
        return weights_dir

    def _unload_model(self) -> None:
        self._preprocess = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        weights_dir = self.model
        if weights_dir is None:
            return {"success": False, "error": "PartUV not loaded"}
        if self._preprocess is None:
            return {"success": False, "error": "PartUV preprocess pipeline is unavailable"}

        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        distortion_threshold = float(inputs.get("distortion_threshold", 1.25))
        output_format = str(inputs.get("output_format", "glb")).lower().lstrip(".")
        if output_format not in {"glb", "obj"}:
            raise ValueError("PartUV output_format must be 'glb' or 'obj'")

        import trimesh

        mesh = trimesh.load(mesh_path, process=False)

        import tempfile

        preprocess_out = Path(tempfile.mkdtemp())
        ctx = contextlib.nullcontext()
        logger.info("[PARTUV] Sampling mesh surfaces and predicting part-aware UV features...")
        preprocess_started = time.perf_counter()
        with ctx:
            result = self._preprocess(mesh_path, output_path=str(preprocess_out))
        preprocess_elapsed = time.perf_counter() - preprocess_started

        # preprocess returns a 4-tuple: (mesh, binary_file_path, tree_dict, preprocess_times)
        mesh_result = result[0] if isinstance(result, tuple) else result
        preprocess_times = result[3] if isinstance(result, tuple) and len(result) > 3 else None
        logger.info(
            "[PARTUV] Sampling/decoding pipeline completed elapsed=%.2fs",
            preprocess_elapsed,
        )
        if isinstance(preprocess_times, dict):
            for stage, elapsed in preprocess_times.items():
                logger.info("[PARTUV] upstream_stage=%s elapsed=%s", stage, elapsed)

        logger.info("[PARTUV] Decoding UV chart mesh and exporting %s artifact...", output_format.upper())
        out = Path(tempfile.mkdtemp()) / f"partuv_{seed}.{output_format}"
        if hasattr(mesh_result, "export"):
            mesh_result.export(str(out), file_type=output_format)
        elif isinstance(mesh_result, trimesh.Trimesh):
            mesh_result.export(str(out))
        else:
            return {"success": False, "error": "PartUV produced no exportable mesh"}

        logger.info("[PARTUV] Export completed: path=%s size_bytes=%d", out, out.stat().st_size)
        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "format": output_format,
            "generation_info": {
                "seed": seed,
                "distortion_threshold": distortion_threshold,
                "preprocess_elapsed_s": round(preprocess_elapsed, 3),
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb"], "output": ["obj", "glb"]}

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
