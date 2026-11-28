"""Worker-local bitsandbytes NF4 placement patch for ARDY's LLM2Vec encoder."""
from __future__ import annotations

from typing import Any


def _is_quantized_model(model: Any) -> bool:
    """Detect bitsandbytes quantization through PEFT/model wrapper layers."""
    pending = [model]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        if any(
            bool(getattr(current, attr, False))
            for attr in ("is_loaded_in_4bit", "is_loaded_in_8bit", "is_quantized")
        ):
            return True
        for attr in ("base_model", "model"):
            child = getattr(current, attr, None)
            if child is not None and child is not current:
                pending.append(child)
    return False


def apply_nf4_patch(LLM2Vec: Any, BitsAndBytesConfig: Any, torch_module: Any, device_index: int) -> None:
    """Load LLM2Vec with NF4 on the assigned GPU and avoid unsupported quantized .to() calls.

    Call this from ARDY's adapter inside its isolated worker, before loading the
    text encoder. It intentionally patches only ARDY's vendored LLM2Vec class.
    """
    if not getattr(LLM2Vec, "_ardy_4bit_patched", False):
        original_from_pretrained = LLM2Vec.from_pretrained.__func__

        @classmethod
        def _nf4_from_pretrained(cls: Any, *args: Any, **kwargs: Any) -> Any:
            kwargs.setdefault(
                "quantization_config",
                BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=torch_module.float16,
                    bnb_4bit_use_double_quant=True,
                ),
            )
            kwargs.setdefault("device_map", {"": device_index})
            return original_from_pretrained(cls, *args, **kwargs)

        LLM2Vec.from_pretrained = _nf4_from_pretrained
        LLM2Vec._ardy_4bit_patched = True

    if not getattr(LLM2Vec, "_ardy_quantized_to_patched", False):
        original_to = LLM2Vec.to

        def _safe_to(self: Any, *args: Any, **kwargs: Any) -> Any:
            # Accelerate/device_map has already placed quantized weights.
            if _is_quantized_model(getattr(self, "model", None)):
                return self
            return original_to(self, *args, **kwargs)

        LLM2Vec.to = _safe_to
        LLM2Vec._ardy_quantized_to_patched = True
