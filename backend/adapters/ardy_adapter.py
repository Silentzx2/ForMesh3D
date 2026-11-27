"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : ardy_motion_generation
Model Name        : ARDY — Motion Generation
Feature Target    : motion_generation
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/GAP-LAB-CUHK-SZ/ARDY
Upstream Pipeline : ardy.model.load_model & ardy.tools.seed_everything
Checkpoint / Path : backend/pretrained/ardy
Hardware / VRAM   : 0 MB (CPU-only inference)
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Motion generation runs CPU-only; text_encoder=False avoids HF downloads.
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

try:
    import torch
except ImportError:  # pragma: no cover - torch optional in CPU-only environments
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base
DEFAULT_CHECKPOINT = "ARDY-Core-RP-20FPS-Horizon40"
TEXT_ENCODER_WARNING = "Text encoder server unavailable; prompt conditioning disabled"


class ArdyMotionGenerationAdapter(BaseModel):
    """ARDY — Motion Generation (CPU-only)."""

    MODEL_KEY = "ardy"
    FEATURE_TYPE = "motion_generation"

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
        self._loaded_checkpoint: str | None = None
        self._text_encoder_warning: str | None = None

    def _resolve_checkpoint_name(self, checkpoint: str | None, weights_dir: Path | None = None) -> str:
        if not checkpoint:
            return DEFAULT_CHECKPOINT
        _ardy_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "ardy")
        if _ardy_root not in sys.path:
            sys.path.insert(0, _ardy_root)
        from ardy.model.registry import resolve_model_name

        try:
            return resolve_model_name(
                str(checkpoint),
                checkpoints_dir=str(weights_dir) if weights_dir is not None else None,
            )
        except ValueError:
            logger.warning("Unknown ARDY checkpoint %r; falling back to %s", checkpoint, DEFAULT_CHECKPOINT)
            return DEFAULT_CHECKPOINT

    def _load_model(self, checkpoint: str | None = None) -> Any:
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading ARDY model from %s", weights_dir)
        # Make the vendored ARDY source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _ardy_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "ardy")
        if _ardy_root not in sys.path:
            sys.path.insert(0, _ardy_root)
        from ardy.model.load_model import load_model, load_text_encoder

        model_name = self._resolve_checkpoint_name(checkpoint, weights_dir=weights_dir)
        # download_models.sh downloads nvidia/ARDY-Core-RP-20FPS-Horizon40 directly
        # into pretrained/ardy/ (config.yaml at root), while upstream load_model
        # expects <checkpoints_dir>/<model_name>/config.yaml.
        expected_dir = weights_dir / model_name
        if model_name == DEFAULT_CHECKPOINT and not expected_dir.exists() and (weights_dir / "config.yaml").is_file():
            try:
                expected_dir.symlink_to(weights_dir)
            except OSError:
                pass

        self._text_encoder_warning = None
        text_encoder: Any = False
        try:
            text_encoder = load_text_encoder(mode="api", fp32=True, device="cpu")
        except Exception as exc:
            self._text_encoder_warning = TEXT_ENCODER_WARNING
            logger.warning(
                "%s (%s); falling back to unconditional torch.zeros text features.",
                TEXT_ENCODER_WARNING,
                exc,
            )

        model = load_model(
            model_name,
            device="cpu",
            checkpoints_dir=str(weights_dir),
            text_encoder=text_encoder,
        )
        self._model = model
        self.model = model
        self._loaded_checkpoint = model_name
        return model

    def _unload_model(self) -> None:
        self._model = None
        self.model = None
        self._loaded_checkpoint = None
        self._text_encoder_warning = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        model = self._model
        if model is None:
            return {"success": False, "error": "ARDY model not loaded"}

        prompt = inputs.get("text_prompt") or inputs.get("prompt", "")
        if not prompt:
            return {"success": False, "error": "ARDY requires a text prompt"}

        requested_checkpoint = self._resolve_checkpoint_name(inputs.get("checkpoint"))
        if self._loaded_checkpoint is not None and requested_checkpoint != self._loaded_checkpoint:
            model = self._load_model(checkpoint=requested_checkpoint)
        checkpoint = self._loaded_checkpoint or requested_checkpoint

        seed = int(inputs.get("seed", DEFAULT_SEED))
        duration = float(inputs["duration"])

        max_steps = getattr(getattr(model, "diffusion", None), "num_base_steps", None)
        raw_steps = inputs.get("num_denoising_steps")
        if raw_steps is None:
            num_denoising_steps = int(max_steps) if isinstance(max_steps, int) and max_steps > 0 else 100
        else:
            num_denoising_steps = int(raw_steps)
        if isinstance(max_steps, int) and max_steps > 0:
            num_denoising_steps = max(1, min(num_denoising_steps, max_steps))

        raw_cfg = inputs.get("cfg_weight")
        cfg_weight = float(raw_cfg) if raw_cfg is not None else 2.0

        from ardy.tools import seed_everything

        seed_everything(seed)

        device = "cpu"
        fps = model.motion_rep.fps
        num_frames = int(duration * fps)

        crop_history_length = None
        if duration > 10.0:
            patch = int(getattr(model, "num_frames_per_token", 1) or 1)
            gen_horizon_len = int(getattr(model, "gen_horizon_len", 0) or 0)
            max_window_len = (int(10 * fps) // patch) * patch
            candidate = ((max_window_len - gen_horizon_len) // patch) * patch
            if candidate > 0:
                crop_history_length = candidate

        text_encoder_warning = self._text_encoder_warning
        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            from ardy.motion_rep.tools import length_to_mask

            texts = [prompt]
            lengths = torch.tensor([num_frames], device=device)
            pad_mask = length_to_mask(lengths)
            first_heading_angle = torch.zeros(1, device=device)
            text_feat = None
            text_pad_mask = None
            if getattr(model, "text_encoder", None) is None:
                text_feat = torch.zeros(1, 1, 4096, device=device)
                text_pad_mask = torch.zeros(1, 1, dtype=torch.bool, device=device)
                if not text_encoder_warning:
                    text_encoder_warning = TEXT_ENCODER_WARNING
                    logger.warning("%s; using unconditional torch.zeros text features.", TEXT_ENCODER_WARNING)
            # None for motion_mask / observed_motion = constraint-free generation.
            motion = model(
                texts,
                num_frames,
                num_denoising_steps=num_denoising_steps,
                pad_mask=pad_mask,
                first_heading_angle=first_heading_angle,
                motion_mask=None,
                observed_motion=None,
                cfg_weight=cfg_weight,
                text_feat=text_feat,
                text_pad_mask=text_pad_mask,
                crop_history_length=crop_history_length,
            )
            output = model.motion_rep.inverse(motion, is_normalized=True)

            if inputs.get("post_process") and "g1" not in checkpoint.lower():
                try:
                    from ardy.postprocess import post_process_motion

                    corrected = post_process_motion(
                        output["local_rot_mats"],
                        output["root_positions"],
                        output["foot_contacts"],
                        model.skeleton,
                    )
                    output.update(corrected)
                except Exception as exc:
                    logger.warning(
                        "ARDY post_process_motion unavailable or failed (%s); using raw motion output.",
                        exc,
                    )

        import numpy as np

        out_dir = self._create_temporary_output_dir("ardy")
        out = out_dir / f"ardy_{seed}.npz"
        arrays = {
            k: (v.detach().cpu().numpy() if torch is not None and isinstance(v, torch.Tensor) else np.asarray(v))
            for k, v in output.items()
        }
        arrays["fps"] = float(fps)
        arrays["text"] = prompt
        np.savez(str(out), **arrays)

        generation_info: Dict[str, Any] = {
            "seed": seed,
            "duration": duration,
            "fps": float(fps),
            "num_frames": num_frames,
            "checkpoint": checkpoint,
            "output_format": "npz",
        }
        if text_encoder_warning:
            generation_info["text_encoder_warning"] = text_encoder_warning

        return {
            "success": True,
            "output_motion_path": str(out),
            "output_path": str(out),
            "file_path": str(out),
            "format": "npz",
            "artifact_type": "motion",
            "generation_info": generation_info,
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": [], "output": ["npz", "json"]}

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
                "duration": {
                    "type": "number",
                    "description": "Motion duration in seconds",
                    "default": 4.0,
                    "required": False,
                },
                "checkpoint": {
                    "type": "string",
                    "description": "ARDY checkpoint variant",
                    "default": DEFAULT_CHECKPOINT,
                    "required": False,
                },
                "cfg_weight": {
                    "type": "number",
                    "description": "Classifier-free guidance weight",
                    "default": 2.0,
                    "minimum": 0.0,
                    "required": False,
                },
                "num_denoising_steps": {
                    "type": "integer",
                    "description": "Number of diffusion denoising steps",
                    "default": 100,
                    "minimum": 1,
                    "required": False,
                },
            }
        }
