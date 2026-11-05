"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : taoflowforge_image_to_raw_mesh
Model Name        : TaoFlowForge — Image to Raw Mesh
Feature Target    : image_to_raw_mesh
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/Taobao3D/TaoFlowForge
Upstream Pipeline : taoflowforge.pipeline.TaoFlowForgePipeline
Checkpoint / Path : backend/pretrained/Taobao3D/TaoFlowForge
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Derives execution device dynamically from gpu_id.
=============================================================================
"""
# Status - BETA / ACTIVE
from __future__ import annotations

import contextlib
import logging
import os
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
from .trellis2_mesh_validation import validate_mesh_arrays

# DINOv3 image-conditioner weights are required by TaoFlowForge stage0/stage2
# when the stage checkpoints do not embed them. Resolve from local storage,
# downloading from HuggingFace on demand so inference never crashes with a
# missing-weight error.
DINOV3_REPO_ID = "camenduru/dinov3-vitl16-pretrain-lvd1689m"
DINOV3_LOCAL_DIR_NAME = "dinov3-vitl16-pretrain-lvd1689m"


def _resolve_dino_checkpoint(weights_dir: Path) -> Path | None:
    """Return a local DINOv3 directory, downloading from HF if needed.

    Looks for the DINOv3 weights under the shared weights root first; if absent,
    downloads them from HuggingFace into <weights_root>/dinov3-vitl16-... so the
    adapter is self-sufficient and does not require a manual pre-download step.
    Returns None only when the download fails (inference will then surface the
    original upstream error).
    """
    weights_root = weights_dir.parent  # e.g. backend/pretrained/Taobao3D -> backend/pretrained
    local_dir = weights_root / DINOV3_LOCAL_DIR_NAME
    if local_dir.is_dir() and any(local_dir.iterdir()):
        return local_dir

    try:
        from huggingface_hub import snapshot_download

        logger.info(
            "DINOv3 weights not found locally; downloading from %s ...",
            DINOV3_REPO_ID,
        )
        snapshot_download(
            repo_id=DINOV3_REPO_ID,
            local_dir=str(local_dir),
            local_dir_use_symlinks=False,
        )
        if local_dir.is_dir() and any(local_dir.iterdir()):
            return local_dir
    except Exception as exc:
        logger.warning(
            "Could not download DINOv3 weights from %s: %s", DINOV3_REPO_ID, exc
        )
    return None

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class TaoFlowForgeImageToRawMeshAdapter(BaseModel):
    """TaoFlowForge — Image to Raw Mesh (progressive native mesh)."""

    MODEL_KEY = "Taobao3D/TaoFlowForge"
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
        self.native_topology = True
        self.model: Any = None
        self.device = "cpu"
        self.dtype = None
        self.version = "1.0"
        self.experimental = False
        self._pipeline: Any = None

    def _load_model(self) -> Any:
        # Make the vendored TaoFlowForge source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _tao_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Taobao3D" / "TaoFlowForge")
        if _tao_root not in sys.path:
            sys.path.insert(0, _tao_root)
        # TaoFlowForge model-specific patcher: disable FlashAttention on
        # pre-Ampere GPUs (Tesla T4 sm_75, etc.) so inference falls back to
        # SDPA instead of crashing with "FlashAttention only supports
        # Ampere GPUs or newer". Must run before importing the pipeline,
        # which imports the attention module at load time.
        from patcher.taoflowforge import apply_patch as _taoflowforge_apply_attn_patch  # noqa: E402
        _taoflowforge_apply_attn_patch()
        from taoflowforge.pipeline import TaoFlowForgePipeline
        from taoflowforge.config import (
            InferenceConfig,
            Stage0Config,
            Stage1Config,
            Stage2Config,
        )

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        weights_path = Path(weights_dir).resolve()
        logger.info("Loading TaoFlowForge pipeline from %s", weights_path)

        # Strict checkpoint presence check
        os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
        required_checkpoints = ["stage0.pt", "stage1.pt", "stage2.pt"]
        missing = [f for f in required_checkpoints if not (weights_path / f).is_file()]
        if missing:
            raise FileNotFoundError(
                f"TaoFlowForge checkpoints missing in {weights_path}: {missing}. "
                "Download them using `bash backend/scripts/download_models.sh -m taoflowforge`."
            )

        # Resolve DINOv3 image-conditioner weights (auto-download from HF if absent).
        # TaoFlowForge stage0/stage2 need these; the stage checkpoints do not embed them.
        dino_checkpoint = _resolve_dino_checkpoint(weights_path)

        config = InferenceConfig(
            stage0=Stage0Config(checkpoint=weights_path / "stage0.pt", num_steps=50, cfg_scale=7.5),
            stage1=Stage1Config(checkpoint=weights_path / "stage1.pt", num_steps=30, cfg_scale=7.0),
            stage2=Stage2Config(checkpoint=weights_path / "stage2.pt", num_steps=50, cfg_scale=3.0),
            seed=DEFAULT_SEED,
            offload="on",
            fill_holes=True,
            image_size=1024,
            output_dir=Path(tempfile.gettempdir()) / "taoflowforge",
            dino_checkpoint=dino_checkpoint,
        )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch and torch.cuda.is_available() else "cpu"
        self.device = device
        pipeline = TaoFlowForgePipeline.from_config(config, device=device)
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        if self._pipeline is not None:
            with contextlib.suppress(Exception):
                self._pipeline.close()
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TaoFlowForge pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        request_workdir = Path(tempfile.mkdtemp(prefix=f"taoflowforge_{seed}_"))
        request_workdir.mkdir(parents=True, exist_ok=True)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        try:
            with ctx:
                result = None
                for update in pipeline.iter_run(
                    image_path, output_dir=request_workdir, seed=seed, show_progress=True
                ):
                    if update.message:
                        logger.info("[TaoFlowForge] %s", update.message)
                    if update.result is not None:
                        result = update.result

                if result is None:
                    return {"success": False, "error": "TaoFlowForge pipeline terminated without a result"}

            if result.mesh is None:
                return {"success": False, "error": "TaoFlowForge produced no mesh"}

            vertices = np.asarray(result.mesh.vertices)
            faces = np.asarray(result.mesh.faces)
            try:
                decoded_stats = validate_mesh_arrays(vertices, faces, stage="decoded mesh")
                logger.info(
                    "[TaoFlowForge] Decoded mesh validated: vertices=%d, faces=%d",
                    decoded_stats["vertex_count"],
                    decoded_stats["face_count"],
                )
            except ValueError as exc:
                logger.error("TaoFlowForge mesh validation failed for seed %s: %s", seed, exc)
                return {"success": False, "error": f"TaoFlowForge mesh validation failed: {exc}"}

            out = Path(result.glb_path) if result.glb_path else None
            if out is None or not out.is_file():
                if result.mesh is not None:
                    out = request_workdir / f"taoflowforge_{seed}.glb"
                    result.mesh.export(str(out))
                elif result.final_mesh_path and Path(result.final_mesh_path).is_file():
                    out = Path(result.final_mesh_path)
                else:
                    return {"success": False, "error": "TaoFlowForge produced no exportable mesh output"}

            if not out.is_file() or out.stat().st_size <= 256:
                return {
                    "success": False,
                    "error": f"TaoFlowForge produced an empty or invalid GLB file ({out.stat().st_size if out.is_file() else 0} bytes)",
                }

            try:
                reloaded = trimesh.load(str(out), force="mesh", process=False)
                validate_mesh_arrays(reloaded.vertices, reloaded.faces, stage="GLB round-trip")
            except Exception as exc:
                return {"success": False, "error": f"TaoFlowForge GLB validation failed: {exc}"}
        except Exception as exc:
            logger.error("TaoFlowForge inference failed: %s", exc, exc_info=True)
            return {"success": False, "error": f"TaoFlowForge inference failed: {exc}"}

        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
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
