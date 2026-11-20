# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-20)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal workstation / VPS / Colab deployment (1 user, trusted network).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, WAL journal mode, synchronous NORMAL, `busy_timeout=30000`. Dual state machines: `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`saved` on direct publication).
- **Queue & Worker Model:** Durable SQLite FIFO queue with background worker process, queue capacity cap of 10, atomic worker claiming with process locks, deduplication fingerprints.

### 2. 100% Server-Side Remote 3D Streaming Viewport
- **Pure Cloud Streaming Architecture**: Elimination of client-side mesh downloading (`loadGLBWithProgress`, `sharedGLTFLoader.parse`) and dual-mode toggle from viewport. Viewport runs 100% on Cloud Streaming (`StreamVideoViewer.tsx` via `useWebRTCStream.ts`).
- **Offscreen Rendering Engine (`backend/streaming/renderer.py`)**: Headless rendering on server GPU / software fallback with dynamic orbit, pan, zoom, presets, shading modes, wireframe, and idle power-saving (pause rendering after 2s of inactivity).
- **WebRTC & WebSocket Streaming (`backend/streaming/webrtc_streamer.py`, `backend/api/routers/streaming.py`)**: WebRTC VideoTrack (aiortc) with transparent multiplexed WebSocket fallback channel (binary frame push + JSON input) streaming lightweight ~22KB frames (<200 KB/s), achieving instant (<1s) inspection.
- **Server-Side Geometry Stats**: Vertex count, triangle count, and dimensions are computed on server load and returned in `/api/v1/stream/session/start` to populate Inspector tabs with zero client-side GLB parsing.

### 3. Canonical Direct-Save Workspace Operations
- **Direct Workspace Persistence**: Tool operations write directly to `storage/<workspace_id>/<tool_type>/<ws_id>_<tool>_v00X.glb` via `publish_derived_mesh`.
- **Durable Versioning & Promotion**: Every run creates a durable `AssetModel` row in SQLite with `settings_snapshot` and automatically updates `active_mesh_asset_id`.
- **AI Neural Engines**:
  - **Auto-Rigging**: Powered by **SkinTokens** (14GB VRAM, TokenRig autoregressive discrete skin tokens) via `POST /api/v1/rig`.
  - **Smart UV Unwrapping**: Powered by **PartUV** (8GB VRAM) via `POST /api/v1/unwrap` (`engine: "ai"`). Absolute checkpoint path resolution via `PARTUV_CHECKPOINT_PATH` and auto-download from HuggingFace (`mikaelaangel/partfield-ckpt`).
  - **Retopology**: Powered by **FastMesh V1K** (neural pure quad topology) via `POST /api/v1/retopo` (`engine: "ai"`).
- **Fast Script Pipelines (`backend/pipelines/`)**:
  - `retopo.py`: Headless Blender QuadriFlow for quad topology and Trimesh quadric decimation for fast isotropic remeshing.
  - `smart_uv.py`: Blender Smart Project and XAtlas / Trimesh for non-overlapping UV chart packing.
  - `segment.py`: Connected-component decomposition and spatial PCA clustering with vivid viewport colorization (pure numpy).
  - `mesh_utils.py`: Safe format conversion, Truthful geometric stats, and bounded subprocess execution with density safety capping via `mesh_guard.py`.

### 4. Native Generation & Mesh Density Governance
- **Mesh Guard Pipeline (`backend/pipelines/mesh_guard.py`)**:
  - `guard_mesh_density`: Enforces 1,000k (1M faces) safety cap on AI generation outputs. Below 1M faces, raw mesh is preserved 100% untouched.
  - Mesh Upload Limit: 2,000k (2M faces) hard ceiling in `backend/core/utils/file_utils.py` and `file_upload.py`.
  - All adapters run in pure native mode with zero internal artificial decimation/subdivision.
  - TripoSG routes directly via canonical workspace storage (`storage/<workspace_id>/mesh/mesh.glb`).

### 5. Hardware Isolation & Priority Rules
- **Modern GPUs (`sm >= 80`)**: 100% native upstream execution preserved. No `_is_pre_ampere` / FlashAttention / BF16 modifications.
- **Pre-Ampere (`sm < 80`)**: Mitigations strictly isolated behind `_is_pre_ampere` checks.
- **Model Patcher Isolation**: Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches.

### 6. Verification Status
- **Verification (`2026-11-20`)**:
  - `python3 -m py_compile`: Zero syntax or import errors.
  - `npx tsc --noEmit`: Exited `0` (zero TypeScript errors).
  - Streaming end-to-end integration tests: 100% PASS (Session start, frames, camera controls, stats, stop).
  - Submodules synced with remote (`ForMesh3D-ThirdParty` up to date).
