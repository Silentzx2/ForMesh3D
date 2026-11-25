# ForMesh3D Changelog

## 2026-11-25 — Viewport Comparison, Wireframe Modes, Asset Library & TriFlow Quads
- Replaced tilted offscreen-target comparison wipe in `MeshViewer` with straight-vertical hardware `setScissorTest`, bottom `Before`/`After` labels, tighter radius, and rotation/controls sync; cloned preview materials in `RealModelPreviewCanvas` (fixing Segment blue-mesh leak) and moved X-Ray updates in-place (fixing Rigging freeze).
- Added 2-mode Wireframe cycle (`off` -> `overlay` -> `xray`) in `WorkspaceContext`, `ViewportToolOverlay`, and `MeshViewer`, plus a compact top-right Mesh Stats card (`Faces` / `Verts`).
- Scoped `RightAssetsPanel` to deduplicated base meshes only (removing category filter & workspace pill), added `_pair_triangles_to_quads()` + quad `.obj` export in `triflow_adapter.py`, and fixed `op.workspace_id` in `download_job_thumbnail`.

## 2026-11-25 — UI Token Consistency, Dropdowns & Contrast
- Replaced hardcoded panel hex literals across all 8 workspace panels with semantic `app/globals.css` tokens (`--surface-0..2`, `--primary`), fixed model dropdown truncation, and upgraded `text-zinc-500` labels.

## 2026-11-25 — Asset Panel, Thumbnails, TripoSR CUDA 12 & Bug Fixes
- Fixed `RightAssetsPanel` 3-dot/Delete placement, `download_job_thumbnail`, `ensure_torchmcubes()` CUDA 12 fallback, `motion_generation.py`, `file_upload.py`, `database.py`, `mesh_uv_unwrapping.py`, `clientExporters.ts`, and `artifactDownload.ts`.
