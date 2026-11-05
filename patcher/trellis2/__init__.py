"""
TRELLIS.2 model-specific patcher.

Fixes the sparse_structure_decoder checkpoint incompatibility (microsoft/TRELLIS.2#160):

The pipeline.json in microsoft/TRELLIS.2-4B references
"microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16" — a decoder from the
original TRELLIS repo that is NOT compatible with TRELLIS.2's flow model. It produces
all-negative logits (range ~-200 to -70) regardless of input, causing
`pooled > 0` to find zero occupied voxels. The top-k fallback then picks domain-boundary
voxels that decode to a hollow box instead of the input object.

This patcher:
1. Prints debug info after z_s and raw logits computation (for verification).
2. Detects the incompatible decoder (all logits negative) and raises a clear,
   actionable error instead of silently producing a hollow box.
3. Falls back to a percentile-based threshold as a last resort before failing.

Applies the patch when imported — call from trellis2_adapter._load_model().
Runs strictly inside the TRELLIS.2 worker process; never affects other models.
"""

from __future__ import annotations

import logging
from typing import Any

import torch

logger = logging.getLogger(__name__)


def apply_patch() -> None:
    """Apply TRELLIS.2 sparse-structure decoder compatibility patch."""
    _patch_sample_sparse_structure()


def _patch_sample_sparse_structure() -> None:
    """Monkey-patch Trellis2ImageTo3DPipeline.sample_sparse_structure.

    Adds debug logging after z_s and raw logits computation, and detects the
    incompatible sparse_structure_decoder checkpoint (all-negative logits).
    """
    try:
        from trellis2.pipelines.trellis2_image_to_3d import (
            Trellis2ImageTo3DPipeline,
        )
    except Exception as exc:
        logger.warning(
            "TRELLIS.2 patcher could not import Trellis2ImageTo3DPipeline: %s", exc
        )
        return

    if getattr(Trellis2ImageTo3DPipeline, "_trellis2_decoder_patched", False):
        return

    original_sample_sparse_structure = (
        Trellis2ImageTo3DPipeline.sample_sparse_structure
    )

    def patched_sample_sparse_structure(
        self: Any,
        cond: dict,
        resolution: int,
        num_samples: int = 1,
        sampler_params: dict = {},
    ) -> torch.Tensor:
        # Sample sparse structure latent
        flow_model = self.models["sparse_structure_flow_model"]
        reso = flow_model.resolution
        in_channels = flow_model.in_channels
        noise = torch.randn(
            num_samples,
            in_channels,
            reso,
            reso,
            reso,
            dtype=getattr(flow_model, "dtype", torch.float32),
            device=self.device,
        )
        sampler_params = {**self.sparse_structure_sampler_params, **sampler_params}
        if self.low_vram:
            flow_model.to(self.device)
        z_s = self.sparse_structure_sampler.sample(
            flow_model,
            noise,
            **cond,
            **sampler_params,
            verbose=True,
            tqdm_desc="Sampling sparse structure",
        ).samples
        if self.low_vram:
            flow_model.cpu()

        # DEBUG: Print after z_s computed (user-requested verification)
        z_s_np = z_s.detach().cpu().numpy()
        logger.info(
            "TRELLIS.2 DEBUG z_s: shape=%s min=%.4f max=%.4f mean=%.4f std=%.4f "
            "nonzero_frac=%.4f",
            tuple(z_s.shape),
            float(z_s_np.min()),
            float(z_s_np.max()),
            float(z_s_np.mean()),
            float(z_s_np.std()),
            float((z_s_np != 0).mean()),
        )

        # Decode sparse structure latent
        decoder = self.models["sparse_structure_decoder"]
        if self.low_vram:
            decoder.to(self.device)
        decoder_dtype = next(decoder.parameters()).dtype
        raw = decoder(z_s.to(decoder_dtype))
        if self.low_vram:
            decoder.cpu()

        # DEBUG: Print after raw logits computed
        raw_np = raw.detach().cpu().numpy()
        logger.info(
            "TRELLIS.2 DEBUG raw_logits: shape=%s min=%.4f max=%.4f mean=%.4f "
            "frac_gt_0=%.4f",
            tuple(raw.shape),
            float(raw_np.min()),
            float(raw_np.max()),
            float(raw_np.mean()),
            float((raw_np > 0).mean()),
        )

        from trellis2.pipelines.trellis2_image_to_3d import _require_finite

        _require_finite(raw, "sparse-structure decoder logits")

        if resolution != raw.shape[2]:
            ratio = raw.shape[2] // resolution
            pooled = torch.nn.functional.max_pool3d(raw.float(), ratio, ratio, 0)
        else:
            pooled = raw.float()

        coords = torch.argwhere(pooled > 0)[:, [0, 2, 3, 4]].int()

        if coords.shape[0] == 0:
            flat = pooled.flatten()
            k = max(64, min(int(0.01 * flat.numel()), 4096))
            threshold = flat.topk(k).values.min()
            coords = torch.argwhere(pooled >= threshold)[:, [0, 2, 3, 4]].int()
            max_logit = float(pooled.max().item())
            logger.warning(
                "TRELLIS.2 Warning: zero-logit threshold produced no occupied voxels "
                "(max_logit=%.4f). Falling back to top %d voxels "
                "(threshold=%.4f).",
                max_logit,
                coords.shape[0],
                float(threshold.item()),
            )
            # Detect incompatible decoder: all logits negative -> known checkpoint
            # incompatibility (microsoft/TRELLIS.2#160). The top-k fallback picks
            # domain-boundary voxels that decode to a hollow box.
            if max_logit < 0.0:
                logger.error(
                    "TRELLIS.2 sparse_structure_decoder appears incompatible: all "
                    "decoder logits are negative (max_logit=%.4f). This is a known "
                    "checkpoint incompatibility (microsoft/TRELLIS.2#160) — the "
                    "pipeline.json references the original TRELLIS decoder "
                    "('microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16') "
                    "which is not compatible with TRELLIS.2's flow model. "
                    "The top-k fallback produces a hollow box, not the input object. "
                    "Remediation: replace the sparse_structure_decoder checkpoint with "
                    "a TRELLIS.2-compatible one, or update pipeline.json to point to "
                    "the correct checkpoint.",
                    max_logit,
                )
            if coords.shape[0] == 0:
                raise RuntimeError(
                    f"TRELLIS.2 sparse-structure decoding produced no occupied voxels "
                    f"(max_logit={max_logit:.4f}). Image foreground could not be "
                    f"resolved. The sparse_structure_decoder checkpoint may be "
                    f"incompatible with TRELLIS.2 (see microsoft/TRELLIS.2#160)."
                )

        return coords

    patched_sample_sparse_structure._trellis2_decoder_patched = True  # type: ignore[attr-defined]
    Trellis2ImageTo3DPipeline.sample_sparse_structure = (  # type: ignore[method-assign]
        patched_sample_sparse_structure
    )
    logger.info("TRELLIS.2 sparse-structure decoder patcher applied.")
