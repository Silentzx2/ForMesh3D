# ForMesh3D Changelog

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

---

## 2026-11-06 — Complete Hi3D Decommissioning & Redundant Geometry Refinement Cleanup

- **Decommissioned Hi3D Submodule**: Completely removed `backend/thirdparty/Hi3D/` (9,660+ lines of redundant code) and deleted `backend/adapters/hi3d_adapter.py`.
- **Cleaned API & Pipeline**: Removed `/refine-mesh` endpoint and `RefineMeshRequest` from `backend/api/routers/mesh_generation.py`. High-resolution geometry is natively generated in a single stage by TRELLIS.2, TaoFlowForge, and Hunyuan3D-2.1.
- **Removed Weight Footprint**: Cleaned `download_hi3d()` from `backend/scripts/download_models.sh`, saving ~8GB disk space and download bandwidth.
- **Frontend & UI Cleanup**: Removed experimental `ViewerToolbar.tsx` ("Refine with Hi3D" button) from 3D Viewport, removed `refineMesh` from `WorkspaceContext` and `apiClient`, and purged Hi3D options from `GeneratePanel.tsx` and `constants/models.ts`.
- **Verification**: Backend pytest passed (44/44). Frontend bun test passed (60/60). Zero regressions.

---

## 2026-11-06 — SkinTokens Integration & Complete UniRig Decommissioning

- **Decommissioned UniRig**: Completely removed `backend/thirdparty/UniRig/` from tracking and deleted `backend/adapters/unirig_adapter.py`. Cleaned all UniRig dependencies (`blenderproc`, `pyrender`, `pytorch-lightning==1.9.5`).
- **Vendored SkinTokens**: Added `backend/thirdparty/SkinTokens/` (MIT License, VAST AI Research, arXiv:2602.04805) to submodule with catalog license table in `LICENSE` and open-source advisory in `README.md`.
- **SkinTokens Thin Adapter**: Created `backend/adapters/skintokens_adapter.py` implementing `BaseModel` for direct in-process `predict_step` execution of the TokenRig unified autoregressive pipeline (FSQ-CVAE + Qwen3-0.6B + GRPO refinement) with companion `bpy_server` daemon.
- **Hardware & Precision Preservation**: Locked native FlashAttention 2 and native BF16 inference profile on modern GPUs (`sm >= 80`). Maintained backward-compatible alias `unirig_auto_rig` resolving to `SkinTokensAdapter`.
- **System & UI Integration**: Updated `backend/config/models.yaml`, `backend/scripts/download_models.sh`, `constants/models.ts`, API routers, scheduler providers, and frontend Rigging Studio panels.
- **Verification**: `backend/tests/test_skintokens_adapter.py` passed (8/8). Full backend suite `backend/tests/` passed (44/44). Frontend `bun test` passed (60/60).


