# ForMesh3D Changelog

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

---

## 2026-11-05 — TaoFlowForge SDPA Contiguity, DINO Precision, Strict Mesh Validation & Progress Logging

- TaoFlowForge Attention & Conditioning: enforced contiguous tensor layout (`.contiguous()`) for `q`, `k`, `v`, and output in `_sdpa_dense`, `_sdpa_masked`, `flash_attn_qkv`, `flash_attn_varlen_qkv`, and `ss_flow.py` `_attention`. Preserved `DinoConditioner` (DINOv3 ViT) in native FP32 on pre-Ampere (`sm < 80`) and BF16 on Ampere+ (`sm >= 80`) to eliminate ViT RoPE attention distortion.
- Fail-Closed Topology & Seed Pipeline: eliminated dummy cube fallbacks in `stage0.py`, `stage1.py`, `stage2.py`, and `pipeline.py`. Replaced silent cascading fake geometry with fail-closed explicit checks, ensuring empty occupancies, zero vertices, or empty faces raise informative runtime errors instead of exporting corrupted 204-byte GLB files.
- Adapter Geometry Validation & Logging: integrated `validate_mesh_arrays()` in `taoflowforge_adapter.py` for decoded mesh and exported GLB roundtrip, rejecting empty scenes and invalid geometry. Enabled `show_progress=True`, logged stage messages (`update.message`), and correctly initialized `self.device = device`.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified backend and thirdparty files.
