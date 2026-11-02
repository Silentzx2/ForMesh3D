"""ARDY adapter — thin integration over the official ThirdParty inference API.

ARDY is CPU-only (no GPU VRAM reservation). Wraps ``ardy.model.load_model`` and
``ardy.tools.seed_everything`` from ``backend/thirdparty/ardy``. Autoregressive
diffusion motion generation from text. Weights resolved through
``backend.loader.get_model_weights_dir``.
"""

from __future__ import annotations

import contextlib
import logging
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

    def _load_model(self) -> Any:
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading ARDY model from %s", weights_dir)
        # Make the vendored ARDY source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _ardy_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "ardy")
        if _ardy_root not in sys.path:
            sys.path.insert(0, _ardy_root)
        from ardy.model import load_model

        model = load_model(
            "ARDY-Core-RP-20FPS-Horizon40",
            device="cpu",
            checkpoints_dir=str(weights_dir),
            text_encoder=False,  # avoid HF download for text encoder
        )
        self._model = model
        self.model = model
        return model

    def _unload_model(self) -> None:
        self._model = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        model = self._model
        if model is None:
            return {"success": False, "error": "ARDY model not loaded"}

        prompt = inputs.get("text_prompt") or inputs.get("prompt", "")
        if not prompt:
            return {"success": False, "error": "ARDY requires a text prompt"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        duration = float(inputs.get("duration", 4.0))
        checkpoint = inputs.get("checkpoint", "ARDY-Core-RP-20FPS-Horizon40")

        from ardy.tools import seed_everything

        seed_everything(seed)

        device = "cpu"
        fps = model.motion_rep.fps
        num_frames = int(duration * fps)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            from ardy.constraints import load_constraints_lst
            from ardy.motion_rep.tools import length_to_mask

            texts = [prompt]
            lengths = torch.tensor([num_frames], device=device)
            pad_mask = length_to_mask(lengths)
            first_heading_angle = torch.zeros(1, device=device)
            # motion_mask: all ones (no joints masked out), observed_motion: zeros (no conditioning)
            motion_mask = torch.ones(1, num_frames, model.motion_rep.n_joints * 3, device=device)
            observed_motion = torch.zeros(1, num_frames, model.motion_rep.n_joints * 3, device=device)
            num_denoising_steps = 50
            motion = model(
                texts,
                num_frames,
                num_denoising_steps=num_denoising_steps,
                pad_mask=pad_mask,
                first_heading_angle=first_heading_angle,
                motion_mask=motion_mask,
                observed_motion=observed_motion,
                cfg_weight=2.0,
            )
            output = model.motion_rep.inverse(motion, is_normalized=True)

        import numpy as np
        import tempfile

        out = Path(tempfile.mkdtemp()) / f"ardy_{seed}.npz"
        arrays = {k: np.asarray(v) for k, v in output.items()}
        arrays["fps"] = float(fps)
        arrays["text"] = prompt
        np.savez(str(out), **arrays)

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "duration": duration,
                "fps": float(fps),
                "num_frames": num_frames,
                "checkpoint": checkpoint,
            },
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
                    "default": "ARDY-Core-RP-20FPS-Horizon40",
                    "required": False,
                },
            }
        }
