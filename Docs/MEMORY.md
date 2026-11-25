# ForMesh3D — Current Project Memory

> **Last audited:** 2026-11-24  
> **Branch:** `dev`  
> **Cleanup baseline:** `27f48a76f302008fa0ab9d9b1d7788a8eb7d55a1`  

## 1. Runtime shape

- Frontend: Next.js 16, React 19, TypeScript, Three.js; Bun 1.4.2.
- Backend: FastAPI, Python 3.10.
- Single-worker mode embeds the scheduler in `main_singleworker.py`.
- Multi-worker mode uses Redis queueing and a separate scheduler through `main_multiworker.py`.
- API port in local setup: 7842. Frontend port: 3000.

## 2. Workspace and viewport

- Workspace deep link: `/workspace/generate/<workspace_id>`.
- Workspace assets and job data are owned by backend storage/database modules under `backend/storage/`.
- Single-worker job database path: `backend/storage/job_queue.db`.
- Current mesh viewer downloads GLB and parses locally with `GLTFLoader` and `glbCache`.
- Server-side WebSocket/WebRTC mesh streaming has been removed. Do not restore it.
- `meshStats.ts` is active; `meshTelemetry.ts` was unreferenced and removed in the cleanup.

## 3. Model enablement

The authoritative flags are in `backend/config/models.yaml`.

Configured enabled families: Hunyuan3D Shape v2.1, Hunyuan3D DiT Mini Turbo, TripoSG, TRELLIS, Stable Fast 3D, Hunyuan3D Paint v2.0/v2.1, PartField, TriFlow, PartUV, SkinTokens, and ARDY.

- PartField (`partfield_segmentation`) and PartUV (`partuv_uv_unwrapping`): marked stable and working.
- TriFlow (`triflow_retopology`): marked stable and working.

Intentionally disabled and retained: Unique3D, Pixal3D, TRELLIS.2, TaoFlowForge. Do not enable them or delete their adapter, patcher, validator, configuration, or model-support files during unrelated work.

A config flag does not prove checkpoint availability or successful inference. GPU validation must be recorded separately.

## 4. Model registry connections

- `ModelFactory.ADAPTER_REGISTRY` resolves model IDs to adapter classes.
- `backend/adapters/__init__.py::_ADAPTER_MAP` feeds `backend/core/runtime_probe.py`.
- The audit found missing runtime-inventory entries for `triflow_retopology`, and `partfield_segmentation`; the cleanup commit adds them and a regression test.
- Third-party source is pinned under `backend/thirdparty`; preserve upstream notices and compatibility imports.

## 5. API and contracts

- System router is mounted at both `/api/v1/system` and `/api/v1` in both app entrypoints. Direct aliases are retained for compatibility.
- Feature routers cover generation/texture, upload, retopology, segmentation, UV, rigging and motion.
- Database administration routes are mounted at `/api/v1/system/database`.
- No REST endpoint was deleted in this cleanup: lack of a frontend caller is not proof that an externally addressable API contract is unused.
- The deprecated synchronous `resolve_file_id()` returned `None` and had no callers; `resolve_file_id_async()` remains active.
- Specialist tool routes enqueue scheduler-backed AI operations; SQLite remains authoritative for operation status, progress and lineage.

## 6. Cleanup status

Removed unreferenced first-party files:
- Frontend: `GenerationLoadingPreview.tsx`, `meshTelemetry.ts`, `presetIntent.ts`, `riggingProgress.ts`, `hugeicons-mapping.ts`.
- Backend: `core/utils/validation.py`, `core/utils/format_utils.py`, `core/utils/mask_generator.py`, `utils/partuv_utils.py`.
- Broken obsolete script: `scripts/verify_integration_loop.py`.

Removed 14 unused internal API-client methods, five unused exports, the deprecated synchronous resolver, the unused remesh `variant` state, and its misleading inspector row. See [TASKS.md](TASKS.md) for the full item-by-item reason and preserved false positives.

## 7. Verification

CI workflows are the checked-in baseline:
- Frontend: frozen Bun install, TypeScript check, ESLint, Bun tests, production build.
- Backend: first-party Python compileall (backend packages, tests, patcher and project scripts; pinned third-party submodule excluded), selected regression/API/lifecycle tests, downloader shell syntax, compute-mode and environment-resolver tests.
- Full `python -m compileall -q backend` currently encounters a pre-existing upstream TRELLIS `IndentationError` at `backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py:57-58`. CI now syntax-checks first-party code separately.

CI does not download model weights or prove GPU inference. Report those checks only when run on an appropriate host.

## 8. Current tool execution

- Retopology: TriFlow AI only. UV: PartUV AI only. Segmentation: PartField AI only. Rigging: SkinTokens AI only.
- No Script engine selector, frontend execution bridge, or deterministic script segmentation pipeline is part of the active UI/runtime.
- PartField can optionally persist each segmented part as a separate workspace mesh asset plus a ZIP archive; the combined colored GLB remains the active mesh.

## 9. State Machines, Tool Fixes & UI Performance (2026-11-25)
- Unified implicit state machines in `WorkspaceContext`, `MeshViewer`, `RightPropertyPanel`, `OutputsPage`, `AnimationPanel`, `RiggingPanel`, `BaseModel.process()`, `JobRequest`, `RedisJobQueue`, and `MultiprocessScheduler`.
- Fixed Rigging (`SkeletonHelper` overlay, real `0` unrigged bone count), UV (shared `shadingMode` checker, seam disposal, mesh-only guard), Segmentation (`parseInt` radix `10`, drag guard, **Explode Parts** + **Isolate**), and `download_triposr()`.
- Added `content-visibility: auto` (`.cv-card`, `.cv-row`), rAF-throttled raycasting in `RealModelPreviewCanvas`, and `matchMedia` in `WorkspaceShell`.

## 10. Viewport Compare, Wireframe Modes, Asset Library & TriFlow Quads (2026-11-25)
- `MeshViewer` comparison uses straight-vertical hardware `setScissorTest`, bottom `Before`/`After` labels, and rotation/`OrbitControls` sync; `RealModelPreviewCanvas` clones materials and updates X-Ray in-place.
- `ViewportToolOverlay` cycles Wireframe (`off` -> `overlay` -> `xray`) and shows top-right Mesh Stats (`Faces`/`Verts`); `RightAssetsPanel` shows deduplicated base meshes only.
- `triflow_adapter.py` pairs co-planar triangles into quads (`_pair_triangles_to_quads`) for `poly_type="quad"`; `system.py` resolves `op_*` + `mesh/mesh_thumb.png` in `download_job_thumbnail`.
