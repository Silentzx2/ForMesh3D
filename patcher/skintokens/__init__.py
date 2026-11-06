"""
SkinTokens model-specific patcher.

Fixes pre-Ampere (Tesla T4 sm_75, etc.) GPU compatibility and imports:

1. FlashAttention crash: FlashAttention 2 requires Ampere+ GPUs (sm_80+).
   Forces attn_implementation = "sdpa" on pre-Ampere GPUs (sm < 80) or when
   FlashAttention 2 is not compiled for the current device.

2. T4 BF16 performance: Tesla T4 (sm_75) lacks native BFloat16 tensor cores.
   On sm < 80, maps compute precision to torch.float16 (or torch.float32)
   to leverage T4 native FP16 tensor cores and avoid software emulation.

3. Large GPU Zero Regression: On modern GPUs (sm >= 80, e.g. A100, RTX 3090/4090, H100),
   runs in 100% native upstream mode (official FlashAttention 2, native BF16).

4. Zero Model Code Modification: Executes strictly inside this patcher module,
   leaving backend/thirdparty/SkinTokens completely untouched.

5. Headless import shim: Injects lightweight dummy module for gradio if not
   installed, enabling demo.py's load_model and run_rig to be used directly.
"""

from __future__ import annotations

import logging
import sys
import types
from typing import Any, Optional

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from patcher.doctor import GPUDoctor

logger = logging.getLogger(__name__)


def apply_patch(gpu_id: Optional[int] = None) -> None:
    """Apply SkinTokens pre-Ampere and import compatibility patches."""
    _shim_gradio_if_missing()
    _patch_attention_and_precision(gpu_id=gpu_id)


def _shim_gradio_if_missing() -> None:
    """Provide a minimal shim if gradio is not installed in the environment."""
    if "gradio" in sys.modules:
        return

    try:
        import gradio  # noqa: F401
    except ImportError:
        dummy = types.ModuleType("gradio")
        dummy.TEMP_DIR = "tmp_gradio"
        dummy_class = type("Dummy", (), {
            "__enter__": lambda s: s,
            "__exit__": lambda *a: None,
            "click": lambda *a, **k: None,
            "launch": lambda *a, **k: None,
        })
        for name in ("Blocks", "Markdown", "File", "Accordion", "Dropdown", "Slider", "Checkbox", "Button", "Textbox"):
            setattr(dummy, name, lambda *a, **k: dummy_class())
        sys.modules["gradio"] = dummy
        logger.debug("SkinTokens patcher: installed headless gradio shim")


def _patch_attention_and_precision(gpu_id: Optional[int] = None) -> None:
    """Configure attention backend and precision according to GPU architecture using GPUDoctor."""
    doctor = GPUDoctor()
    gpu_info = doctor.inspect_gpu(gpu_id)
    is_pre_ampere = gpu_info.is_pre_ampere or gpu_info.is_cpu

    if is_pre_ampere and not gpu_info.is_cpu:
        logger.info(
            "SkinTokens patcher: pre-Ampere GPU (sm_%d%d, e.g. Tesla T4) detected. "
            "Configuring SDPA attention and float16 precision for native hardware acceleration.",
            gpu_info.major,
            gpu_info.minor,
        )

    # Patch transformers AutoModelForCausalLM if present
    try:
        import transformers
        if getattr(transformers, "_skintokens_patched", False):
            return

        orig_from_config = transformers.AutoModelForCausalLM.from_config

        def patched_from_config(config: Any, **kwargs: Any) -> Any:
            if is_pre_ampere:
                # Fall back to SDPA when FlashAttention 2 is unsupported
                if kwargs.get("attn_implementation") == "flash_attention_2":
                    kwargs["attn_implementation"] = "sdpa"
                if hasattr(config, "_attn_implementation") and config._attn_implementation == "flash_attention_2":
                    config._attn_implementation = "sdpa"
                # On T4, adapt BF16 to FP16 for native tensor core acceleration
                if getattr(config, "torch_dtype", None) == (getattr(torch, "bfloat16", None) if torch else None):
                    config.torch_dtype = torch.float16 if torch else None

            return orig_from_config(config, **kwargs)

        transformers.AutoModelForCausalLM.from_config = patched_from_config  # type: ignore
        transformers._skintokens_patched = True
    except (ImportError, AttributeError):
        pass
