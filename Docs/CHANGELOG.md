# ForMesh3D Changelog

## 2026-11-21 — Workspace Viewport Idle-Render & Bundle Optimization
- **Main Three.js viewport**: Replaced the unconditional RAF loop with invalidation-based rendering. OrbitControls damping, animated model mixers, and the optional turntable continue scheduling frames only while active; model, camera, lighting, shading, grid, comparison, resize, and snapshot updates explicitly invalidate the frame.
- **Inspector preview**: Removed its unconditional RAF loop; renders on interaction, damping, resize, model rebuild, or preview-setting changes.
- **Viewport mutation invalidation**: Inspector and property-panel updates dispatch a shared invalidation event so in-place mesh visibility, UV/material, transform, and rig-pose changes still redraw the main viewport.
- **Inspector code splitting**: UV, segmentation, animation, and rigging inspector modules now load only when their matching tool is selected.
- **Zustand subscriptions**: Replaced whole viewer/app-store subscriptions with focused selectors for the shading action, batch queue, and auto-rotate preference.
- **Validation**: GitHub Actions frontend type-check, contract tests, and production build run on this commit. Browser/GPU profiling remains a manual follow-up; no FPS/CPU gain is claimed without measurement.

## 2026-11-21 — Streaming Engine Removed, Local-Only Mesh Viewer Restored
- **Streaming engine deleted**: `backend/api/routers/streaming.py`, `backend/streaming/` directory (renderer, stream_manager, placeholder) removed entirely
- **Router registration removed**: `streaming` import and `app.include_router()` removed from `backend/api/main_multiworker.py` and `backend/api/routers/__init__.py`
- **Frontend streaming files deleted**: `StreamVideoViewer.tsx`, `useWebSocketStream.ts` removed
- **Mesh viewer reverted to local-only**: `MeshViewer.tsx` restored to `a7b28a2a` state — `GLTFLoader` + `glbCache` + `meshStats` inline rendering
- **Deleted complex cache system**: `MeshLoader.ts`, `useMeshLoader.ts`, `MeshRenderer.ts`, `MeshRenderer.test.ts`, `MeshLoader.test.ts` removed
- **Docs updated**: `MEMORY.md` section 2 changed from server-side streaming to local viewport; `DECISIONS.md` ADR-107 marked SUPERSEDED; `TASKS.md` updated to reflect local-only approach

## 2026-11-20 — Local Mesh Loading & Rendering Optimization (GPU + CPU Fallback)
- **MeshLoader.ts** (new): URL-keyed mesh cache with LRU eviction (cap 8), refCount, AbortController. Parses GLB/OBJ/FBX/STL/PLY once via GLTFLoader/DRACO/meshopt; same URL returns cached Group instantly — no re-download/re-parse.
- **MeshRenderer.ts** (new): GPU-accelerated WebGL renderer (antialias, ACES toneMapping, PCF shadows) with automatic CPU fallback. Animation loop pauses when no model loaded. Large meshes (>1M triangles) auto-disable shadows/pixelRatio. dispose() safety on getter-only fields.
- **useMeshLoader.ts** (new): React hook load/unload state machine (idle→loading→loaded|error), mounted-ref protection, abort-on-unmount, full GPU/RAM release on unload.
- **MeshViewer.tsx**: Rewrote to integrate loader/renderer; removed 1000+ lines of dead Three.js imports/inline renderer code; local canvas shows when streaming unavailable; WebSocket stream viewer stays as fallback.
- **ViewportToolOverlay.tsx / types.ts**: Fixed `LightTone` import path and added type definition.
- Verification: `tsc --noEmit` 0 errors; eslint 0 errors.
