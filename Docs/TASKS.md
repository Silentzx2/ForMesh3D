# Tasks — Completed Studio Fixes & Backlog

> **Audit date:** 2026-11-25 | **Status:** Pushed to `dev`

## Completed
| Area | Summary |
|---|---|
| **Viewport Compare** | Straight-vertical hardware `setScissorTest` wipe, bottom `Before`/`After` labels, rotation + `OrbitControls` sync |
| **Wireframe & Stats** | 2-mode Wireframe cycle (`overlay` solid-surface vs `xray` internal) + top-right Mesh Stats (`Faces`/`Verts`) |
| **Segment & Rigging** | Cloned preview materials in `RealModelPreviewCanvas` (fixes permanent blue mesh) + in-place X-Ray bone toggle |
| **Asset Panel** | Deduplicated base meshes only, removed category filter & workspace pill, fixed 3-dot/Delete placement |
| **TriFlow & Backend** | `_pair_triangles_to_quads()` + quad `.obj` output (`poly_type="quad"`), `download_job_thumbnail` `op_*` fix |
| **UI Tokens & Dropdowns** | Replaced hardcoded panel hexes with `globals.css` tokens; removed model dropdown truncation |

## Remaining Backlog
- Forwarding `TexturePanel` PBR/style/dilation/seed controls to `POST /api/v1/texture`.
- Undoing `MeshViewer` viewport normalization scale/grounding offset on client export + `ExportModal.tsx` ZIP/LOD/FBX handling.
- Backend on-demand multi-format conversion (`obj`/`stl`/`ply`/`gltf`) & `lod0`–`collision` key handling.
