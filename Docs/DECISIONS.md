# Architecture Decisions — ForMesh 3D

> **Version**: 0.5.0
> **Last Updated**: November 19, 2026
> **Retention Policy**: Keep only the last 3 active Architectural Decision Records (ADRs) to preserve lean context.

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

---

## ADR-105: Script Engine End-to-End Execution for Retopo, Smart UV, and Segment (2026-11-16)

**Context:** The UI studio supported switching between Neural AI and Script engines, but mesh-tools endpoints returned placeholder service rebuilding events. Furthermore, in-memory object URLs bypassed durable SQLite operation identity.

**Decision:**
1. **Flat Backend Pipeline Architecture**: Added `backend/pipelines/retopo.py`, `smart_uv.py`, `segment.py`, and cohesive `mesh_utils.py` with density safety capping through `mesh_guard.py`.
2. **Deterministic Algorithm Execution**:
   - Retopo uses headless Blender QuadriFlow for quad topology and Trimesh quadric decimation for fast isotropic remeshing.
   - Smart UV uses Blender Smart Project for dihedral angle-based unwrapping and XAtlas / Trimesh for chart packing.
   - Segment uses Trimesh connected-component decomposition and spatial PCA clustering with vivid viewport colorization.
3. **Durable Script Operation Lifecycle**: Every script operation registers in SQLite FIFO queue (`enqueue_operation`, `update_operation_execution_status`) with real-time progress and cancellation support.

**Consequences:** Complete end-to-end integration with truthful geometric statistics, zero regressions on modern GPU flows, and lightweight CPU script fallbacks.

---

## ADR-104: Native Target Triangles — Post-Process Count Forcing Removed (2026-11-15)

**Context:** Part I of the Unified Master Specification prohibits using subdivision, decimation, simplification, remeshing, or retopology after raw generation to force a mesh toward the user's requested triangle target. Five adapters were forcing triangle targets after generation.

**Decision:**
1. **Remove all post-process count forcing** from adapters — adapters return raw model-native geometry unchanged; `native_target_polycount` is preserved for honest reporting.
2. **Router preserves requested targets** for truthful requested-vs-actual triangle reporting in `/api/v1/system/jobs/{job_id}/info`.
3. **Frontend parameter simplification**: Capability registry marks models truthfully and eliminates dead decimation switches.

**Consequences:** Zero post-process topology-changing fallbacks in any adapter. Modern GPU (`sm >= 80`) native execution path preserved.
