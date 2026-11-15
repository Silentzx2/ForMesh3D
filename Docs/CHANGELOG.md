# ForMash3D Changelog

## 2026-11-15 — Native High-Res Engine, 1M Gen Limit, 2M Upload Ceiling & 60 FPS Viewport

- **Mesh Density Limits & Guard Pipeline (`backend/pipelines/mesh_guard.py`)**: Centralized mesh safety handling into `backend/pipelines/mesh_guard.py` (`guard_mesh_density`). AI generation enforces a 1,000k (1M faces) safety cap, preserving raw AI meshes <= 1M faces untouched. User mesh upload allows up to 2,000k (2M faces); meshes exceeding 2M faces are strictly rejected with an explicit 400 validation error in `backend/core/utils/file_utils.py` and `file_upload.py`.
- **Generate Panel UI Simplification**: Removed Target Triangles slider and dynamic floating portal flyout from `GeneratePanel.tsx`. Real functional switches (Remove Lighting, PBR Materials) moved directly inline in the main panel; replaced raw emoji with Lucide `Dices`.
- **Three.js Viewport 60+ FPS Optimization for 2M Triangles (`MeshViewer.tsx`)**: Optimized for ultra-dense meshes up to 2,000,000 triangles: high-performance power preference, 1.5 clamped DPR, keylight shadow map tuned to 1024x1024, shadow-map rasterization bypass for meshes > 800k triangles, static matrix auto-update disabling, and pre-cached unlit wireframe materials with deep 10-slot texture disposal.
- **Verification**: All 50 bun tests pass; all Python files pass `py_compile`; no heavy dependencies installed.

## 2026-11-15 — Native Target Triangles Part I §7 Fix & UI Component System (Batches 2-6)

- **Removed post-process count forcing** from all 5 adapters (SF3D, TripoSG, Hunyuan3D v2.1, Mini Turbo, TRELLIS) — no `mesh.subdivide()`, `fast_simplification.simplify()`, or `simplify_quadric_decimation()` forces mesh count toward requested target after generation.
- **Router preserves `native_target_polycount`** for honest requested-vs-actual triangle reporting; no longer zeroed when postprocess disabled.
- **All models classified `UNSUPPORTED`** — none pass `native_target_polycount` to upstream generation (evidence-backed per Part I §4 research gate).
- **Unified identity & save/preview lifecycle**: Keep/Discard endpoints, route reservation only after successful Keep, identity matching same image+same model.
- **Explicit mesh selection state machine** (`idle|selecting|verifying|loading|ready|error`) with `selectionRequestId` stale-response guard; `failAssetLoad` keeps last valid mesh visible.
- **New UI components** (`features/workspace/components/`): `GlowButton.tsx` (5 variants, layout-stable), `JobProgressBar.tsx` (determinate 0-100%), `JobProgressStage.tsx` (label chip + status icon).
- **All Python files pass `py_compile`**; no GPU path changes (Priority Rule 1 preserved).

## 2026-11-14 — Batch 7 Backend Bloat Cleanup, Subsystem Purge & Decoupling

- **Legacy Subsystem Removal:** Completely deleted obsolete backend directories: `backend/postprocess/` (136KB legacy pipeline & services), `backend/core/auth/` (obsolete user database and password hashing), `backend/core/quality/` and `backend/config/quality.yaml` (offline Chamfer/Hausdorff benchmarking and scoring), `backend/core/animation/` (`ardy_converter.py`), and `backend/core/preprocess/` (`image_enhancement.py` and `hi3dgen_bridging.py`).
- **Dead Scripts & Dummy Models Purge:** Deleted dead offline benchmarking scripts (`run_mesh_quality_benchmark.py`, `run_model_ab_benchmark.py`, `create_admin_user.py`, `verify_postprocess_runtime.py`) and prototype mock models in `backend/core/models/` (`mesh_models.py`, `mesh_editing_models.py`, `retopo_models.py`, `rig_models.py`, `segment_models.py`, `uv_models.py`). Preserved `backend/core/models/base.py` (`BaseModel`, `ModelStatus`) as the universal adapter base class.
- **Scheduler & Workspace Decoupling:** Migrated canonical asset workspace management (`canonical_asset_workspace`, `prepare_asset_job_workspace`, `register_asset_job_manifest`) into `backend/core/utils/artifact_utils.py`. Decoupled `multiprocess_scheduler.py` from quality and postprocess dependencies, while preserving core job queuing and worker process lifecycle.
- **Router Cleanups:** Unmounted `image_enhancement` router from `main_singleworker.py` and `main_multiworker.py`. Replaced `mesh_tools.py` with self-contained non-blocking SSE endpoints pending custom rebuild. Forwarded raw image inputs directly to AI model adapters.
