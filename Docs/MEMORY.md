# ForMesh3D — Project Memory

> **Last audited:** 2026-11-25 | **Branch:** `dev`

## 1. Stack & Runtime
- **Frontend:** Next.js 16, React 19, TypeScript, Three.js (`GLTFLoader` + `glbCache`), Bun 1.4.2 (port `3000`).
- **Backend:** FastAPI, Python 3.10, SQLite (`backend/storage/job_queue.db`), port `7842`.
- **Modes:** Single-worker (`main_singleworker.py`, embedded scheduler) and multi-worker (`main_multiworker.py`, Redis + separate scheduler).
- **Workspace route:** `/workspace/generate/<workspace_id>`; assets live under `backend/storage/<workspace_id>/mesh/mesh.glb`.

## 2. Model Registry & Single Source of Truth
- `backend/config/models.yaml` is the sole source for model metadata (`name`, `label`, `description`, `vram_requirement`), enablement, `capabilities`, and `default_parameters`.
- `ModelFactory.ADAPTER_REGISTRY` resolves model IDs to adapter classes; `backend/adapters/__init__.py::_ADAPTER_MAP` derives from it automatically.
- `multiprocess_scheduler.py` injects `default_parameters` before inference when keys are missing/`None` without overwriting UI-owned params (`seed`, `texture_resolution`, `poly_type`, `target_polycount`, `remesh_option`).
- **Enabled families:** HY 2.1, HY 2.0 Mini Turbo, TripoSR, TripoSG, TRELLIS, Stable Fast 3D, HY 2.1/2.0 Paint, TripoSR Paint, TRELLIS Paint/Text Paint, PartField, SkinTokens, TriFlow, PartUV, ARDY.
- **Disabled & retained:** Pixal3D, TRELLIS.2, TaoFlowForge (do not enable or delete).
- `backend/thirdparty/` is a pinned submodule; `backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py` has a known upstream `IndentationError` (compile first-party code separately).

## 3. UI, Tools & Contracts
- `ModelsTab.tsx`, `GeneratePanel.tsx`, and `TexturePanel.tsx` load dynamically from `/api/v1/system/models` (`constants/models.ts` deleted); VRAM badges round `vram_requirement / 1024`.
- Retopology = TriFlow AI (`_pair_triangles_to_quads` for quads), UV = PartUV AI, Segmentation = PartField AI, Rigging = SkinTokens AI, Motion = ARDY. No script fallback engine exists.
- `MeshViewer.tsx` renders local GLBs with hardware `setScissorTest` split comparison, 3-step Wireframe (`off` -> `overlay` -> `xray`), the simple `Execution Progress Bar` (`bottom-20`) and ~0.95s `THREE.Plane` scan reveal.
- `multiprocess_scheduler.py` and `system.py` normalize and serve durable workspace paths (`mesh/mesh.glb`) rather than `/tmp`.

## 4. Verification Baseline
- Frontend: `bun run test` (`tsc --noEmit`), `bun run lint`, `bun test`, `bun run build`.
- Backend: first-party `python -m compileall -q backend/adapters backend/api backend/core ...`, `python -m unittest backend/tests/test_default_parameters_injection.py`, `pytest` contracts, `bash -n backend/scripts/download_models.sh`.

## Adapter Architecture Overview & Vision

The **adapter layer** currently wraps each third‑party model with a large amount of duplicated boiler‑plate (environment guards, temporary‑directory handling, checkpoint download logic, schema definitions, etc.).  Our audit shows that most upstream model repositories provide a single compact implementation (typically under 100 lines) that already contains the full pipeline.

**Benefits of re‑using the original model code directly:**
- **Single source of truth** – fixes, performance improvements, and new features in the upstream repo flow automatically to our system.
- **Lean codebase** – eliminating duplicated blocks saves ~735 lines (~14 % of adapter code) and reduces cognitive load for new contributors.
- **GPU parity compliance** – the upstream pipelines are already built for `sm >= 80` GPUs, preserving our high‑GPU‑parity rule.
- **Simpler maintenance** – only a thin façade remains per adapter, handling input shaping and output conversion.

**Vision:** Collapse each adapter to a minimal façade that configures inputs and forwards the request to the original model pipeline, while shared utilities (temp‑dir cleanup, checkpoint caching, pre‑Ampere guards) live centrally in `BaseModel` or `patcher/common.py`.  This makes the codebase easier to understand for any new AI or human reviewer lacking prior context.
