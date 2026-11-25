# Tasks — General Studio, Export & API Bug Audit

> **Audit date:** 2026-11-25 | **Status:** Fixed high-impact items & pushed to `dev`

## Fixed in Working Tree
| # | Severity | Location | Fix Applied |
|---|---:|---|---|
| 1 | 9/10 | `backend/api/routers/motion_generation.py:106-120` | Pass `operation_id=generate_operation_id()` & unpack `(op_row, _)` |
| 2 | 9/10 | `backend/api/routers/system.py:1779,2328-2375` | Strip `preview_` & resolve `op_*` + `mesh/mesh_thumb.png` in download/thumbnail |
| 3 | 8/10 | `patcher/triposr/mcubes_fallback.py`, `triposr_adapter.py` | TripoSR-only `skimage.measure.marching_cubes` fallback when `libcudart.so.11.0` missing |
| 4 | 8/10 | `RightAssetsPanel.tsx`, `WorkspaceContext.tsx:1794` | Strict workspace scoping, unclipped/visible 3-dot & delete buttons, `404` delete tolerance |
| 3 | 8/10 | `backend/api/routers/file_upload.py:1265-1277` | Allow `thumbnail_path is None` in `delete_file` (fixes HTTP 500 on `ast_*`/images) |
| 4 | 8/10 | `backend/api/routers/database.py:539-541` | Preserve `uploads/` directory in `clear_all_jobs` |
| 5 | 8/10 | `features/workspace/utils/clientExporters.ts:9-45` | Strip `__rigging_skeleton_helper`, `__isSeamLine`, debug materials & explode offsets |
| 6 | 7/10 | `features/workspace/Panels/RemeshPanel.tsx:292,630,1003` | Default `inputTab` to `'mesh'`, remove duplicate `meshInputRef`, guard CTA |
| 7 | 6/10 | `backend/api/routers/mesh_uv_unwrapping.py:265-289` | Forward `atlas_resolution`, `island_margin`, `unwrap_strategy`, `max_cone_deg` |
| 8 | 6/10 | `features/workspace/Panels/GeneratePanel.tsx:528,623` | Functional `setImageUploadProgress` updater; clear `imageFileId` on remove |
| 9 | 6/10 | `features/workspace/lib/artifactDownload.ts:8-16` | Allow `application/json` (GLTF) and `text/plain` (ASCII STL/PLY) |
| 10 | 5/10 | `RightAssetsPanel.tsx:301`, `RightPropertyPanel.tsx:446,517,766` | Replace `overflow-hidden` with `overflow-y-auto` |

## Remaining Backlog (Not Yet Fixed)
- `7/10` `TexturePanel.tsx` / `buildTextureGenerationParameters.ts` / `WorkspaceContext.tsx`: Forward PBR/style/dilation/seed controls to `POST /api/v1/texture`.
- `8/10` `MeshViewer.tsx` / `clientExporters.ts`: Undo viewport normalization scale/grounding offset on client export; `ExportModal.tsx` ZIP/LOD/FBX format handling.
- `7/10` `system.py` / `file_upload.py`: On-demand multi-format conversion (`obj`/`stl`/`ply`/`gltf`) & `lod0`–`collision` key handling.
- `5/10` `useMeshAssetUpload.ts` callers, `RightPropertyPanel.tsx` (`materialConfig` sync), `mesh_generation.py` (paint `workspace_id`/`operation_id`).
