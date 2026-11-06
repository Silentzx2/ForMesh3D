# ForMesh3D Changelog

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

---

## 2026-11-05 — PR #80 review follow-ups

- Scoped TRELLIS.2 sparse-convolution fallback selection to the adapter worker's assigned GPU; the global hardware helper no longer forces spconv on every worker. The painting adapter follows the same per-GPU selection and preserves the upstream FlexGEMM path on modern GPUs when available.
- Unified the TRELLIS.2 painting adapter status check with the adapter's backend.core.models.base.ModelStatus enum.
- The model downloader loads the project/backend .env before resolving MODEL_STORAGE_ROOT.
- Image-to-raw-mesh jobs now forward the top-level seed; it takes precedence over legacy model_parameters.seed.
- Verification: source-level fixes only in this commit; CI and GPU inference are pending rerun.

