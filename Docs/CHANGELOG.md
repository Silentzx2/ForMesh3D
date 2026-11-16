# ForMash3D Changelog

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

## 2026-11-15 — Native High-Res Engine, 1M Gen Limit, 2M Upload Ceiling & 60 FPS Viewport

- **Mesh Density Limits & Guard Pipeline (`backend/pipelines/mesh_guard.py`)**: Centralized mesh safety handling into `backend/pipelines/mesh_guard.py` (`guard_mesh_density`). AI generation enforces a 1,000k (1M faces) safety cap, preserving raw AI meshes <= 1M faces untouched. User mesh upload allows up to 2,000k (2M faces); meshes exceeding 2M faces are strictly rejected with an explicit 400 validation error in `backend/core/utils/file_utils.py` and `file_upload.py`.
- **Generate Panel UI Simplification**: Removed Target Triangles slider and dynamic floating portal flyout from `GeneratePanel.tsx`. Real functional switches (Remove Lighting, PBR Materials) moved directly inline in the main panel; replaced raw emoji with Lucide `Dices`.
- **Three.js Viewport 60+ FPS Optimization for 2M Triangles (`MeshViewer.tsx`)**: Optimized for ultra-dense meshes up to 2,000,000 triangles: high-performance power preference, 1.5 clamped DPR, keylight shadow map tuned to 1024x1024, shadow-map rasterization bypass for meshes > 800k triangles, static matrix auto-update disabling, and pre-cached unlit wireframe materials with deep 10-slot texture disposal.
- **Verification**: All 55 bun tests pass; all Python unit tests pass; no GPU regressions.

