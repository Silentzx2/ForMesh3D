# ForMash3D Changelog

## 2026-11-18 — Mesh download, thumbnail, and TRELLIS texture fixes
- **Download 404 fix**: `download_job_result` now falls back to `<workspace_id>/mesh/mesh.glb` when the job result lacks `asset_root`/`output_mesh_path`, resolving 404s when clicking assets or after mesh generation.
- **Job result persistence**: `update_job_result` now called after mesh copy so `asset_root`/`output_mesh_path` are persisted to Redis for all successful generation jobs (including raw-mesh with post-processing disabled).
- **One workspace dir per job**: Image upload no longer creates a storage-root directory; generation creates exactly one `<workspace_id>/` and copies the image to `<workspace_id>/input/source_image<ext>`. Mesh saves to `<workspace_id>/mesh/mesh.glb`.
- **TRELLIS texture fallback**: When `utils3d` is not installed, texture generation is skipped and the raw mesh is returned instead of crashing with `AttributeError: module 'utils3d' has no attribute 'torch'`.
- **Manifest write fix**: `write_manifest` now creates the workspace directory before writing `.metadata_<hash>.tmp`, preventing `FileNotFoundError` on image upload manifest projection.
- **Storage root cleanup**: Removed `models/`, `images/`, `thumbnails/` directory creation at `backend/storage/` root (setup.sh and build_docker.sh); only `uploads/` and `temp/` are created at root.

## 2026-11-16 — Workspace UI Audit Cleanup

- Added IME composition guards to snapshot and export profile submissions.
- Replaced native collection and preset confirmation prompts with accessible dialog flows, and replaced the workspace focus query with a React ref.
- Migrated the remaining workspace Lucide icon usage to Hugeicons and replaced audited hex color literals with existing HSL theme tokens.
- Fixed backend mesh-tool imports for workers started from the `backend/` directory.

## 2026-11-16 — Script Engine for Mesh Tools: Retopo, Smart UV & Segment

- **End-to-End Execution**: Connected the existing Script Engine for Retopo, Smart UV, and Segment across UI panels, bridge (`meshProcessingBridge.ts`), FastAPI endpoints, and SQLite workspace lifecycle.
- **Flat Backend Pipelines**: Added `backend/pipelines/retopo.py`, `smart_uv.py`, `segment.py`, and `mesh_utils.py` with density safety capping (`mesh_guard.py`). Retopo supports QuadriFlow & Trimesh decimation; UV supports Blender Smart Project & XAtlas; Segment supports connected components and spatial PCA clustering with vivid viewport colorization.
- **FastAPI SSE Streaming**: Replaced rebuilding placeholders at `/api/v1/mesh-tools/auto-retopo`, `/auto-uv`, and `/segment` with real-time SSE progress streaming and operation registration.
- **Workspace Preview & Action Bar Lifecycle**: Staged outputs in `storage/temp/<operation_id>/`, served via `/api/v1/workspace/operations/{operation_id}/preview`. Keep persists an immutable workspace asset version; Discard purges temp preview and restores viewer baseline.

## 2026-11-15 — Canonical Workspace API Consolidation

- **Unified generation:** Existing image-to-mesh handler is exposed at `POST /api/v1/generate`; model registration selects the raw or textured-only scheduler feature. SQLite operation type follows the selected feature.
- **Unified painting:** Existing image/text mesh-painting handlers are reused behind `POST /api/v1/texture`; image-guided and prompt-only requests remain supported.
- **Specialist routes:** Existing retopo, UV, rigging, motion, and segmentation handlers are mounted at `/retopo`, `/unwrap`, `/rig`, `/motion`, and `/segment`.
- **Removed dead routes:** Retired mesh-editing router, imports, frontend callback and request types are removed. No legacy endpoint aliases or redirects are mounted.
- **Frontend and contracts:** API client, WorkspaceContext, request builders, mesh-processing bridge, proxy verification, API docs, architecture, design docs, README and regression tests use canonical endpoints.

