"""Runtime patches isolated to the Stable Fast 3D worker."""

from .attention import pre_ampere_chunked_sdpa

__all__ = ["pre_ampere_chunked_sdpa"]
