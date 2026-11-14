# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-14)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal VPS deployment (1 user, trusted network).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, configured with WAL journal mode (`PRAGMA journal_mode=WAL;`), synchronous NORMAL (`PRAGMA synchronous=NORMAL;`), and `busy_timeout=30000`.
- **Queue & Worker Model:** Durable SQLite FIFO queue (`JobQueue`) with a single background worker process managed via `MultiprocessModelScheduler`. Redis job queue is optional and non-blocking for standalone VPS operation. Operations are tracked with a fixed queue capacity cap of 10 operations (`QUEUE_FULL`), atomic single-worker claiming with process locks, and deduplication fingerprints.
- **Dual State Machine:** Strict separation between `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`not_saved` -> `saving` -> `saved` | `save_failed` | `discarded` | `cleanup_pending` | `preview_expired`), with enforced terminal immutability.
- **Storage Topology:** Centralized storage root `backend/storage/` with active per-workspace layout `backend/storage/<workspace_id>/` (`input/`, `mesh/`, `texture/pbr/`, `retopology/`, `segmentation/`, and rebuildable `metadata.json`), managed by `WorkspaceStorageManager` and backed by `WorkspaceModel`, `AssetModel`, and `OperationModel` in authoritative SQLite DB. Temporary previews are staged in `storage/temp/<operation_id>/` and governed by 24-hour TTL cleanup.
- **Generation Workflow:** Direct high-fidelity model-native mesh generation is standard. Automated downstream post-processing during generation is disabled by default (`postprocessing.enabled: false`), while all post-processing modules (`backend/postprocess/`) remain permanent core assets powering discrete on-demand specialist tools (PartUV, AutoRetopo, Normal Baking, Collision Generation, and QA inspection).

### 2. API Surface Census
- **Active Endpoints:** Exactly 100 active `APIRoute` endpoints registered (98 mounted across 13 `APIRouter` modules plus 2 application-level endpoints: `/health` and `/`).
- **Core Endpoints (55):**
  - System router (`/api/v1/system`): 40 endpoints for telemetry, logs, scheduler status, and job controls.
  - Database router (`/api/v1/system/database`): 6 endpoints for DB maintenance, stats, and verification.
  - File Upload router (`/api/v1/file-upload`): 9 endpoints for image/mesh intake, metadata, download, and thumbnails.
- **Specialist & Tool Routers (43):**
  - Mesh Tools (`/api/v1/mesh-tools`): 12 endpoints (LODs, optimize, auto-UV, auto-retopo, repair, convert, collision, bake, flatten, segment, inspect, thumbnail).
  - Mesh Generation (`/api/v1/mesh-generation`): 6 endpoints (image-to-raw-mesh, image-to-textured-mesh, text/image mesh painting, formats, cancel).
  - Mesh UV Unwrapping (`/api/v1/mesh-uv-unwrapping`): 4 endpoints (unwrap, formats, pack methods, models).
  - Motion Generation (`/api/v1/motion-generation`): 4 endpoints (generate-motion, checkpoints, models, formats).
  - Auto Rigging (`/api/v1/auto-rigging`): 3 endpoints (generate-rig, formats, models).
  - Mesh Retopology (`/api/v1/mesh-retopology`): 3 endpoints (retopologize-mesh, formats, models).
  - Mesh Segmentation (`/api/v1/mesh-segmentation`): 3 endpoints (segment-mesh, formats, models).
  - Mesh Editing (`/api/v1/mesh-editing`): 3 endpoints (text/image mesh editing, supported masks).
  - Image Enhancement (`/api/v1/image-enhancement`): 2 endpoints (preview, artifact download).
- **Application-Level Endpoints (2):**
  - `GET /health` (health check) and `GET /` (root status).

### 3. Hardware Isolation & Patcher Parity (Priority Rule 1)
- **Modern GPUs (`sm >= 80`, e.g. A100, RTX 3090, RTX 4090, H100):** 100% native upstream execution preserved. Uses native BFloat16 precision, official FlashAttention (FA2/FA3), and upstream inference schedules with zero fallback overhead.
- **Pre-Ampere (`sm < 80`, e.g. T4, V100):** Mitigations strictly isolated behind `_is_pre_ampere` checks. Uses query-chunked SDPA and FP16/FP32 stability guards.
- **Model Patcher Isolation:** Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches on compiler primitives (`tl.store`, `tl.load`) or shared libraries (`torchvision`).

### 4. Frontend & 3D Viewer Capabilities
- **Viewport Engine:** Three.js 0.186 WebGLRenderer with `preserveDrawingBuffer: true`, SRGB color space, OrbitControls, and `AbortController` stale fetch race protection.
- **Shading Modes:** 7 modes supported (`textured`, `solid`, `clay`, `matcap-gold`, `matcap-chrome`, `uv-checker`, `wireframe`).
- **Interactive Tools:** Interactive comparison wipe divider, auto-turntable, XYZ orientation gizmo, workspace snapshot capture.
- **Workspace Identity & Routing:** URL route mapped stably to backend `workspace_id` (`/workspace/generate/<workspace_id>`), eliminating client-side ephemeral route hashing (`routeShortId`). Asset selection in the Assets panel updates only `active_mesh_asset_id` on the workspace without mutating the URL route.
- **Mesh Versions Control:** Dynamic viewer selector hidden when a workspace has only its raw base mesh; dynamically displays retained versions (`_v002`, `_v003`) when derived operations succeed.
- **Operation Action Bar:** Dockable action bar supporting Keep in Workspace (commits derived preview, transitions to `saved`), Regenerate (creates new execution with `parent_operation_id`), and Discard Preview (cleans temporary output, restores base mesh).
- **Adaptive Polling:** Single unified poller across background tasks: 1.5s initial cadence, 5s backoff after 2 minutes, pause on tab hidden (`visibilitychange`), stop on terminal state.
- **Global Workspaces Gallery:** Studio dashboard card listing navigating directly to `/workspace/generate/<workspace_id>`.
- **State Machine Inventory:** Explicit state machines enforced for execution (`idle`, `queued`, `running`, `completed`, `failed`, `interrupted`) and persistence (`not_saved`, `saving`, `saved`, `save_failed`, `discarded`). Frontend state transitions coordinated with backend workspace and operation models.

### 5. Verified Test Suite (conda env `3daigc-api`)
- **Backend Pytest:** 46 passed across `test_e2e_architecture_plan.py`, `test_batch2_storage_and_identity.py`, `test_batch3_queue_and_lifecycle.py`, and `test_batch4_api_integration.py` (0 failures).
- **Frontend Bun Tests:** 18 passed across 4 test files (`meshStats.test.ts`, `buildGenerationParameters.test.ts`, `workspaceBatch5.test.ts`, `route.test.mjs`, 0 failures).
- **TypeScript Health:** 0 compiler errors (`bun x tsc --noEmit`).
- **Operational Startup Flow:** Single-command run `bash scripts/start.sh` verified cleanly; Redis, backend multi-worker API (port 7842, `/health` reporting healthy), and frontend Next.js (port 3000) operational with unified logging in `logs/master.log`.

### 6. Invariant Preservation
- Pre-existing uncommitted changes in `AGENTS.md` and `Docs/TASKS.md` preserved intact.
- Zero dependencies added to conda environment or package manifests.
