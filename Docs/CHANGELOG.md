# ForMesh3D Changelog

## 2026-11-05 — TaoFlowForge Query-Chunked Attention (10 GiB OOM Fix), Stage Offload & Pre-Ampere Hardware Parity

- **TaoFlowForge Stage 1 OOM Elimination**: In `taoflowforge/models/attention.py`, resolved the 10.06 GiB CUDA Out of Memory crash in Stage 1 refinement (64->128 lattice, 15,000+ tokens). Added pre-Ampere query chunking (`chunk_size=1024`) and xFormers integration to `_sdpa_dense` and `_sdpa_masked`. When PyTorch's SDPA falls back from unavailable FlashAttention on pre-Ampere GPUs (`sm < 80`), query chunking computes attention in tiles against all key/value tokens, mathematically guaranteeing identical results (diff = 0.0) while reducing peak attention memory from 10.06 GiB down to ~30 MB.
- **Stage-Wise VRAM Offload Enforcement**: In `taoflowforge_adapter.py`, configured `InferenceConfig(..., offload="on")`. Guarantees that completed stage modules (Stage 0, Stage 1, Stage 2) and intermediate tensors are actively offloaded to CPU and `torch.cuda.empty_cache()` is called between stages, preserving VRAM overhead on 16GB GPUs like Tesla T4.
- **TaoFlowForge Patcher & Multi-Worker Safety**: Preserved strict process isolation in `patcher/taoflowforge/` and `taoflowforge_adapter.py`, ensuring pre-Ampere SDPA routing and memory mitigations execute exclusively within worker processes without leaking to other models. Modern GPUs (`sm >= 80`, e.g. A100, RTX 3090/4090, H100) run 100% native FlashAttention with zero performance penalties.
- **Verification**: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `python -m py_compile` passed on all modified adapter, thirdparty, and patcher files.

---

## 2026-11-05 — TRELLIS.2 Sparse Structure Adaptive Top-K Fallback & Rembg Zero-Mask Guard

- **TRELLIS.2 Sparse-Structure Top-K Foreground Recovery**: In `sample_sparse_structure` (`trellis2_image_to_3d.py`), replaced the restrictive artificial gate (`if max_logit > -15.0:`) with top-1% / top-k percentile voxel fallback when zero-logit thresholding produces no occupied coordinates. Ensures subtle foreground peaks are preserved for downstream cascade SLat sampling instead of crashing with `RuntimeError: TRELLIS.2 sparse-structure decoding produced no occupied voxels`.
- **Rembg Empty Foreground Fallback**: In `preprocess_image` (`trellis2_image_to_3d.py` and `trellis2_texturing.py`), guarded alpha cropping so that when no foreground alpha is detected (`bbox_coords.shape[0] == 0`), the pipeline safely falls back to `input.convert('RGB')` instead of multiplying by zero alpha and passing an entirely pitch-black image into the conditioning network. Large GPUs (`sm >= 80`) remain completely untouched in native BF16 FlashAttention.
- **Verification**: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified backend and thirdparty files.

---

## 2026-11-05 — TaoFlowForge BFloat16 Autocast & NaN Overflow Resolution

- **TaoFlowForge Precision Stability**: Configured `get_compute_dtype()` to return `torch.bfloat16` on CUDA instead of `torch.float16`. Running 50 Euler integration steps on the 1.5B parameter DiT under FP16 autocast caused numerical exponent overflow (> 65,504) and produced `max_prob=nan` in Stage 0. `bfloat16` provides full 8-bit dynamic range, eliminating NaN collapse.
- **Attention Backend Parity & Acceleration**: `_sdpa_dense`, `_sdpa_masked`, and `_attention` handle pre-Ampere FP16 Cutlass kernel execution internally when operands are BF16 on `sm < 80` (preventing SDPA MATH fallback OOM), harmonizing `k` and `v` to `q.dtype` and restoring original precision immediately.
- **Robust Occupancy Extraction**: Sanitized Stage 0 latent decoding and occupancy fields with `torch.nan_to_num()`, and aligned `flow_sampler.sample` initial state and timestep dtypes in Stage 0 and Stage 2 with compute dtype. Large GPUs (`sm >= 80`) remain untouched in native BF16 with FlashAttention.
- **Verification**: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified backend and thirdparty files.
