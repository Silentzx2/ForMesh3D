# ForMesh3D Changelog

## 2026-11-25 — UI Token Consistency, Dropdowns & Contrast
- Replaced hardcoded panel hex literals (`#12131d`, `#0f1019`, `#141524`, `#1c1d2c`, `#161726`, `#F9CF00`, `#ffdb29`) across all 8 workspace panels with semantic `app/globals.css` tokens (`--surface-0..2`, `--primary`).
- Fixed truncated model names in `GeneratePanel` and `TexturePanel` dropdowns (stacked labels cleanly without `truncate`), widened `TopHeader` and `RightAssetsPanel` menus, and upgraded `text-zinc-500` labels to `text-zinc-400`.

## 2026-11-25 — Asset Panel, Thumbnails, TripoSR CUDA 12 & Bug Fixes
- Scoped `RightAssetsPanel` strictly to the active workspace, unclipped the 3-dot dropdown, made Delete/3-dot actions clearly visible, and handled `404` gracefully in `deleteAsset`.
- Fixed `download_job_thumbnail` (`op_*` + `mesh/mesh_thumb.png`), `ensure_torchmcubes()` CUDA 12 fallback, `motion_generation.py`, `file_upload.py`, `database.py`, `mesh_uv_unwrapping.py`, `clientExporters.ts`, `artifactDownload.ts`, `RemeshPanel.tsx`, and `GeneratePanel.tsx`.

## 2026-11-25 — TripoSR Unified Raw, Textured and Painting Modes
- Added TripoSR to image-to-raw-mesh generation with the UI texture toggle controlling the official upstream bake step (`backend/thirdparty/TripoSR`).
