# ForMesh3D Changelog

## 2026-11-20 — TriFlow Neural Quad-Dominant Retopology Model Integration
- **TriFlow Model Adapter (`backend/adapters/triflow_adapter.py`)**: Subclassed `BaseModel` (`triflow_retopology`) with 10GB VRAM profile. Encodes mesh Signed Distance Field (SDF) to voxel latents, samples Nearest-Vertex Vector Fields via Latent Flow Matching, and executes constrained QEM edge collapse simplification via `pyfqmr_triflow`.
- **Dynamic Face Budget & Quad Control**: Added full support for target polygon counts (5,000 to 200,000 faces, including 700k -> 50k decimation), quad ratio (`0.0` to `1.0`), feature edge retention (`qem_threshold`), and watertight SDF hole-filling.
- **Model Registry & Download Automation**: Registered `triflow_retopology` in `backend/config/models.yaml` and `model_factory.py`. Added `download_triflow()` to `backend/scripts/download_models.sh` (fetching from HuggingFace `lihcxr/TriFlow`) and added Option `[19]` to `manager.sh`.
- **Frontend Studio Integration (`RemeshPanel.tsx`)**: Unlocked Target Face Budget slider and presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`) in AI mode, wired `features/workspace/services/meshProcessingBridge.ts` and `WorkspaceContext.tsx` to dispatch `triflow_retopology`.

## 2026-11-20 — 100% Server-Side Remote 3D Streaming Engine & PartUV Checkpoint Resolution
- **100% Server-Side 3D Streaming Engine**: Implemented offscreen rendering engine (`backend/streaming/renderer.py`) and WebRTC / WebSocket streaming server (`backend/streaming/webrtc_streamer.py`, `backend/api/routers/streaming.py`) with dynamic camera controls (orbit, pan, zoom, presets, shading modes, wireframe, idle power-saving).
- **Client Mesh Loader Removal**: Completely removed client-side mesh download loop (`loadGLBWithProgress`, `sharedGLTFLoader.parse`) and dual-mode toggle from `MeshViewer.tsx` and `ViewportToolOverlay.tsx`. Viewport runs 100% on Cloud Streaming, dropping network bandwidth from 100MB download to lightweight ~22KB frames (<200KB/s) and achieving instant (<1s) inspection.
- **Server-Side Mesh Metadata**: Added automatic geometry statistics calculation (vertex count, triangle count, dimensions) in `HeadlessRenderer` returned during `/session/start`, allowing inspector tabs to populate with zero client-side mesh parsing.
- **PartUV Checkpoint Path Resolution**: Fixed PartUV inference crash (`FileNotFoundError: model_objaverse.ckpt`) by setting `PARTUV_CHECKPOINT_PATH` env var in `partuv_adapter.py`, resolving absolute paths in `preprocess.py` and `run_PF.py`, and adding auto-download fallback via `huggingface_hub`.

## 2026-11-20 — Tool Mesh Resolution & Worker Scoping Fixes
- **Retopo & UV Endpoint 404 Resolution**: Fixed input mesh lookup in `mesh_retopology.py`, `mesh_uv_unwrapping.py`, and `mesh_segmentation.py`. In `file_upload.py`, added workspace directory awareness (`storage/<workspace_id>/<relative_path>`) and operation/workspace fallbacks to `get_file_path_impl`, preventing premature 404s when dispatching fast script operations from UI.
- **Worker Process Scoping Fix**: Removed nested `import os` inside `model_worker_process` in `multiprocess_scheduler.py` that caused `UnboundLocalError: local variable 'os' referenced before assignment` at line 383 when launching CPU workers (e.g. motion generation).
- **SchedulerAdapter Resilience**: Added `if self._job_queue:` null guard before querying job status in `api/dependencies.py` to avoid 500 errors on polling.
