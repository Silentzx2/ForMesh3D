"""TaoFlowForge model-specific patcher.

Fixes two issues on low-VRAM / pre-Ampere GPUs:

1. FlashAttention crash: taoflowforge.models.attention imports flash_attn
   packages and sets ATTENTION_BACKEND = "fa3"/"fa2" when installed. On
   pre-Ampere GPUs (Tesla T4 sm_75, etc.), flash_attn_func raises:
       RuntimeError: FlashAttention only supports Ampere GPUs or newer.
   This patcher forces ATTENTION_BACKEND = "sdpa" when GPU compute
   capability is below 8.0, falling back to PyTorch SDPA.

2. Stage 1 OOM: TaoFlowForge stage 1 attention computation needs ~10 GiB
   GPU memory at image_size=1024. On cards with < 12 GB VRAM this OOMs.
   This patcher reduces image_size from 1024→512 and stage 1 num_steps
   from 30→20 when total GPU VRAM is below 12 GB, letting inference fit
   on low-VRAM cards.

Applies the patch when imported — call from taoflowforge_adapter._load_model().
"""

from __future__ import annotations

import logging
import torch
from typing import Any

logger = logging.getLogger(__name__)


def apply_patch() -> None:
    """Apply all TaoFlowForge patches: FlashAttention fallback + low VRAM config."""
    _patch_attention_backend()
    _patch_low_vram_config()


def _patch_attention_backend() -> None:
    """Force SDPA attention on pre-Ampere GPUs to avoid FlashAttention crash."""
    try:
        import taoflowforge.models.attention as attn_mod
    except Exception as exc:
        logger.warning(
            "TaoFlowForge attention patcher could not import attention module: %s",
            exc,
        )
        return

    # Already patched guard
    if getattr(attn_mod, "_taoflowforge_attn_patched", False):
        return

    original_backend = attn_mod.ATTENTION_BACKEND

    def _resolve_backend() -> str:
        """Return 'fa3'/'fa2' only on Ampere+ GPUs, else 'sdpa'."""
        if original_backend not in {"fa3", "fa2"}:
            return original_backend
        if torch is not None and torch.cuda.is_available():
            try:
                major, _ = torch.cuda.get_device_capability()
                if major < 8:
                    logger.info(
                        "TaoFlowForge: pre-Ampere GPU (sm_%d%d) detected — "
                        "disabling FlashAttention, falling back to SDPA.",
                        major,
                        _,
                    )
                    return "sdpa"
            except Exception:
                pass
        return original_backend

    attn_mod.ATTENTION_BACKEND = _resolve_backend()
    attn_mod._taoflowforge_attn_patched = True  # type: ignore[attr-defined]
    logger.info(
        "TaoFlowForge attention patcher applied: backend=%s",
        attn_mod.ATTENTION_BACKEND,
    )


def _patch_low_vram_config() -> None:
    """Reduce image_size and stage 1 steps on low-VRAM GPUs (< 12 GB).

    Stage 1 attention needs ~10 GiB GPU memory at image_size=1024.
    Reducing to 512 cuts attention memory ~16x (O(n^2) with resolution),
    letting inference fit on 8-12 GB cards.
    """
    try:
        import taoflowforge.pipeline as pipeline_mod
    except Exception as exc:
        logger.warning(
            "TaoFlowForge low-VRAM patcher could not import pipeline module: %s",
            exc,
        )
        return

    # Already patched guard
    if getattr(pipeline_mod, "_taoflowforge_lowvram_patched", False):
        return

    original_init = pipeline_mod.TaoFlowForgePipeline.__init__

    def patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        original_init(self, *args, **kwargs)

        if torch is not None and torch.cuda.is_available():
            try:
                props = torch.cuda.get_device_properties(self.device)
                total_vram_gb = props.total_memory / (1024**3)
                if total_vram_gb < 12:
                    logger.info(
                        "TaoFlowForge: low VRAM (%.1f GB) detected — reducing "
                        "image_size 1024→512 and stage 1 steps 30→20",
                        total_vram_gb,
                    )
                    self.image_size = 512
                    if self.stage1_config is not None:
                        self.stage1_config.num_steps = min(
                            self.stage1_config.num_steps, 20
                        )
            except Exception:
                pass

    pipeline_mod.TaoFlowForgePipeline.__init__ = patched_init
    pipeline_mod._taoflowforge_lowvram_patched = True  # type: ignore[attr-defined]
    logger.info("TaoFlowForge low-VRAM patcher applied")

