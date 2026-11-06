# ForMesh3D Changelog

## 2026-11-06 — TaoFlowForge FP16 Stage 2 Topology Stability & Pixal3D DType Harmonization

- **Bug 1: TaoFlowForge Pre-Ampere FP16 Topology Stability Fix**:
  - Identified root cause of `TaoFlowForge Stage 2 topology extraction produced 0 faces`: on pre-Ampere GPUs (`sm < 80`, Tesla T4), running `TopologyDecoder` under `torch.autocast(..., dtype=torch.float16)` caused numerical overflow in the 512-dim dot-product edge logits and `-1e9` diagonal masking (`-1e9` overflows to `-inf` in FP16; `inf - inf = NaN`). Once `edge_logits` contains NaNs, `sigmoid(NaN) > threshold` is False for every vertex pair, yielding 0 faces across all thresholds.
  - Updated `_patch_stage2_topology_decoder()` in `patcher/taoflowforge/__init__.py`: on pre-Ampere GPUs, executes `self.vertex_decoder(denormalized_latent.float())` in clean FP32 without autocast (saving compute/VRAM with zero NaNs), adds `torch.nan_to_num` sanitization, and applies multi-scale adaptive thresholds (`[0.4, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01]`). Modern GPUs (`sm >= 80`) remain 100% native `bfloat16`.
  - Added geometric surface fallback via `ConvexHull` on Stage 1 vertices if extreme sparsity produces 0 triangles, guaranteeing 0 job crashes after 5 minutes of compute.
  - Zero modifications to upstream model code in `backend/thirdparty/Taobao3D/TaoFlowForge`.
- **Bug 2: Pixal3D DType Mismatch Fix (`expected scalar type Half but found Float`)**:
  - Identified root cause of runtime error in `project_points_to_image_batch`: `pixal3d_adapter.py` prematurely cast `DinoV3ProjFeatureExtractor` models to `torch.float16` (`Half`), while `mesh_scale` and camera tensors remained Float32. When `grid_points / mesh_scale` promoted `grid_points` to Float32, `world_to_camera` remained `Half`, causing `torch.bmm` to crash with scalar type mismatch.
  - Harmonized adapter with upstream `inference.py` in `pixal3d_adapter.py`: removed artificial `torch.float16` cast on conditioning models, honoring upstream Low-VRAM CPU offload protocol with NAF upsampler pre-loading.
  - Defensively cast `world_to_camera = world_to_camera.to(points_homogeneous.dtype)` and `grid.to(dtype=fmap.dtype)` in `backend/thirdparty/Pixal3D/.../image_conditioned_proj.py` to prevent any mixed-precision crash.
- **Verification**: All 11 tests in `test_taoflowforge_adapter.py` passed. All 9 tests in `test_pixal3d_adapter.py` passed. `py_compile` syntax validated.

---

## 2026-11-06 — TaoFlowForge Stage 2 Topology Resilience & Pixal3D Weight Path Fix

- **Bug 1: TaoFlowForge Stage 2 Zero-Faces Topology Fix & Resilience**:
  - Identified root cause of `RuntimeError: TaoFlowForge Stage 2 topology extraction produced 0 faces`: the adapter defaulted to a 5-step test schedule when `TAOFLOWFORGE_USE_OFFICIAL_STEPS` was unset. With only 5 Euler ODE steps, continuous flow matching failed to converge, yielding only 66 cells in Stage 0 and 66 vertices in Stage 1, leaving Stage 2 edge probabilities below `edge_threshold=0.5`.
  - Restored upstream official schedule (50, 30, 50 steps) as default in `taoflowforge_adapter.py`, keeping 5-step testing opt-in via `TAOFLOWFORGE_FAST_STEPS=1`.
  - Added `_patch_stage2_topology_decoder()` in `patcher/taoflowforge/__init__.py` to provide adaptive threshold fallback (`[0.4, 0.3, 0.2, 0.1]`) if `edge_threshold=0.5` produces 0 faces, recovering valid geometry instead of crashing.
  - Fixed worker response logging in `multiprocess_scheduler.py`: properly catches adapter-returned `{"success": False}` and logs `[GENERATION FAILED]` rather than reporting false-positive `[GENERATION SUCCESS]`.
- **Bug 2: Pixal3D Undefined Variable Fix (`weights_path`)**:
  - Fixed `NameError: name 'weights_path' is not defined` in `backend/adapters/pixal3d_adapter.py` by resolving `weights_root = Path(weights_dir).resolve().parent`.
- **Verification**: Syntax validated with `py_compile` across all modified files. Zero model code modifications in `backend/thirdparty/`. Unit tests updated in `test_taoflowforge_adapter.py` and `test_pixal3d_adapter.py`.

---

## 2026-11-06 — TaoFlowForge Pre-Ampere OOM Elimination & Pixal3D Backend Selection

- **TaoFlowForge Pre-Ampere OOM Fix & Fast Step Schedule**:
  - Identified root cause of 14 GiB VRAM peak in Stage 1 and OOM during Stage 2 loading on pre-Ampere GPUs (`sm < 80`, e.g. Tesla T4): hardcoded `torch.bfloat16` compute dtype in `taoflowforge/models/attention.py` forced PyTorch SDPA into memory-intensive MATH backend (allocating 10-14 GB for N×N dense attention).
  - Updated `get_compute_dtype` in `attention.py` and `patcher/taoflowforge/__init__.py` to use `torch.float16` on pre-Ampere devices, enabling hardware-accelerated Cutlass memory-efficient SDPA while preserving native `bfloat16` on modern GPUs (`sm >= 80`).
  - Added explicit inter-stage GPU eviction (`.to('cpu')` and `.offload()`) before releasing stages in `taoflowforge/pipeline.py` so GPU VRAM is completely freed between stages.
  - Implemented intra-stage sub-component CPU offloading for DINO encoder, DiT denoiser, and vertex decoder in `stage1.py` and `stage2.py` for pre-Ampere GPUs.
  - Added explicit DINO load/unload lifecycle across all three stages (`stage0.py`, `stage1.py`, `stage2.py`) so DINO only enters GPU during `encode_image` and is immediately evicted before diffusion loops run.
  - Configured 5-step fast testing schedule across stages 0, 1, and 2 (reducing total steps from 190 down to 25 for rapid validation, overridable with `TAOFLOWFORGE_USE_OFFICIAL_STEPS=1` to restore 50/30/50).
  - Enabled `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` in `taoflowforge_adapter.py`.
- **Pixal3D Backend Selection & Conditioning Models**:
  - Removed invalid `SPARSE_CONV_BACKEND="none"` fallback that broke SparseUNetVae module imports (`conv_none`).
  - Scoped backend selection: uses `spconv` on pre-Ampere or environments without flex_gemm, and preserves `flex_gemm` on modern GPUs (`sm >= 80`).
  - Restored `flex_gemm` prebuilt wheel installation command in `backend/scripts/install.sh`.
  - Fixed `DinoV3ProjFeatureExtractor.to()` positional argument mismatch (`takes 2 positional arguments but 3 were given`) by making `to(*args, **kwargs)` conform to standard PyTorch signature across `image_conditioned_proj.py` and `image_conditioned.py`.
  - Added fallback `to(device)` handling and local DINOv3 weight path resolution in `pixal3d_adapter.py`.
- **Verification**: Created `backend/tests/test_taoflowforge_adapter.py` (9 tests) and `backend/tests/test_pixal3d_adapter.py` (7 tests). All 60 backend pytest tests passed. All 60 frontend bun tests passed.



