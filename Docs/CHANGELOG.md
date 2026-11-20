# ForMesh3D Changelog

## 2026-11-20 — Local Mesh Loading & Rendering Optimization (GPU + CPU Fallback)
- **MeshLoader.ts** (new): URL-keyed mesh cache with LRU eviction (cap 8), refCount, AbortController. Parses GLB/OBJ/FBX/STL/PLY once via GLTFLoader/DRACO/meshopt; same URL returns cached Group instantly — no re-download/re-parse.
- **MeshRenderer.ts** (new): GPU-accelerated WebGL renderer (antialias, ACES toneMapping, PCF shadows) with automatic CPU fallback. Animation loop pauses when no model loaded. Large meshes (>1M triangles) auto-disable shadows/pixelRatio. dispose() safety on getter-only fields.
- **useMeshLoader.ts** (new): React hook load/unload state machine (idle→loading→loaded|error), mounted-ref protection, abort-on-unmount, full GPU/RAM release on unload.
- **MeshViewer.tsx**: Rewrote to integrate loader/renderer; removed 1000+ lines of dead Three.js imports/inline renderer code; local canvas shows when streaming unavailable; WebSocket stream viewer stays as fallback.
- **ViewportToolOverlay.tsx / types.ts**: Fixed `LightTone` import path and added type definition.
- Verification: `tsc --noEmit` 0 errors; eslint 0 errors.

## 2026-11-20 — WebRTC Stream Infinite Reconnect Loop Fix & Backend Import Parity
- **WebRTC Stream Hook Response Unwrapping & Loop Prevention (`features/workspace/hooks/useWebRTCStream.ts`)**: Fixed `sessionData` unwrapping from `api.post` (which already returns unwrapped response body), eliminating `Cannot read properties of undefined (reading 'session_id')`. Removed cyclic `connectionState`, `shadingMode`, and `showWireframe` dependencies from `connect` callback to stop infinite `POST /api/v1/stream/session/start` request loops, and added `isConnectingRef` concurrency mutex.
- **Streaming Router Resilient Imports (`backend/api/routers/streaming.py`)**: Added fallback import logic for `streaming` vs `backend.streaming` to prevent `ModuleNotFoundError: No module named 'backend'` during uvicorn worker router resolution when `cwd` is `backend/`.
- **Server Startup PYTHONPATH Parity (`backend/scripts/run_server.sh`)**: Exported both `PROJECT_ROOT` and `BACKEND_DIR` into `PYTHONPATH`, guaranteeing consistent resolution for all `from backend.` and `from api.` imports across uvicorn multi-workers and standalone schedulers.

## 2026-11-20 — NVIDIA PartField Neural Mesh Segmentation & Viewport/Inspector Lag Elimination
- **PartField Model Adapter (`backend/adapters/partfield_adapter.py`)**: Subclassed `BaseModel` (`partfield_segmentation`) with 8GB VRAM profile. Computes continuous 3D surface feature fields with PVCNN/PointNet++ backbone, constructs sparse face adjacency connectivity matrices, and executes hierarchical Agglomerative clustering (or KMeans) with topological fallback.
- **Model Registry & Download Automation**: Registered `partfield_segmentation` under `mesh_segmentation` in `backend/config/models.yaml` and `model_factory.py`. Added `download_partfield()` to `backend/scripts/download_models.sh` (HuggingFace `mikaelaangel/partfield-ckpt`), added Option `[20]` to `manager.sh`, and recorded dependencies in `backend/requirements-models.txt` and `backend/scripts/install.sh`.
- **Segmentation Page Lag Elimination**: Fixed extreme main-thread device and UI freezing when opening Segmentation:
  - Eliminated continuous WebGLRenderer teardown/recreation and model cloning on every mouse move in `RealModelPreviewCanvas.tsx`.
  - Added cached `EdgesGeometry` to prevent synchronous main-thread geometry recomputation on high-poly models.
  - Memoized hover/select callbacks in `DynamicSegmentationInspector.tsx` with `useCallback` to prevent infinite render loops.
  - Fixed radix bug `parseInt(match[1], 1)` to `parseInt(match[1], 10)` in `MeshViewer.tsx`.
  - Unlocked AI Mode in `SegmentationPanel.tsx` and `EngineModeSelector.tsx` (`GPU (PartField)`).
- **Verification**: `backend/tests/test_partfield_adapter.py` 6/6 unit tests passed, `python3 -m py_compile` clean, and `npx tsc --noEmit` clean (0 errors).

## 2026-11-20 — NVIDIA PartField Neural Mesh Segmentation & Viewport/Inspector Lag Elimination