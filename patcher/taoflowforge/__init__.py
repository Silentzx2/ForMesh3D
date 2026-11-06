"""TaoFlowForge model-specific patcher.

Fixes pre-Ampere (Tesla T4 sm_75, etc.) GPU compatibility:

1. FlashAttention crash: flash_attn packages require Ampere+ (sm_80+).
   Forces ATTENTION_BACKEND = "sdpa" on pre-Ampere GPUs.

2. Stage 1 OOM: PyTorch Cutlass memory-efficient attention does NOT support
   bfloat16 on pre-Ampere GPUs (sm < 80). Using bfloat16 forces SDPA to fall
   back to SDPBackend.MATH, which materializes the entire N x N attention
   matrix (~10.06 GiB at Stage 1 level 8) and causes CUDA OOM on 16GB GPUs.
   Forces _COMPUTE_DTYPE = torch.float16 on sm < 80, allowing Cutlass
   SDPBackend.EFFICIENT_ATTENTION to run in tiles with < 10 MB memory overhead.

Preserves original high-quality resolution (image_size=1024) and full sampling steps.
Applies the patch when imported — call from taoflowforge_adapter._load_model().
"""

from __future__ import annotations

import logging
from typing import Any
import torch

logger = logging.getLogger(__name__)


def apply_patch() -> None:
    """Apply TaoFlowForge pre-Ampere compatibility patches."""
    _patch_attention_backend()


def _patch_attention_backend() -> None:
    """Configure attention backend and compute dtype for GPU architecture."""
    try:
        import taoflowforge.models.attention as attn_mod
    except Exception as exc:
        logger.warning(
            "TaoFlowForge attention patcher could not import attention module: %s",
            exc,
        )
        return

    if getattr(attn_mod, "_taoflowforge_attn_patched", False):
        return

    if torch is not None and torch.cuda.is_available():
        try:
            major, minor = torch.cuda.get_device_capability()
            if major < 8:
                logger.info(
                    "TaoFlowForge: pre-Ampere GPU (sm_%d%d) detected — "
                    "setting ATTENTION_BACKEND='sdpa' and compute_dtype=torch.float16 "
                    "for Cutlass memory-efficient attention (avoids 10 GiB MATH OOM).",
                    major,
                    minor,
                )
                attn_mod.ATTENTION_BACKEND = "sdpa"
                attn_mod._COMPUTE_DTYPE = torch.float16
                orig_get_compute_dtype = attn_mod.get_compute_dtype

                def _safe_get_compute_dtype(d=None):
                    if d is not None and getattr(d, "type", str(d)) == "cpu":
                        return torch.float32
                    if attn_mod._is_pre_ampere(d):
                        return torch.float16
                    return orig_get_compute_dtype(d)

                attn_mod.get_compute_dtype = _safe_get_compute_dtype
        except Exception as exc:
            logger.warning("TaoFlowForge patcher device check failed: %s", exc)

    attn_mod._taoflowforge_attn_patched = True
    logger.info(
        "TaoFlowForge attention patcher applied: backend=%s, compute_dtype=%s",
        attn_mod.ATTENTION_BACKEND,
        attn_mod._COMPUTE_DTYPE,
    )
