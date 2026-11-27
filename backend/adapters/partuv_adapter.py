"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  PartUV UV Unwrapping Adapter                                                ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/PartUV (partuv.preprocess, pipeline_numpy)    ║
║  Weights  : backend/pretrained/PartUV (model_objaverse.ckpt)                 ║
║  Patcher  : None (Trimesh 4/5 shim + Blender pack subprocess)                ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import importlib
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict

import numpy as np
import torch
import trimesh

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, resolve_thirdparty, use_thirdparty

logger = logging.getLogger(__name__)


class PartUVUnwrappingAdapter(BaseModel):
    MODEL_KEY = "PartUV"
    FEATURE_TYPE = "uv_unwrapping"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self._preprocess: Any = None
        self._pipeline_numpy: Any = None
        self._save_results: Any = None
        self._pf_model: Any = None
        self._partuv_config: Path | None = None
        self._partuv_pack_script: Path | None = None

    def _load_model(self) -> Any:
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        ckpt_path = weights_dir / "model_objaverse.ckpt"
        if not ckpt_path.is_file():
            raise FileNotFoundError(f"PartUV checkpoint missing: {ckpt_path}")
        os.environ["PARTUV_CHECKPOINT_PATH"] = str(ckpt_path)

        # Trimesh 4/5 compat for legacy PartUV calls
        if not hasattr(trimesh.Trimesh, "remove_duplicate_faces"):
            trimesh.Trimesh.remove_duplicate_faces = lambda m: m.update_faces(m.unique_faces())
        if not hasattr(trimesh.Trimesh, "remove_degenerate_faces"):
            trimesh.Trimesh.remove_degenerate_faces = lambda m: m.update_faces(m.nondegenerate_faces())

        partuv_root = resolve_thirdparty("PartUV")
        if str(partuv_root) not in sys.path:
            sys.path.append(str(partuv_root))  # append so prebuilt partuv._core wheel is not shadowed

        with use_thirdparty("PartUV", chdir=False):
            sys.modules["partuv.preprocess_utils"] = importlib.import_module("preprocess_utils")
            from partuv.preprocess import PFInferenceModel, preprocess
            from partuv import pipeline_numpy, save_results

            pf_cfg = partuv_root / "preprocess_utils" / "partfield_official" / "configs" / "final" / "demo.yaml"
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            logger.info("Loading PartUV from %s on %s", ckpt_path, device)
            self._pf_model = PFInferenceModel(cfg_path=str(pf_cfg), checkpoint_path=str(ckpt_path), device=device)
            self._preprocess = preprocess
            self._pipeline_numpy = pipeline_numpy
            self._save_results = save_results
            self._partuv_config = partuv_root / "config" / "config.yaml"
            self._partuv_pack_script = partuv_root / "pack" / "pack_blender.py"
            return self._pf_model

    def _unload_model(self) -> None:
        self._preprocess = self._pipeline_numpy = self._save_results = self._pf_model = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if not all((self._preprocess, self._pipeline_numpy, self._save_results, self._pf_model)):
            return {"success": False, "error": "PartUV pipeline not loaded"}
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"Mesh not found: {mesh_path}"}

        seed = int(inputs["seed"])
        distortion = float(inputs.get("distortion_threshold", 1.25))
        output_format = str(inputs.get("output_format", "glb")).lower().lstrip(".")
        pack_method = str(inputs.get("pack_method", "blender")).strip().lower()
        sample_on_faces = int(inputs.get("sample_on_faces", 10))
        sample_batch_size = int(inputs.get("sample_batch_size", 100_000))

        work_dir = self._create_temporary_output_dir("partuv")
        output_dir = work_dir / Path(mesh_path).stem
        output_dir.mkdir(parents=True, exist_ok=True)

        t0 = time.perf_counter()
        processed_mesh, _, tree_dict, _ = self._preprocess(
            str(mesh_path),
            self._pf_model,
            output_path=str(work_dir / "preprocess"),
            save_tree_file=True,
            save_processed_mesh=True,
            sample_on_faces=sample_on_faces,
            sample_batch_size=sample_batch_size,
        )
        final_parts, individual_parts = self._pipeline_numpy(
            V=processed_mesh.vertices,
            F=processed_mesh.faces,
            tree_dict=tree_dict,
            configPath=str(self._partuv_config),
            threshold=distortion,
        )
        self._save_results(output_dir, final_parts, individual_parts)
        unwrapped_path = output_dir / "final_components.obj"

        packed = False
        if pack_method in {"blender", "auto"}:
            blender_bin = shutil.which("blender")
            if blender_bin and self._partuv_pack_script and self._partuv_pack_script.is_file():
                try:
                    subprocess.run(
                        [blender_bin, "--background", "--python", str(self._partuv_pack_script), "--", "--mesh_folder", str(output_dir)],
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=300,
                    )
                    packed = (output_dir / "final_packed.obj").is_file()
                except (OSError, subprocess.SubprocessError) as exc:
                    logger.warning("[PARTUV] Blender packing failed (%s); keeping unwrapped charts", exc)

        source_output = output_dir / "final_packed.obj" if packed else unwrapped_path
        uv_mesh = trimesh.load(str(source_output), force="mesh", process=False)
        uv_coords = getattr(getattr(uv_mesh, "visual", None), "uv", None)
        if uv_coords is None or not np.isfinite(np.asarray(uv_coords)[:, :2]).all():
            raise RuntimeError("PartUV output is missing valid UV coordinates")

        out = work_dir / f"partuv_{seed}.{output_format}"
        uv_mesh.export(str(out), file_type=output_format)
        logger.info("[PARTUV] Unwrap complete elapsed=%.2fs packed=%s", time.perf_counter() - t0, packed)
        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "format": output_format,
            "uv_unwrapped": True,
            "uv_packed": packed,
            "generation_info": {"seed": seed, "distortion_threshold": distortion, "pack_method": pack_method},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb"], "output": ["obj", "glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
