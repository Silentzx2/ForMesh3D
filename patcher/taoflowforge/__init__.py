"""TaoFlowForge model-specific patcher.

Fixes FlashAttention crash on pre-Ampere GPUs (Tesla T4 sm_75, etc.).

taoflowforge.models.attention imports flash_attn packages and sets
ATTENTION_BACKEND = "fa3"/"fa2" when they are installed. On pre-Ampere
GPUs, calling flash_attn_func raises:
    RuntimeError: FlashAttention only supports Ampere GPUs or newer.

This patcher forces ATTENTION_BACKEND = "sdpa" when the GPU compute
capability is below 8.0, so inference falls back to PyTorch's
scaled_dot_product_attention instead of crashing.

Applies the patch when imported — call from taoflowforge_adapter._load_model().
"""

from __future__ import annotations

import logging
import torch
from typing import Any

logger = logging.getLogger(__name__)


def apply_patch() -> None:
    """Patch TaoFlowForge attention module to disable FlashAttention on pre-Ampere GPUs."""
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
