# ForMesh3D Changelog

## 2026-11-20 — 100% Server-Side Remote 3D Streaming Engine & PartUV Checkpoint Resolution
- **100% Server-Side 3D Streaming Engine**: Implemented offscreen rendering engine (`backend/streaming/renderer.py`) and WebRTC / WebSocket streaming server (`backend/streaming/webrtc_streamer.py`, `backend/api/routers/streaming.py`) with dynamic camera controls (orbit, pan, zoom, presets, shading modes, wireframe, idle power-saving).
- **Client Mesh Loader Removal**: Completely removed client-side mesh download loop (`loadGLBWithProgress`, `sharedGLTFLoader.parse`) and dual-mode toggle from `MeshViewer.tsx` and `ViewportToolOverlay.tsx`. Viewport runs 100% on Cloud Streaming, dropping network bandwidth from 100MB download to lightweight ~22KB frames (<200KB/s) and achieving instant (<1s) inspection.
- **Server-Side Mesh Metadata**: Added automatic geometry statistics calculation (vertex count, triangle count, dimensions) in `HeadlessRenderer` returned during `/session/start`, allowing inspector tabs to populate with zero client-side mesh parsing.
- **PartUV Checkpoint Path Resolution**: Fixed PartUV inference crash (`FileNotFoundError: model_objaverse.ckpt`) by setting `PARTUV_CHECKPOINT_PATH` env var in `partuv_adapter.py`, resolving absolute paths in `preprocess.py` and `run_PF.py`, and adding auto-download fallback via `huggingface_hub`.

## 2026-11-20 — Tool Mesh Resolution & Worker Scoping Fixes
- **Retopo & UV Endpoint 404 Resolution**: Fixed input mesh lookup in `mesh_retopology.py`, `mesh_uv_unwrapping.py`, and `mesh_segmentation.py`. In `file_upload.py`, added workspace directory awareness (`storage/<workspace_id>/<relative_path>`) and operation/workspace fallbacks to `get_file_path_impl`, preventing premature 404s when dispatching fast script operations from UI.
- **Worker Process Scoping Fix**: Removed nested `import os` inside `model_worker_process` in `multiprocess_scheduler.py` that caused `UnboundLocalError: local variable 'os' referenced before assignment` at line 383 when launching CPU workers (e.g. motion generation).
- **SchedulerAdapter Resilience**: Added `if self._job_queue:` null guard before querying job status in `api/dependencies.py` to avoid 500 errors on polling.

## 2026-11-19 — Auto-Retry Elimination, Canonical Mesh Routing, Trellis utils3d Shim, & UI Retry Switch
- **Backend Auto-Retry Elimination**: Removed automatic job requeue loop in `job_queue.py`, `redis_job_queue.py`, and `database_models.py` (`max_retries = 0`). Jobs now immediately terminate cleanly in `FAILED` state on error instead of resetting to 0% and looping.
- **Canonical Mesh Routing & Tool Dir Removal**: Fixed `multiprocess_scheduler.py` where `bool(_op_id)` was misclassifying generation jobs as tools and writing to `storage/<workspace_id>/tool/`. Restored direct canonical output to `storage/<workspace_id>/mesh/mesh.glb` and eliminated invalid `operation_type` argument in `DatabaseManager.add_asset()`.
- **TRELLIS utils3d Compatibility Shim**: Added compatibility shim in `trellis_adapter.py` mapping `utils3d.torch.perspective_from_fov_xy` to `perspective_from_fov` (`utils3d >= 0.3.0`), resolving paint pipeline failure during hole filling.
- **UI Generate/Retry Button Toggle**: Updated `GeneratePanel.tsx` to display "Retry Generation" upon execution failure and reset cleanly back to "Generate 3D Model" when the user changes or uploads an image or switches AI models.
