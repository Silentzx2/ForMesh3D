# ForMesh3D Changelog

## 2026-11-25 — State Machines, Tool Fixes & UI Performance
- Unified implicit state machines across `WorkspaceContext`, `MeshViewer`, `RightPropertyPanel`, `OutputsPage`, `AnimationPanel`, `RiggingPanel`, `BaseModel.process()`, `JobRequest`, `RedisJobQueue`, and `MultiprocessScheduler`.
- Fixed Rigging (`SkeletonHelper` overlay, real `0` unrigged bone count, pose reset), UV (shared `shadingMode` checker, seam disposal, mesh-only guard), Segmentation (`parseInt` radix `10`, drag-vs-click guard, scrollable hierarchy, **Explode Parts** + **Isolate**), and `download_triposr()` in `backend/scripts/download_models.sh`.
- Optimized UI rendering with `content-visibility: auto` (`.cv-card`, `.cv-row`), rAF-throttled raycasting in `RealModelPreviewCanvas`, and `matchMedia` in `WorkspaceShell`.

## 2026-11-25 — TripoSR Unified Raw, Textured and Painting Modes
- Added TripoSR to image-to-raw-mesh generation with the UI texture toggle controlling the official upstream bake step (`backend/thirdparty/TripoSR`).
- Texture OFF runs official mesh extraction only; Texture ON bakes a base-color atlas; Texture Painting paints an existing user mesh from a reference image.

## 2026-11-24 — Asset Library and Viewer Lifecycle Reliability
- Connected selection requests to actual Three.js load completion/failure, made deletion ownership-aware, fixed strict workspace filtering, and stabilized PartField merge-tree labels.
