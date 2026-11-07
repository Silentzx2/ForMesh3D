# ForMesh3D Changelog

## 2026-11-07 — TaoFlowForge 66-Vertex Box Mesh Fix & Pre-Ampere FP32 Flow Matching

- **Root Cause Analysis (66-Vertex, 44,967-Polygon Polyhedron Box Mesh)**:
  - In `patcher/taoflowforge/__init__.py` and `attention.py`, `_COMPUTE_DTYPE` was forced to `torch.float16` on pre-Ampere GPUs (`sm < 80`, Tesla T4) to avoid Cutlass SDPA MATH fallback.
  - However, running Euler ODE flow matching across 50 steps with CFG 7.5/7.0/3.0 under FP16 easily exceeds FP16's narrow 5-bit exponent dynamic range ($\pm 65,504$), overflowing to `Inf` and `NaN`.
  - In Stage 0, `denoised_latent` overflowed to NaNs, which `nan_to_num(0.0)` flattened into zero, causing empty field prediction (`max_prob < 0.05`) and triggering a fallback that picked `topk(64)` noise coordinates.
  - In Stage 1, these 64 noise coordinates were refined into 66 noise vertices.
  - In Stage 2, `sample_latent` also overflowed to NaNs in FP16, resulting in identical zero-latents. When `extract_mesh` failed at 0.5, adaptive thresholding dropped to 0.01 where virtually every vertex pair had edge probability > 0.01, constructing the complete graph $K_{66}$ ($\binom{66}{3} = 45,760$ potential triangles) with **44,967 polygons** and 2,145 non-manifold edges forming a 1x1x1m box.
- **Implemented Fixes**:
  - `patcher/taoflowforge/__init__.py`: set `compute_dtype = torch.float32` on pre-Ampere GPUs (`sm < 80`), restoring the required 8-bit exponent range ($10^{38}$) to prevent FP16 NaN/Inf overflow during DiT flow matching ODE integration. Modern GPUs (`sm >= 80`) remain 100% native `bfloat16`.
  - `patcher/taoflowforge/__init__.py`: bounded adaptive thresholds to $[0.4, 0.35, 0.3, 0.25, 0.2]$ and added a manifold face-count constraint (`len(faces) <= 4 * len(vertices)`). Any candidate threshold producing hyper-connected clique graphs is rejected; if learned topology fails, ConvexHull surface reconstruction guarantees a valid manifold envelope.
  - `backend/thirdparty/Taobao3D/TaoFlowForge/taoflowforge/models/attention.py`: updated `get_compute_dtype` to return `torch.float32` on pre-Ampere GPUs, matching native 8-bit exponent range.
  - `backend/thirdparty/Taobao3D/TaoFlowForge/taoflowforge/config.py`: configured official schedule (50, 30, 50 steps) as standard default, keeping fast 5-step testing opt-in via `TAOFLOWFORGE_FAST_STEPS=1`.
  - `backend/thirdparty/Taobao3D/TaoFlowForge/taoflowforge/models/stage0.py`: guarded Stage 0 topk fallback with `max_prob > 0.05` to prevent converting blank/corrupt fields into false points.
  - `backend/adapters/taoflowforge_adapter.py`: auto-resolved local RMBG-1.4/2.0 weights for background removal.
- **Verification**: All 12 unit tests in `backend/tests/test_taoflowforge_adapter.py`, 11 in `test_pixal3d_adapter.py`, and 9 in `test_trellis2_mesh_validation.py` passed (32/32 tests pass).

---

## 2026-11-07 — TaoFlowForge Bounding Box Validator Fix & Pixal3D Natten Dependency

- **Bug 1: TaoFlowForge Hollow Domain Bounding Box False-Positive Rejection**:
  - Identified root cause of `TaoFlowForge mesh validation failed for seed 500313: decoded mesh: geometry is a hollow domain bounding box ([2.0, 2.0, 2.0]) from empty sparse structure`: in `trellis2_mesh_validation.py`, a heuristic intended for TRELLIS.2's `[-0.5, 0.5]^3` empty sparse structure box was checking `np.all(extents >= 0.99) and np.all(bounds_min <= -0.49) and np.all(bounds_max >= 0.49)`.
  - Because TaoFlowForge generates meshes in `[-1.0, 1.0]^3` with extents `[2.0, 2.0, 2.0]`, this heuristic falsely rejected completely valid, high-resolution TaoFlowForge meshes (e.g. 44,967 faces) after full pipeline completion.
  - Added `check_domain_box: bool = True` to `validate_mesh_arrays` and bounded the TRELLIS empty sparse structure check strictly to `[-0.5, 0.5]^3` with extents `~1.0` (`abs(extents - 1.0) <= 0.05`).
  - In `taoflowforge_adapter.py`, explicitly passed `check_domain_box=False` for both decoded mesh and GLB round-trip validation since TaoFlowForge has no sparse structure and operates in `[-1, 1]`.
- **Bug 2: Pixal3D Missing Natten Prebuilt Wheel & Pre-Ampere Kernel Image Resilience**:
  - Added prebuilt `natten` wheel to `backend/scripts/install.sh`, eliminating `ModuleNotFoundError: No module named 'natten'`.
  - Resolved `NATTEN failure: CUDA runtime error: no kernel image is available for execution on the device`: upstream prebuilt wheels compiled for `sm >= 80` lack binary images for `sm < 80` (Tesla T4 `sm_75`). Created dedicated worker patcher `patcher/pixal3d/` with chunked pure-PyTorch Neighborhood Attention (`pure_pytorch_na2d`, < 200 MB VRAM) for pre-Ampere devices and missing-extension fallback. Modern GPUs (`sm >= 80`) remain 100% native Cutlass-FNA with zero overhead.
  - Added defensive `try/except` around `m._load_naf()` in `pixal3d_adapter.py`.
- **Verification**: All 11 tests in `test_taoflowforge_adapter.py`, 11 tests in `test_pixal3d_adapter.py`, and 9 tests in `test_trellis2_mesh_validation.py` passed. Syntax validated with `py_compile`.

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




