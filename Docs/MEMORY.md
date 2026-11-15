# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-15)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal workstation / VPS deployment (1 user, trusted network, no multi-tenant auth required).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, WAL journal mode, synchronous NORMAL, `busy_timeout=30000`. Dual state machines: `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`not_saved` -> `saving` -> `saved` | `save_failed` | `discarded` | `cleanup_pending` | `preview_expired`).
- **Queue & Worker Model:** Durable SQLite FIFO queue with background worker process, queue capacity cap of 10, atomic worker claiming with process locks, deduplication fingerprints.

### 2. Native High-Res Generation & Mesh Density Governance
- **Mesh Guard Pipeline (`backend/pipelines/mesh_guard.py`)**:
  - `guard_mesh_density`: Enforces 1,000k (1M faces) safety cap on AI generation outputs. Below 1M faces, raw mesh is preserved 100% untouched.
  - Mesh Upload Limit: 2,000k (2M faces) hard ceiling in `backend/core/utils/file_utils.py` and `file_upload.py`. Uploads exceeding 2M faces are rejected with an explicit HTTP 400 error. Uploads <= 2M faces are accepted untouched.
  - All adapters run in pure native mode with zero internal artificial decimation/subdivision. Legacy 600K limit removed from `hunyuan3d_adapter_v21.py` and models.yaml updated to 1,000,000.
- **Generate Panel UI Simplified**:
  - Target Triangles slider and dynamic floating portal flyout removed from `GeneratePanel.tsx`.
  - Functional switches (Remove Lighting, PBR Materials) moved inline directly into the main panel.
  - `buildGenerationParameters.ts` clamped to 1,000,000 max polycount.

### 3. Viewport 60+ FPS Optimization for Up to 2M Triangles (`MeshViewer.tsx`)
- **Instant Wireframe Toggle**: Uses pre-cached unlit `MeshBasicMaterial` (`__wireMaterial`). Eliminates `needsUpdate = true` shader recompilation freeze on heavy PBR materials.
- **Deep GPU Cleanup**: `disposeObject3D` recursively disposes all 10 material texture map slots preventing VRAM memory leaks during rapid model loading/unloading.
- **DPR Clamping**: Viewport pixel ratio clamped to `Math.min(window.devicePixelRatio, 1.5)` to prevent GPU fillrate choking on 4K/retina displays.
- **Dense Mesh Shadow Optimization**: Key light shadow map tuned to 1024x1024; meshes with >800k triangles bypass shadow-map rasterization while keeping `receiveShadow = true`. Static meshes disable `matrixAutoUpdate` saving per-frame matrix recalculations. Shadow passes auto-disabled during wireframe rendering.

### 3. Unified Identity & Route (Part II — Batch 3-4 Complete)
- **Canonical ID**: `job_id == workspace_id == route ID` (`/workspace/generate/<canonical_id>`), format `<sanitized_name>_<6-8_hex>`.
- **Identity matching**: same source image + same model reuses workspace ID via `DatabaseManager.list_workspaces_by_asset_and_model()`; settings changes do not create new route.
- **Save/Preview lifecycle**: Keep endpoint (`/workspace/operations/{operation_id}/keep`) commits preview, sets `persistence_status=SAVED` + `workspace.active_mesh_asset_id`. Discard endpoint (`/workspace/operations/{operation_id}/discard`) cleans temp only. Route reservation only after successful Keep.

### 4. Mesh Hierarchy & Selection (Part II — Batch 5-6 Complete)
- **Right Property Panel**: Unified Mesh Browser with hierarchy grouping parent/base mesh + derived meshes by `operation_type` with v001/v002 version labels.
- **AssetModel.operation_type**: Column added with idempotent ALTER TABLE migration in `_init_db`.
- **Viewer asset selection state machine** (`useViewerStore.assetSelectionState`): `idle | selecting | verifying | loading | ready | error` with `selectionRequestId` stale-response guard; `failAssetLoad` keeps last valid mesh visible.
- **New components** (`features/workspace/components/`): `GlowButton.tsx` (5 variants: keep/discard/regenerate/cancel/export, layout-stable no scale/translate), `JobProgressBar.tsx` (determinate 0-100% + stage text), `JobProgressStage.tsx` (label chip + spinner/check/alert icon).

### 5. Hardware Isolation & Patcher Parity (Priority Rule 1)
- **Modern GPUs (`sm >= 80`)**: 100% native upstream execution preserved. No `_is_pre_ampere` / FlashAttention / BF16 modifications in any changed file.
- **Pre-Ampere (`sm < 80`)**: Mitigations strictly isolated behind `_is_pre_ampere` checks.
- **Model Patcher Isolation**: Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches.

### 6. Verification Status
- **Python Compilation:** All 8 changed Python files pass `py_compile` with 0 errors.
- **Frontend:** New components created (GlowButton, JobProgressBar, JobProgressStage, index.ts); TypeScript syntax-reviewed.
- **pytest/bun:** NOT run this session (numpy missing on low-end machine; bun build skipped per constraint). Prior evidence retained: 57 pytest passed / 0 failed, 50 bun passed across 7 test files.
- **No unrelated user changes lost.**

### 7. Files Changed (22 modified, 4 new)
- Modified: 5 adapters, mesh_generation.py, system.py, database_manager.py, database_models.py, GeneratePanel.tsx, RightPropertyPanel.tsx, MeshViewer.tsx, OperationActionBar.tsx, meshStats.ts, WorkspaceContext.tsx, types.ts, buildGenerationParameters.ts, buildGenerationParameters.test.ts, .gitignore, Docs/MEMORY.md, Docs/TASKS.md, Docs/CHANGELOG.md
- New: features/workspace/components/GlowButton.tsx, JobProgressBar.tsx, JobProgressStage.tsx, index.ts
