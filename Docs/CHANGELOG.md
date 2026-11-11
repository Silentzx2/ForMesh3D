# ForMesh3D Changelog

## 2026-11-11 — Workspace Routing, Friendly Job URLs & Recent Jobs Chip

- **Routing:** Bare `/workspace` now redirects to `/workspace/generate`; `/workspace/overview` and `/workspace/system` routes removed from the workspace UI (`WorkspaceShell.tsx`, `workspaceRouteContract.ts`, `WorkspaceContext.tsx`). Dashboard/assets/jobs route map simplified; `navigateToMain` points dashboard/workspace to `/workspace/generate`.
- **Friendly URLs:** Mesh/image uploads now reflect in the URL as `/workspace/generate/<name>_<hash>` (`useMeshAssetUpload.ts`, `GeneratePanel.tsx`). Generation tasks use friendly `name-hash` IDs instead of raw UUIDs (`WorkspaceContext.tsx::startTask`). Backend job UUID stored separately as `backendJobId`; URL keeps the friendly local ID.
- **Recent Jobs Chip:** New `RecentJobsChip.tsx` in top header shows live/done/failed counts with a dropdown of up to 6 recent jobs; clicking a job navigates to `/workspace/jobs/{id}` and hydrates the job into the viewport (`TopHeader.tsx`, `JobsTab.tsx` inspect link fixed to path param).
- **XYZ Gizmo fix:** Moved below header overlap (`top-3` → `top-12`) and made axis buttons clickable (`pointer-events-auto`) (`ViewportToolOverlay.tsx`).
- **Generate flow:** Removed unnecessary `resolveSmartIntent` hop; generate submits directly to `/api/v1/mesh-generation/image-to-raw-mesh` (`WorkspaceContext.tsx::generate3DModel`).
- **Upload progress:** Image upload now posts to backend with real `onProgress` bar; mesh upload no longer fakes 50% start (starts at 0%, real progress through upload).
- **AGENTS.md:** Added top project-rule notice; removed user-preferences section and table of contents; Section 3 research/search rules consolidated.
- **Tests:** `npx tsc --noEmit` passed with 0 errors. Runtime server/browser not verified in this environment.

---

## 2026-11-10 — Auto-load Mesh on Route Change, Single-Thumbnail Deduplication, Explicit Model VRAM Eviction, and TripoSG Thumbnail Generation

- **Viewport Auto-Load & Route Hydration (`WorkspaceContext.tsx`):** Added `loadCompletedJobResult` to auto-load completed meshes into `MeshViewer` directly upon job completion and route navigation (`/workspace/[tool]/[job_id]`). Connected `loadModelInViewer` and viewport reframing. Updated `bindBackendJob` to sync the browser URL with the backend job UUID via `replaceState`.
- **Thumbnail & Asset Deduplication (`WorkspaceContext.tsx`, `system.py`, `file_upload.py`):** Resolved duplicate thumbnails for generated meshes by excluding internal `job-*` and job UUID entries from `/api/v1/file-upload/list` and deduplicating assets by job UUID across local, upload, and history sources.
- **On-Demand Mesh Thumbnail Generation & Storage Download (`system.py`, `file_upload.py`):** Enhanced `get_job_status` and `download_job_thumbnail` to auto-render missing thumbnails from raw meshes (e.g. TripoSG output) using `generate_mesh_thumbnail`. Allowed storage-based mesh access in `file_upload.py` without 404 errors.
- **Explicit Candidate VRAM Eviction (`planner.py`, `multiprocess_scheduler.py`):** When a user explicitly chooses a model whose VRAM budget is tight due to another model resident on the GPU, marked candidate for eviction and proactively freed LRU workers rather than aborting.
- **Model Selector Parity (`models.yaml`, `GeneratePanel.tsx`, `TexturePanel.tsx`):** Disabled non-functional pipelines (`trellis2*`, `pixal3d*`, `taoflowforge*`, `unique3d*`) and strictly enforced local weight availability before permitting model selection.
- **Tests:** `bun x tsc --noEmit` passed with 0 errors; `bun test` passed (8 pass, 0 fail); `backend/tests/test_mesh_tools_verification.py` passed (4 pass, 3 skipped).
