# ForMesh3D — Audited Project Memory & Current State

## Audited Current State (2026-11-20)

### 1. Architectural Topology & Deployment
- **Deployment Model:** Single personal workstation / VPS / Colab deployment (1 user, trusted network).
- **Backend Runtime:** FastAPI (`backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`), Uvicorn on port 7842.
- **Frontend Studio:** Next.js 16 (App Router), React 19, Bun 1.4.2 on port 3000.
- **Database Authority:** Authoritative SQLite database at `backend/storage/job_queue.db`, WAL journal mode, synchronous NORMAL, `busy_timeout=30000`. Dual state machines: `ExecutionStatus` (`queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`) and `PersistenceStatus` (`saved` on direct publication).
- **Queue & Worker Model:** Durable SQLite FIFO queue with background worker process, queue capacity cap of 10, atomic worker claiming with process locks, deduplication fingerprints.

### 2. Local Mesh Viewport (Client-Side Rendering)
- **Local GLTFLoader-based Rendering**: Mesh viewer downloads GLB via `fetch`/`glbCache`, parses with `GLTFLoader` (DRACO + meshopt), and renders inline in Three.js viewport (`MeshViewer.tsx`).
- **No Server-Side Streaming**: WebRTC/WebSocket streaming engine (`backend/streaming/`, `backend/api/routers/streaming.py`) removed. All mesh loading is client-side.
- **Cache**: URL-keyed fetch cache (`glbCache.ts`) with L1 RAM + L2 CacheStorage tiers. Mesh statistics collected via `meshStats.ts`.

### 3. Canonical Direct-Save Workspace Operations
- **Direct Workspace Persistence**: Tool operations write directly to `storage/<workspace_id>/<tool_type>/<ws_id>_<tool>_v00X.glb` via `publish_derived_mesh`.
- **Durable Versioning & Promotion**: Every run creates a durable `AssetModel` row in SQLite with `settings_snapshot` and automatically updates `active_mesh_asset_id`.
- **AI Neural Engines**:
  - **Segmentation**: Powered by **PartField** (`partfield_segmentation`, 8GB VRAM, continuous 3D feature fields + Agglomerative face clustering) via `POST /api/v1/segment` (`engine: "ai"`). Checkpoint `backend/pretrained/PartField/model_objaverse.ckpt`.
  - **Retopology**: Powered by **TriFlow** (`triflow_retopology`, 10GB VRAM, Latent Flow Matching with Nearest-Vertex Vector Fields and constrained QEM decimation for dynamic 5k to 200k face budgets and quad-dominant topology) via `POST /api/v1/retopo` (`engine: "ai"`).
  - **Auto-Rigging**: Powered by **SkinTokens** (14GB VRAM, TokenRig autoregressive discrete skin tokens) via `POST /api/v1/rig`.
  - **Smart UV Unwrapping**: Powered by **PartUV** (8GB VRAM) via `POST /api/v1/unwrap` (`engine: "ai"`). Absolute checkpoint path resolution via `PARTUV_CHECKPOINT_PATH` and auto-download from HuggingFace (`mikaelaangel/partfield-ckpt`).
- **Fast Script Pipelines (`backend/pipelines/`)**:
  - `retopo.py`: Headless Blender QuadriFlow for quad topology and Trimesh quadric decimation for fast isotropic remeshing.
  - `smart_uv.py`: Blender Smart Project and XAtlas / Trimesh for non-overlapping UV chart packing.
  - `segment.py`: Connected-component decomposition and spatial PCA clustering with vivid viewport colorization (pure numpy).
  - `mesh_utils.py`: Safe format conversion, Truthful geometric stats, and bounded subprocess execution with density safety capping via `mesh_guard.py`.

### 4. Native Generation & Mesh Density Governance
- **Mesh Guard Pipeline (`backend/pipelines/mesh_guard.py`)**: Enforces 1,000k (1M faces) safety cap on AI generation outputs. Below 1M faces, raw mesh is preserved 100% untouched.
- Mesh Upload Limit: 2,000k (2M faces) hard ceiling in `backend/core/utils/file_utils.py` and `file_upload.py`.
- All adapters run in pure native mode with zero internal artificial decimation/subdivision.

### 5. Hardware Isolation & Priority Rules
- **Modern GPUs (`sm >= 80`)**: 100% native upstream execution preserved. No `_is_pre_ampere` / FlashAttention / BF16 modifications.
- **Pre-Ampere (`sm < 80`)**: Mitigations strictly isolated behind `_is_pre_ampere` checks.
- **Model Patcher Isolation**: Patchers reside strictly in `patcher/<model-name>/` with zero global monkeypatches.

### 6. Verification Status
- **Verification (`2026-11-20`)**:
  - `backend/tests/test_partfield_adapter.py`: 6/6 unit tests passed.
  - `backend/tests/test_triflow_adapter.py`: 5/5 unit tests passed.
  - `python3 -m py_compile`: Zero syntax or import errors.
  - `npx tsc --noEmit`: Exited `0` (zero TypeScript errors).
  - Submodules and vendored directories cleaned of nested `.git` folders.
