"""TRELLIS-only, worker-scoped spconv compatibility patch."""
from __future__ import annotations

import os


def apply_spconv_workarounds() -> None:
    """Set spconv environment variables before TRELLIS/spconv import to avoid
    CUDA illegal-address errors in spconv's implicit_gemm merge_sort kernel
    during SLAT sampling.  Must be called before `use_thirdparty("TRELLIS")`
    because spconv reads these at import time."""
    os.environ.setdefault("SPCONV_ALGO", "native")


__all__ = ["apply_spconv_workarounds"]
