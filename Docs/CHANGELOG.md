# ForMash3D Changelog

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
- **Verification**: All 50 bun tests pass; all Python files pass `py_compile`; no heavy dependencies installed.

## 2026-11-15 — Native Target Triangles Part I §7 Fix & UI Component System (Batches 2-6)

- **Removed post-process count forcing** from all 5 adapters (SF3D, TripoSG, Hunyuan3D v2.1, Mini Turbo, TRELLIS) — no `mesh.subdivide()`, `fast_simplification.simplify()`, or `simplify_quadric_decimation()` forces mesh count toward requested target after generation.
- **Router preserves `native_target_polycount`** for honest requested-vs-actual triangle reporting; no longer zeroed when postprocess disabled.
- **All models classified `UNSUPPORTED`** — none pass `native_target_polycount` to upstream generation (evidence-backed per Part I §4 research gate).
- **Unified identity & save/preview lifecycle**: Keep/Discard endpoints, route reservation only after successful Keep, identity matching same image+same model.
- **Explicit mesh selection state machine** (`idle|selecting|verifying|loading|ready|error`) with `selectionRequestId` stale-response guard; `failAssetLoad` keeps last valid mesh visible.
- **New UI components** (`features/workspace/components/`): `GlowButton.tsx` (5 variants, layout-stable), `JobProgressBar.tsx` (determinate 0-100%), `JobProgressStage.tsx` (label chip + status icon).
- **All Python files pass `py_compile`**; no GPU path changes (Priority Rule 1 preserved).

