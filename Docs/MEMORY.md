# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-16)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal workstation / VPS deployment (1 user, trusted network, no multi-tenant auth required).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, WAL journal mode, synchronous NORMAL, `busy_timeout=30000`. Dual state machines: `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`not_saved` -> `saving` -> `saved` | `save_failed` | `discarded` | `cleanup_pending` | `preview_expired`).
- **Queue & Worker Model:** Durable SQLite FIFO queue with background worker process, queue capacity cap of 10, atomic worker claiming with process locks, deduplication fingerprints.

### 2. Script Engine for Mesh Tools (Retopo, Smart UV, Segment)
- **Flat Pipelines (`backend/pipelines/`)**:
  - `retopo.py`: Headless Blender QuadriFlow for quad topology and Trimesh quadric decimation for fast isotropic remeshing.
  - `smart_uv.py`: Blender Smart Project and XAtlas / Trimesh for non-overlapping UV chart packing.
  - `segment.py`: Connected-component decomposition and spatial PCA clustering with vivid viewport colorization (pure numpy, zero scipy dependency).
  - `mesh_utils.py`: Safe format conversion, Truthful geometric stats, and bounded subprocess execution with density safety capping via `mesh_guard.py`.
- **FastAPI Endpoints**: Removed `/api/v1/mesh-tools/auto-retopo`, `/auto-uv`, and `/segment` SSE endpoints; pending replacement pipeline.
- **Workspace Preview & Action Bar Lifecycle**:
  - Unsaved preview meshes stage in `storage/temp/<operation_id>/` and stream via `/api/v1/workspace/operations/{operation_id}/preview`.
  - Keep commits the preview into an immutable workspace asset; Discard cleans the temporary directory and restores viewer baseline.

### 3. Native High-Res Generation & Mesh Density Governance
- **Mesh Guard Pipeline (`backend/pipelines/mesh_guard.py`)**:
  - `guard_mesh_density`: Enforces 1,000k (1M faces) safety cap on AI generation outputs. Below 1M faces, raw mesh is preserved 100% untouched.
  - Mesh Upload Limit: 2,000k (2M faces) hard ceiling in `backend/core/utils/file_utils.py` and `file_upload.py`. Uploads exceeding 2M faces are rejected with an explicit HTTP 400 error.
  - All adapters run in pure native mode with zero internal artificial decimation/subdivision.

### 4. Hardware Isolation & Priority Rules
- **Modern GPUs (`sm >= 80`)**: 100% native upstream execution preserved. No `_is_pre_ampere` / FlashAttention / BF16 modifications.
- **Pre-Ampere (`sm < 80`)**: Mitigations strictly isolated behind `_is_pre_ampere` checks.
- **Model Patcher Isolation**: Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches.

### 5. Verification Status
- **Python Tests**: Pipeline unit tests passing (4/4 in 2.39s).
- **Frontend Tests**: 55/55 Bun tests passing across 8 test suites.
- **Documentation**: CHANGELOG (last 3), DECISIONS (last 3), TASKS (active), MEMORY (< 100 lines).
