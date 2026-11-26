"""Stable Fast 3D-only, worker-scoped attention compatibility patch."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator


@contextmanager
def pre_ampere_chunked_sdpa(
    torch_module: Any, *, enabled: bool, chunk_size: int = 1024
) -> Iterator[None]:
    """Temporarily chunk query attention only for pre-Ampere Stable Fast 3D workers."""
    if not enabled or torch_module is None:
        yield
        return
    if chunk_size < 1:
        raise ValueError("chunk_size must be positive")

    functional = torch_module.nn.functional
    original = getattr(functional, "scaled_dot_product_attention", None)
    if not callable(original):
        yield
        return

    def _chunked(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None):
        token_dim = 2 if q.ndim == 4 else 1
        token_count = q.shape[token_dim]
        if token_count <= chunk_size or dropout_p > 0.0 or is_causal:
            return original(
                q, k, v, attn_mask=attn_mask, dropout_p=dropout_p,
                is_causal=is_causal, scale=scale,
            )

        kwargs = {"dropout_p": dropout_p, "is_causal": is_causal}
        if scale is not None:
            kwargs["scale"] = scale
        chunks = []
        for start in range(0, token_count, chunk_size):
            stop = start + chunk_size
            query = q[:, :, start:stop, :] if token_dim == 2 else q[:, start:stop, :]
            mask = attn_mask
            if attn_mask is not None and attn_mask.ndim >= 2 and attn_mask.shape[-2] == token_count:
                mask = attn_mask[..., start:stop, :]
            chunks.append(original(query, k, v, attn_mask=mask, **kwargs))
        return torch_module.cat(chunks, dim=token_dim).contiguous()

    functional.scaled_dot_product_attention = _chunked
    try:
        yield
    finally:
        functional.scaled_dot_product_attention = original
