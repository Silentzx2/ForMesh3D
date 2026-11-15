# Active Sprint: Unified Workspace Endpoints Architecture

## Goal
Transition workspace generation and operations to direct, streamlined endpoints while eliminating obsolete mesh editing routes and consolidating generation/texturing into single unified endpoints with zero regressions across DB, scheduler, and frontend.

---

## 1. Target Endpoint Architecture
- `POST /api/v1/generate` — Unified 3D Mesh Generation (Raw & Textured; routes dynamically by model + `texture_enabled` flag).
- `POST /api/v1/texture` — Unified Texture Generation (PBR texture painting via image or prompt).
- `POST /api/v1/retopo` — Retopology & Polycount Decimation (Quad/Triangle remesh).
- `POST /api/v1/unwrap` — UV Unwrapping & Atlas Packing.
- `POST /api/v1/rig` — Auto-Rigging (Humanoid/Creature bone skeleton & skin binding).
- `POST /api/v1/motion` — Skeletal Animation & Motion Generation.
- `POST /api/v1/segment` — Semantic Part & Material Segmentation.
- ❌ **Removed**: `text-mesh-editing` & `image-mesh-editing` endpoints, router, and dead files.

---

## 2. End-to-End Impact Surface & Safety Checks

### A. Backend Router & FastAPI Layer (`backend/api/routers/`)
- [ ] Create `generate` route in `backend/api/routers/mesh_generation.py` unifying `/image-to-raw-mesh` and `/image-to-textured-mesh`.
- [ ] Create `texture` route in `backend/api/routers/mesh_generation.py` unifying `/image-mesh-painting` and `/text-mesh-painting`.
- [ ] Update route prefixes in `backend/api/main.py`:
  - `mesh_retopology` -> `/api/v1/retopo` (`retopologize-mesh` aliased or root POST `/`)
  - `mesh_uv_unwrapping` -> `/api/v1/unwrap` (`unwrap-mesh` aliased or root POST `/`)
  - `auto_rigging` -> `/api/v1/rig` (`generate-rig` aliased or root POST `/`)
  - `motion_generation` -> `/api/v1/motion` (`generate-motion` aliased or root POST `/`)
  - `mesh_segmentation` -> `/api/v1/segment` (`segment-mesh` aliased or root POST `/`)
- [ ] Remove `mesh_editing.py` router from `backend/api/main.py` and delete dead file references.
- [ ] Retain legacy route aliases with 307/internal dispatch so ongoing in-flight jobs or legacy scripts never break.

### B. Database & Scheduler Integration (`backend/core/scheduler/`)
- [ ] Verify `JobRequest(feature=...)`:
  - `generate`: dispatches to `image_to_3d` or `image_to_textured_mesh` feature based on model capabilities & inputs.
  - `texture`: dispatches to `text_mesh_painting` / `image_mesh_painting`.
  - Operations preserve standard features (`mesh_retopology`, `mesh_uv_unwrapping`, `auto_rigging`, `motion_generation`, `mesh_segmentation`).
- [ ] Verify SQLite operation types (`enqueue_operation`): Keep canonical operation names (`generate_mesh`, `retopologize_mesh`, `uv_unwrap`, etc.) intact so workspace asset version tree and DB lineage remain 100% compatible.

### C. Frontend API Client & Workspace Shell (`features/workspace/`)
- [ ] Update `buildGenerationParameters.ts`:
  - Point single endpoint resolution to `/api/v1/generate`.
  - Retain capability routing inside payload parameters.
- [ ] Update `WorkspaceContext.tsx`:
  - Replace generation POST URL with `/api/v1/generate`.
  - Update retopo call to `/api/v1/retopo`.
  - Update UV unwrap call to `/api/v1/unwrap`.
  - Update auto-rig call to `/api/v1/rig`.
  - Update motion call to `/api/v1/motion`.
  - Update segment call to `/api/v1/segment`.
  - Remove mesh editing execution handlers.
- [ ] Update `app/api/v1/[...path]/route.ts`: Ensure Next.js API proxy passes all new routes cleanly without buffering.

### D. Verification & Quality Gates
- [ ] `python3 -m py_compile`: All modified routers compile without syntax errors.
- [ ] `bun test`: All workspace unit and integration tests pass.
- [ ] `bun x tsc --noEmit`: 0 TypeScript type errors across frontend workspace.
- [ ] End-to-end smoke test of generate, retopo, unwrap, rig, motion, and segment endpoints.
