"""ARDY worker-local runtime patches."""
from .text_encoder import apply_nf4_patch

__all__ = ["apply_nf4_patch"]
