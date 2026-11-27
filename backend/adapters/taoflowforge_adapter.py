"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TaoFlowForge Image-to-Raw-Mesh Adapter (Disabled by Default in models.yaml) ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/Taobao3D/TaoFlowForge (TaoFlowForgePipeline)  ║
║  Weights  : backend/pretrained/Taobao3D/TaoFlowForge (fail-fast local)       ║
║  Patcher  : patcher.taoflowforge (applied BEFORE upstream import)            ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict

import numpy as np
import trimesh

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from core.models.base import BaseModel, ModelStatus
from core.utils.upstream import resolve_pretrained, use_thirdparty
from .trellis2_mesh_validation import validate_mesh_arrays

logger = logging.getLogger(__name__)


# ── 1. Adapter Class ──────────────────────────────────────────────────────────

class TaoFlowForgeImageToRawMeshAdapter(BaseModel):
    """TaoFlowForge — Image to Raw Mesh (progressive native mesh)."""

    MODEL_KEY = "Taobao3D/TaoFlowForge"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=None,
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.status = ModelStatus.UNLOADED
        self.native_topology = True
        self.version = "1.0"
        self._pipeline: Any = None

    # ── 2. Lifecycle (Load / Unload) ──────────────────────────────────────────

    def _load_model(self) -> Any:
        weights_path = resolve_pretrained(self.MODEL_KEY).resolve()
        missing = [f for f in ("stage0.pt", "stage1.pt", "stage2.pt") if not (weights_path / f).is_file()]
        if missing:
            raise FileNotFoundError(f"TaoFlowForge checkpoints missing in {weights_path}: {missing}")

        weights_root = weights_path.parent
        dino_dir = weights_root / "dinov3-vitl16-pretrain-lvd1689m"
        dino_ckpt = dino_dir if dino_dir.is_dir() and any(dino_dir.iterdir()) else None
        rembg_model = next(
            (weights_root / c for c in ("RMBG-1.4", "RMBG-2.0", "briaai/RMBG-1.4", "briaai/RMBG-2.0")
             if (weights_root / c).is_dir() and any((weights_root / c).iterdir())),
            None,
        )

        with use_thirdparty("Taobao3D/TaoFlowForge", chdir=False):
            from patcher.taoflowforge import apply_patch
            apply_patch()
            from taoflowforge.config import InferenceConfig, Stage0Config, Stage1Config, Stage2Config
            from taoflowforge.pipeline import TaoFlowForgePipeline

            use_fast = (
                os.environ.get("TAOFLOWFORGE_FAST_STEPS", "").lower() in ("1", "true")
                or os.environ.get("TAOFLOWFORGE_USE_OFFICIAL_STEPS", "1").lower() in ("0", "false")
            )
            s0 = int(os.environ.get("TAOFLOWFORGE_STAGE0_STEPS", "5" if use_fast else "50"))
            s1 = int(os.environ.get("TAOFLOWFORGE_STAGE1_STEPS", "5" if use_fast else "30"))
            s2 = int(os.environ.get("TAOFLOWFORGE_STAGE2_STEPS", "5" if use_fast else "50"))

            config = InferenceConfig(
                stage0=Stage0Config(checkpoint=weights_path / "stage0.pt", num_steps=s0, cfg_scale=7.5),
                stage1=Stage1Config(checkpoint=weights_path / "stage1.pt", num_steps=s1, cfg_scale=7.0),
                stage2=Stage2Config(checkpoint=weights_path / "stage2.pt", num_steps=s2, cfg_scale=3.0),
                seed=0, offload="on", fill_holes=True, image_size=1024,
                output_dir=Path(tempfile.gettempdir()) / "taoflowforge",
                dino_checkpoint=dino_ckpt, rembg_model=rembg_model,
            )
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch and torch.cuda.is_available() else "cpu"
            self.device = device
            self._pipeline = self.model = TaoFlowForgePipeline.from_config(config, device=device)
            return self._pipeline

    def _unload_model(self) -> None:
        if self._pipeline is not None:
            with contextlib.suppress(Exception):
                self._pipeline.close()
        self._pipeline = self.model = None

    # ── 3. Inference & Export ─────────────────────────────────────────────────

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            return {"success": False, "error": "TaoFlowForge pipeline not loaded"}
        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs["seed"])
        workdir = self._create_temporary_output_dir("taoflowforge")
        workdir.mkdir(parents=True, exist_ok=True)

        result = None
        with (torch.no_grad() if torch is not None else contextlib.nullcontext()):
            for update in self._pipeline.iter_run(image_path, output_dir=workdir, seed=seed, show_progress=True):
                if update.result is not None:
                    result = update.result
        if result is None or result.mesh is None:
            return {"success": False, "error": "TaoFlowForge produced no mesh"}

        validate_mesh_arrays(np.asarray(result.mesh.vertices), np.asarray(result.mesh.faces), stage="decoded mesh", check_domain_box=False)
        out = Path(result.glb_path) if result.glb_path else (workdir / f"taoflowforge_{seed}.glb")
        if not out.is_file():
            result.mesh.export(str(out))
        if not out.is_file() or out.stat().st_size <= 256:
            return {"success": False, "error": "TaoFlowForge produced an empty or invalid GLB file"}
        reloaded = trimesh.load(str(out), force="mesh", process=False)
        validate_mesh_arrays(reloaded.vertices, reloaded.faces, stage="GLB round-trip", check_domain_box=False)

        return {
            "success": True, "output_mesh_path": str(out.resolve()), "mesh_path": str(out.resolve()),
            "generation_info": {"seed": seed, "num_inference_steps": "adapter_owned"},
        }

    # ── 4. Schema & Metadata ──────────────────────────────────────────────────

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {"seed": {"type": "integer", "minimum": 0, "required": False}}}
