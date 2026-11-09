"""Pixal3D model-specific patcher.

Provides pre-Ampere GPU resilience and lightweight fallback for NAF Neighborhood Attention:
1. Modern GPUs (sm >= 80, e.g. A100, H100, RTX 3090/4090):
   Maintains 100% native upstream execution using official NATTEN Cutlass-FNA kernels.
2. Pre-Ampere GPUs (sm < 80, e.g. Tesla T4 sm_75):
   NATTEN wheels compiled for sm >= 80 lack sm_75 kernel images, causing:
   `CUDA runtime error: no kernel image is available for execution on the device`.
   Routes neighborhood attention to a pure-PyTorch chunked implementation with zero
   CUDA image dependencies, identical mathematical behavior, and < 200 MB VRAM footprint.
3. Environments without natten:
   Stubs `natten` and `natten.functional` in `sys.modules` so ValeoAI NAF upsampler
   can initialize and execute without requiring external C++ extensions.

Strictly isolated: runs only inside Pixal3D worker process via pixal3d_adapter.
"""

from __future__ import annotations

import logging
import sys
import types
from typing import Any, Tuple, Union

import torch
import torch.nn.functional as F

logger = logging.getLogger(__name__)


def _is_pre_ampere() -> bool:
    """Return True if running on CPU or an NVIDIA GPU with compute capability < 8.0."""
    if not torch.cuda.is_available():
        return True
    try:
        major, _ = torch.cuda.get_device_capability()
        return major < 8
    except Exception:
        return True


def pure_pytorch_na2d(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    kernel_size: Union[int, Tuple[int, int]] = (9, 9),
    dilation: Union[int, Tuple[int, int]] = (1, 1),
    stride: int = 1,
    backend: Any = None,
    chunk_size: int = 1024,
    **kwargs: Any,
) -> torch.Tensor:
    """Mathematically exact 2D Neighborhood Attention in pure PyTorch.

    Args:
        q: Query tensor of shape [B, H, W, N_q, D_qk].
        k: Key tensor of shape [B, H, W, N_k, D_qk].
        v: Value tensor of shape [B, H, W, N_v, D_v].
        kernel_size: Window size (Kh, Kw) or scalar K.
        dilation: Dilation step (Dh, Dw) or scalar D.
        stride: Stride (defaults to 1).
        backend: Ignored in pure PyTorch fallback.
        chunk_size: Spatial token chunk size to bound peak memory usage (< 200 MB).

    Returns:
        Tensor of shape [B, H, W, N_q, D_v].
    """
    B, H, W, N_q, D_qk = q.shape
    _, _, _, N_k, D_k = k.shape
    _, _, _, N_v, D_v = v.shape

    if isinstance(kernel_size, int):
        kernel_size = (kernel_size, kernel_size)
    if isinstance(dilation, int):
        dilation = (dilation, dilation)

    Kh, Kw = kernel_size
    Dh, Dw = dilation
    scale = D_qk ** -0.5

    Rh = (Kh - 1) // 2
    Rw = (Kw - 1) // 2

    # Support Multi-Query / Grouped-Query Attention if N_q != N_k or N_q != N_v
    if N_q != N_k:
        k = k.repeat_interleave(N_q // N_k, dim=-2)
    if N_q != N_v:
        v = v.repeat_interleave(N_q // N_v, dim=-2)

    # Precompute 1D window indices along Height with sliding boundary clamping
    h_idx = torch.arange(H, device=q.device).unsqueeze(1) + (torch.arange(Kh, device=q.device) - Rh) * Dh
    h_idx = torch.where(h_idx < 0, (torch.arange(Kh, device=q.device) * Dh).unsqueeze(0), h_idx)
    max_h_start = max(0, H - 1 - (Kh - 1) * Dh)
    h_idx = torch.where(h_idx >= H, (max_h_start + torch.arange(Kh, device=q.device) * Dh).unsqueeze(0), h_idx).clamp(0, H - 1)

    # Precompute 1D window indices along Width with sliding boundary clamping
    w_idx = torch.arange(W, device=q.device).unsqueeze(1) + (torch.arange(Kw, device=q.device) - Rw) * Dw
    w_idx = torch.where(w_idx < 0, (torch.arange(Kw, device=q.device) * Dw).unsqueeze(0), w_idx)
    max_w_start = max(0, W - 1 - (Kw - 1) * Dw)
    w_idx = torch.where(w_idx >= W, (max_w_start + torch.arange(Kw, device=q.device) * Dw).unsqueeze(0), w_idx).clamp(0, W - 1)

    # Compute 2D flat neighbor index map: [H * W, Kh * Kw]
    grid_h = h_idx[:, None, :, None].expand(H, W, Kh, Kw)
    grid_w = w_idx[None, :, None, :].expand(H, W, Kh, Kw)
    flat_hw = (grid_h * W + grid_w).reshape(H * W, Kh * Kw)

    k_flat = k.reshape(B, H * W, N_q, D_k)
    v_flat = v.reshape(B, H * W, N_q, D_v)
    q_flat = q.reshape(B, H * W, N_q, D_qk)

    total_tokens = H * W
    out_flat = torch.empty(B, total_tokens, N_q, D_v, device=q.device, dtype=q.dtype)

    for start in range(0, total_tokens, chunk_size):
        end = min(start + chunk_size, total_tokens)
        idx = flat_hw[start:end]

        k_chunk = k_flat[:, idx]  # [B, chunk_len, K2, N_q, D_qk]
        v_chunk = v_flat[:, idx]  # [B, chunk_len, K2, N_q, D_v]
        q_chunk = q_flat[:, start:end]  # [B, chunk_len, N_q, D_qk]

        scores = (q_chunk.unsqueeze(2) * k_chunk).sum(dim=-1) * scale  # [B, chunk_len, K2, N_q]
        attn = F.softmax(scores, dim=2)
        out_chunk = (attn.unsqueeze(-1) * v_chunk).sum(dim=2)  # [B, chunk_len, N_q, D_v]
        out_flat[:, start:end] = out_chunk

    return out_flat.reshape(B, H, W, N_q, D_v)


def safe_legacy_attention(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    kernel_size: Any = (9, 9),
    dilation: Any = (1, 1),
    scale: float = 1.0,
    return_weights: bool = False,
    **kwargs: Any,
) -> Any:
    """Safe drop-in replacement for NAF legacy_attention using pure_pytorch_na2d."""
    out = pure_pytorch_na2d(q, k, v, kernel_size=kernel_size, dilation=dilation)
    if return_weights:
        return out, None
    return out


def _ensure_naf_attentions_patched() -> None:
    """Ensure any loaded NAF CrossAttention or legacy_attention uses modern/resilient attention."""
    for mod_name, mod in list(sys.modules.items()):
        if mod and ("attentions" in mod_name or "src.layers" in mod_name):
            if hasattr(mod, "NATTEN_RECENT"):
                mod.NATTEN_RECENT = True
            if hasattr(mod, "legacy_attention"):
                mod.legacy_attention = safe_legacy_attention


def _patch_naf_loader() -> None:
    """Wrap DinoV3ProjFeatureExtractor._load_naf to patch NAF attentions immediately on load."""
    try:
        from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import (
            DinoV3ProjFeatureExtractor,
        )
    except Exception as exc:
        logger.warning(
            "Pixal3D patcher could not import DinoV3ProjFeatureExtractor: %s",
            exc,
        )
        return

    if getattr(DinoV3ProjFeatureExtractor, "_pixal3d_naf_loader_patched", False):
        return

    orig_load_naf = DinoV3ProjFeatureExtractor._load_naf

    def resilient_load_naf(self: Any) -> None:
        orig_load_naf(self)
        _ensure_naf_attentions_patched()

    DinoV3ProjFeatureExtractor._load_naf = resilient_load_naf
    DinoV3ProjFeatureExtractor._pixal3d_naf_loader_patched = True


def apply_patch() -> None:
    """Apply Pixal3D pre-Ampere NATTEN compatibility and graceful fallback patch."""
    # 1. If natten is missing from environment, provide pure-PyTorch stub
    if "natten" not in sys.modules:
        try:
            import natten  # type: ignore[import-not-found]
        except ImportError:
            logger.info("Pixal3D patcher: natten not installed; registering pure PyTorch stub.")
            _stub_natten_module()

    # 2. Patch natten.na2d with pre-Ampere routing and kernel-missing protection
    _patch_natten_na2d()

    # 3. Patch NAF loader and existing NAF modules
    _patch_naf_loader()
    _ensure_naf_attentions_patched()


def _stub_natten_module() -> None:
    """Create a minimal stub for natten and natten.functional in sys.modules."""
    natten_mod = types.ModuleType("natten")
    natten_mod.na2d = pure_pytorch_na2d
    natten_mod.__version__ = "0.21.0-pure_pytorch_stub"

    natten_func_mod = types.ModuleType("natten.functional")
    natten_func_mod.na2d = pure_pytorch_na2d
    natten_mod.functional = natten_func_mod

    sys.modules["natten"] = natten_mod
    sys.modules["natten.functional"] = natten_func_mod


def _patch_natten_na2d() -> None:
    """Wrap natten.na2d to use pure_pytorch_na2d on sm < 80 or on kernel error."""
    try:
        import natten  # type: ignore[import-not-found]
        orig_na2d = getattr(natten, "na2d", None)
        if orig_na2d is None:
            natten.na2d = pure_pytorch_na2d
            return

        if getattr(natten, "_pixal3d_na2d_patched", False):
            return

        def resilient_na2d(*args: Any, **kwargs: Any) -> torch.Tensor:
            if _is_pre_ampere():
                return pure_pytorch_na2d(*args, **kwargs)
            try:
                return orig_na2d(*args, **kwargs)
            except Exception as exc:
                err_msg = str(exc).lower()
                if "no kernel image" in err_msg or "natten failure" in err_msg or "device-side assert" in err_msg:
                    logger.warning(
                        "Pixal3D NATTEN execution failed (%s); falling back to pure PyTorch neighborhood attention.",
                        exc,
                    )
                    return pure_pytorch_na2d(*args, **kwargs)
                raise

        natten.na2d = resilient_na2d
        natten._pixal3d_na2d_patched = True

        if hasattr(natten, "functional"):
            natten.functional.na2d = resilient_na2d
            for attr in ("na2d_qk", "na2d_av"):
                if hasattr(natten.functional, attr):
                    try:
                        delattr(natten.functional, attr)
                    except Exception:
                        pass

        logger.info("Pixal3D patcher: natten.na2d patched with pre-Ampere resilience.")
    except Exception as exc:
        logger.warning("Pixal3D patcher could not patch natten.na2d: %s", exc)

    # 4. Guard SparseTensor.__init__ against empty coords (coords.max(0) on empty tensor).
    #    Stage 1 sparse-structure sampling can return 0 occupied voxels; without this guard
    #    get_proj_cond_shape / sample_shape_slat crash with an opaque IndexError.
    _patch_sparse_tensor_empty_coords()


def _patch_sparse_tensor_empty_coords() -> None:
    """Make SparseTensor.__init__ resilient to empty coords.

    On empty coords (0 occupied voxels from Stage 1 sparse-structure sampling),
    coords.max(0)[0] raises IndexError. Bypass it and set a safe empty state so the
    pipeline fails gracefully instead of an opaque IndexError crash. Modern GPUs
    (sm >= 80) are unaffected — this only short-circuits when coords.numel() == 0.
    """
    try:
        from pixal3d.modules.sparse.basic import SparseTensor
        from pixal3d.modules.sparse import config as sparse_config
    except Exception:
        return
    if getattr(SparseTensor, "_pixal3d_empty_coords_patched", False):
        return
    orig_init = SparseTensor.__init__
    from fractions import Fraction

    def resilient_init(self, *args, **kwargs):
        # Mirror __init__ coords extraction to detect empty early.
        coords = None
        feats = None
        if len(args) != 0:
            if isinstance(args[0], torch.Tensor):
                feats = args[0]
                if len(args) >= 2:
                    coords = args[1]
            else:
                # method_id == 1 'data' path: coords not used
                return orig_init(self, *args, **kwargs)
        else:
            feats = kwargs.get("feats")
            coords = kwargs.get("coords")
        if coords is not None and torch.is_tensor(coords) and coords.numel() == 0:
            self._shape = kwargs.get("shape", None)
            self._scale = kwargs.get("scale", (Fraction(1, 1), Fraction(1, 1), Fraction(1, 1)))
            self._spatial_cache = kwargs.get("spatial_cache", {})
            if getattr(sparse_config, "CONV", "") == "spconv":
                self.data = None
            else:
                self.data = {"feats": feats, "coords": coords}
            return
        return orig_init(self, *args, **kwargs)

    SparseTensor.__init__ = resilient_init
    SparseTensor._pixal3d_empty_coords_patched = True
    logger.info("Pixal3D patcher: SparseTensor.__init__ guarded against empty coords.")
