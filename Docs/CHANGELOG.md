# ForMesh3D Changelog

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

---

## 2026-11-05 — TRELLIS.2 SDPA Contiguity Fix, DINOv3 Conditioning & Large-GPU Isolation

- TRELLIS.2: resolved attention tensor stride corruption in `trellis2/modules/attention/full_attn.py` by making `q`, `k`, `v`, and `out` strictly contiguous (`.contiguous()`) around `sdpa()`, preventing CUDA memory stride mismatch across sequence and head dimensions.
- Large GPU Isolation (`sm >= 80`): guarded sparse and dense attention backend configuration in `trellis2_adapter.py` so modern GPUs (`sm >= 80`, e.g. A100, RTX 4090, H100) natively run `flash_attn` without SDPA fallback or precision conversion.
- TRELLIS.2 Conditioning: preserved `image_cond_model` (DINOv3 ViT) in native precision to protect Vision Transformer RoPE embeddings from FP16 roundoff degradation, widening adaptive logit threshold margin to `-15.0`.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` passed across all modified files.
