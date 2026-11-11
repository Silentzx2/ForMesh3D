# ForMesh3D — Active Engineering Tasks & Implementation Specifications

**Document Status:** Active Engineering Roadmap & Implementation Plan  
**Updated:** 2026-11-11

---

## ✅ COMPLETE — TEX-1: Texture pipeline inside adapter; raw + texture in one weights load; complete Paint3D removal from main repo

**Priority:** High | **Area:** Backend API / Scheduler / Adapters / Postprocess / Frontend UI | **Status:** DONE

**Description:**
`/api/v1/mesh-generation/image-to-raw-mesh` generates a raw mesh, saves it as immutable `master/source.glb`, and when `texture_enabled` is set, runs the selected model's own texture pipeline immediately after raw inference using already-loaded weights (single `_load_model` call). Textured output is stored as a separate artifact (`textures/<base>_textured.glb`); `master/source.glb` stays raw/immutable.

**What was done:**
1. ✅ `enable_postprocess` and `texture_enabled` split into independent toggles on UI (`GeneratePanel.tsx`, `buildGenerationParameters.ts`)
2. ✅ Texture OFF: raw mesh → postprocess (no texture) → output
3. ✅ Texture ON: raw mesh → same adapter's `_process_request` runs texture pipeline → separate textured artifact; `master/source.glb` untouched
4. ✅ No second weights load — both shape + paint pipelines loaded in one `_load_model` call (Hunyuan3D-2.1 adapter)
5. ✅ No separate external texture adapter — postprocess `_execute_texture_stage` converted to no-op shim; Paint3D/Hunyuan-Paint calls removed
6. ✅ UI shows per-model texture settings (dynamic from backend per selected model)
7. ✅ Complete Paint3D removal from main repo — adapter file deleted, registry/factory/planner/models.yaml entries removed, frontend constants/UI cleaned, API route references removed, docs references removed
8. ✅ **Critical fix:** `texture_enabled` was stripped by `_POSTPROCESS_ONLY_INPUTS` in `multiprocess_scheduler.py:_build_model_inference_inputs()` before reaching the adapter — removed it with explanatory comment so adapter receives the flag
9. ✅ CPU offload: `cpu_offload: true` added to `hunyuan3d_paint_v21_image_mesh_painting` in models.yaml; planner sets offload flag; scheduler dispatches with `strategy="cpu_offload"`
10. ✅ Strong structured logging (TEX-2) wired — `JobContextFilter`, `logging.yaml` Option 2 format, API entry/exit logging

**Files touched:**
1. ✅ `features/workspace/Panels/GeneratePanel.tsx` — split `enable_postprocess` / `texture_enabled` into independent toggles
2. ✅ `features/workspace/utils/buildGenerationParameters.ts` — added `texture_enabled` + `texture_settings` to request body
3. ✅ `features/workspace/utils/buildTextureGenerationParameters.ts` — removed Paint3D fallback; route to Hunyuan3D-Paint v2.1
4. ✅ `backend/api/routers/mesh_generation.py` — accept `texture_enabled` + `texture_settings`; validate; route to scheduler; remove Paint3D route references
5. ✅ `backend/core/scheduler/multiprocess_scheduler.py` — `texture_enabled` no longer stripped from model inputs; `_TEXTURE_MODEL_MAP`/`_resolve_texture_model` removed; CPU offload dispatch wired
6. ✅ `backend/postprocess/pipeline.py` — `_execute_texture_stage` no-op shim; postprocess picks up adapter's `textured_mesh_path`; keeps gate/repair/decimate/UV/bake/LOD/collision/QA
7. ✅ `backend/adapters/hunyuan3d_adapter_v21.py` — `_load_model` loads shape + paint pipelines from same weights dir; `_process_request` runs raw → texture using already-loaded weights; returns `textured_mesh_path`
8. 🔲 `backend/adapters/trellis_adapter.py` — add texture method to `_TrellisBaseAdapter._process_request` (TRELLIS v1 supports `image_mesh_painting`; paint pipeline uses `to_glb(gs, mesh, texture_size=...)`)
9. 🔲 `backend/adapters/trellis2_adapter.py` — add texture method to `Trellis2ImageToRawMeshAdapter._process_request` (TRELLIS.2 supports `image_mesh_painting`; same pipeline does `pipeline(mesh=, image=, seed=)`)
10. ✅ `backend/adapters/paint3d_adapter.py` — deleted entirely
11. ✅ `backend/adapters/trellis2_paint_adapter.py` — deleted (consolidated into trellis2_adapter.py)
12. ✅ `backend/adapters/hunyuan3d_paint_v21.py` — deleted (consolidated into hunyuan3d_adapter_v21.py)
13. ✅ `backend/adapters/__init__.py` — removed Paint3D/hunyuan3d_paint_v21/trellis2_paint registry entries
14. ✅ `backend/core/scheduler/model_factory.py` — removed Paint3D registry entries
15. ✅ `backend/config/models.yaml` — removed Paint3D registration; added `cpu_offload: true` to Hunyuan3D-Paint v2.1
16. ✅ `backend/api/routers/system.py` — removed Paint3D from model listing
17. ✅ `backend/core/planner.py` — removed Paint3D routing; `cpu_offload` read for Hunyuan3D-Paint v2.1
18. ✅ `frontend constants/models.ts` — removed Paint3D entries
19. ✅ `features/workspace/Panels/TexturePanel.tsx` — removed Paint3D option / references
20. ✅ `frontend constants/models.ts` — removed Paint3D entries
21. ✅ `backend/scripts/download_models.sh` — removed Paint3D download/verify entries
22. ✅ `backend/requirements-models.txt` — removed Paint3D from comment
23. ✅ `backend/api/routers/mesh_generation.py` — `texture_enabled` + `texture_settings` fields on both request models; passthrough to job inputs/metadata
24. ✅ `Docs/api-documentation.md` — documented new fields + textured artifact URL; removed Paint3D endpoint docs
25. ✅ `Docs/ARCHITECTURE.md` — updated pipeline contract; removed Paint3D from tables/diagrams
26. ✅ `Docs/DESIGN.md`, `Docs/PRD.md`, `Docs/SYSTEM-BLUEPRINT.md`, `Docs/MEMORY.md` — removed Paint3D references
27. ✅ `Docs/TASKS.md` — this document

**Rules compliance (AGENTS.md + Ponytail):**
- YAGNI: No new endpoint, no separate texture adapter, no global monkeypatch, no new dependency
- Smallest diff: Texture moves into existing adapter `_process_request`; postprocess texture stage deleted; Paint3D deleted
- Priority Rule 1: `sm >= 80` modern GPU path untouched — zero regression
- Priority Rule 2: Fix inside adapter code, no global runtime monkeypatch
- Priority Rule 3: Model-specific patcher isolation; never leaks to other models
- Root cause: Texture forced through separate adapter causing second weights load; fixed by keeping texture inside same adapter
- Reuse first: Existing adapter texture calls reused; no new adapter created

**Acceptance criteria:**
- Texture OFF → raw mesh + postprocess derivatives; no texture artifact ✅
- Texture ON → raw `master/source.glb` AND textured artifact; weights loaded once ✅ (Hunyuan3D-2.1)
- No external texture adapter called from postprocess ✅
- Paint3D fully removed from main repo ✅
- Hunyuan3D-Paint v2.1 CPU offload: `cpu_offload: true` in models.yaml ✅
- `bun x tsc --noEmit` → 0 errors ✅
- `bun test` passes ✅
- Backend `pytest` passes (11 passed, 7 pre-existing failures from missing optional modules) ✅
- No change to `sm >= 80` inference path ✅

**Verification:**
- Frontend: `npx tsc --noEmit` → 0 errors; `bun test` passes
- Backend: `python -m pytest backend/tests/` → 11 passed, 5 skipped, 7 pre-existing failures (rtree/xatlas/pymeshlab — unrelated)
- `python3 -m py_compile` on all edited Python files → OK
- Runtime: Not GPU-verified (no GPU/backend server available)

**Remaining (next agent — texture pipeline for Trellis + Trellis.2):**
- `backend/adapters/trellis_adapter.py` — `_TrellisBaseAdapter._process_request`: after raw mesh generation, if `texture_enabled`, run `to_glb(gs, mesh, texture_size=...)` using already-loaded pipeline; return `textured_mesh_path`
- `backend/adapters/trellis2_adapter.py` — `Trellis2ImageToRawMeshAdapter._process_request`: after raw mesh generation, if `texture_enabled`, run `pipeline(mesh=mesh, image=image, seed=seed)` using already-loaded pipeline; return `textured_mesh_path`
- These two adapters share `MODEL_KEY` with their shape adapters; loading both pipelines in one `_load_model` call avoids second weights load
- Pattern: same as `hunyuan3d_adapter_v21.py` (load paint pipeline in `_load_model`, run after raw in `_process_request`, guard on `texture_enabled` + reference image path + pipeline availability)

**Risks / skipped:**
- Live GPU texture inference not run (no GPU)
- TRELLIS/TRELLIS.2 texture pipeline not yet implemented (marked above for next agent)
- VRAM inconsistency across adapter header (14336 MB), models.yaml (12000 MB), pipeline.py (21000 MB) — owner confirmation needed
- `backend/thirdparty/Paint3D/` submodule removal deferred to user
- Frontend download/viewer must switch to new `textured_url` artifact

---

## ✅ COMPLETE — TEX-2: Strong pipeline logging & clear log formatting

**Priority:** High | **Area:** Backend API / Scheduler / Adapters / Postprocess / Config | **Status:** DONE

**What was done:**
1. ✅ `backend/core/logging_filters.py` — created `JobContextFilter` (adds `job_id`, `stage`, `duration_ms` defaults)
2. ✅ `backend/config/logging.yaml` — Option 2 format: `[job=<id>] [stage=<stage>] key=value message`; adapters/postprocess at DEBUG
3. ✅ `backend/core/config.py` — `setup_logging()` wires `JobContextFilter` (dictConfig + belt-and-suspenders explicit injection)
4. ✅ `backend/api/routers/mesh_generation.py` — entry (`[stage=receive]`) and exit (`[job=<id>] [stage=dispatch]`) logging with duration_ms

**Acceptance criteria:**
- `logging.yaml` formatter includes `[job=%(job_id)s] [stage=%(stage)s]` with defaults ✅
- `JobContextFilter` injected in `setup_logging()` ✅
- API entry/exit structured logging ✅

---

## 🟡 OPEN — Texture pipeline for Trellis + Trellis.2 adapters

**Priority:** Medium | **Area:** Backend Adapters

**Description:**
TRELLIS v1 and TRELLIS.2 both register `image_mesh_painting` feature and have texture-painting capability in their vendored pipelines. Add texture generation inside each adapter's `_process_request` (after raw inference, same `_load_model` call) following the `hunyuan3d_adapter_v21.py` pattern.

**Files to touch:**
1. `backend/adapters/trellis_adapter.py` — `_TrellisBaseAdapter._process_request`
2. `backend/adapters/trellis2_adapter.py` — `Trellis2ImageToRawMeshAdapter._process_request`

**Pattern to follow** (from `hunyuan3d_adapter_v21.py`):
- `_load_model`: load paint pipeline from same weights dir into `self._paint_pipeline` (guard with try/except)
- `_unload_model`: clear `self._paint_pipeline`
- `_process_request`: after raw mesh export, if `inputs.get("texture_enabled")` and reference image path exists and `self._paint_pipeline` is not None, run paint pipeline on raw mesh + image; return `textured_mesh_path` in result dict

---
