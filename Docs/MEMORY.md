# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-14)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal workstation / VPS deployment (1 user, trusted network, no multi-tenant auth required).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, configured with WAL journal mode (`PRAGMA journal_mode=WAL;`), synchronous NORMAL (`PRAGMA synchronous=NORMAL;`), and `busy_timeout=30000`.
- **Queue & Worker Model:** Durable SQLite FIFO queue (`JobQueue`) with a dedicated background worker process managed via `MultiprocessModelScheduler`. Redis job queue is optional and non-blocking for multi-worker mode. Operations are tracked with a fixed queue capacity cap of 10 operations (`QUEUE_FULL`), atomic worker claiming with process locks, and deduplication fingerprints.
- **Dual State Machine:** Strict separation between `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`not_saved` -> `saving` -> `saved` | `save_failed` | `discarded` | `cleanup_pending` | `preview_expired`), with enforced terminal immutability.
- **Storage Topology:** Centralized storage root `backend/storage/` with per-workspace layout `backend/storage/<workspace_id>/` (`input/`, `mesh/`, `texture/pbr/`, `retopology/`, `segmentation/`, and rebuildable `metadata.json`), managed by `WorkspaceStorageManager` and backed by `WorkspaceModel`, `AssetModel`, and `OperationModel` in authoritative SQLite DB. Canonical asset operations and manifests are governed by `backend/core/utils/artifact_utils.py`.
- **Direct Native Generation:** Direct high-fidelity model-native mesh generation is standard. Upstream models (Hunyuan3D-2.1, TRELLIS, Stable Fast 3D, TripoSG) output native, detailed geometry directly.

### 2. Purged & Decoupled Legacy Components (Clean Architecture)
- **Eliminated Bloat:**
  - `backend/postprocess/`: 100% removed (16 legacy service files, 136KB). No external 3DGenStudio dependency or licensing restrictions.
  - `backend/core/auth/`: 100% removed. Single-user local runtime does not need JWT/passlib multi-tenant authentication.
  - `backend/core/quality/` & `quality.yaml`: 100% removed. Artificial quality gates and arbitrary mesh score fallbacks eliminated.
  - `backend/core/preprocess/`: Removed dead `image_enhancement.py` and `hi3dgen_bridging.py`. Image inputs route directly to model adapters.
  - `backend/core/models/`: Removed dummy mock model definitions (`mesh_models.py`, `mesh_editing_models.py`, etc.). Clean `BaseModel` and `ModelStatus` retained.
  - `backend/api/routers/image_enhancement.py`: Unmounted and deleted.
- **Mesh Tools Router (`/api/v1/mesh-tools`):** Self-contained SSE streaming router returning structured progress, validation (`.glb`, `.gltf`, `.obj`, `.ply`, `.stl`), and error events without legacy postprocess pipeline coupling.

### 3. API Surface Census
- **Active Routers:**
  - System router (`/api/v1/system`): Telemetry, logs, scheduler status, worker controls, keep/discard operations.
  - Database router (`/api/v1/system/database`): DB stats, verification, and migration helpers.
  - File Upload router (`/api/v1/file-upload`): Direct image and mesh intake, metadata extraction, thumbnail generation, downloads.
  - Mesh Generation (`/api/v1/mesh-generation`): Direct neural generation (image-to-raw-mesh, image-to-textured-mesh, painting, cancel).
  - Mesh Tools (`/api/v1/mesh-tools`): Self-contained format validation and SSE streaming specialist tools.
  - Specialist Routers: `/api/v1/mesh-uv-unwrapping`, `/api/v1/motion-generation`, `/api/v1/auto-rigging`, `/api/v1/mesh-retopology`, `/api/v1/mesh-segmentation`, `/api/v1/mesh-editing`.
- **Application Endpoints:**
  - `GET /health` (system health status) and `GET /` (root status).

### 4. Hardware Isolation & Patcher Parity (Priority Rule 1)
- **Modern GPUs (`sm >= 80`, e.g. A100, RTX 3090, RTX 4090, H100):** 100% native upstream execution preserved. Uses native BFloat16 precision, official FlashAttention (FA2/FA3), and upstream inference schedules with zero fallback overhead.
- **Pre-Ampere (`sm < 80`, e.g. T4, V100):** Mitigations strictly isolated behind `_is_pre_ampere` checks. Uses query-chunked SDPA and FP16/FP32 stability guards.
- **Model Patcher Isolation:** Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches on compiler primitives (`tl.store`, `tl.load`) or shared libraries (`torchvision`).

### 5. Frontend & 3D Viewer Capabilities
- **Viewport Engine:** Three.js 0.186 WebGLRenderer with `preserveDrawingBuffer: true`, SRGB color space, OrbitControls, and `AbortController` stale fetch race protection.
- **Shading Modes:** 7 modes supported (`textured`, `solid`, `clay`, `matcap-gold`, `matcap-chrome`, `uv-checker`, `wireframe`).
- **Interactive Tools:** Interactive comparison wipe divider, auto-turntable, XYZ orientation gizmo, workspace snapshot capture.
- **Workspace Identity & Routing:** URL route mapped stably to backend `workspace_id` (`/workspace/generate/<workspace_id>`). Asset selection in the Assets panel updates only `active_mesh_asset_id` on the workspace without mutating the URL route.
- **Operation Action Bar:** Dockable action bar supporting Keep in Workspace (commits derived preview, transitions to `saved`), Regenerate (creates new execution with `parent_operation_id`), and Discard Preview (cleans temporary output, restores base mesh).
- **Adaptive Polling:** Single unified poller across background tasks: 1.5s initial cadence, 5s backoff after 2 minutes, pause on tab hidden (`visibilitychange`), stop on terminal state.
- **State Machine Inventory:** Explicit state machines enforced for execution (`idle`, `queued`, `running`, `completed`, `failed`, `interrupted`) and persistence (`not_saved`, `saving`, `saved`, `save_failed`, `discarded`).

### 6. Verified Test Suite (conda env `3daigc-api`)
- **Backend Pytest:** **57 passed, 0 failed** in 21.80s across `backend/tests/`:
  - `test_e2e_architecture_plan.py` (22 passed)
  - `test_batch1_regressions.py` (8 passed)
  - `test_batch2_storage_and_identity.py` (5 passed)
  - `test_batch3_queue_and_lifecycle.py` (6 passed)
  - `test_batch4_api_integration.py` (16 passed)
- **Python Compilation:** `python3 -m py_compile` across all `backend/api/` and `backend/core/` files passed with 0 errors.
- **Frontend Bun Tests:** 18 passed across 4 test files (`meshStats.test.ts`, `buildGenerationParameters.test.ts`, `workspaceBatch5.test.ts`, `route.test.mjs`, 0 failures).

### 7. Invariant Preservation
- Zero dead imports or dangling references to `postprocess`, `quality`, or `auth`.
- Zero frontend modifications made (preserved for parallel UI cleanup agent).
- Zero dependencies added to conda environment or package manifests.
