"""Qwen3 compatibility shim for transformers < 4.51 (e.g. 4.44.2) inside SkinTokens worker."""

from __future__ import annotations

import logging
from typing import Any, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

logger = logging.getLogger(__name__)

try:
    from transformers.models.qwen2.configuration_qwen2 import Qwen2Config
    from transformers.models.qwen2.modeling_qwen2 import (
        Qwen2ForCausalLM,
        Qwen2RMSNorm,
        Qwen2RotaryEmbedding,
        apply_rotary_pos_emb,
        repeat_kv,
    )
    _HAS_QWEN2 = True
except ImportError:
    Qwen2Config = object  # type: ignore
    Qwen2ForCausalLM = nn.Module  # type: ignore
    _HAS_QWEN2 = False


if _HAS_QWEN2:

    class Qwen3Config(Qwen2Config):
        """Module-level Qwen3Config (picklable across DataLoader spawn workers)."""

        model_type = "qwen3"

        def __init__(
            self,
            head_dim: int = 128,
            attention_bias: bool = False,
            **kwargs: Any,
        ) -> None:
            self.head_dim = head_dim
            self.attention_bias = attention_bias
            super().__init__(**kwargs)

    class Qwen3Attention(nn.Module):
        """Qwen2-compatible attention with Qwen3 explicit head_dim, unbiased projections, and QK-Norm."""

        def __init__(self, config: Qwen3Config, layer_idx: Optional[int] = None) -> None:
            super().__init__()
            self.config = config
            self.layer_idx = layer_idx
            self.hidden_size = config.hidden_size
            self.num_heads = config.num_attention_heads
            self.head_dim = getattr(config, "head_dim", self.hidden_size // self.num_heads)
            self.num_key_value_heads = config.num_key_value_heads
            self.num_key_value_groups = self.num_heads // self.num_key_value_heads
            self.max_position_embeddings = config.max_position_embeddings
            self.rope_theta = config.rope_theta
            self.is_causal = True
            self.attention_dropout = getattr(config, "attention_dropout", 0.0)

            bias = getattr(config, "attention_bias", False)
            self.q_proj = nn.Linear(self.hidden_size, self.num_heads * self.head_dim, bias=bias)
            self.k_proj = nn.Linear(self.hidden_size, self.num_key_value_heads * self.head_dim, bias=bias)
            self.v_proj = nn.Linear(self.hidden_size, self.num_key_value_heads * self.head_dim, bias=bias)
            self.o_proj = nn.Linear(self.num_heads * self.head_dim, self.hidden_size, bias=bias)
            self.q_norm = Qwen2RMSNorm(self.head_dim, eps=config.rms_norm_eps)
            self.k_norm = Qwen2RMSNorm(self.head_dim, eps=config.rms_norm_eps)
            self.rotary_emb = Qwen2RotaryEmbedding(
                self.head_dim,
                max_position_embeddings=self.max_position_embeddings,
                base=self.rope_theta,
            )

        def forward(
            self,
            hidden_states: torch.Tensor,
            attention_mask: Optional[torch.Tensor] = None,
            position_ids: Optional[torch.LongTensor] = None,
            past_key_value: Optional[Any] = None,
            output_attentions: bool = False,
            use_cache: bool = False,
            cache_position: Optional[torch.LongTensor] = None,
            position_embeddings: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        ) -> Tuple[torch.Tensor, Optional[torch.Tensor], Optional[Any]]:
            bsz, q_len, _ = hidden_states.size()

            query_states = self.q_norm(
                self.q_proj(hidden_states).view(bsz, q_len, self.num_heads, self.head_dim)
            ).transpose(1, 2)
            key_states = self.k_norm(
                self.k_proj(hidden_states).view(bsz, q_len, self.num_key_value_heads, self.head_dim)
            ).transpose(1, 2)
            value_states = self.v_proj(hidden_states).view(
                bsz, q_len, self.num_key_value_heads, self.head_dim
            ).transpose(1, 2)

            kv_seq_len = key_states.shape[-2]
            if past_key_value is not None:
                kv_seq_len += past_key_value.get_usable_length(kv_seq_len, self.layer_idx)

            if position_ids is None:
                past_len = kv_seq_len - q_len
                position_ids = torch.arange(
                    past_len, past_len + q_len, device=hidden_states.device
                ).unsqueeze(0)

            cos, sin = self.rotary_emb(value_states, seq_len=kv_seq_len)
            query_states, key_states = apply_rotary_pos_emb(query_states, key_states, cos, sin, position_ids)

            if past_key_value is not None:
                cache_kwargs = {"sin": sin, "cos": cos, "cache_position": cache_position}
                key_states, value_states = past_key_value.update(
                    key_states, value_states, self.layer_idx, cache_kwargs
                )

            key_states = repeat_kv(key_states, self.num_key_value_groups)
            value_states = repeat_kv(value_states, self.num_key_value_groups)

            causal_mask = attention_mask
            if attention_mask is not None:
                causal_mask = attention_mask[:, :, :, : key_states.shape[-2]]
                if causal_mask.dtype != torch.bool and causal_mask.dtype != query_states.dtype:
                    causal_mask = causal_mask.to(query_states.dtype)

            if query_states.device.type == "cuda" and causal_mask is not None:
                query_states = query_states.contiguous()
                key_states = key_states.contiguous()
                value_states = value_states.contiguous()

            is_causal = causal_mask is None and q_len > 1
            attn_output = F.scaled_dot_product_attention(
                query_states,
                key_states,
                value_states,
                attn_mask=causal_mask,
                dropout_p=self.attention_dropout if self.training else 0.0,
                is_causal=is_causal,
            )
            attn_output = attn_output.transpose(1, 2).contiguous().view(bsz, q_len, self.num_heads * self.head_dim)
            attn_output = self.o_proj(attn_output)
            return attn_output, None, past_key_value

    class Qwen3ForCausalLM(Qwen2ForCausalLM):
        """Module-level Qwen3ForCausalLM (picklable across DataLoader spawn workers)."""

        config_class = Qwen3Config

        def __init__(self, config: Qwen3Config) -> None:
            super().__init__(config)
            for idx, layer in enumerate(self.model.layers):
                layer.self_attn = Qwen3Attention(config, layer_idx=idx)
            self.post_init()


def register_qwen3_if_missing() -> None:
    """Register Qwen3Config and Qwen3ForCausalLM into transformers if 'qwen3' is absent."""
    if not _HAS_QWEN2:
        return
    try:
        import transformers
        from transformers import AutoConfig, AutoModelForCausalLM
        from transformers.models.auto.configuration_auto import CONFIG_MAPPING
    except ImportError:
        return

    if "qwen3" in CONFIG_MAPPING:
        return

    AutoConfig.register("qwen3", Qwen3Config)
    AutoModelForCausalLM.register(Qwen3Config, Qwen3ForCausalLM)
    setattr(transformers, "Qwen3Config", Qwen3Config)
    setattr(transformers, "Qwen3ForCausalLM", Qwen3ForCausalLM)
    logger.info("SkinTokens patcher: registered Qwen3Config/Qwen3ForCausalLM compatibility shim into transformers")
