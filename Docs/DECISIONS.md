# Architecture Decisions — ForMesh 3D

> **Version**: 0.4.0
> **Last Updated**: November 18, 2026
> **Retention Policy**: Keep only the last 3 active Architectural Decision Records (ADRs) to preserve lean context.

---

## ADR-105: Script Engine End-to-End Execution for Retopo, Smart UV, and Segment (2026-11-16)

**Context:** The UI studio supported switching between Neural AI and Script engines, but mesh-tools endpoints returned placeholder service rebuilding events. Furthermore, in-memory object URLs bypassed durable SQLite operation identity, preventing the Operation Action Bar from supporting Keep/Discard workflows.

**Decision:**
1. **Flat Backend Pipeline Architecture**: Added `backend/pipelines/retopo.py`, `smart_uv.py`, `segment.py`, and cohesive `mesh_utils.py` with density safety capping through `mesh_guard.py`.
2. **Deterministic Algorithm Execution**:
   - Retopo uses headless Blender QuadriFlow for quad topology and Trimesh quadric decimation for fast isotropic remeshing.
   - Smart UV uses Blender Smart Project for dihedral angle-based unwrapping and XAtlas / Trimesh for chart packing.
   - Segment uses Trimesh connected-component decomposition and spatial PCA clustering with vivid viewport colorization (pure numpy, zero scipy dependency).
3. **Workspace Preview & Operation Persistence**:
   - Every script operation registers in SQLite FIFO queue (`enqueue_operation`, `update_operation_execution_status`).
   - Unsaved preview meshes stage in `storage/temp/<operation_id>/` and stream via `/api/v1/workspace/operations/{operation_id}/preview`.
   - Keep commits the preview into an immutable workspace asset; Discard cleans the temporary directory and restores viewer baseline.

**Consequences:** Complete end-to-end integration with truthful geometric statistics, zero regressions on modern GPU flows, and full Operation Action Bar support.

**Superseding clarification (2026-11-18):** The legacy `backend/api/routers/mesh_tools.py` router and its `/api/v1/mesh-tools/*` endpoint surface are retired. The flat pipelines and their dedicated canonical routes remain active; the old router description in ADR-104/105-era history is not current implementation guidance.

**Implementation status correction (2026-11-19):** The end-to-end behavior described above was a target decision, not the verified state of the live branch at the start of this implementation. The canonical routes now carry the `engine` discriminator; Script requests call the flat pipelines directly, register SQLite operation state, and expose the existing preview / Keep / Discard lifecycle. AI remains the default and retains scheduler execution. GitHub Actions results are the verification source for this change.

---

## ADR-104: Native Target Triangles — Post-Process Count Forcing Removed (2026-11-15)

**Context:** Part I of the Unified Master Specification (Docs/TASKS.md) prohibits using subdivision, decimation, simplification, remeshing, or retopology after raw generation to force a mesh toward the user's requested triangle target. Five adapters (SF3D, TripoSG, Hunyuan3D v2.1, Mini Turbo, TRELLIS) were calling `mesh.subdivide()`, `fast_simplification.simplify()`, or `simplify_quadric_decimation()` to match `native_target_polycount` after generation. Additionally, the router zeroed `native_target_polycount` when `enable_postprocess=false`, hiding the requested value from honest reporting.

**Decision:**
1. **Remove all post-process count forcing** from the 5 adapters — adapters now return raw model-native geometry unchanged; `native_target_polycount` is informational only (logged/preserved in `generation_info`).
2. **Router no longer zeroes `native_target_polycount`** when `enable_postprocess=false` — the value is preserved for honest requested-vs-actual triangle reporting in `/api/v1/system/jobs/{job_id}/info`.
3. **All models classified `UNSUPPORTED`** — verified none pass `native_target_polycount` to upstream generation. TRELLIS.2, Unique3D, Pixal3D, TaoFlowForge log only; Hunyuan3D v2.1/Mini Turbo use hardcoded `octree_resolution` (indirect resolution control only); SF3D `vertex_count` ignored when `remesh_option="none"` (default).
4. **Frontend `buildGenerationParameters.ts` simplified** — removed dead native parameter computation switch (no model reaches upstream generation); capability registry returns `UNSUPPORTED` for all models.

**Consequences:**
- Zero post-process topology-changing fallbacks remain in any adapter.
- `native_target_polycount` is never silently used to subdivide/decimate a mesh after generation.
- Requested vs actual triangle counts are reported separately and honestly (measured from the actual GLB on disk, never inferred from requested).
- No change to modern GPU (`sm >= 80`) native execution path (Priority Rule 1 preserved).

---

## ADR-103: Decoupling and Elimination of Legacy Postprocess, Auth, and Quality Gate Bloat (2026-11-14)

**Context:** The codebase contained legacy modules from earlier iterations and an external fork (`backend/postprocess/` adapted from 3DGenStudio, 16 files, 136KB), a multi-tenant authentication system (`backend/core/auth/` with JWT/passlib), artificial heuristic quality checks (`backend/core/quality/` and `backend/config/quality.yaml`), preprocessing bridging layers, and dummy mock model classes. ForMesh3D is a single-user, self-hosted 3D studio where modern upstream generative models (Hunyuan3D-2.1, TRELLIS.2, Stable Fast 3D) produce high-fidelity geometry directly.

**Decision:**
1. **Complete Removal of Legacy Postprocess**: Deleted `backend/postprocess/` in its entirety. Decoupled `multiprocess_scheduler.py` from `run_postprocess_job`. Replaced heavy mesh processing dependencies in `artifact_utils.py` with lightweight asset workspace helpers.
2. **Elimination of Multi-Tenant Auth Bloat**: Deleted `backend/core/auth/` and associated user management scripts. Single-user local workstation/VPS requires no JWT tokens or password hashing overhead.
3. **Removal of Heuristic Quality Gates**: Deleted `backend/core/quality/` and `backend/config/quality.yaml`. Cleaned `backend/core/config.py` of 100+ lines of quality YAML parsing.
4. **Self-Contained Specialist Mesh Tools**: Refactored `backend/api/routers/mesh_tools.py` into a standalone, SSE streaming router that provides real-time progress events and strict mesh format validation without relying on the legacy postprocess pipeline.

**Consequences:** Zero dead code or dangling postprocess imports across the entire backend. Full test suites passing with zero regressions on upstream model flows or hardware isolation (`sm >= 80` vs `sm < 80`).
