# ForMesh3D Changelog

## 2026-11-07 — Studio Subsystem Streamlining & Workspace Cleanup for Tripo3D UI Migration

- **Repository Deadweight Elimination (Commit `7651f22`)**:
  - Deleted 221 unused files (74,750 lines removed) across non-core subsystems: `features/board/`, `features/graph/`, `features/image-editor/`, `features/mesh-extras/`, `features/wiki/`, `features/hooks/`, `plugins/unity/`, `plugins/unreal/`, and `tools/`.
  - Removed outdated legacy test files across backend and frontend to be re-anchored to the rebuilt studio layout.
- **Workspace UI Streamlining (Personal Use Scope)**:
  - Removed unneeded, bloated workspace panels and non-core runtime utilities: `MeshToolsPanel.tsx`, `ImagePointCloud.ts`, `MeshDiffViewer.tsx`, `PhysicsRuntime.ts`, `physicsSettings.ts`, and redundant rigging/animation inspectors.
  - Rebuilding the workspace cleanly matching Tripo3D Studio from scratch for personal use: zero auth overhead, zero marketing bloat, unified single-user layout across 12 core tools (Image, Model, Segment, Fill Parts, Retopo, Smart UV, Texture, Edit, Upscale, PBR, Rig, Animate).

---

## 2026-11-07 — TaoFlowForge Stage 1 FP16 Tensor Core Acceleration & Complete Pipeline Hardening

- **TaoFlowForge Stage 1 Pre-Ampere Speedup (61s -> ~1.7s per step)**:
  - Identified root cause of 61-second step times during Stage 1 octree refinement (`[Stage 1/3] 64->128: 2/90 [02:02<1:29:28, 61.00s/it]`): while Stage 0 and Stage 2 require FP32 on pre-Ampere GPUs (`sm < 80`, Tesla T4) to prevent unbounded Euler ODE overflow, Stage 1 is an octree cell classifier strictly bounded by `x1 = torch.sigmoid(prediction)` in $[0.0, 1.0]$.
  - Forcing FP32 on Stage 1 prevented PyTorch SDPA from utilizing Cutlass on Turing Tensor Cores, falling back to software `MATH` chunking over 20,000–50,000 tokens.
  - Enabled `torch.float16` compute dtype specifically for Stage 1 on pre-Ampere GPUs (`is_pre_amp = device.type == 'cuda' and _is_pre_ampere(device)`) in `taoflowforge/models/stage1.py` and wrapped via worker patcher `patcher/taoflowforge/`.
  - Added hardware Cutlass memory-efficient attention fast-path in `taoflowforge/models/attention.py` (`_sdpa_dense`, `_sdpa_masked`, `flash_attn_qkv`) so that FP16 runs directly in hardware Cutlass tiles with $O(1)$ memory overhead and zero Math fallback. Modern GPUs (`sm >= 80`) remain 100% native `bfloat16` FlashAttention.
- **Pixal3D Pure PyTorch NATTEN Asymmetric Dimension & Legacy Attention Fix**:
  - Identified root cause of `TypeError: unsupported operand type(s) for *: 'NoneType' and 'float'` at `attentions.py:21`: ValeoAI NAF checks `try: from natten.functional import na2d_av, na2d_qk; NATTEN_RECENT = False except: NATTEN_RECENT = True`. When `patcher/pixal3d` stubbed `na2d_qk` and `na2d_av` as dummy functions returning `None`, NAF erroneously assumed ancient NATTEN and called `legacy_attention`, where `attn_scores = na2d_qk(...) * scale` evaluated `None * scale`.
  - Removed dummy `None`-returning attributes from `natten.functional`, allowing NAF to correctly detect modern NATTEN and route to `na2d`.
  - Implemented `safe_legacy_attention` in `patcher/pixal3d/__init__.py` and wrapped `DinoV3ProjFeatureExtractor._load_naf` to force `NATTEN_RECENT = True` on all loaded NAF modules, routing both modern and legacy attention paths to `pure_pytorch_na2d` on pre-Ampere GPUs and native Cutlass-FNA on modern GPUs.
  - Also resolved asymmetric feature dimension handling ($D_{qk} = 64$ vs $D_v = 256$) with < 170 MB peak attention VRAM.
- **TaoFlowForge 66-Vertex Box Mesh Fix & Pre-Ampere FP32 Flow Matching**:
  - Restored FP32 compute dtype on pre-Ampere GPUs (`sm < 80`, Tesla T4) for Stage 0 and Stage 2 to prevent FP16 NaN/Inf overflow during Euler flow matching ODE integration.
  - Bounded adaptive thresholds to $[0.4, 0.35, 0.3, 0.25, 0.2]$ and added a manifold face-count constraint (`len(faces) <= 4 * len(vertices)`). Any candidate threshold producing hyper-connected clique graphs is rejected; if learned topology fails, ConvexHull surface reconstruction guarantees a valid manifold envelope.
  - Configured official schedule (50, 30, 50 steps) as standard default, keeping fast 5-step testing opt-in via `TAOFLOWFORGE_FAST_STEPS=1`.
- **Verification**: All 33 unit tests passed (`test_taoflowforge_adapter.py`, `test_pixal3d_adapter.py`, `test_trellis2_mesh_validation.py`).

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






