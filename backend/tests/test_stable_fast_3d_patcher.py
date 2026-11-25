from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from patcher.stable_fast_3d.attention import pre_ampere_chunked_sdpa


def test_disabled_patch_keeps_native_attention_untouched():
    functional = torch.nn.functional
    original = functional.scaled_dot_product_attention

    with pre_ampere_chunked_sdpa(torch, enabled=False):
        assert functional.scaled_dot_product_attention is original

    assert functional.scaled_dot_product_attention is original


def test_pre_ampere_chunked_sdpa_matches_native_and_restores_function():
    functional = torch.nn.functional
    original = functional.scaled_dot_product_attention
    q = torch.randn(1, 1, 23, 8)
    k = torch.randn(1, 1, 23, 8)
    v = torch.randn(1, 1, 23, 8)
    expected = original(q, k, v)

    with pre_ampere_chunked_sdpa(torch, enabled=True, chunk_size=7):
        assert functional.scaled_dot_product_attention is not original
        actual = functional.scaled_dot_product_attention(q, k, v)

    assert torch.allclose(actual, expected, atol=1e-6, rtol=1e-5)
    assert functional.scaled_dot_product_attention is original


def test_pre_ampere_patch_is_restored_when_inference_raises():
    original = torch.nn.functional.scaled_dot_product_attention
    with pytest.raises(RuntimeError, match="simulated"):
        with pre_ampere_chunked_sdpa(torch, enabled=True):
            raise RuntimeError("simulated")
    assert torch.nn.functional.scaled_dot_product_attention is original
