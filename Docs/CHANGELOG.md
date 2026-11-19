# ForMesh3D Changelog

## 2026-11-19 — Direct-Save Workspace Architecture, Temp Removal, & SkinTokens/PartUV Integration
- **Direct Workspace Persistence**: Eliminated temporary staging (`storage/temp/`) and blocking Keep/Discard Action Bar. All operations (Script & AI) write directly to `storage/<workspace_id>/<tool_type>/` using monotonic versioning (`<ws_id>_<tool>_v00X.glb`).
- **Complete Section C Removal**: Cleanly removed `/workspace/operations/{op_id}/keep`, `/discard`, `/preview` endpoints, and deleted `OperationActionBar.tsx`.
- **SkinTokens Auto-Rigging Integration**: Connected `RiggingPanel.tsx` and `EngineModeSelector.tsx` to the `skintokens_auto_rigging` AI model (14GB VRAM). Exposed neural parameters (`temperature`, `top_k`, `num_beams`, `use_transfer`, `use_postprocess`) and mapped them cleanly to `JobRequest` and backend adapter.
- **PartUV Smart UV Wiring**: Wired PartUV neural model badge and Blender pack method in `UVPanel.tsx`, with safe runtime shims for C++ `_core.so` and `partuv.preprocess_utils`.
- **Parameter Snapshot Tracking**: Preserved full parameter snapshots in `AssetModel.settings_snapshot` and updated `active_mesh_asset_id` in SQLite upon run completion.

## 2026-11-19 — Script-First Canonical Workspace Processing
- Added the `engine: "ai" | "script"` discriminator to canonical Retopo, UV, and Segmentation requests; AI remains the default.
- Routed Script requests directly to the existing Trimesh / Blender pipelines without acquiring the AI scheduler.
- Registered Script executions in SQLite with durable operation status tracking and progress reporting.
- Replaced retired multipart/SSE bridge transport with canonical JSON requests and durable operation references.

## 2026-11-18 — Legacy Mesh-Tools Cleanup & Download Fixes
- Reconciled task checklist and architecture documentation with the retired `/api/v1/mesh-tools/*` router.
- `download_job_result` falls back to `<workspace_id>/mesh/mesh.glb` when the job result lacks `asset_root`/`output_mesh_path`, resolving 404s when clicking assets or after mesh generation.
- Workspace creation sets `active_mesh_asset_id=asset_id` so download resolves via `source_asset_id` fallback when `active_mesh_asset_id` is None.
- Removed `models/`, `images/`, `thumbnails/` directory creation at `backend/storage/` root; SQLite `assets` table is the single source of truth for file metadata.
