"""
UniRig Pre-Ampere (sm < 80, e.g. Tesla T4) Worker Patcher.
Isolated inside UniRig's worker/subprocess; sm >= 80 stays 100% native.
"""

from __future__ import annotations

import importlib.machinery
import logging
import os
import sys
import types
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _install_flash_attn_sdpa_shim() -> None:
    """Override flash_attn & flash_attn.modules.mha.MHA with SDPA on pre-Ampere GPUs."""
    if getattr(sys.modules.get("flash_attn"), "_unirig_sdpa_shim", False):
        return

    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class _SDPAMHA(nn.Module):
        """SDPA drop-in matching flash_attn.modules.mha.MHA parameter names & signature."""

        def __init__(
            self,
            embed_dim: int,
            num_heads: int,
            cross_attn: bool = False,
            qkv_proj_bias: bool = True,
            out_proj_bias: bool = True,
            causal: bool = False,
            **kwargs: Any,
        ) -> None:
            super().__init__()
            self.embed_dim = embed_dim
            self.num_heads = num_heads
            self.head_dim = embed_dim // num_heads
            self.cross_attn = cross_attn
            self.causal = causal
            if cross_attn:
                self.Wq = nn.Linear(embed_dim, embed_dim, bias=qkv_proj_bias)
                self.Wkv = nn.Linear(embed_dim, 2 * embed_dim, bias=qkv_proj_bias)
            else:
                self.Wqkv = nn.Linear(embed_dim, 3 * embed_dim, bias=qkv_proj_bias)
            self.out_proj = nn.Linear(embed_dim, embed_dim, bias=out_proj_bias)

        def forward(
            self,
            x: torch.Tensor,
            x_kv: Optional[torch.Tensor] = None,
            **kwargs: Any,
        ) -> torch.Tensor:
            bsz, q_len, _ = x.shape
            if self.cross_attn:
                kv_src = x if x_kv is None else x_kv
                q = self.Wq(x).view(bsz, q_len, self.num_heads, self.head_dim).transpose(1, 2)
                kv = self.Wkv(kv_src).view(bsz, kv_src.shape[1], 2, self.num_heads, self.head_dim)
                k = kv[:, :, 0].transpose(1, 2)
                v = kv[:, :, 1].transpose(1, 2)
            else:
                qkv = self.Wqkv(x).view(bsz, q_len, 3, self.num_heads, self.head_dim)
                q, k, v = (qkv[:, :, i].transpose(1, 2) for i in range(3))
            out = F.scaled_dot_product_attention(q, k, v, is_causal=self.causal)
            return self.out_proj(out.transpose(1, 2).contiguous().view(bsz, q_len, self.embed_dim))

    def _varlen_qkvpacked_sdpa(qkv: torch.Tensor, cu_seqlens: torch.Tensor, max_seqlen: int, **kwargs: Any) -> torch.Tensor:
        out = torch.empty((qkv.shape[0], qkv.shape[2], qkv.shape[3]), dtype=qkv.dtype, device=qkv.device)
        for i in range(len(cu_seqlens) - 1):
            s, e = int(cu_seqlens[i].item()), int(cu_seqlens[i + 1].item())
            if e <= s:
                continue
            q, k, v = (qkv[s:e, j].transpose(0, 1).unsqueeze(0) for j in range(3))
            attn = F.scaled_dot_product_attention(q, k, v, is_causal=bool(kwargs.get("causal", False)))
            out[s:e] = attn.squeeze(0).transpose(0, 1)
        return out

    fa_mod = types.ModuleType("flash_attn")
    fa_mod._unirig_sdpa_shim = True  # type: ignore[attr-defined]
    fa_mod.__path__ = []  # type: ignore[attr-defined]
    fa_mod.__spec__ = importlib.machinery.ModuleSpec("flash_attn", loader=None, is_package=True)
    fa_mod.flash_attn_varlen_qkvpacked_func = _varlen_qkvpacked_sdpa  # type: ignore[attr-defined]
    fa_mod.flash_attn_func = lambda *a, **kw: None  # type: ignore[attr-defined]
    fa_mod.flash_attn_varlen_func = lambda *a, **kw: None  # type: ignore[attr-defined]
    modules_mod = types.ModuleType("flash_attn.modules")
    modules_mod.__path__ = []  # type: ignore[attr-defined]
    modules_mod.__spec__ = importlib.machinery.ModuleSpec("flash_attn.modules", loader=None, is_package=True)
    mha_mod = types.ModuleType("flash_attn.modules.mha")
    mha_mod.__spec__ = importlib.machinery.ModuleSpec("flash_attn.modules.mha", loader=None)
    mha_mod.MHA = _SDPAMHA  # type: ignore[attr-defined]
    bp_mod = types.ModuleType("flash_attn.bert_padding")
    bp_mod.__spec__ = importlib.machinery.ModuleSpec("flash_attn.bert_padding", loader=None)
    bp_mod.index_first_axis = lambda *a, **kw: None  # type: ignore[attr-defined]
    bp_mod.pad_input = lambda *a, **kw: None  # type: ignore[attr-defined]
    bp_mod.unpad_input = lambda *a, **kw: None  # type: ignore[attr-defined]
    fa_mod.modules = modules_mod  # type: ignore[attr-defined]
    fa_mod.bert_padding = bp_mod  # type: ignore[attr-defined]
    modules_mod.mha = mha_mod  # type: ignore[attr-defined]

    sys.modules["flash_attn"] = fa_mod
    sys.modules["flash_attn.modules"] = modules_mod
    sys.modules["flash_attn.modules.mha"] = mha_mod
    sys.modules["flash_attn.bert_padding"] = bp_mod
    try:
        import transformers.utils as tf_u
        import transformers.utils.import_utils as tf_iu
        tf_iu.is_flash_attn_2_available = lambda: False
        tf_u.is_flash_attn_2_available = lambda: False
    except Exception:
        pass
    logger.info("UniRig patcher: installed SDPA flash_attn shim for pre-Ampere GPU")


def _patch_pre_ampere_precision() -> None:
    """Redirect bfloat16 autocast and Lightning bf16-mixed to float16 on sm < 80."""
    import torch

    if not getattr(torch.autocast, "_unirig_fp16_patched", False):
        orig_autocast = torch.autocast

        class _FP16Autocast(orig_autocast):  # type: ignore[misc,valid-type]
            def __init__(self, device_type: str, dtype: Any = None, *args: Any, **kwargs: Any) -> None:
                if device_type == "cuda" and dtype == torch.bfloat16:
                    dtype = torch.float16
                super().__init__(device_type, dtype=dtype, *args, **kwargs)

        _FP16Autocast._unirig_fp16_patched = True  # type: ignore[attr-defined]
        torch.autocast = _FP16Autocast  # type: ignore[misc]

    try:
        import lightning as L

        if not getattr(L.Trainer, "_unirig_fp16_patched", False):
            orig_init = L.Trainer.__init__

            def _fp16_trainer_init(self: Any, *args: Any, **kwargs: Any) -> None:
                if kwargs.get("precision") == "bf16-mixed":
                    kwargs["precision"] = "16-mixed"
                orig_init(self, *args, **kwargs)

            L.Trainer.__init__ = _fp16_trainer_init  # type: ignore[method-assign]
            L.Trainer._unirig_fp16_patched = True  # type: ignore[attr-defined]
    except ImportError:
        pass

    try:
        from transformers import AutoModelForCausalLM

        if not getattr(AutoModelForCausalLM, "_unirig_sdpa_patched", False):
            orig_from_config = AutoModelForCausalLM.from_config.__func__  # type: ignore[attr-defined]

            @classmethod  # type: ignore[misc]
            def _sdpa_from_config(cls: Any, config: Any, *args: Any, **kwargs: Any) -> Any:
                target = "eager" if getattr(config, "model_type", "") == "opt" else "sdpa"
                if getattr(config, "_attn_implementation", None) == "flash_attention_2":
                    config._attn_implementation = target
                if kwargs.get("attn_implementation") == "flash_attention_2":
                    kwargs["attn_implementation"] = target
                return orig_from_config(cls, config, *args, **kwargs)

            AutoModelForCausalLM.from_config = _sdpa_from_config  # type: ignore[method-assign]
            AutoModelForCausalLM._unirig_sdpa_patched = True  # type: ignore[attr-defined]
    except ImportError:
        pass

    try:
        import src.inference.download as dl_mod

        if not getattr(dl_mod, "_unirig_local_ckpt_patched", False):
            orig_download = dl_mod.download

            def _local_first_download(ckpt_name: str) -> str:
                if os.path.isfile(ckpt_name):
                    return ckpt_name
                return orig_download(ckpt_name)

            dl_mod.download = _local_first_download
            dl_mod._unirig_local_ckpt_patched = True  # type: ignore[attr-defined]
    except ImportError:
        pass


def _install_torch_cluster_shim() -> None:
    """Provide pure-PyTorch torch_cluster.fps when torch_cluster is absent."""
    if "torch_cluster" in sys.modules:
        return
    try:
        import torch_cluster  # noqa: F401
        return
    except ImportError:
        pass

    import torch

    def fps(
        src: torch.Tensor,
        batch: Optional[torch.Tensor] = None,
        ratio: float = 0.5,
        random_start: bool = True,
    ) -> torch.Tensor:
        if batch is None:
            batch = torch.zeros(src.shape[0], dtype=torch.long, device=src.device)
        out_indices = []
        for b_id in torch.unique(batch, sorted=True):
            mask = batch == b_id
            pts = src[mask]
            orig_idx = torch.nonzero(mask, as_tuple=False).squeeze(1)
            n = pts.shape[0]
            k = max(1, int(round(n * float(ratio)))) if ratio < 1.0 else min(n, int(ratio))
            selected = torch.empty(k, dtype=torch.long, device=src.device)
            cur = int(torch.randint(0, n, (1,), device=src.device).item()) if random_start else 0
            dists = torch.full((n,), float("inf"), dtype=torch.float32, device=src.device)
            pts_f = pts.float()
            for i in range(k):
                selected[i] = cur
                dist = ((pts_f - pts_f[cur]) ** 2).sum(dim=-1)
                dists = torch.minimum(dists, dist)
                cur = int(torch.argmax(dists).item())
            out_indices.append(orig_idx[selected])
        return torch.cat(out_indices, dim=0)

    tc_mod = types.ModuleType("torch_cluster")
    tc_mod.fps = fps  # type: ignore[attr-defined]
    sys.modules["torch_cluster"] = tc_mod
    logger.info("UniRig patcher: installed pure-PyTorch torch_cluster.fps shim")


def _allow_unirig_checkpoint_globals() -> None:
    """Allowlist box.box.Box (and safe fallback) for PyTorch 2.6+ weights_only checkpoint loading."""
    try:
        import torch
        from box import Box
        if hasattr(torch.serialization, "add_safe_globals"):
            torch.serialization.add_safe_globals([Box])
    except Exception:
        pass


def apply_patch(gpu_id: Optional[int] = None) -> None:
    """Apply UniRig patches; pre-Ampere shims run strictly when sm < 80."""
    from patcher.doctor import GPUDoctor

    _allow_unirig_checkpoint_globals()
    _install_torch_cluster_shim()

    info = GPUDoctor().inspect_gpu(gpu_id)
    if not info.is_pre_ampere and not info.is_cpu:
        return

    _install_flash_attn_sdpa_shim()
    _patch_pre_ampere_precision()
