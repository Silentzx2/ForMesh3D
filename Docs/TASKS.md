# Current Tasks and Verified Cleanup Record

> **Audit date:** 2026-11-22  
> **Branch:** `dev`  
> **Baseline:** `27f48a76f302008fa0ab9d9b1d7788a8eb7d55a1`  
> **Rule:** This file records source-verified cleanup. A missing frontend caller alone does not make a REST endpoint safe to delete.

## 1. Removed orphaned first-party files

| Path | Evidence / reason |
|---|---|
| `features/workspace/Viewport/GenerationLoadingPreview.tsx` | Component had no code importer, dynamic import, route registration, or runtime consumer. Its old mention in this file was documentation only. |
| `features/workspace/lib/meshTelemetry.ts` | `analyzeGeometryTelemetry`, `countUVCharts`, and `prepareMeshTangentsAndNormals` had no consumers. Active viewer statistics use `meshStats.ts`. |
| `features/workspace/lib/presetIntent.ts` | `getPresetIntentFromSearch`, `getPromptFromSearch`, and `getModelFromSearch` had no callers. |
| `features/workspace/lib/riggingProgress.ts` | `computeRigProgress` and `computeRigStatusText` had no callers. |
| `components/icons/hugeicons-mapping.ts` | Mapping export had no imports; active icon components use the actual Hugeicons component layer. |
| `backend/core/utils/validation.py` | All validation helpers had zero first-party import/call sites; active request validation lives in router/Pydantic contracts. |
| `backend/core/utils/format_utils.py` | `fbx_to_glb` and `fbx_to_glb_headless` had no callers or registered conversion flow. |
| `backend/core/utils/mask_generator.py` | `MaskGenerator` and its convenience functions had no imports or runtime consumers. |
| `backend/utils/fastmesh_utils.py` | `FastMeshRunner` had no callers; the active FastMesh adapter owns the current inference path. |
| `backend/utils/partuv_utils.py` | `PartUVRunner` had no callers; the active PartUV adapter owns the current inference path. |
| `scripts/verify_integration_loop.py` | Standalone script was unreferenced and stale: it imports missing `backend.core.animation.ardy_converter` and calls retired motion-generation paths. |

## 2. Removed unused API-client wrappers

The following methods in `services/apiClient.ts` had no frontend callers. Only the client wrappers were removed; their backend endpoints were retained as API contracts.

- `getModelParameters()`
- `downloadJobResult()` — workspace download code builds its current download URL directly.
- `getFileMetadata()`
- `getMeshGenerationSupportedFormats()`
- `getMeshSegmentationSupportedFormats()`
- `getAutoRiggingSupportedFormats()`
- `getRetopologyAvailableModels()`
- `getMeshRetopologySupportedFormats()`
- `getUVUnwrappingAvailableModels()`
- `getUVUnwrappingPackMethods()`
- `getMeshUVUnwrappingSupportedFormats()`
- `getMotionCheckpoints()`
- `getMotionAvailableModels()`
- `getMotionSupportedFormats()`

## 3. Removed unused exports and deprecated function

- `features/config.js`: removed `API_BASE` and `resourceUrl()`; retained `SERVER_ORIGIN` and `assetUrl()`.
- `lib/motion.ts`: removed `MOTION_BASE`, `MOTION_SLOW`, and `MOTION_SPRING_SNAPPY`; retained `MOTION_FAST` and `MOTION_SPRING`.
- `backend/api/routers/file_upload.py`: removed synchronous `resolve_file_id()` (deprecated, always returned `None`, no callers). Retained `resolve_file_id_async()`, which is used by active routes.
- `features/workspace/types.ts`, `RemeshPanel.tsx`, and `WorkspaceContext.tsx`: removed the unused `RemeshSettings.variant` field. The panel only wrote `V1K` and the inspector displayed it as `FastMesh Variant`, but the active workspace AI remesh request always submits TriFlow and does not consume that value. Removed the stale field and misleading inspector row; FastMesh V1K remains registered and available through the backend adapter/API.

## 4. Runtime correction found during final verification

`execute_script_operation()` accepted FastAPI `BackgroundTasks` but awaited the pipeline through `asyncio.to_thread()`. That blocked the response and returned a completed status instead of the documented queued response. It now registers the existing worker with `background_tasks.add_task()`, allowing the API to return the queued operation while the task runs after response delivery. Integration tests cover the queued response and persisted completion.

## 5. Wiring correction

`backend/core/runtime_probe.py` reads `backend.adapters._ADAPTER_MAP`, while `ModelFactory.ADAPTER_REGISTRY` already registered the enabled specialist adapters. The runtime map omitted:
- `triflow_retopology` → `backend.adapters.triflow_adapter`
- `fastmesh_v1k_retopology` → `backend.adapters.fastmesh_adapter`
- `partfield_segmentation` → `backend.adapters.partfield_adapter`

The map now includes these IDs, and `test_batch1_regressions.py` protects the inventory.

## 6. Reviewed and deliberately retained

These were false positives or unsafe deletion candidates:

- `backend/utils/trellis2_utils.py`, TRELLIS.2 adapters, patchers and validation code: retained because TRELLIS.2 is intentionally disabled, not retired. Do not remove disabled-model support.
- `backend/utils/image_super_utils.py`, `pipeline_utils.py`, `simplify_mesh_utils.py`, `multiview_utils.py`, `uvwrap_utils.py`, `torchvision_fix.py`, and `dinov3_vit.py`: compatibility/model support paths; not safe to delete from first-party import counts alone.
- `backend/adapters/trellis2_mesh_validation.py`: retained validation support.
- `backend/api/routers/script_execution.py`: helper functions are imported by specialist routers; it is not an unused router.
- `features/workspace/Viewport/meshStats.ts`, `glbCache.ts`, and `components/index.ts`: active callers exist.
- Disabled models **Unique3D, Pixal3D, TRELLIS.2, TaoFlowForge**: configuration remains unchanged. No model was enabled or removed.

## 7. API endpoints deliberately preserved

No backend REST endpoint was deleted. Routes without a current frontend caller remain externally addressable and/or documented/tested API contracts. Examples include model parameters, supported-format metadata, candidate download/select, shutdown, adapter inventory, logs configuration, file counts, and database verification. The system router's direct `/api/v1` aliases are also retained for compatibility. Removing these requires a separate explicit API-breaking decision and contract/doc updates.

## 8. Verification baseline

The checked-in CI commands are documented in [CONTRIBUTING.md](../CONTRIBUTING.md). Frontend CI runs frozen Bun install, TypeScript check, lint, tests and production build. Backend CI compiles first-party Python packages, patchers and project scripts while excluding the pinned upstream `backend/thirdparty` submodule; it then runs selected backend contract tests, downloader shell syntax and resolver tests. The full-tree `python -m compileall -q backend` command currently reports an existing `IndentationError` in the pinned TRELLIS source (`backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py:57-58`), so that upstream tree is intentionally not part of the first-party syntax gate. CI does not validate GPU inference or checkpoint installation.
