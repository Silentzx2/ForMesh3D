# ForMesh3D — Project Memory

> **Last audited:** 2026-11-26 | **Branch:** `dev`

## 1. Stack & Runtime
- **Frontend:** Next.js 16, React 19, TypeScript, Three.js (`GLTFLoader` + `glbCache`), Bun 1.4.2 (port `3000`).
- **Backend:** FastAPI, Python 3.10, SQLite (`backend/storage/job_queue.db`), port `7842`.
- **Modes:** Single-worker (`main_singleworker.py`, embedded scheduler) and multi-worker (`main_multiworker.py`, Redis + separate scheduler).
- **Workspace route:** `/workspace/generate/<workspace_id>`; assets live under `backend/storage/<workspace_id>/mesh/mesh.glb`.

## 2. Model Registry & Single Source of Truth
- `backend/config/models.yaml` is the sole source for model metadata (`name`, `label`, `description`, `vram_requirement`), enablement, `capabilities`, and `default_parameters`.
- `ModelFactory.ADAPTER_REGISTRY` resolves model IDs to adapter classes; `backend/adapters/__init__.py::_ADAPTER_MAP` derives from it automatically.
- `multiprocess_scheduler.py` injects `default_parameters` before inference when keys are missing/`None` without overwriting UI-owned params (`seed`, `texture_resolution`, `poly_type`, `target_polycount`, `remesh_option`).
- **Enabled families:** HY 2.1, HY 2.0 Mini Turbo, TripoSR, TripoSG, TRELLIS, Stable Fast 3D, HY 2.1/2.0 Paint, TripoSR Paint, TRELLIS Paint (Text Paint remains disabled), PartField, SkinTokens, TriFlow, PartUV, ARDY.
- **Disabled & retained:** Pixal3D, TRELLIS.2, TaoFlowForge (do not enable or delete).
- `backend/thirdparty/` is a pinned submodule; `backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py` has a known upstream `IndentationError` (compile first-party code separately).

## 3. UI, Tools & Contracts
- `ModelsTab.tsx`, `GeneratePanel.tsx`, and `TexturePanel.tsx` load dynamically from `/api/v1/system/models` (`constants/models.ts` deleted); VRAM badges round `vram_requirement / 1024`.
- Retopology = TriFlow AI (`_pair_triangles_to_quads` for quads), UV = PartUV AI, Segmentation = PartField AI, Rigging = SkinTokens AI, Motion = ARDY. No script fallback engine exists.
- `MeshViewer.tsx` renders local GLBs with hardware `setScissorTest` split comparison, 3-step Wireframe (`off` -> `overlay` -> `xray`), the simple `Execution Progress Bar` (`bottom-20`) and ~0.95s `THREE.Plane` scan reveal.
- `multiprocess_scheduler.py` and `system.py` normalize and serve durable workspace paths (`mesh/mesh.glb`) rather than `/tmp`.
- Animation panel (`features/workspace/Panels/AnimationPanel.tsx`) creates text→motion (ARDY), lists bundled Premade and server-backed My Presets, imports user NPZ and saves generated motion, and binds clips to the active rigged mesh. `ViewportToolOverlay.tsx` mounts `CameraTriad` (interactive SVG XYZ triad via `viewportEvents.ts`) and `AnimationPlayerBar` (play/pause, loop, speed, scrub, export GLB). `ActiveMeshBar.tsx` is the compact downstream mesh selector/uploader. `QualityBadge.tsx` reports mesh QA tier.
- `services/motionClient.ts` (typed `MotionClipV1`/preset client + validation) consumes the motion API. `services/motionStorage.ts` is an optional IndexedDB cache; backend/storage/presets/ is authoritative for user uploads/generated copies.

## 4. Motion Clip Service Layer
- `backend/services/motion_clips.py`: bounded pure-Python ZIP+NPY parsing (no `numpy.load`/pickle), ZIP/NPY size/entry/frame/joint limits, path-traversal-safe preset thumbnails, ARDY `local_rot_mats`/`root_positions` → `MotionClipV1` (quaternion_xyzw, y-up, source_native translation units; handedness and physical units are not claimed until a real NPZ is verified).
- Bundled premade presets are enumerated read-only from `backend/motion_presets/` and are version-controlled. User uploads/generated copies live under `backend/storage/presets/<preset_id>/motion.npz` with one `metadata.json` per directory and opaque `upl_`/`gen_` IDs. Legacy flat `motion_uploads/` entries remain read-only compatible.
- `backend/api/routers/motion_generation.py`: `GET /api/v1/motion/presets`, `GET /api/v1/motion/presets/{id}/thumbnail`, `GET /api/v1/motion/clips/{clip_id}`, `POST /api/v1/motion/clips/preview`, `GET/POST /api/v1/motion/uploads, POST /api/v1/motion/uploads/from-clip/{clip_id}, DELETE /api/v1/motion/uploads/{clip_id}`. Existing `POST /api/v1/motion`, checkpoints, available-models, supported-formats unchanged.
- `system.py` job results expose `motion_clip_id` + `clip_url` for completed motion artifacts; frontend resolves via `/api/v1/motion/clips/{clip_id}`.
- Tests: `backend/tests/test_motion_clips_api.py` (normalization, ZIP security, preset scanning, preview non-persistence, job resolution, AutoRig SkinTokens alignment, OpenAPI route order).

## 5. Verification Baseline
- Frontend: `bun run test` (`tsc --noEmit`), `bun run lint`, `bun test`, `bun run build`.
- Backend: first-party `python -m compileall -q backend/adapters backend/api backend/core ...`, `python -m unittest backend/tests/test_default_parameters_injection.py`, `pytest` contracts, `bash -n backend/scripts/download_models.sh`.

## Adapter Architecture (Pluggable Upstream Loader)

- **Shared loader (`backend/core/utils/upstream.py`):** `resolve_thirdparty`, `resolve_pretrained`, `use_thirdparty`, `load_thirdparty_script`.
- **Completed rewrite:** All 15 adapters (12 enabled + 3 disabled `pixal3d`, `trellis2`, `taoflowforge`) rewritten cleanly from 0 using `upstream.py`, applying `patcher/<model>` first and failing fast on missing local weights (`backend/pretrained/<Model>`).
- **GPU parity:** `sm >= 80` keeps native BF16/FlashAttention; `sm < 80` workarounds stay isolated in `patcher/<model>/`.
