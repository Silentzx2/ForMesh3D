# ForMesh3D Changelog

## 2026-11-05 — TRELLIS.2 Sparse Structure Adaptive Top-K Fallback & Rembg Zero-Mask Guard

- TRELLIS.2 Sparse-Structure Top-K Foreground Recovery: in `sample_sparse_structure` (`trellis2_image_to_3d.py`), replaced the restrictive artificial gate (`if max_logit > -15.0:`) with top-1% / top-k percentile voxel fallback when zero-logit thresholding produces no occupied coordinates. Ensures subtle foreground peaks are preserved for downstream cascade SLat sampling instead of crashing with `RuntimeError: TRELLIS.2 sparse-structure decoding produced no occupied voxels`.
- Rembg Empty Foreground Fallback: in `preprocess_image` (`trellis2_image_to_3d.py` and `trellis2_texturing.py`), guarded alpha cropping so that when no foreground alpha is detected (`bbox_coords.shape[0] == 0`), the pipeline safely falls back to `input.convert('RGB')` instead of multiplying by zero alpha and passing an entirely pitch-black image into the conditioning network. Large GPUs (`sm >= 80`) remain completely untouched in native BF16 FlashAttention.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified backend and thirdparty files.

---

## 2026-11-05 — TaoFlowForge BFloat16 Autocast & NaN Overflow Resolution

- TaoFlowForge Precision Stability: configured `get_compute_dtype()` to return `torch.bfloat16` on CUDA instead of `torch.float16`. Running 50 Euler integration steps on the 1.5B parameter DiT under FP16 autocast caused numerical exponent overflow (> 65,504) and produced `max_prob=nan` in Stage 0. `bfloat16` provides full 8-bit dynamic range, eliminating NaN collapse.
- Attention Backend Parity & Acceleration: `_sdpa_dense`, `_sdpa_masked`, and `_attention` handle pre-Ampere FP16 Cutlass kernel execution internally when operands are BF16 on `sm < 80` (preventing SDPA MATH fallback OOM), harmonizing `k` and `v` to `q.dtype` and restoring original precision immediately.
- Robust Occupancy Extraction: sanitized Stage 0 latent decoding and occupancy fields with `torch.nan_to_num()`, and aligned `flow_sampler.sample` initial state and timestep dtypes in Stage 0 and Stage 2 with compute dtype. Large GPUs (`sm >= 80`) remain untouched in native BF16 with FlashAttention.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified backend and thirdparty files.

---

## 2026-11-05 — TRELLIS.2 Palette Transparency Handling, Native Model Precision & Cross-Attention Dtype Parity

- TRELLIS.2 Image Preprocessing: resolved transparent image foreground corruption by detecting palette images with byte transparency (`mode == 'P'` and `'transparency' in info`) and converting them to RGBA in `preprocess_image` (`trellis2_image_to_3d.py`, `trellis2_texturing.py`, and `trellis2_adapter.py`). Prevents transparent backgrounds from collapsing to black or triggering background removal on corrupted palettes.
- TRELLIS.2 Model Precision: removed destructive pre-Ampere FP16 model weight conversion in `trellis2_adapter.py`. TRELLIS.2 models remain in their native trained precision (BFloat16 for DiT, FP16 for decoders), eliminating LayerNorm type mismatches and Euler integration numerical drift that collapsed occupancy logits to -74.3125.
- Attention Backend Parity: aligned query, key, and value dtypes in `full_attn.py` across `sdpa` and `xformers` with pre-Ampere FP16 kernel acceleration, contiguous layout, and cast-back to original precision. Guarded `SPARSE_ATTN_BACKEND="xformers"` against missing module import. Large GPUs (`sm >= 80`) remain completely untouched in native BFloat16 with FlashAttention.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified backend and thirdparty files.
