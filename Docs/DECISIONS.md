# Architecture Decisions — ForMesh 3D

> **Version**: 0.8.0
> **Last Updated**: November 20, 2026
> **Retention Policy**: Keep only the last 3 active Architectural Decision Records (ADRs) to preserve lean context.

---

## ADR-109: NVIDIA PartField Neural Mesh Segmentation & Viewport/Inspector WebGL Lifecycle Optimization (2026-11-20)

**Context:** The Studio Segmentation tool previously lacked a dedicated neural model on the backend (`mesh_segmentation: {}`), disabling AI mode in the UI. Furthermore, navigating to the Segmentation page induced severe UI and device freezing caused by `RealModelPreviewCanvas.tsx` destroying and allocating new WebGL renderers on every mouse hover, re-cloning full meshes, and synchronously recalculating `THREE.EdgesGeometry` across all submeshes on the main thread.

**Decision:**
1. **NVIDIA PartField Model Adapter (`backend/adapters/partfield_adapter.py`)**: Subclassed `BaseModel` under model ID `partfield_segmentation` (8GB VRAM profile). It computes continuous surface feature representations using a PointNet++/PVCNN backbone, constructs sparse face adjacency connectivity graphs, and clusters features into parts via Agglomerative hierarchical clustering or KMeans, backed by a pure-NumPy topological clustering fallback for lightweight test environments.
2. **Registry & Routing Wiring**: Registered in `backend/config/models.yaml`, `backend/core/scheduler/model_factory.py`, and updated `backend/api/routers/mesh_segmentation.py` with default `model_preference = "partfield_segmentation"`.
3. **Weight Automation**: Added `download_partfield()` to `backend/scripts/download_models.sh` (fetching from HuggingFace `mikaelaangel/partfield-ckpt`), registered Option `[20]` in `manager.sh`, and recorded dependencies in `backend/requirements-models.txt` and `backend/scripts/install.sh`.
4. **Main-Thread Lag Elimination**: Refactored `RealModelPreviewCanvas.tsx` to mount WebGLRenderer, Scene, Camera, and OrbitControls once; cached `EdgesGeometry` in a `WeakMap` to eliminate CPU freeze; mutated materials and visibility in-place; memoized callbacks with `useCallback` in `DynamicSegmentationInspector.tsx`; and corrected the `parseInt(match[1], 10)` radix bug in `MeshViewer.tsx`.
5. **Studio UI Unlock**: Unlocked AI Mode in `SegmentationPanel.tsx` and `EngineModeSelector.tsx` (`GPU (PartField)`).

**Consequences:** Zero-lag instantaneous navigation and part inspection on the Segmentation page, full support for neural hierarchical part decomposition, zero GPU regressions on `sm >= 80`, and clean process-isolated adapter execution.

---

## ADR-108: TriFlow Neural Quad-Dominant Retopology Integration & Dynamic Face Budget Conditioning (2026-11-20)

**Context:** The existing neural retopology option (FastMesh V1K) had a fixed ~1K output resolution, disabling target polygon budget selection and quad/tri control in AI mode. Users required dynamic retopology supporting large reduction ratios (e.g. 700k poly input to 50k faces) with artist-like quad flow loops, crease preservation, and watertight healing. FastMesh V1K was subsequently removed; TriFlow is now the sole retopology model.

**Decision:**
1. **TriFlow Model Adapter (`backend/adapters/triflow_adapter.py`)**: Subclassed `BaseModel` under model ID `triflow_retopology` (10GB VRAM profile). It encodes input mesh SDFs to sparse voxel latents, samples Nearest-Vertex Vector Fields (NVF) with Latent Flow Matching conditioned on target face count, and extracts final meshes via watershed clustering and constrained QEM decimation (`pyfqmr_triflow`).
2. **Model Registry & Routing**: Registered in `backend/config/models.yaml`, `model_factory.py`, and updated `backend/api/routers/mesh_retopology.py` to route dynamic parameters (`target_polycount`, `quad_ratio`, `preserve_features`, `watertight`).
3. **Weight Automation**: Added `download_triflow()` to `backend/scripts/download_models.sh` (fetching from HuggingFace `lihcxr/TriFlow`) and added Option `[19]` to `manager.sh`.
4. **Studio UI Unlock (`RemeshPanel.tsx`)**: Unlocked Target Face Budget slider (5,000 to 200,000) and presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`) in AI mode, enabling seamless switching between neural quad flow and script-based QuadriFlow/Trimesh.

**Consequences:** Full end-to-end support for custom polygon budgets on AI retopology, zero regressions on modern GPUs (`sm >= 80`), clean process-level adapter isolation, and immediate visual feedback in the studio.

---

## ADR-107: 100% Server-Side Remote 3D WebRTC/WebSocket Streaming & Removal of Client Mesh Loaders (2026-11-20)

> **Status: SUPERSEDED** — Streaming engine removed. Mesh viewer reverted to local GLTFLoader-based rendering (`MeshViewer.tsx`). `backend/streaming/` directory and `backend/api/routers/streaming.py` deleted.

**Context:** Heavy 3D meshes (80MB–150MB GLB files) took 15–30 minutes to download over slow client internet before local Three.js could render them, choking client network bandwidth and crashing low-memory client devices. Furthermore, client-side Three.js parsing was running in the background even when previewing models.

**Decision (original, now reversed):**
1. **100% Pure Cloud Viewport**: Eliminate all client-side mesh download loops (`loadGLBWithProgress`, `sharedGLTFLoader.parse`) and remove dual-mode switching from `ViewportToolOverlay.tsx`. Viewport runs exclusively on Cloud Streaming.
2. **Headless Offscreen Renderer (`backend/streaming/renderer.py`)**: Server GPU/worker loads the mesh offscreen, calculates geometry statistics (vertices, triangles, dimensions), and executes dynamic camera matrices (orbit, pan, zoom, presets, shading, wireframe) with adaptive FPS and idle power-saving.
3. **WebRTC & WebSocket Streaming Architecture (`backend/streaming/webrtc_streamer.py`, `backend/api/routers/streaming.py`)**: Deliver real-time video via WebRTC VideoTrack (aiortc) with transparent, multiplexed WebSocket fallback channel (binary frame push + JSON input) ensuring 100% compatibility across all network topographies and proxy environments.
4. **Server-Side Stats Delivery**: Mesh statistics are returned directly in the `/api/v1/stream/session/start` response, populating the Inspector tab instantly without downloading mesh geometry.

**Consequences (original):** Network footprint drops from a 100MB upfront download to lightweight ~22KB frames (<200KB/s), achieving instant (<1s) viewport inspection on any device.

**Current state:** Reverted to local client-side mesh loading. Mesh viewer downloads GLB via `fetch`/`glbCache`, parses with `GLTFLoader`, and renders inline in Three.js viewport. No server-side streaming.
