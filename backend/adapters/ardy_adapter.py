"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  ARDY Motion Generation Adapter                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/ardy (ardy.model.load_model, ardy.postprocess)║
║  Weights  : backend/pretrained/ardy                                          ║
║  Patcher  : None (CPU-only text-to-motion)                                   ║
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
        self._text_encoder_warning: str | None = None

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

            self._text_encoder_warning = None
            text_encoder: Any = False
            te_dir = weights_dir / "text_encoders"
            if te_dir.is_dir():
                os.environ.setdefault("TEXT_ENCODERS_DIR", str(te_dir))
            try:
                te_mode = os.environ.get("ARDY_TEXT_ENCODER_MODE", "auto")
                te_device = os.environ.get("ARDY_TEXT_ENCODER_DEVICE", "auto")
                if te_device == "auto":
                    te_device = "cuda" if torch.cuda.is_available() else "cpu"
                use_4bit_cuda = False
                if te_device.startswith("cuda"):
                    try:
                        import bitsandbytes  # noqa: F401
                        from transformers import BitsAndBytesConfig
                        from ardy.model.llm2vec.llm2vec import LLM2Vec

                        if not getattr(LLM2Vec, "_ardy_4bit_patched", False):
                            orig_fp = LLM2Vec.from_pretrained.__func__  # type: ignore[attr-defined]

                            @classmethod  # type: ignore[misc]
                            def _4bit_from_pretrained(cls: Any, *a: Any, **kw: Any) -> Any:
                                kw.setdefault(
                                    "quantization_config",
                                    BitsAndBytesConfig(
                                        load_in_4bit=True,
                                        bnb_4bit_compute_dtype=torch.float16,
                                    ),
                                )
                                kw.setdefault("device_map", {"": 0})
                                return orig_fp(cls, *a, **kw)

                            LLM2Vec.from_pretrained = _4bit_from_pretrained  # type: ignore[method-assign]
                            LLM2Vec._ardy_4bit_patched = True  # type: ignore[attr-defined]
                        use_4bit_cuda = True
                        logger.info("ARDY text encoder: using 4-bit bitsandbytes quantization on %s", te_device)
                    except ImportError:
                        logger.info("bitsandbytes unavailable; loading ARDY text encoder on %s", te_device)
                # Pass device=None for 4-bit device_map (avoids .to() ValueError); preserve default dtype on failure.
                prev_dtype = torch.get_default_dtype()
                try:
                    text_encoder = load_text_encoder(
                        mode=te_mode,
                        fp32=False,
                        device=None if use_4bit_cuda else te_device,
                    )
                finally:
                    torch.set_default_dtype(prev_dtype)
                if use_4bit_cuda and text_encoder and not getattr(text_encoder, "_ardy_cpu_out_wrapped", False):
                    orig_call = text_encoder.__call__

                    def _cpu_out_call(texts: Any, _orig: Any = orig_call) -> Any:
                        t, lengths = _orig(texts)
                        return (t.cpu() if hasattr(t, "cpu") else t), lengths

                    text_encoder.__call__ = _cpu_out_call  # type: ignore[method-assign]
                    text_encoder._ardy_cpu_out_wrapped = True
            except Exception as exc:
                self._text_encoder_warning = "Text encoder server unavailable; prompt conditioning disabled"
                logger.warning("%s (%s)", self._text_encoder_warning, exc)

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
        self._text_encoder_warning = None

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
            text_feat, text_pad_mask = None, None
            if getattr(model, "text_encoder", None) is None:
                text_feat = torch.zeros(1, 1, 4096, device="cpu")
                text_pad_mask = torch.zeros(1, 1, dtype=torch.bool, device="cpu")

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
        if self._text_encoder_warning:
            info["text_encoder_warning"] = self._text_encoder_warning

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
