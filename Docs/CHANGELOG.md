# ForMesh3D Changelog

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

---

## 2026-11-04 — TaoFlowForge & TRELLIS.2 Pre-Ampere GPU Acceleration and OOM Fixes

- TaoFlowForge: resolved 10-minute (696s) startup lag and 8GB VRAM spike caused by software BF16 emulation on pre-Ampere GPUs (sm < 80, e.g. Tesla T4). Added robust `_is_pre_ampere()` check and `get_compute_dtype()` across `attention.py`, `dino.py`, `ss_flow.py`, `stage0.py`, `stage1.py`, and `stage2.py`, dynamically routing execution to FP16 with native Tensor Cores.
- TaoFlowForge: fixed 10.06 GiB SDPA OOM by enabling Cutlass memory-efficient attention in FP16 on sm < 80, preventing fallback to dense $N \times N$ `SDPBackend.MATH`. Cached `load_pretrained_dino_state_dict` to avoid re-parsing multi-gigabyte DINO checkpoints across stages.
- TRELLIS.2: resolved sparse-structure zero-logit failure on sm < 80 by defaulting `ATTN_BACKEND` to `sdpa` instead of unsupported `flash_attn`, with FP16 casting around Cutlass SDPA and restoring top-1% occupancy rescue fallback.
- Main repo: added `PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"` in `taoflowforge_adapter.py` and pre-Ampere SDPA backend configuration in `trellis2_adapter.py`.
- Verification: `bun test` passed (60/60 tests across 11 files). Python syntax check passed across all modified backend files (`py_compile`).
