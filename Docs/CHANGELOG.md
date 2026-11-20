# ForMesh3D Changelog

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

## 2026-11-20 — TriFlow Neural Quad-Dominant Retopology Model Integration
- **TriFlow Model Adapter (`backend/adapters/triflow_adapter.py`)**: Subclassed `BaseModel` (`triflow_retopology`) with 10GB VRAM profile. Encodes mesh Signed Distance Field (SDF) to voxel latents, samples Nearest-Vertex Vector Fields via Latent Flow Matching, and executes constrained QEM edge collapse simplification via `pyfqmr_triflow`.
- **Dynamic Face Budget & Quad Control**: Added full support for target polygon counts (5,000 to 200,000 faces, including 700k -> 50k decimation), quad ratio (`0.0` to `1.0`), feature edge retention (`qem_threshold`), and watertight SDF hole-filling.
- **Model Registry & Download Automation**: Registered `triflow_retopology` in `backend/config/models.yaml` and `model_factory.py`. Added `download_triflow()` to `backend/scripts/download_models.sh` (fetching from HuggingFace `lihcxr/TriFlow`) and added Option `[19]` to `manager.sh`.
- **Frontend Studio Integration (`RemeshPanel.tsx`)**: Unlocked Target Face Budget slider and presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`) in AI mode, wired `features/workspace/services/meshProcessingBridge.ts` and `WorkspaceContext.tsx` to dispatch `triflow_retopology`.

## 2026-11-20 — 100% Server-Side Remote 3D Streaming Engine & PartUV Checkpoint Resolution
- **100% Server-Side 3D Streaming Engine**: Implemented offscreen rendering engine (`backend/streaming/renderer.py`) and WebRTC / WebSocket streaming server (`backend/streaming/webrtc_streamer.py`, `backend/api/routers/streaming.py`) with dynamic camera controls (orbit, pan, zoom, presets, shading modes, wireframe, idle power-saving).
- **Client Mesh Loader Removal**: Completely removed client-side mesh download loop (`loadGLBWithProgress`, `sharedGLTFLoader.parse`) and dual-mode toggle from `MeshViewer.tsx` and `ViewportToolOverlay.tsx`. Viewport runs 100% on Cloud Streaming, dropping network bandwidth from 100MB download to lightweight ~22KB frames (<200KB/s) and achieving instant (<1s) inspection.
- **Server-Side Mesh Metadata**: Added automatic geometry statistics calculation (vertex count, triangle count, dimensions) in `HeadlessRenderer` returned during `/session/start`, allowing inspector tabs to populate with zero client-side mesh parsing.
- **PartUV Checkpoint Path Resolution**: Fixed PartUV inference crash (`FileNotFoundError: model_objaverse.ckpt`) by setting `PARTUV_CHECKPOINT_PATH` env var in `partuv_adapter.py`, resolving absolute paths in `preprocess.py` and `run_PF.py`, and adding auto-download fallback via `huggingface_hub`.
