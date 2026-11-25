# ForMesh3D Changelog

## 2026-11-25 — Asset Panel, Thumbnails, TripoSR CUDA 12 & Bug Fixes
- Scoped `RightAssetsPanel` strictly to the active workspace, unclipped the 3-dot dropdown (`overflow-hidden` moved to thumbnail), made Delete/3-dot actions clearly visible, and handled `404` gracefully in `deleteAsset`.
- Fixed `download_job_thumbnail` in `system.py` to resolve `op_*` operation IDs, `preview_*` prefixes, `active_mesh_asset_id`, and `mesh/mesh_thumb.png`.
- Added `ensure_torchmcubes()` fallback in `patcher/triposr/mcubes_fallback.py` for CUDA 12 environments missing `libcudart.so.11.0`.
- Fixed `motion_generation.py`, `file_upload.py` (`delete_file`), `database.py` (`clear_all_jobs` preserving `uploads/`), `mesh_uv_unwrapping.py`, `clientExporters.ts`, `artifactDownload.ts`, `RemeshPanel.tsx`, `GeneratePanel.tsx`, and inspector scrolling.

## 2026-11-25 — TripoSR Unified Raw, Textured and Painting Modes
- Added TripoSR to image-to-raw-mesh generation with the UI texture toggle controlling the official upstream bake step (`backend/thirdparty/TripoSR`).

## 2026-11-24 — Asset Library and Viewer Lifecycle Reliability
- Connected selection requests to actual Three.js load completion/failure, made deletion ownership-aware, fixed strict workspace filtering, and stabilized PartField merge-tree labels.
