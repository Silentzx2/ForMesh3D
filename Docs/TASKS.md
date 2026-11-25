# Tasks — Completed Audit & Optimization Record

> **Date:** 2026-11-25 | **Scope:** Personal single-user studio (`dev` branch)

## 1. Implicit State Machines (Fixed)
- **Workspace execution:** `WorkspaceContext.tsx` derives `isExecuting` from `executionStatus`.
- **Viewport load:** `MeshViewer.tsx` unifies `modelLoadStatus`, `hasModel`, and `loadError` into atomic `loadState`.
- **Export & cleanup:** `RightPropertyPanel.tsx` uses `exportState` + tracked timer; `OutputsPage.tsx` uses `cleanupState`.
- **Panels:** `AnimationPanel.tsx` and `RiggingPanel.tsx` guard `isExecuting` / `isMeshUploading` and reset in `finally`.
- **Backend lifecycle:** Guarded `BaseModel.process()`, `JobRequest.mark_*()`, `RedisJobQueue._normalize_status()`, `MultiprocessScheduler._lifecycle_state`, and removed direct `self.status` mutations from adapters.

## 2. Rigging, UV & Segmentation Fixes
- **Rigging:** Added `THREE.SkeletonHelper` in main viewport (`DynamicRiggingInspector.tsx`), removed fake `54` fallback bone count, reset pose on model switch, removed duplicate `meshInputRef`.
- **UV:** Removed `uv-checker` force-override in `MeshViewer.tsx`, unified checker toggle to shared `shadingMode` (eliminating `CanvasTexture` leak), disposed seam geometries, removed `[1%, 99%]` coverage clamp, gated `UVPanel.tsx` on mesh + upload state.
- **Segmentation:** Fixed `parseInt(match[1], 10) - 1` hover radix bug, prevented `OrbitControls` drag from firing `onClick`, removed fake fallback parts, made hierarchy scrollable, added **Explode Parts** slider + **Isolate** button.
- **Downloader:** Fixed `download_triposr()` in `backend/scripts/download_models.sh` to pass `config.yaml model.ckpt` positionally.

## 3. UI Performance Optimizations
- Added `.cv-card` and `.cv-row` (`content-visibility: auto` + `contain-intrinsic-size`) in `app/globals.css` for `OutputsPage.tsx` and `JobDetailView.tsx`.
- Throttled `RealModelPreviewCanvas.tsx` pointer raycasting with `requestAnimationFrame` and reused `Raycaster` / `Vector2`.
- Replaced `WorkspaceShell.tsx` raw `resize` listener with `window.matchMedia('(min-width: 768px)')`.
