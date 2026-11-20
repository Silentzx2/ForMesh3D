# ForMesh3D Changelog

## 2026-11-20 — Tool Mesh Resolution & Worker Scoping Fixes
- **Retopo & UV Endpoint 404 Resolution**: Fixed input mesh lookup in `mesh_retopology.py`, `mesh_uv_unwrapping.py`, and `mesh_segmentation.py`. In `file_upload.py`, added workspace directory awareness (`storage/<workspace_id>/<relative_path>`) and operation/workspace fallbacks to `get_file_path_impl`, preventing premature 404s when dispatching fast script operations from UI.
- **Worker Process Scoping Fix**: Removed nested `import os` inside `model_worker_process` in `multiprocess_scheduler.py` that caused `UnboundLocalError: local variable 'os' referenced before assignment` at line 383 when launching CPU workers (e.g. motion generation).
- **SchedulerAdapter Resilience**: Added `if self._job_queue:` null guard before querying job status in `api/dependencies.py` to avoid 500 errors on polling.

## 2026-11-19 — Auto-Retry Elimination, Canonical Mesh Routing, Trellis utils3d Shim, & UI Retry Switch
- **Backend Auto-Retry Elimination**: Removed automatic job requeue loop in `job_queue.py`, `redis_job_queue.py`, and `database_models.py` (`max_retries = 0`). Jobs now immediately terminate cleanly in `FAILED` state on error instead of resetting to 0% and looping.
- **Canonical Mesh Routing & Tool Dir Removal**: Fixed `multiprocess_scheduler.py` where `bool(_op_id)` was misclassifying generation jobs as tools and writing to `storage/<workspace_id>/tool/`. Restored direct canonical output to `storage/<workspace_id>/mesh/mesh.glb` and eliminated invalid `operation_type` argument in `DatabaseManager.add_asset()`.
- **TRELLIS utils3d Compatibility Shim**: Added compatibility shim in `trellis_adapter.py` mapping `utils3d.torch.perspective_from_fov_xy` to `perspective_from_fov` (`utils3d >= 0.3.0`), resolving paint pipeline failure during hole filling.
- **UI Generate/Retry Button Toggle**: Updated `GeneratePanel.tsx` to display "Retry Generation" upon execution failure and reset cleanly back to "Generate 3D Model" when the user changes or uploads an image or switches AI models.

## 2026-11-19 — Direct-Save Workspace Architecture, Temp Removal, & SkinTokens/PartUV Integration
- **Direct Workspace Persistence**: Eliminated temporary staging (`storage/temp/`) and blocking Keep/Discard Action Bar. All operations (Script & AI) write directly to `storage/<workspace_id>/<tool_type>/` using monotonic versioning (`<ws_id>_<tool>_v00X.glb`).
- **Complete Section C Removal**: Cleanly removed `/workspace/operations/{op_id}/keep`, `/discard`, `/preview` endpoints, and deleted `OperationActionBar.tsx`.
- **SkinTokens Auto-Rigging Integration**: Connected `RiggingPanel.tsx` and `EngineModeSelector.tsx` to the `skintokens_auto_rigging` AI model (14GB VRAM). Exposed neural parameters (`temperature`, `top_k`, `num_beams`, `use_transfer`, `use_postprocess`) and mapped them cleanly to `JobRequest` and backend adapter.
- **PartUV Smart UV Wiring**: Wired PartUV neural model badge and Blender pack method in `UVPanel.tsx`, with safe runtime shims for C++ `_core.so` and `partuv.preprocess_utils`.
- **TripoSG Storage Normalization**: Eliminated rogue `triposg_output` directory creation in `triposg_adapter.py` and `patcher/triposg/output_to_storage.py`. TripoSG exports to managed temporary paths that the multiprocess scheduler persists directly into canonical workspace storage (`storage/<workspace_id>/mesh/mesh.glb`) with density validation and asset registration.
- **Frontend Performance & Bundle Optimization**: Converted secondary workspace tool panels (`TexturePanel`, `UVPanel`, `RemeshPanel`, `RiggingPanel`, `SegmentationPanel`, `AnimationPanel`) to Next.js `dynamic()` lazy loading with fallback skeletons. Optimized root navigation directly to `/workspace/generate` eliminating redirect chains, and aligned Resource Monitor button aria-label with visible telemetry for WCAG 2.5.3 compliance.
- **Parameter Snapshot Tracking**: Preserved full parameter snapshots in `AssetModel.settings_snapshot` and updated `active_mesh_asset_id` in SQLite upon run completion.
