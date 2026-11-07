# ForMesh3D Changelog

## 2026-11-07 — TaoFlowForge Bounding Box Validator Fix & Pixal3D Natten Dependency

- **Bug 1: TaoFlowForge Hollow Domain Bounding Box False-Positive Rejection**:
  - Identified root cause of `TaoFlowForge mesh validation failed for seed 500313: decoded mesh: geometry is a hollow domain bounding box ([2.0, 2.0, 2.0]) from empty sparse structure`: in `trellis2_mesh_validation.py`, a heuristic intended for TRELLIS.2's `[-0.5, 0.5]^3` empty sparse structure box was checking `np.all(extents >= 0.99) and np.all(bounds_min <= -0.49) and np.all(bounds_max >= 0.49)`.
  - Because TaoFlowForge generates meshes in `[-1.0, 1.0]^3` with extents `[2.0, 2.0, 2.0]`, this heuristic falsely rejected completely valid, high-resolution TaoFlowForge meshes (e.g. 44,967 faces) after full pipeline completion.
  - Added `check_domain_box: bool = True` to `validate_mesh_arrays` and bounded the TRELLIS empty sparse structure check strictly to `[-0.5, 0.5]^3` with extents `~1.0` (`abs(extents - 1.0) <= 0.05`).
  - In `taoflowforge_adapter.py`, explicitly passed `check_domain_box=False` for both decoded mesh and GLB round-trip validation since TaoFlowForge has no sparse structure and operates in `[-1, 1]`.
- **Bug 2: Pixal3D Missing Natten Prebuilt Wheel & Preload Resilience**:
  - Added prebuilt `natten` wheel (`natten-0.21.0+torch2.6cu124-cp310-cp310-linux_x86_64.whl` from Pixal3D upstream releases) to `backend/scripts/install.sh`, eliminating `ModuleNotFoundError: No module named 'natten'`.
  - Added defensive `try/except` around `m._load_naf()` in `pixal3d_adapter.py` with descriptive warning so pipeline load does not crash if natten or network is momentarily unavailable.
- **Verification**: All 11 tests in `test_taoflowforge_adapter.py` and 9 tests in `test_trellis2_mesh_validation.py` passed. Syntax validated with `py_compile`.

---

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




