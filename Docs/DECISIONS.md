# Architecture Decisions — ForMesh 3D

> **Last Updated:** 2026-11-26 | **Retention Policy:** Keep only the last 3 active ADRs.

---

## ADR-112: Motion Clip Service Layer & Normalized MotionClipV1 API (2026-11-26)

**Context:** ARDY motion generation produced raw NPZ artifacts with no safe, normalized, frontend-consumable contract. The UI needed preset listing, clip retrieval, thumbnails, user NPZ preview/upload, and completed-job clip resolution without exposing filesystem paths or raw NPZ internals.
**Decision:**
1. Add `backend/services/motion_clips.py`: bounded pure-Python ZIP+NPY parsing (no `numpy.load`/pickle), ZIP/NPY size/entry/frame/joint/resource limits, path-traversal-safe preset thumbnail resolution, ARDY `local_rot_mats`/`root_positions` → `MotionClipV1` (quaternion_xyzw, y-up, source_native translation units (handedness and physical units unverified)), preset listing from `backend/motion_presets/`, user-uploaded/generated presets in `backend/storage/presets/<preset_id>/` (opaque `upl_`/`gen_` IDs, motion.npz plus one metadata.json per preset directory), and completed-job resolution via `motion_clip_id`.
2. Mount `backend/api/routers/motion_generation.py` motion router with routes `GET /api/v1/motion/presets`, `GET /api/v1/motion/presets/{id}/thumbnail`, `GET /api/v1/motion/clips/{clip_id}`, `POST /api/v1/motion/clips/preview`, `GET/POST /api/v1/motion/uploads, POST /api/v1/motion/uploads/from-clip/{clip_id}, DELETE /api/v1/motion/uploads/{clip_id}`, preserving existing `POST /api/v1/motion`, checkpoints, available-models, supported-formats.
3. Frontend typed client `services/motionClient.ts` validates `MotionClipV1` on receipt; `services/motionStorage.ts` is an optional IndexedDB cache, while the backend user preset library is authoritative; UI pieces `AnimationPlayerBar`, `CameraTriad`, `ActiveMeshBar`, `QualityBadge` wired into the Animation panel and viewport overlay; completed ARDY jobs expose `motion_clip_id` in `system.py` job results.
4. Keep bundled premade presets in backend/motion_presets/. User uploads and generated copies live under backend/storage/presets/<preset_id>/; preview uploads remain temporary and are never persisted.

---

## ADR-111: Single-Source `models.yaml` & Runtime Parameter Injection (2026-11-25)

**Context:** Model defaults (`steps`, `guidance_scale`, `octree_resolution`, etc.) were duplicated across adapters and `constants/models.ts` duplicated the model catalog in the frontend.
**Decision:**
1. Make `backend/config/models.yaml` the sole registry for metadata (`name`, `label`, `description`, `vram_requirement`), `capabilities`, and official `default_parameters`.
2. Delete `constants/models.ts`, derive `backend/adapters/__init__.py::_ADAPTER_MAP` from `ModelFactory.ADAPTER_REGISTRY`, and serve UI dropdowns/order/badges from `/api/v1/system/models`.
3. Inject `default_parameters` in `multiprocess_scheduler.py` before inference when keys are missing/`None` without overwriting UI-owned params (`seed`, `texture_resolution`, `poly_type`, `target_polycount`, `remesh_option`).

---

## ADR-110: Workspace-Scoped Derived Operation Artifacts (2026-11-24)

**Context:** Derived operations (`retopology`, `uv`, `segmentation`, `rigging`) previously created extra `storage/<job_id>/` sibling directories alongside workspace folders.
**Decision:** Publish derived outputs inside the existing `workspace_id` folder only, clean adapter temp outputs after durable publication, and persist durable workspace paths (`mesh/mesh.glb`) in SQLite.
