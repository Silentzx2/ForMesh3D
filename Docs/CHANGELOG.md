# ForMesh3D Changelog

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

---

## 2026-11-04 — Hunyuan3D 600k Topology Limit, TRELLIS.2 FP16 Speedup & TaoFlowForge Seed Fallback

- Hunyuan3D: capped maximum topology at 600k faces in `hunyuan3d_shape_v21.py` and `hunyuan3d_adapter_v21.py` using `fast_simplification` and `simplify_quadric_decimation` with unreferenced vertex removal to prevent runaway 1M+ vertex/face meshes; added `max_topology: 600000` capability manifest in `models.yaml`.
- TRELLIS.2: added pre-Ampere (`sm < 80`) automatic FP16 conversion in `trellis2_adapter.py` across `pipeline.models` and `image_cond_model`, restoring native Tensor Core acceleration on T4 while preserving BF16 on `sm >= 80`. Aligned noise and decoder tensor dtypes in `trellis2_image_to_3d.py` and guarded alpha cropping.
- TaoFlowForge: resolved `ValueError: Stage 1 seed is empty` by adding center-seed cluster fallback (`[31, 32]` volume center) in `stage0.py` and `stage1.py` whenever predicted occupancy is zero/empty, ensuring Stage 1 seed is always populated.
- Verification: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `py_compile` syntax checked across all modified files.
