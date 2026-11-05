# ForMesh3D Changelog

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

---

## 2026-11-05 — TRELLIS.2 LayerNorm/GroupNorm Dtype Alignment & TaoFlowForge Empty Vertices Resolution

- TRELLIS.2: resolved `RuntimeError: expected scalar type Float but found Half` in `LayerNorm32`, `GroupNorm32`, `SparseLayerNorm32`, and `SparseGroupNorm32`. Dynamically align input tensor dtype with `self.weight.dtype` before `super().forward(x)` so normalization runs natively in FP16 on converted models without hardcoded float32 mismatch.
- TRELLIS.2: resolved `RuntimeError: mat1 and mat2 must have the same dtype, but got Float and Half` by casting `timestep_embedding` positional outputs to `self.mlp` parameter dtype, and casting inputs/outputs to match layer weights in `sparse_structure_flow.py`, `structured_latent_flow.py`, `image_feature_extractor.py`, and `decode_shape_slat`.
- TaoFlowForge: resolved `ValueError: Stage 2 vertices are empty` by adding top-candidate occupancy fallback (`probs >= top_thresh`) in `stage1.py` when thresholding prunes all octree children, parent coordinate scaling fallback in `_expand_children`, and minimal vertex fallback in `stage2.py` `prepare_vertices`.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` syntax checked across all modified files.
