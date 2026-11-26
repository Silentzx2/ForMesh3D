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

import logging
import shutil
import subprocess
import sys
import time
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
        self._pipeline_numpy: Any = None
        self._save_results: Any = None
        self._pf_model: Any = None
        self._partuv_config: Path | None = None
        self._partuv_pack_script: Path | None = None

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
            # Append (not insert at 0) so a prebuilt site-packages `partuv` wheel is not shadowed.
            sys.path.append(_partuv_root)
        try:
            # Upstream partuv.preprocess imports this as a package-relative module,
            # while the vendored source keeps preprocess_utils at the repository root.
            import preprocess_utils  # type: ignore
            sys.modules["partuv.preprocess_utils"] = preprocess_utils
            # Import only after the alias exists so the real compiled _core extension
            # and the upstream preprocess module both finish package initialization.
            import partuv  # type: ignore
            from partuv.preprocess import preprocess, save_results  # type: ignore
            from preprocess_utils.partfield_official.run_PF import PFInferenceModel  # type: ignore

            pipeline_numpy = getattr(partuv, "pipeline_numpy", None)
            if not callable(pipeline_numpy):
                raise ImportError("PartUV compiled extension does not expose pipeline_numpy")

            device = "cuda" if torch is not None and torch.cuda.is_available() else "cpu"
            self._pf_model = PFInferenceModel(
                device=device,
                checkpoint_path=str(ckpt_path) if ckpt_path.is_file() else None,
            )
            self._preprocess = preprocess
            self._pipeline_numpy = pipeline_numpy
            self._save_results = save_results
            self._partuv_config = Path(_partuv_root) / "config" / "config.yaml"
            self._partuv_pack_script = Path(_partuv_root) / "pack" / "pack_blender.py"
            if not self._partuv_config.is_file():
                raise FileNotFoundError(f"PartUV config not found: {self._partuv_config}")
        except Exception as exc:
            raise RuntimeError(f"PartUV full UV pipeline could not be loaded: {exc}") from exc

        self.model = weights_dir
        return weights_dir

    def _unload_model(self) -> None:
        self._preprocess = None
        self._pipeline_numpy = None
        self._save_results = None
        self._pf_model = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self.model is None:
            return {"success": False, "error": "PartUV not loaded"}
        if not all((self._preprocess, self._pipeline_numpy, self._save_results, self._pf_model)):
            return {"success": False, "error": "PartUV full UV pipeline is unavailable"}

        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        distortion_threshold = float(inputs.get("distortion_threshold", 1.25))
        output_format = str(inputs.get("output_format", "glb")).lower().lstrip(".")
        if output_format not in {"glb", "obj"}:
            raise ValueError("PartUV output_format must be 'glb' or 'obj'")
        pack_method = str(inputs.get("pack_method", "blender")).strip().lower()
        if pack_method not in {"blender", "none"}:
            raise ValueError("PartUV pack_method must be 'blender' or 'none'")

        sample_on_faces = int(inputs.get("sample_on_faces", 10))
        sample_batch_size = int(inputs.get("sample_batch_size", 100_000))
        if sample_on_faces < 1 or sample_batch_size < 1:
            raise ValueError("PartUV sampling parameters must be positive integers")

        work_dir = self._create_temporary_output_dir("partuv")
        output_dir = work_dir / Path(mesh_path).stem
        output_dir.mkdir(parents=True, exist_ok=True)
        preprocess_started = time.perf_counter()
        preprocess_result = self._preprocess(
            str(mesh_path),
            self._pf_model,
            output_path=str(work_dir / "preprocess"),
            save_tree_file=True,
            save_processed_mesh=True,
            sample_on_faces=sample_on_faces,
            sample_batch_size=sample_batch_size,
        )
        if not isinstance(preprocess_result, tuple) or len(preprocess_result) < 4:
            raise RuntimeError("PartUV preprocess returned an unexpected result; expected 4 values")

        processed_mesh, _binary_path, tree_dict, preprocess_times = preprocess_result
        if processed_mesh is None or not isinstance(tree_dict, dict) or not tree_dict:
            raise RuntimeError("PartUV preprocessing did not produce a valid mesh hierarchy")
        preprocess_elapsed = time.perf_counter() - preprocess_started

        unwrap_started = time.perf_counter()
        final_parts, individual_parts = self._pipeline_numpy(
            V=processed_mesh.vertices,
            F=processed_mesh.faces,
            tree_dict=tree_dict,
            configPath=str(self._partuv_config),
            threshold=distortion_threshold,
        )
        unwrap_elapsed = time.perf_counter() - unwrap_started
        if final_parts is None or not individual_parts:
            raise RuntimeError("PartUV UV-unwrapping pipeline returned no charts")

        self._save_results(output_dir, final_parts, individual_parts)
        unwrapped_path = output_dir / "final_components.obj"
        if not unwrapped_path.is_file() or unwrapped_path.stat().st_size == 0:
            raise RuntimeError("PartUV did not write final_components.obj with UV coordinates")

        packed = False
        if pack_method == "blender":
            blender_bin = shutil.which("blender")
            if blender_bin and self._partuv_pack_script and self._partuv_pack_script.is_file():
                try:
                    subprocess.run(
                        [
                            blender_bin,
                            "--background",
                            "--python",
                            str(self._partuv_pack_script),
                            "--",
                            "--mesh_folder",
                            str(output_dir),
                        ],
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=300,
                    )
                    packed = (output_dir / "final_packed.obj").is_file()
                except (OSError, subprocess.SubprocessError) as exc:
                    logger.warning("[PARTUV] Blender UV packing failed; retaining un-packed UV charts: %s", exc)
            else:
                logger.warning("[PARTUV] Blender executable unavailable; retaining valid un-packed UV charts")

        source_output = output_dir / "final_packed.obj" if packed else unwrapped_path
        import trimesh
        import numpy as np

        uv_mesh = trimesh.load(str(source_output), force="mesh", process=False)
        uv_coords = getattr(getattr(uv_mesh, "visual", None), "uv", None)
        if uv_coords is None:
            raise RuntimeError("PartUV output is missing UV coordinates")
        uv_coords = np.asarray(uv_coords)
        if uv_coords.ndim != 2 or uv_coords.shape[1] < 2 or not np.isfinite(uv_coords[:, :2]).all():
            raise RuntimeError("PartUV output contains invalid UV coordinates")

        out = work_dir / f"partuv_{seed}.{output_format}"
        uv_mesh.export(str(out), file_type=output_format)
        if not out.is_file() or out.stat().st_size == 0:
            raise RuntimeError("PartUV output export failed")

        if isinstance(preprocess_times, dict):
            for stage, elapsed in preprocess_times.items():
                logger.info("[PARTUV] upstream_stage=%s elapsed=%s", stage, elapsed)
        logger.info(
            "[PARTUV] UV unwrap complete: components=%s distortion=%s packed=%s output=%s",
            getattr(final_parts, "num_components", len(individual_parts)),
            getattr(final_parts, "distortion", None),
            packed,
            out,
        )
        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "format": output_format,
            "uv_unwrapped": True,
            "uv_packed": packed,
            "generation_info": {
                "seed": seed,
                "distortion_threshold": distortion_threshold,
                "uv_components": getattr(final_parts, "num_components", len(individual_parts)),
                "uv_distortion": getattr(final_parts, "distortion", None),
                "uv_vertex_count": int(len(uv_coords)),
                "preprocess_elapsed_s": round(preprocess_elapsed, 3),
                "unwrap_elapsed_s": round(unwrap_elapsed, 3),
                "packing_method": "blender" if packed else None,
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
                "pack_method": {
                    "type": "string",
                    "description": "Pack UV charts with Blender, or leave the UV charts un-packed",
                    "default": "blender",
                    "enum": ["blender", "none"],
                    "required": False,
                },
            }
        }
