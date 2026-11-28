"""
UniRig — Unified Skeleton & Skinning Auto-Rigging Adapter
Upstream: https://github.com/VAST-AI-Research/UniRig
Thin adapter: directly invokes official upstream src.data.extract, run.py, and src.inference.merge.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict

from backend.core.models.base import BaseModel, ModelStatus
from backend.core.utils.upstream import resolve_thirdparty
from backend.loader import get_model_weights_dir
from patcher.doctor import GPUDoctor

logger = logging.getLogger(__name__)
_REPO_ROOT = Path(__file__).resolve().parents[2]

_SUFFIXES = "obj,fbx,FBX,dae,glb,gltf,vrm"
_DATA_CFG = "configs/data/quick_inference.yaml"
_SKEL_TASK = "configs/task/quick_inference_skeleton_articulationxl_ar_256.yaml"
_SKIN_TASK = "configs/task/quick_inference_unirig_skin.yaml"


class UniRigAdapter(BaseModel):
    """UniRig — Unified Skeleton & Skinning Auto-Rigging (Thin Adapter)."""

    MODEL_KEY = "UniRig"
    FEATURE_TYPE = "auto_rig"

    def __init__(self, vram_requirement: int = 8192, **kwargs: Any):
        self.model_id = kwargs.get("model_id", "unirig_auto_rigging")
        self.model_path: Path | None = None
        self.vram_requirement = vram_requirement
        self.feature_type = kwargs.get("feature_type", self.FEATURE_TYPE)
        self.status = ModelStatus.UNLOADED
        self.gpu_id: int | None = None
        self.gpu_ids: list[int] = []
        self.resource_plan: dict[str, Any] = {}
        self.model: Any = None
        self.device = "cpu"
        self.version = "1.0"
        self._unirig_root: Path | None = None
        self._weights_dir: Path | None = None

    def _load_model(self) -> Any:
        self._unirig_root = resolve_thirdparty("UniRig")
        if not (self._unirig_root / "run.py").is_file():
            raise FileNotFoundError(f"UniRig run.py missing in {self._unirig_root}")
        self._weights_dir = get_model_weights_dir(self.MODEL_KEY)
        exp_src = self._weights_dir / "experiments"
        exp_dst = self._unirig_root / "experiments"
        if exp_src.is_dir():
            if exp_dst.is_symlink() and not exp_dst.exists():
                exp_dst.unlink()
            if not exp_dst.exists():
                try:
                    exp_dst.symlink_to(exp_src, target_is_directory=True)
                except OSError:
                    pass
        logger.info("UniRig ready (root=%s, weights_dir=%s)", self._unirig_root, self._weights_dir)
        self.model = True
        return self.model

    def _unload_model(self) -> None:
        self.model = None
        self._unirig_root = None
        self._weights_dir = None

    def _run_py(self, args: list[str], step_name: str) -> None:
        assert self._unirig_root is not None
        env = os.environ.copy()
        if self._weights_dir and self._weights_dir.is_dir():
            env.setdefault("HF_HUB_CACHE", str(self._weights_dir))
        cmd = [sys.executable, *args]
        if args and args[0] == "run.py":
            boot = (
                "import sys, runpy; "
                f"sys.path.insert(0, {str(_REPO_ROOT)!r}); "
                f"from patcher.unirig import apply_patch; apply_patch({self.gpu_id!r}); "
                f"sys.argv = {args!r}; "
                "runpy.run_path('run.py', run_name='__main__')"
            )
            cmd = [sys.executable, "-c", boot]
        t0 = time.perf_counter()
        logger.info("[UNIRIG] Starting %s...", step_name)
        res = subprocess.run(cmd, cwd=str(self._unirig_root), env=env, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"UniRig {step_name} failed (exit {res.returncode}):\n{(res.stderr or res.stdout)[-2000:]}")
        logger.info("[UNIRIG] %s completed in %.2fs", step_name, time.perf_counter() - t0)

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"Mesh not found: {mesh_path}"}

        seed = str(int(inputs["seed"]))
        faces_target = str(int(inputs.get("faces_target_count", 50000)))
        workdir = self._create_temporary_output_dir("unirig")
        local_mesh = workdir / f"input{Path(mesh_path).suffix}"
        try:
            local_mesh.symlink_to(Path(mesh_path).resolve())
        except OSError:
            shutil.copy2(mesh_path, local_mesh)
        npz_dir = workdir / "npz"
        skel_fbx = workdir / "skeleton.fbx"
        skin_fbx = workdir / "skin.fbx"
        out_glb = workdir / f"{Path(mesh_path).stem}_rigged.glb"
        run_tag = time.strftime("%Y_%m_%d_%H_%M_%S")

        self._run_py([
            "-m", "src.data.extract",
            f"--config={_DATA_CFG}", f"--require_suffix={_SUFFIXES}",
            "--force_override=false", "--num_runs=1", "--id=0", f"--time={run_tag}",
            f"--faces_target_count={faces_target}", f"--input={local_mesh}", f"--output_dir={npz_dir}",
        ], "extract(mesh)")

        self._run_py([
            "run.py", f"--task={_SKEL_TASK}", f"--seed={seed}",
            f"--input={local_mesh}", f"--output={skel_fbx}", f"--npz_dir={npz_dir}",
        ], "generate_skeleton")

        self._run_py([
            "-m", "src.data.extract",
            f"--config={_DATA_CFG}", f"--require_suffix={_SUFFIXES}",
            "--force_override=true", "--num_runs=1", "--id=0", f"--time={run_tag}",
            f"--faces_target_count={faces_target}", f"--input={skel_fbx}", f"--output_dir={npz_dir}",
        ], "extract(skeleton)")

        self._run_py([
            "run.py", f"--task={_SKIN_TASK}", f"--seed={seed}",
            f"--input={skel_fbx}", f"--output={skin_fbx}", f"--npz_dir={npz_dir}", "--data_name=raw_data.npz",
        ], "generate_skin")

        self._run_py([
            "-m", "src.inference.merge",
            f"--require_suffix={_SUFFIXES}", "--num_runs=1", "--id=0",
            f"--source={skin_fbx}", f"--target={mesh_path}", f"--output={out_glb}",
        ], "merge")

        if not out_glb.is_file() or out_glb.stat().st_size == 0:
            return {"success": False, "error": "UniRig produced no rigged GLB"}

        return {
            "success": True,
            "output_mesh_path": str(out_glb),
            "mesh_path": str(out_glb),
            "generation_info": {"seed": int(seed), "faces_target_count": int(faces_target), "model": "UniRig"},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "fbx", "dae", "glb", "gltf", "vrm"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {"type": "integer", "minimum": 0, "required": False},
                "faces_target_count": {"type": "integer", "default": 50000, "minimum": 1000, "maximum": 200000, "required": False},
            }
        }
