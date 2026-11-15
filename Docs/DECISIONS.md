# Architecture Decisions — ForMesh 3D

> **Version**: 0.3.0
> **Last Updated**: November 15, 2026
> **Retention Policy**: Keep only the last 3 active Architectural Decision Records (ADRs) to preserve lean context.

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
- ADR-102 is superseded on the point that adapters "apply direct geometric subdivision/simplification before export" — that behavior is removed.

---

## ADR-103: Decoupling and Elimination of Legacy Postprocess, Auth, and Quality Gate Bloat (2026-11-14)

**Context:** The codebase contained legacy modules from earlier iterations and an external fork (`backend/postprocess/` adapted from 3DGenStudio, 16 files, 136KB), a multi-tenant authentication system (`backend/core/auth/` with JWT/passlib), artificial heuristic quality checks (`backend/core/quality/` and `backend/config/quality.yaml`), preprocessing bridging layers, and dummy mock model classes. ForMesh3D is a single-user, self-hosted 3D studio where modern upstream generative models (Hunyuan3D-2.1, TRELLIS.2, Stable Fast 3D) produce high-fidelity geometry directly. The postprocess pipeline was already disabled by default, and having 136KB of unmaintained postprocess code, restrictive third-party licensing conditions, and mock quality scoring created brittle imports, complex dependency trees, and maintenance drag.

**Decision:**
1. **Complete Removal of Legacy Postprocess**:
   - Deleted `backend/postprocess/` in its entirety. Removed external 3DGenStudio community license constraints.
   - Decoupled `multiprocess_scheduler.py` from `run_postprocess_job`. Generation jobs deliver direct model-native meshes to the workspace.
   - Replaced heavy mesh processing dependencies in `artifact_utils.py` with lightweight, canonical asset workspace helpers (`canonical_asset_workspace`, `prepare_asset_job_workspace`, `register_asset_job_manifest`).
2. **Elimination of Multi-Tenant Auth Bloat**:
   - Deleted `backend/core/auth/` and associated user management scripts.
   - Single-user local workstation/VPS requires no JWT tokens or password hashing overhead. Rate limiting and dependency checks operate without auth database lookups.
3. **Removal of Heuristic Quality Gates**:
   - Deleted `backend/core/quality/` and `backend/config/quality.yaml`.
   - Cleaned `backend/core/config.py` of 100+ lines of quality YAML parsing; quality tiers are validated cleanly as known strings without hard-coded geometric threshold rejections.
4. **Self-Contained Specialist Mesh Tools**:
   - Refactored `backend/api/routers/mesh_tools.py` into a standalone, SSE streaming router that provides real-time progress events and strict mesh format validation (`.glb`, `.gltf`, `.obj`, `.ply`, `.stl`) without relying on the legacy postprocess pipeline.
5. **Direct Preprocessing Intake**:
   - Removed `backend/core/preprocess/image_enhancement.py` and `hi3dgen_bridging.py`, unmounting the unused image enhancement router. Image inputs are passed directly to model adapters.
6. **Clean Model Architecture**:
   - Deleted dummy model mock files (`mesh_models.py`, `retopo_models.py`, etc.) from `backend/core/models/`, retaining a clean, authoritative `BaseModel` and `ModelStatus`.

**Consequences:**
- Zero dead code or dangling postprocess imports across the entire backend.
- Full 57-test pytest suite passing with zero regressions on upstream model flows or hardware isolation (`sm >= 80` vs `sm < 80`).
- Dramatically reduced repository surface area, zero third-party licensing baggage from 3DGenStudio, and improved startup speed and maintainability.

---

## ADR-102: Universal Model Adapter Parameter Passthrough and Dynamic Model-Aware UI Controls (2026-11-14)

**Status:** Partially superseded by ADR-104 — the statement that "adapters apply direct geometric subdivision/simplification before export" is removed; adapters no longer perform post-generation count forcing. The dynamic model-aware UI controls and authoritative parameter passthrough portions remain valid.

**Context:** Generation parameters explicitly configured by users in the UI (e.g. polycount target 400K, texture atlas resolution, texture enable toggle, remesh topology) were previously intercepted by router-level preset overrides or logged and dropped by adapters, resulting in meshes with default resolutions (e.g. 8K faces for SF3D regardless of slider setting). Furthermore, static UI buttons offered unsupported resolutions (e.g. 4K for SF3D which only supports up to 2K) and Quad topology buttons for models producing only native triangles.

**Decision:**
1. **Dynamic Model-Aware UI Controls**:
   - `GeneratePanel` and `TexturePanel` resolve texture resolutions dynamically based on the active model: SF3D offers `512`, `1K`, `2K`; Hunyuan3D-Paint offers `1K`, `2K`, `4K`; raw mesh generators hide the texture section.
   - Geometry topology selector dynamically disables/indicates when a model does not support Quad remeshing, preventing user confusion.
2. **Authoritative Parameter Passthrough**:
   - `buildGenerationParameters.ts` maps user-selected polycount directly to `native_target_polycount` and routes user parameters without intermediate decimation post-processing flags.
   - `mesh_generation.py` router respects user-specified `native_target_polycount`, `texture_resolution`, and `seed` over preset fallbacks.

**Consequences:** Users have full control over generation parameters with dynamic model-aware UI controls; parameter passthrough is authoritative without post-generation count forcing.
