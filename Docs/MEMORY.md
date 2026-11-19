# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-19)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal workstation / VPS deployment (1 user, trusted network, no multi-tenant auth required).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, WAL journal mode, synchronous NORMAL, `busy_timeout=30000`. Dual state machines: `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`saved` on direct publication).
- **Queue & Worker Model:** Durable SQLite FIFO queue with background worker process, queue capacity cap of 10, atomic worker claiming with process locks, deduplication fingerprints.

### 2. Canonical Direct-Save Workspace Operations
- **Direct Workspace Persistence**: Staging under `storage/temp/` and modal Keep/Discard flows are completely removed (Section C Complete Removal). Tool operations write directly to `storage/<workspace_id>/<tool_type>/<ws_id>_<tool>_v00X.glb` via `publish_derived_mesh`.
- **Durable Versioning & Promotion**: Every run creates a durable `AssetModel` row in SQLite with `settings_snapshot` and automatically updates `active_mesh_asset_id`. The master mesh is never overwritten; Version History allows immediate instant switching between prior runs.
- **AI Neural Engines**:
  - **Auto-Rigging**: Powered by **SkinTokens** (14GB VRAM, TokenRig autoregressive discrete skin tokens) via `POST /api/v1/rig`. Configured in `RiggingPanel.tsx` with neural sampling parameters (`temperature`, `top_k`, `num_beams`, `use_transfer`, `use_postprocess`).
  - **Smart UV Unwrapping**: Powered by **PartUV** (8GB VRAM, part-based neural seam prediction) via `POST /api/v1/unwrap` (`engine: "ai"`).
  - **Retopology**: Powered by **FastMesh V1K** (neural pure quad topology) via `POST /api/v1/retopo` (`engine: "ai"`).
  - **Segmentation**: Wire-stage ready for segmentation model weights via `POST /api/v1/segment`.
- **Fast Script Pipelines (`backend/pipelines/`)**:
  - `retopo.py`: Headless Blender QuadriFlow for quad topology and Trimesh quadric decimation for fast isotropic remeshing.
  - `smart_uv.py`: Blender Smart Project and XAtlas / Trimesh for non-overlapping UV chart packing.
  - `segment.py`: Connected-component decomposition and spatial PCA clustering with vivid viewport colorization (pure numpy, zero scipy dependency).
  - `mesh_utils.py`: Safe format conversion, Truthful geometric stats, and bounded subprocess execution with density safety capping via `mesh_guard.py`.
- **Frontend Bundle Optimization**: Lazy code-splitting for secondary workspace panels via Next.js `dynamic()`, direct root routing to `/workspace/generate`, and WCAG 2.5.3 accessible label alignment on Resource Monitor.

### 3. Native High-Res Generation & Mesh Density Governance
- **Mesh Guard Pipeline (`backend/pipelines/mesh_guard.py`)**:
  - `guard_mesh_density`: Enforces 1,000k (1M faces) safety cap on AI generation outputs. Below 1M faces, raw mesh is preserved 100% untouched.
  - Mesh Upload Limit: 2,000k (2M faces) hard ceiling in `backend/core/utils/file_utils.py` and `file_upload.py`. Uploads exceeding 2M faces are rejected with an explicit HTTP 400 error.
  - All adapters run in pure native mode with zero internal artificial decimation/subdivision.
  - TripoSG routes directly via canonical workspace storage (`storage/<workspace_id>/mesh/mesh.glb`); rogue `triposg_output` directory eliminated.

### 4. Hardware Isolation & Priority Rules
- **Modern GPUs (`sm >= 80`)**: 100% native upstream execution preserved. No `_is_pre_ampere` / FlashAttention / BF16 modifications.
- **Pre-Ampere (`sm < 80`)**: Mitigations strictly isolated behind `_is_pre_ampere` checks.
- **Model Patcher Isolation**: Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches.

### 5. Scheduler & Model Stability Policies
- **Terminal Failure & Retry Control**: Job auto-retry loops disabled (`max_retries = 0`) across `job_queue.py` and `redis_job_queue.py`. Failures terminate immediately; frontend exposes manual "Retry Generation" CTA that resets on model/image change.
- **Tool Operation Isolation**: `multiprocess_scheduler.py` only routes explicitly registered tool operations to `tool/`; mesh generation strictly saves to `storage/<workspace_id>/mesh/mesh.glb`.
- **TRELLIS Postprocessing Compatibility**: `trellis_adapter.py` shims `utils3d.torch.perspective_from_fov_xy` to `perspective_from_fov` for `utils3d >= 0.3.0`.

### 6. Verification Status
- **Verification (`2026-11-19`)**: Full validation passes cleanly:
  - `python3 -m compileall backend/ patcher/`: Exited `0` (zero syntax/import errors).
  - `bun tsc`: Exited `0` (zero TypeScript errors).
  - Submodules synced with remote.
  - Git branch `dev` ready for push.
