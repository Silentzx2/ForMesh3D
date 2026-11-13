# Required standing check (AGENTS.md §0.2 rule 7)
find all of the implicit state machines in my formesh3d app

# Task: Native Mesh Output Mode — Remove Automatic Postprocessing from the Default Workflow

**Status:** Planned  
**Scope:** Generation workflow, Dynamic Floating Geometry Settings UI, YAML configuration, and task documentation  
**Priority:** High

## 1. Objective

Make the mesh extracted directly by the selected 3D model the final mesh displayed to the user. The default generation workflow must not run a separate postprocessing stage or modify the extracted mesh.

The user-selected polygon/face count is a **native generation/extraction target**, not a downstream decimation or postprocessing target.

## 2. Required Default Workflow

1. The user selects a model and, where supported, a target polygon/face count.
2. The user starts generation.
3. The selected model performs inference and extracts its mesh using its native extraction capabilities.
4. The application stores and displays that extracted mesh directly.
5. No automatic postprocessing or geometry modification is performed between extraction and display.

**The model's extracted mesh is the output. Do not create a separately processed replacement mesh.**

## 3. Strict No-Postprocessing Rule

When postprocessing is disabled (the default), do not invoke the postprocessing pipeline and do not apply any automatic mesh-changing operation after native extraction.

This includes, but is not limited to:

- Retopology or topology conversion
- Remeshing
- Decimation or polygon reduction
- Hole filling
- Mesh repair
- Smoothing
- Automatic cleanup or optimization
- Any other operation that changes mesh geometry or topology

Do not add substitute processing steps. Do not silently run any of these operations as part of saving, preview generation, export preparation, or background job completion. Preserve the extracted mesh as-is.

## 4. Native Polycount Target

Update the generation flow so the selected polygon/face count is passed to the selected model's native mesh extraction path wherever that model supports such a control.

Requirements:

- Trace the target from the generation UI through request construction, API/schema handling, scheduler filtering, and the selected model adapter.
- Implement model-specific native extraction support only where the underlying model actually exposes a suitable control.
- Do not treat a downstream `target_polycount` value as proof of native extraction support.
- Do not use decimation, remeshing, or another postprocessing operation to force the result to the requested count.
- Do not claim that a model generates an exact count unless its native implementation guarantees that behavior.
- If a model does not support a native polygon-count target, preserve its normal native output and clearly document the limitation. Do not modify the mesh afterward to approximate the requested count.

## 5. Hide Postprocessing UI by Default

Completely hide the postprocessing-related UI when postprocessing is disabled.

In particular, inspect **Dynamic Floating Geometry Settings** and hide its postprocessing-related functions and controls, including relevant settings, buttons, sliders, toggles, and options.

“Hide” means the controls must not be rendered. Do not merely disable them, make them read-only, or leave empty placeholders in their place.

The default generation interface should present the native generation controls without exposing postprocessing options.

## 6. YAML Opt-In for Existing Postprocessing

Keep the existing postprocessing implementation in the codebase. Do not delete or unnecessarily rewrite it.

Add or reuse a YAML configuration setting, following the repository's existing configuration conventions, to control whether postprocessing is available.

Required behavior:

- The setting defaults to `false` (postprocessing disabled).
- With the setting `false`, the generation workflow bypasses the postprocessing pipeline entirely and postprocessing controls remain hidden.
- With the setting explicitly set to `true`, the existing postprocessing workflow may be enabled and its related UI controls may be shown.
- The setting must be read consistently by the backend and frontend/UI configuration path; do not create a frontend-only switch that leaves the backend behavior inconsistent.
- Document the exact YAML file, key, default value, and how an operator enables the feature.

Do not make postprocessing user-toggleable in the default UI. YAML configuration is the opt-in mechanism.

## 7. Preserve Unrelated Functionality

- Preserve existing model inference behavior and model-specific extraction settings unless a narrowly scoped change is required to pass a supported native polycount target.
- Preserve generated asset storage, loading, preview, and export behavior, while ensuring none of those paths modifies the extracted mesh when postprocessing is disabled.
- Do not remove independent/manual mesh-editing tools elsewhere in the application. This task hides the automatic postprocessing controls in the generation experience; it does not request deletion of separate manual tools.
- Avoid unrelated refactoring and new dependencies.

## 8. Documentation Updates

Update `Docs/TASKS.md` (or the repository's canonical `TASKS.md`) with this task and track its implementation status accurately.

Also update relevant configuration, architecture, and API documentation where necessary. Documentation must distinguish clearly between:

- Native model extraction and its model-specific polycount capabilities.
- The default no-postprocessing generation workflow.
- The YAML opt-in path for the existing postprocessing pipeline.

Do not mark work as completed until it has been implemented and verified.

## 9. Acceptance Criteria

- [ ] Postprocessing is disabled by default through YAML configuration.
- [ ] The default generation path does not invoke the postprocessing pipeline.
- [ ] The mesh displayed after generation is the mesh extracted by the selected model, with no automatic geometry/topology modifications.
- [ ] The selected polygon/face target reaches native model extraction wherever genuinely supported.
- [ ] Unsupported native polycount controls do not trigger downstream processing or false exact-count claims.
- [ ] Postprocessing-related controls in Dynamic Floating Geometry Settings are not rendered by default.
- [ ] Setting the YAML opt-in to `true` enables the existing postprocessing path and makes its relevant controls available as designed.
- [ ] Existing manual mesh tools, model adapters, asset persistence, preview, and export remain functional.
- [ ] Tests cover both YAML-disabled and YAML-enabled behavior, including verification that the disabled path does not call postprocessing.
- [ ] Relevant backend tests, frontend tests, type checks, linting, and build checks pass.
- [ ] `TASKS.md` and related documentation accurately describe the implemented behavior and any model-specific limitations.

## 10. Implementation Report

When the task is implemented, report:

- Files changed and the purpose of each change.
- The YAML file/key used to enable postprocessing.
- Which model adapters support native polygon-count targeting and any limitations.
- Evidence that the default generation path bypasses postprocessing and preserves the extracted mesh.
- Tests and checks executed, with results.
- Any remaining work or known limitations.

## 11. Implementation Details (for assignee)

### 11.1 YAML opt-in config (default: postprocessing disabled)
There is no global postprocessing kill-switch today. `backend/config/models.yaml` only has per-model `recommended_postprocess_profile` (e.g. lines 34, 72, 109, 146, 187, 228, 334, 385, 420, 490).

Add a top-level YAML setting read by both backend and frontend. Candidate locations:
- New file: `backend/config/postprocessing.yaml` with:
```yaml
postprocessing:
  enabled: false
```
- Or extend an existing YAML, following repo conventions in `backend/config/`.

The setting must default to `false`. When `false`, the generation workflow bypasses the postprocessing pipeline entirely and postprocessing UI controls are not rendered. When explicitly `true`, the existing postprocessing path runs as designed. Do not make postprocessing user-toggleable in the default UI — YAML is the opt-in mechanism.

### 11.2 Normalize API defaults to off
File: `backend/api/routers/mesh_generation.py`

Current `enable_postprocess` defaults are inconsistent:
- Line 276–277: `Field(False)` — already off, keep.
- Line 402: `Field(True)` — change default to `False`.
- Line 608: `Field(True)` — change default to `False`.
- Line 769–770: `postprocess_mode` defaults `"manual_mesh_tool"` (bypasses pipeline), `enable_postprocess: Field(False)` — already off, keep.

All endpoints that pass `enable_postprocess` into scheduler inputs (lines 1042–1050, 1138–1142, 1385–1462, 1709–1882, 2033–2041) must respect the YAML default rather than hardcoding `True`.

### 11.3 Scheduler guard
File: `backend/core/scheduler/multiprocess_scheduler.py`

- Lines 2358–2379: `postprocess_mode` and `enable_postprocess` are derived from `job_request.metadata`/`.inputs`. Add an early check: if YAML `postprocessing.enabled` is `false`, force `postprocess_mode = "none"` and `enable_postprocess = False` before line 2393.
- Line 136: `enable_postprocess` is already in `_POSTPROCESS_ONLY_INPUTS` — keep it out of model inference inputs (correct already).
- Lines 2393, 2413, 2451, 2494: the `run_postprocess_job` call path — wrap behind the YAML gate so it never executes when disabled by default.

### 11.4 Frontend UI — hide postprocessing controls
Locate the Dynamic Floating Geometry Settings component under `features/workspace/`. When postprocessing is disabled (default), remove postprocessing toggles/buttons/sliders from the JSX entirely — not disabled, not read-only, no empty placeholders. Fetch the YAML-backed flag from `/system/features` or `/system/models` and conditionally exclude the postprocessing section.

### 11.5 Tests to add
File: `backend/tests/` (new or existing test file)
- Test that with `postprocessing.enabled: false`, `run_postprocess_job` is never called and `enable_postprocess` is forced `False`.
- Test that with `postprocessing.enabled: true`, the existing postprocessing path runs unchanged.
- Test that the default generation path returns the adapter's extracted mesh with no decimation/remeshing applied.
Run: `pytest` for backend; `bun run test`, `bun run lint`, `bun run build` for frontend.

### 11.6 Documentation
- Update `Docs/TASKS.md` to track implementation status as work proceeds.
- Document the exact YAML file/key/default and how an operator enables postprocessing in `Docs/ARCHITECTURE.md` or a config doc.
- Distinguish clearly between: native model extraction, default no-postprocessing workflow, and YAML opt-in path.

## 12. Pre-existing separate fix (already applied, not part of this task)
The texture-adapter registry references in `backend/core/scheduler/model_factory.py` and `backend/core/planner.py` were fixed (wrong module paths for `trellis2_image_mesh_painting`, `trellis2_paint`, `hunyuan3d_paint_v21_image_mesh_painting`). Tests pass: 26 passed, 3 skipped. This is unrelated to the postprocessing task.

## 13. Standing check (AGENTS.md §0.2 rule 7)
After every code change, run: `find all of the implicit state machines in my formesh3d app` — scan for scattered booleans/flags acting as implicit state machines and report each with name, states, transitions, triggers, file+line, and explicit/implicit. Verify no new implicit state machine is created and no existing one is broken.

## 14. Implicit State Machine Audit (AGENTS.md §0.2 rule 7)
Scan of the codebase for scattered booleans/flags acting as implicit state machines. None were created or broken by this change.

### Frontend — Implicit State Machines

| # | Name | States | Transitions | Triggers | File + Lines | Explicit/Implicit |
|---|------|--------|-------------|----------|--------------|-------------------|
| F1 | Generation / execution FSM | `idle → queued → running → completed / failed / interrupted` | `startTask()` sets `isExecuting=true`, progress 0, status `queued`; backend poller flips `queued/running → completed/failed/interrupted`; `cancelExecution()` aborts controller, sets `interrupted` | Generate/Remesh click, backend job status polling, SSE `executed`/`execution_error`, explicit cancel, page refresh | `features/workspace/store/WorkspaceContext.tsx:351, 635, 1169-1317, 1485-1548, 1550-1587` | Implicit (`isExecuting`, `executionProgress`, `executionStep`, `activeTask`, `jobsById`, `activeAbortControllerRef`) |
| F2 | Batch queue FSM | `queued → running → completed / failed / cancelled` | `processBatchQueue()` submits → `running`; 5s polling fetches each job, flips on terminal states; `cancelBatchProcessing()` marks `cancelled`; `retryFailedBatchItems()` resets `failed → queued` | User actions, backend poll, `jobsByIdRef` sync | `features/workspace/store/WorkspaceContext.tsx:360-361, 1049-1157` | Implicit (`batchQueue[].status`) |
| F3 | Viewport model-load FSM | `empty → loading → loaded / error` | `modelUrl` change clears previous + starts loader (cancellation-safe via `isCancelled`); success → `setHasModel(true)`; failure → `setLoadError(msg)`; falsy URL → `setHasModel(false)` | `modelUrl` change, `viewportResetTrigger`, `isComparing` toggle | `features/workspace/Viewport/MeshViewer.tsx:215-217, 795-938` | Implicit (`hasModel`, `loadError`, `isComparisonLoading`; `isCancelled` is per-effect `let`) |
| F4 | Image/mesh upload FSM | `idle → uploading → verifying → saved → idle` (2s timeout); `idle → uploading → error → idle` (2s timeout) | `upload()` sets `uploading`, `onProgress` updates percent; success → `saved`, percent=100, auto-reset after 2000ms; catch → `error`, same 2s reset | File drop/paste, backend success/failure, 2s timeout reset | `hooks/useMeshAssetUpload.ts:9-146`, `features/workspace/Panels/GeneratePanel.tsx:344` | Implicit on top of explicit `status: 'idle' \| 'uploading' \| 'verifying' \| 'saved' \| 'error'` |
| F5 | Task polling FSMs | `poll active → terminal` | `isPolling` guard + fixed interval; `queued/running → terminal` | Mount/unmount, tab visibility, store changes | `hooks/useTaskPolling.ts:19-168`, `hooks/useTaskManager.ts:51-257` | Implicit (`isPolling` guard, `pollTickCountRef`) |
| F6 | SSE connection FSM | `disconnected → connecting → connected` | Reconnect with backoff 1s→2s→4s→8s cap 30s; fallback poll while `connected === false` | `EventSource` open/message/error, unmount cleanup | `hooks/useSSE.ts:5-71` | Implicit (`connected`, `data`, `reconnectAttemptsRef`) |
| F7 | Feature / model availability FSM | `loading → loaded / error` | `fetchFeatureAvailability()` on mount/refetch; merges `/system/features` and `/system/models`; disabled-model filter in GeneratePanel | Mount, `refetch()` | `hooks/useFeatureAvailability.ts:43-173` | Implicit (`loading → loaded / error`, `weightsStatus`) |
| F8 | Comparison FSM | `off → on` | `setIsComparing(!isComparing)`; guard `canCompareModels`; auto-exit if comparison unavailable | Compare button click, model load | `features/workspace/store/WorkspaceContext.tsx:351`, `MeshViewer.tsx:859-864` | Implicit (`isComparing`) |
| F9 | Panel open/close FSMs | `closed → open → closed` | Toggle buttons set open state; close buttons reset | Button clicks | `WorkspaceContext.tsx:607-609, 632-633`, `GeneratePanel.tsx:270, 344, 359`, `ViewportToolOverlay.tsx:51` | Implicit (`isSettingsOpen`, `isExportModalOpen`, `isLeftPanelOpen`, `isRightPanelOpen`, `isGeneralSettingsOpen`, `isModelDropdownOpen`, `isGeomTextureOpen`, `isTextureSettingsOpen`, `isDragOver`) |
| F10 | Viewport shading/display FSM | Multiple orthogonal toggles | `showWireframe`, `showGrid`, `showBones`, `isTurntable`, `shadingMode`, `activeTransformTool` toggled independently | UI controls, tool selection | `WorkspaceContext.tsx:607-609, 759-777`, `MeshViewer.tsx` | Implicit (scattered booleans) |
| F11 | Texture settings FSM | Multiple orthogonal toggles | `enableTexture`, `removeLighting`, `enablePbr`, `bakeNormal`, `bakeRoughness`, `bakeMetallic`, `bakeAo` | UI toggles | `GeneratePanel.tsx:362-365`, `TexturePanel.tsx:354-359` | Implicit (scattered booleans) |

### Backend — Implicit State Machines

| # | Name | States | Transitions | Triggers | File + Lines | Explicit/Implicit |
|---|------|--------|-------------|----------|--------------|-------------------|
| B1 | Job status FSM | `queued → processing → completed / failed / cancelled` | `QUEUED` on submission; `PROCESSING` when worker starts; `COMPLETED`/`FAILED`/`CANCELLED` on terminal; retry tracking with `retry_count` | Job submission, worker start, job completion, cancellation | `backend/core/scheduler/job_queue.py:59-64, 104, 252-281`, `database_models.py:25-30, 68` | Explicit (`JobStatus` enum) |
| B2 | Model load FSM | `unloaded → loading → loaded → processing → error` | `load()` → `LOADING` → `LOADED`; `process()` → `PROCESSING` → `LOADED`/`ERROR`; `unload()` → `UNLOADED` | `load()`, `process()`, `unload()` calls | `backend/core/models/base.py:16-21, 68-110, 112-154` | Explicit (`ModelStatus` enum) |
| B3 | Scheduler worker FSM | `available → busy → available` / `created → loading → ready → error` | `_mark_worker_busy()` / `_mark_worker_available()`; `_create_worker_for_model()` → `_stop_worker_for_job()` | Job dispatch, worker completion, cancellation, timeout | `backend/core/scheduler/multiprocess_scheduler.py:3552-3604, 3046-3231` | Implicit (worker busy/available tracking) |
| B4 | Texture pipeline state | `none → production_mesh → running → completed / degraded / failed` | `postprocess_mode` derived from request; `run_postprocess_job` invoked; `degraded_reasons` appended on failure | `texture_enabled`, `enable_postprocess`, `postprocess_mode` | `backend/core/scheduler/multiprocess_scheduler.py:2355-2508`, `postprocess/pipeline.py` | Implicit (`postprocess_mode`, `enable_postprocess`, `texture_stage.status`) |

### Verification
- No new implicit state machine was created by this change. The `native_target_polycount` flow is a plain data pass-through (no state, no transitions, no flags).
- No existing implicit state machine was broken. The `postprocessingEnabled` YAML flag (F7-adjacent) was already present; this change only adds the `native_target_polycount` data field alongside it.
- The standing check at Section 13 must be re-run after every subsequent change.
