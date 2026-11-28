"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  ARDY Motion Generation Adapter                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/ardy (ardy.model.load_model, ardy.postprocess)║
║  Weights  : backend/pretrained/ardy                                          ║
║  Patcher  : patcher.ardy.apply_nf4_patch()                                   ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict

import numpy as np
import torch

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)
DEFAULT_CHECKPOINT = "ARDY-Core-RP-20FPS-Horizon40"


class ArdyMotionGenerationAdapter(BaseModel):
    MODEL_KEY = "ardy"
    FEATURE_TYPE = "motion_generation"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self._model: Any = None
        self._loaded_checkpoint: str | None = None

    def _resolve_checkpoint_name(self, checkpoint: str | None, weights_dir: Path | None = None) -> str:
        if not checkpoint:
            return DEFAULT_CHECKPOINT
        with use_thirdparty("ardy", chdir=False):
            from ardy.model.registry import resolve_model_name
            try:
                return resolve_model_name(
                    str(checkpoint),
                    checkpoints_dir=str(weights_dir) if weights_dir else None,
                )
            except ValueError:
                logger.warning("Unknown ARDY checkpoint %r; falling back to %s", checkpoint, DEFAULT_CHECKPOINT)
                return DEFAULT_CHECKPOINT

    def _load_model(self, checkpoint: str | None = None) -> Any:
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        if not weights_dir.is_dir():
            raise FileNotFoundError(f"ARDY weights missing: {weights_dir}")

        with use_thirdparty("ardy", chdir=False):
            from ardy.model.load_model import load_model, load_text_encoder

            model_name = self._resolve_checkpoint_name(checkpoint, weights_dir=weights_dir)
            expected_dir = weights_dir / model_name
            if model_name == DEFAULT_CHECKPOINT and not expected_dir.exists() and (weights_dir / "config.yaml").is_file():
                try:
                    expected_dir.symlink_to(weights_dir)
                except OSError:
                    pass

            text_encoder: Any = None
            te_dir = weights_dir / "text_encoders"
            te_device = os.environ.get("ARDY_TEXT_ENCODER_DEVICE", "auto").strip().lower()
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "ARDY prompt conditioning requires a visible CUDA GPU for the NF4 LLM2Vec text encoder."
                )
            current_gpu = torch.cuda.current_device()
            if te_device == "auto":
                te_device = f"cuda:{current_gpu}"
            if not te_device.startswith("cuda"):
                raise RuntimeError(
                    f"ARDY prompt conditioning requires CUDA, got ARDY_TEXT_ENCODER_DEVICE={te_device!r}."
                )
            requested_device = torch.device(te_device)
            device_index = current_gpu if requested_device.index is None else requested_device.index
            if device_index != current_gpu:
                raise RuntimeError(
                    f"ARDY worker was assigned cuda:{current_gpu}, but ARDY_TEXT_ENCODER_DEVICE requests {te_device}."
                )
            te_device = f"cuda:{device_index}"
            os.environ["TEXT_ENCODER_DEVICE"] = te_device
            if te_dir.is_dir():
                os.environ["TEXT_ENCODERS_DIR"] = str(te_dir)

            try:
                import bitsandbytes  # noqa: F401
                from transformers import BitsAndBytesConfig
                from ardy.model.llm2vec.llm2vec import LLM2Vec
            except ImportError as exc:
                raise RuntimeError(
                    "ARDY prompt conditioning requires bitsandbytes and Transformers BitsAndBytesConfig "
                    "for the NF4 CUDA text encoder."
                ) from exc

            from patcher.ardy import apply_nf4_patch

            apply_nf4_patch(LLM2Vec, BitsAndBytesConfig, torch, device_index)
            prev_dtype = torch.get_default_dtype()
            try:
                text_encoder = load_text_encoder(mode="local", fp32=False, device=te_device)
            except Exception as exc:
                raise RuntimeError(
                    f"ARDY NF4 text encoder failed to initialize on {te_device}: {type(exc).__name__}: {exc}"
                ) from exc
            finally:
                torch.set_default_dtype(prev_dtype)
            if text_encoder is None:
                raise RuntimeError("ARDY NF4 text encoder initialization returned no encoder.")

            logger.info("Loading ARDY (%s) from %s", model_name, weights_dir)
            self._model = load_model(
                model_name,
                device="cpu",
                checkpoints_dir=str(weights_dir),
                text_encoder=text_encoder,
            )
            self._loaded_checkpoint = model_name
            return self._model

    def _unload_model(self) -> None:
        self._model = None
        self._loaded_checkpoint = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        prompt = inputs.get("text_prompt") or inputs.get("prompt", "")
        if not prompt:
            return {"success": False, "error": "ARDY requires a text prompt"}

        requested = self._resolve_checkpoint_name(inputs.get("checkpoint"))
        if self._loaded_checkpoint and requested != self._loaded_checkpoint:
            self._load_model(checkpoint=requested)
        model = self._model
        if model is None:
            return {"success": False, "error": "ARDY model not loaded"}

        seed = int(inputs["seed"])
        duration = float(inputs.get("duration", 4.0))
        cfg_weight = float(inputs.get("cfg_weight", 2.0))
        max_steps = getattr(getattr(model, "diffusion", None), "num_base_steps", None)
        steps = int(inputs.get("num_denoising_steps") or max_steps or 100)
        if isinstance(max_steps, int) and max_steps > 0:
            steps = max(1, min(steps, max_steps))

        with use_thirdparty("ardy", chdir=False):
            from ardy.motion_rep.tools import length_to_mask
            from ardy.tools import seed_everything
            seed_everything(seed)

            fps = model.motion_rep.fps
            num_frames = int(duration * fps)
            crop_history_length = None
            if duration > 10.0:
                patch = int(getattr(model, "num_frames_per_token", 1) or 1)
                horizon = int(getattr(model, "gen_horizon_len", 0) or 0)
                cand = (((int(10 * fps) // patch) * patch - horizon) // patch) * patch
                if cand > 0:
                    crop_history_length = cand

            texts = [prompt]
            pad_mask = length_to_mask(torch.tensor([num_frames], device="cpu"))
            first_heading_angle = torch.zeros(1, device="cpu")
            if getattr(model, "text_encoder", None) is None:
                return {
                    "success": False,
                    "error": "ARDY prompt encoder is unavailable; refusing unconditional motion generation.",
                }
            text_feat, text_pad_mask = None, None

            with torch.no_grad():
                motion = model(
                    texts,
                    num_frames,
                    num_denoising_steps=steps,
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

            if inputs.get("post_process") and "g1" not in (self._loaded_checkpoint or "").lower():
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
                    logger.warning("ARDY post_process_motion skipped: %s", exc)

        out_dir = self._create_temporary_output_dir("ardy")
        out_path = out_dir / f"ardy_{seed}.npz"
        np.savez(
            out_path,
            **{k: v.cpu().numpy() if torch.is_tensor(v) else v for k, v in output.items()},
            fps=fps,
            text=prompt,
        )

        info: Dict[str, Any] = {
            "seed": seed,
            "duration": duration,
            "fps": float(fps),
            "num_frames": num_frames,
            "checkpoint": self._loaded_checkpoint,
            "output_format": "npz",
        }

        return {
            "success": True,
            "output_motion_path": str(out_path),
            "output_path": str(out_path),
            "file_path": str(out_path),
            "format": "npz",
            "artifact_type": "motion",
            "generation_info": info,
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": [], "output": ["npz", "json"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {"type": "integer", "description": "Random seed for reproducibility", "minimum": 0, "required": False},
                "duration": {"type": "number", "description": "Motion duration in seconds", "default": 4.0, "required": False},
                "checkpoint": {"type": "string", "description": "ARDY checkpoint variant", "default": DEFAULT_CHECKPOINT, "required": False},
                "cfg_weight": {"type": "number", "description": "Classifier-free guidance weight", "default": 2.0, "minimum": 0.0, "required": False},
                "num_denoising_steps": {"type": "integer", "description": "Number of diffusion denoising steps", "default": 100, "minimum": 1, "required": False},
            }
        }
