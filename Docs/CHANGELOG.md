# ForMesh3D Changelog

## 2026-11-10 — Auto-load Mesh on Route Change, Single-Thumbnail Deduplication, Explicit Model VRAM Eviction, and TripoSG Thumbnail Generation

- **Viewport Auto-Load & Route Hydration (`WorkspaceContext.tsx`):** Added `loadCompletedJobResult` to auto-load completed meshes into `MeshViewer` directly upon job completion and route navigation (`/workspace/[tool]/[job_id]`). Connected `loadModelInViewer` and viewport reframing. Updated `bindBackendJob` to sync the browser URL with the backend job UUID via `replaceState`.
- **Thumbnail & Asset Deduplication (`WorkspaceContext.tsx`, `system.py`, `file_upload.py`):** Resolved duplicate thumbnails for generated meshes by excluding internal `job-*` and job UUID entries from `/api/v1/file-upload/list` and deduplicating assets by job UUID across local, upload, and history sources.
- **On-Demand Mesh Thumbnail Generation & Storage Download (`system.py`, `file_upload.py`):** Enhanced `get_job_status` and `download_job_thumbnail` to auto-render missing thumbnails from raw meshes (e.g. TripoSG output) using `generate_mesh_thumbnail`. Allowed storage-based mesh access in `file_upload.py` without 404 errors.
- **Explicit Candidate VRAM Eviction (`planner.py`, `multiprocess_scheduler.py`):** When a user explicitly chooses a model whose VRAM budget is tight due to another model resident on the GPU, marked candidate for eviction and proactively freed LRU workers rather than aborting.
- **Model Selector Parity (`models.yaml`, `GeneratePanel.tsx`, `TexturePanel.tsx`):** Disabled non-functional pipelines (`trellis2*`, `pixal3d*`, `taoflowforge*`, `unique3d*`) and strictly enforced local weight availability before permitting model selection.
- **Tests:** `bun x tsc --noEmit` passed with 0 errors; `bun test` passed (8 pass, 0 fail); `backend/tests/test_mesh_tools_verification.py` passed (4 pass, 3 skipped).

---

## 2026-11-10 — Batch 3: UV Limits, Ray-Cast Baking, Feature Snapping, and UV Checker

- **UV & Baking:** Removed proxy-transfer cKDTree in `uv_backend_resolver.py`, moved `max_safe_triangles` (100K) to `quality.yaml`, and tuned xatlas options. In `bake.py`, replaced nearest KD with inward ray casting (`sample_high_normals`) and barycentric normal interpolation; removed fake white AO image and corrected raster/sample half-pixel alignment.
- **Retopology & Quality Gate:** Implemented sharp crease snapping (`snap_to_features`) in `autoretopo/pipeline.py` after projection; defaulted `watertight=False` on closed meshes. Replaced $O(N \times M)$ matrix in `_compute_feature_edge_retention` with KD-tree edge midpoints; added `crispness` metric in `gate.py`. In `segment.py`, added majority-vote label smoothing over face adjacency.
- **UI Integrity & Viewport:** Defaulted `SegmentationPanel` to Script mode with honest disabled state for AI mode. Added 3D procedural UV checkerboard inspection mode in `MeshViewer.tsx`, `ViewportToolOverlay.tsx`, and `UVPanel.tsx`. Cleaned hardcoded defaults from `meshProcessingBridge.ts`.
- **Tests:** 26 passed, 3 skipped in backend pytest; 8 passed, 0 failed in `bun test`; 0 TypeScript errors.

---

## 2026-11-10 — Batch 1 mesh-quality completion

- **FastMesh:** removed the stale V4K frontend registry/selector path, fixed workspace AI routing to V1K, and replaced the misleading AI target-budget UI with the checkpoint-fixed approximately 1K-vertex output. Verified the normalized-coordinate export contract against the vendored upstream inference entry point; adapter telemetry now records actual output vertices.
- **Hole repair:** added a non-planar 3D ear-clipping fallback, retained edge-count safety checks, derived boundary incidence directly from triangle faces, and changed the perimeter cap to a bounding-box-diagonal fraction shared by targeted and UV-preserving repair.
- **Decimation:** routed memory-safe decimation through the existing PyMeshLab QEM implementation in one pass, enabled planarquadric for untextured meshes, and removed the slow custom Python QEM implementation.
- **Tests:** CI passed backend compileall and the Batch 1 regression suite (9 passed, 2 skipped), compute-mode resolver tests, frontend TypeScript type-check, and production build. Two optional PyMeshLab QEM integration tests were skipped because PyMeshLab is absent; FastMesh weights/GPU inference, Blender runtime, and visual mesh-quality validation were not run.
