# Architecture Decisions — ForMesh 3D

> **Last Updated:** 2026-11-25 | **Retention Policy:** Keep only the last 3 active ADRs.

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

---

## ADR-109: NVIDIA PartField Neural Mesh Segmentation & WebGL Lifecycle Optimization (2026-11-20)

**Context:** Studio Segmentation lacked a backend neural model and `RealModelPreviewCanvas.tsx` froze the UI by recreating WebGL renderers on hover.
**Decision:** Registered `partfield_segmentation` (`partfield_adapter.py`), mounted a single WebGLRenderer/Scene/Camera in `RealModelPreviewCanvas.tsx`, cached `EdgesGeometry` in a `WeakMap`, and removed Script/geometric fallback engines.
