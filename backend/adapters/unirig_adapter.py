"""UniRig adapter — thin integration over the official ThirdParty inference API.

Wraps the lightning-based UniRig training/inference system from
``backend/thirdparty/UniRig``. Auto-rigging (skeleton + skinning) for a mesh.
Weights resolved through ``backend.loader.get_model_weights_dir``.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class UniRigAdapter(BaseModel):
    """UniRig — Auto Rigging."""

    MODEL_KEY = "UniRig"
    FEATURE_TYPE = "auto_rig"

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
        self._system: Any = None

    def _load_model(self) -> Any:
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("UniRig weights at %s; inference via run.py subprocess", weights_dir)
        # UniRig inference is a two-phase CLI (skeleton → skin) driven by run.py.
        # No in-process loading required; store weights_dir for _process_request.
        self._weights_dir = weights_dir
        self._unirig_root = Path(__file__).resolve().parents[1] / "thirdparty" / "UniRig"
        self.model = {"weights_dir": str(weights_dir)}
        return self.model

    def _unload_model(self) -> None:
        self._weights_dir = None
        self._unirig_root = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self.model is None:
            return {"success": False, "error": "UniRig not loaded"}

        mesh_path = inputs.get("mesh_path") or inputs.get("image_path") or inputs.get("image")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        rig_mode = inputs.get("rig_mode", "full")

        unirig_root = self._unirig_root
        run_py = unirig_root / "run.py"
        workdir = Path(tempfile.mkdtemp()) / f"unirig_{seed}"
        workdir.mkdir(parents=True, exist_ok=True)

        skeleton_cfg = str(unirig_root / "configs/task/quick_inference_skeleton_articulationxl_ar_256.yaml")
        skin_cfg = str(unirig_root / "configs/task/quick_inference_unirig_skin.yaml")

        base_cmd = [sys.executable, str(run_py)]

        # Phase 1: skeleton
        if rig_mode in ("skeleton", "full"):
            proc = subprocess.run(
                base_cmd + ["--task", skeleton_cfg, "--input", str(mesh_path),
                             "--output_dir", str(workdir), "--seed", str(seed)],
                cwd=str(unirig_root), capture_output=True, text=True,
            )
            if proc.returncode != 0:
                logger.error("UniRig skeleton phase failed: %s", proc.stderr[-2000:])
                return {"success": False, "error": f"UniRig skeleton failed: {proc.stderr[-500:]}"}

        # Phase 2: skin
        if rig_mode in ("skin", "full"):
            proc2 = subprocess.run(
                base_cmd + ["--task", skin_cfg, "--input_dir", str(workdir),
                             "--output_dir", str(workdir), "--seed", str(seed)],
                cwd=str(unirig_root), capture_output=True, text=True,
            )
            if proc2.returncode != 0:
                logger.error("UniRig skin phase failed: %s", proc2.stderr[-2000:])
                return {"success": False, "error": f"UniRig skin failed: {proc2.stderr[-500:]}"}

        # Locate the result FBX/GLB produced by the writer
        out_file = next(workdir.rglob("result_fbx*.fbx"), None) or next(workdir.rglob("*.fbx"), None) or next(workdir.rglob("*.glb"), None)
        if out_file is None:
            return {"success": False, "error": "UniRig produced no output file"}

        return {
            "success": True,
            "output_mesh_path": str(out_file),
            "mesh_path": str(out_file),
            "generation_info": {"seed": seed, "rig_mode": rig_mode},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb", "fbx"], "output": ["glb", "fbx"]}

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
                "rig_mode": {
                    "type": "string",
                    "description": "Rigging mode: skeleton, skin, or full",
                    "default": "full",
                    "required": False,
                },
            }
        }
