# Architecture Decisions — ForMesh 3D

> **Version**: 0.7.0
> **Last Updated**: November 20, 2026
> **Retention Policy**: Keep only the last 3 active Architectural Decision Records (ADRs) to preserve lean context.

---

## ADR-108: TriFlow Neural Quad-Dominant Retopology Integration & Dynamic Face Budget Conditioning (2026-11-20)

**Context:** The existing neural retopology option (FastMesh V1K) had a fixed ~1K output resolution, disabling target polygon budget selection and quad/tri control in AI mode. Users required dynamic retopology supporting large reduction ratios (e.g. 700k poly input to 50k faces) with artist-like quad flow loops, crease preservation, and watertight healing.

**Decision:**
1. **TriFlow Model Adapter (`backend/adapters/triflow_adapter.py`)**: Subclassed `BaseModel` under model ID `triflow_retopology` (10GB VRAM profile). It encodes input mesh SDFs to sparse voxel latents, samples Nearest-Vertex Vector Fields (NVF) with Latent Flow Matching conditioned on target face count, and extracts final meshes via watershed clustering and constrained QEM decimation (`pyfqmr_triflow`).
2. **Model Registry & Routing**: Registered in `backend/config/models.yaml`, `model_factory.py`, and updated `backend/api/routers/mesh_retopology.py` to route dynamic parameters (`target_polycount`, `quad_ratio`, `preserve_features`, `watertight`).
3. **Weight Automation**: Added `download_triflow()` to `backend/scripts/download_models.sh` (fetching from HuggingFace `lihcxr/TriFlow`) and added Option `[19]` to `manager.sh`.
4. **Studio UI Unlock (`RemeshPanel.tsx`)**: Unlocked Target Face Budget slider (5,000 to 200,000) and presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`) in AI mode, enabling seamless switching between neural quad flow and script-based QuadriFlow/Trimesh.

**Consequences:** Full end-to-end support for custom polygon budgets on AI retopology, zero regressions on modern GPUs (`sm >= 80`), clean process-level adapter isolation, and immediate visual feedback in the studio.

---

## ADR-107: 100% Server-Side Remote 3D WebRTC/WebSocket Streaming & Removal of Client Mesh Loaders (2026-11-20)

**Context:** Heavy 3D meshes (80MB–150MB GLB files) took 15–30 minutes to download over slow client internet before local Three.js could render them, choking client network bandwidth and crashing low-memory client devices. Furthermore, client-side Three.js parsing was running in the background even when previewing models.

**Decision:**
1. **100% Pure Cloud Viewport**: Eliminate all client-side mesh download loops (`loadGLBWithProgress`, `sharedGLTFLoader.parse`) and remove dual-mode switching from `ViewportToolOverlay.tsx`. Viewport runs exclusively on Cloud Streaming.
2. **Headless Offscreen Renderer (`backend/streaming/renderer.py`)**: Server GPU/worker loads the mesh offscreen, calculates geometry statistics (vertices, triangles, dimensions), and executes dynamic camera matrices (orbit, pan, zoom, presets, shading, wireframe) with adaptive FPS and idle power-saving.
3. **WebRTC & WebSocket Streaming Architecture (`backend/streaming/webrtc_streamer.py`, `backend/api/routers/streaming.py`)**: Deliver real-time video via WebRTC VideoTrack (aiortc) with transparent, multiplexed WebSocket fallback channel (binary frame push + JSON input) ensuring 100% compatibility across all network topographies and proxy environments.
4. **Server-Side Stats Delivery**: Mesh statistics are returned directly in the `/api/v1/stream/session/start` response, populating the Inspector tab instantly without downloading mesh geometry.

**Consequences:** Network footprint drops from a 100MB upfront download to lightweight ~22KB frames (<200KB/s), achieving instant (<1s) viewport inspection on any device.

---

## ADR-106: Direct-Save Workspace Architecture, Elimination of Temp Staging, & SkinTokens/PartUV Integration (2026-11-19)

**Context:** Workspace tool operations (Retopo, UV, Segment, Rigging) formerly staged outputs in `storage/temp/<op_id>/`, requiring modal Keep/Discard confirmation via `OperationActionBar.tsx`. Users requested eliminating temporary staging, writing operations directly into the active workspace under monotonic versioning (`<ws_id>_<tool>_v00X.glb`), removing Keep/Discard endpoints, and fully connecting neural models (SkinTokens for Auto-Rigging and PartUV for Smart UV).

**Decision:**
1. **Direct Disk Publication**: All operations write outputs directly into `storage/<workspace_id>/<tool_type>/` via `WorkspaceStorageManager.publish_derived_mesh`, maintaining monotonic versions (`_v001`, `_v002`, ...). The master active mesh is never overwritten.
2. **Immediate Promotion & SQLite Record**: Automatically register each run as a durable `AssetModel` row with `settings_snapshot` and promote it to `active_mesh_asset_id` in SQLite.
3. **Complete Section C Removal**: Deleted `OperationActionBar.tsx`, removed `/workspace/operations/{op_id}/keep`, `/discard`, `/preview` endpoints, and decoupled frontend states from blocking `persistenceState: 'not_saved'`.
4. **SkinTokens Neural Auto-Rigging Wiring**: Connected `RiggingPanel.tsx` to the `skintokens_auto_rigging` AI model (14GB VRAM) with `EngineModeSelector` (`tool="rig"`), neural sampling controls (`temperature`, `top_k`, `num_beams`, `use_transfer`, `use_postprocess`), and backend job scheduling.
5. **PartUV Neural UV Integration**: Wired `UVPanel.tsx` in AI mode to PartUV with Blender UV packing and runtime import shims.

**Consequences:** Eliminates modal preview blocking, guarantees atomic versioned persistence on disk, preserves complete parameter history across iterations, and enables seamless switching between historical asset versions in the UI.
