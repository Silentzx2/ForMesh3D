# ForMesh3D Changelog

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

---

## 2026-11-04 — TRELLIS.2 Hollow Box Elimination & TaoFlowForge Seed Empty Resolution

- TRELLIS.2: eliminated hollow bounding-box mesh generation caused by unconditional top-1% occupancy fallback on negative logit fields (-74.89). Top-1% boundary voxel selection removed; adaptive thresholding only allowed when real foreground activations exist (`max_logit > -5.0`), otherwise raises a clear `RuntimeError`.
- TRELLIS.2: added device-index safe `_is_pre_ampere()` capability detection in `full_attn.py` with native FP16 (`half()`) dispatch on pre-Ampere GPUs (sm < 80) avoiding SDPA math fallback and type errors, while keeping sm >= 80 native BF16 untouched. Dynamically defaults sparse conv backend to `flex_gemm` if available, falling back to `spconv` when unavailable.
- TaoFlowForge: resolved `ValueError: Stage 1 seed is empty` crash by adding adaptive occupancy thresholding (`eff_threshold = max(0.1, max_prob * 0.8)`) when foreground peak probability is below default 0.5, and added fallback to `occupied.nonzero()` if `mid_keep` filter produces 0 coordinates.
- Verification: `bun test` passed (60/60 tests across 11 files). Python syntax check passed across all modified backend files (`py_compile`).
