# ForMash3D — Implicit State Machine Inventory

Read-only audit (no code changes). 10 subagents scanned: frontend (Viewport, MeshViewer, panels, stores, hooks) and backend (scheduler, job queue, adapters, API routers). Inventory below — verified file paths and line numbers against the current codebase; inaccuracies corrected; missing machines added.

## Frontend — Implicit state machines

### F1. Generation / execution FSM — `features/workspace/store/WorkspaceContext.tsx:633–645, 1038–1043, 1169–1317, 1485–1548, 1550–1587`
- **Kind:** implicit (`isExecuting`, `executionProgress`, `executionStep`, `activeTask`, `jobsById`, `activeAbortControllerRef`)
- **States:** `idle → queued → running → completed / failed / interrupted`
- **Transitions:** `startTask()` sets `isExecuting=true`, progress 0, status `queued`, writes URL `/{toolRoute}/{taskId}`. `bindBackendJob()` maps local id → backend UUID via `localStorage` (`fm3d:job:${id}`). Backend poller (1.2s visible / 3s hidden) flips `queued/running → completed` (loads result, adds asset) or `failed/cancelled → interrupted/failed`. `cancelExecution()` aborts controller, sets `interrupted`. URL hydration on mount rebuilds `ActiveTask` so in-flight status survives refresh.
- **Triggers:** Generate/Remesh click, backend job status polling, SSE `executed`/`execution_error`, explicit cancel, page refresh.

### F2. Batch queue FSM — `features/workspace/store/WorkspaceContext.tsx` + `useAppStore` (`batchQueue`)
- **Kind:** implicit (`BatchQueueItem.status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'`)
- **States:** `queued → running → completed / failed / cancelled`
- **Transitions:** `processBatchQueue()` submits each queued item → `running`, stores jobId mapping. 5s polling fetches each job, flips on terminal backend states, deletes from `batchJobIdMap`. `cancelBatchProcessing()` marks running/queued `cancelled`. `retryFailedBatchItems()` resets failed → `queued`, clears jobId.
- **Triggers:** user actions, backend poll, `jobsByIdRef` sync.

### F3. Viewport model-load FSM — `features/workspace/Viewport/MeshViewer.tsx:215–217, 795–938`
- **Kind:** implicit (`hasModel`, `loadError`, `isComparisonLoading`; `isCancelled` is a per-effect `let` flag inside the two effects at 737 and 802, not a ref)
- **States:** `empty → loading → loaded / error`; comparison adds `comparison loading` sub-state
- **Transitions:** `modelUrl` change clears previous model + starts loader (cancellation-safe via `isCancelled`). Success → `setHasModel(true)`, `setLoadError(null)`. Failure → `setLoadError(msg)`. Falsy URL → `setHasModel(false)`, cleared stats.
- **Triggers:** `modelUrl` change (derived from `currentAsset.source.*` / `loadedModelUrl`), `viewportResetTrigger`, `isComparing` toggling `comparisonBeforeGroup`.

### F4. Image/mesh upload FSM — `hooks/useMeshAssetUpload.ts:9–146`, `features/workspace/Panels/GeneratePanel.tsx:344` (hook call), `514–561` (separate image-upload progress flow `processImageFile`)
- **Kind:** implicit on top of explicit `status: 'idle' | 'uploading' | 'verifying' | 'saved' | 'error'` useState
- **States:** `idle → uploading → verifying → saved →(2s timeout) idle`; on backend failure `idle → uploading → error →(2s timeout) idle`
- **Transitions:** `upload()` sets `uploading`, `onProgress` updates percent. Success → `saved`, percent=100, auto-reset to `idle` after 2000ms. Catch → `error` with the failure message (`error instanceof Error ? error.message : String(error)`), same 2s auto-reset to `idle`.
- **Triggers:** file drop/paste input, backend success/failure, 2s timeout reset.
- **Risk:** none — the hook now emits `error` and `MeshUploadStatus` renders it (alert role, assertive aria-live, error message paragraph).

### F5. Task polling FSMs — `hooks/useTaskPolling.ts:19–168`, `hooks/useTaskManager.ts:51–257`
- **Kind:** implicit — `useTaskPolling` uses `isPolling` guard + fixed 5s interval; `useTaskManager` uses `pollTickCountRef` with exponential backoff 5s→7.5s→10s and uuid-shape job filter (`isPollableGenerationTask` at 34–35)
- **States:** poll active; `queued/running → terminal`
- **Triggers:** mount/unmount, tab visibility (`documentVisible`), store changes. Only polls uuid-shaped backend jobs; local placeholder ids never polled.
- **Risk:** overlaps with F1 backend job poller — both write `isExecuting`/`activeTask` from different stores; race on refresh plausible.

### F6. SSE connection FSM — `hooks/useSSE.ts:5–71`
- **Kind:** implicit (`connected`, `data`, `reconnectAttemptsRef`, exponential backoff 1s→2s→4s→8s cap 30s)
- **States:** `disconnected → connecting → connected`; reconnect with backoff; fallback poll while `connected === false`
- **Triggers:** `EventSource` open/message/error, unmount cleanup.

### F7. Feature / model availability FSM — `hooks/useFeatureAvailability.ts:43–173`
- **Kind:** implicit (`loading → loaded / error`, `weightsStatus` gates dropdown)
- **Transitions:** `fetchFeatureAvailability()` on mount / `refetch()`. Merges `/system/features` and `/system/models`. Disabled-model filter in GeneratePanel (`isMeshModelDisabled`).

### F8. Navigation / tool FSM — `features/workspace/store/WorkspaceContext.tsx:208–220, 2860–2916`
- **Kind:** implicit (`activeTool`, `mainNav`, `activeRightTab`, panel booleans `isLeftPanelOpen`, `isRightPanelOpen`, `toolPanelOpen`, `isGeomTextureOpen`, `isModelDropdownOpen`, `isDragOver`)
- **Transitions:** `navigateToTool()` sets tool + mainNav + URL `replaceState`. `navigateToMain()` pushes/replaces admin or workspace routes. `TOOL_TO_ROUTE` map (208–220) is the transition table. URL pathname syncs `selectedAssetId`.
- **Implicit coupling:** `activeTool === 'remesh'` forces `showWireframe=true` (WorkspaceContext.tsx:974–975). `effectiveShadingMode` forces `uv-checker` when tool is `uv` (MeshViewer.tsx:662–665).

### F9. Viewport hover / part highlight — `features/workspace/Viewport/MeshViewer.tsx:941–985`
- **Kind:** implicit (mesh `userData.__hoverOriginalMaterial` backup)
- **States:** `none highlighted → part highlighted` → restored on unmount / hover change
- **Triggers:** `hoveredPartId` from workspace context

### F10. Viewport turntable — `features/workspace/Viewport/MeshViewer.tsx:341–346`
- **Kind:** implicit boolean driving per-frame RAF mutation
- **States:** `still → rotating` (continuous `modelGroup.rotation.y` mutation)

### F11. Animation mixer — `features/workspace/Viewport/MeshViewer.tsx:859–869`
- **Kind:** implicit (`mixerRef` presence + `useAnimationStore.isPlaying`)
- **States:** `none → playing → stopped/nulled` on model reload

### F12. Viewport UI shell — `features/workspace/Viewport/MeshViewer.tsx:1054–1156`
- **Kind:** explicit single UI-status enum (`viewportStatus: 'idle' | 'empty' | 'executing' | 'comparing' | 'error'`)
- **States/branches:** empty (`'empty'`) vs execution overlay (`'executing'`) vs comparison UI (`'comparing'`) vs error banner (`'error'`) vs idle model view (`'idle'`)
- **Transitions:** derived each render with priority `loadError` > `isExecuting` > `!hasModel` > `isComparing && canCompareModels`; branches are mutually exclusive, replacing the previously overlapping JSX conditions.
- **Risk:** none — single source of truth; no order-dependent overlap.

### F13. Settings popover — `features/workspace/Viewport/ViewportToolOverlay.tsx:59–85, 51`
- **Kind:** explicit `isSettingsOpen` useState + implicit outside-click/Escape dismiss
- **States:** `closed → open → closed`
- **Triggers:** settings button toggle; outside click / Escape (document listeners); close button.

### F14. Job detail poll cadence — `features/workspace/Jobs/JobDetailView.tsx:94–106` (list) and `:141–154` (selected)
- **Kind:** implicit interval-length machine
- **States:** slow poll (30s) ↔ fast poll (5s / 1200ms when any job running / selected job running)
- **Triggers:** computed `hasRunningJobs` / `jobStatus === 'running'`; `visibilitychange`

### F15. Job status lifecycle — `features/workspace/Jobs/JobDetailView.tsx:141, 466–552` (implicit)
- **Kind:** single inference source of truth: `jobStatus: 'idle' | 'running' | 'completed' | 'failed'` derived once from `selectedJob.status` AND `selectedJob.productionStatus`; both axes unified into a single `jobStatus`.
- **Derived booleans:** none — `isRunning`/`isCompleted`/`isFailed` replaced by `jobStatus` checks everywhere (badge, progress card, error diagnostics, output card, cancel/delete action). Production axis (`productionStatus`) is folded into `jobStatus` — if production is `failed` or `running`, jobStatus reflects that.
- **Triggers:** polling `fetchSelectedJobDetails`
- **Risk:** none — `jobStatus` is the single source of truth for both inference and production axes; no duplicate `selectedJobIsRunning` remains.

### F16. Copy-ID toast — `features/workspace/Jobs/JobDetailView.tsx:162–169`
- **Kind:** implicit timeout machine
- **States:** `cleared → showing → cleared after 2000ms`
- **Triggers:** `handleCopyId`; `setTimeout`

### F17. Retry-postprocess guard — `features/workspace/Jobs/JobDetailView.tsx:186–199`
- **Kind:** implicit
- **States:** `idle → retrying (button disabled) → idle`
- **Triggers:** `handleRetryPostprocess`; `finally` resets flag.

### F18. Wireframe toggle — `features/workspace/store/WorkspaceContext.tsx` + `features/workspace/Viewport/MeshViewer.tsx`
- **Kind:** implicit boolean
- **States:** `off → on` (`showWireframe`)
- **Triggers:** wireframe button toggle; `activeTool === 'remesh'` forces on (WorkspaceContext.tsx:974–975)

### F19. Shading mode cycle — `features/workspace/Viewport/MeshViewer.tsx:662–675` + `features/workspace/Viewport/ViewportToolOverlay.tsx`
- **Kind:** implicit enum cycle via `effectiveShadingMode` derivation
- **States:** `textured / clay / matcap-* / wireframe / xray / normals / matcap / uv-checker`
- **Transitions:** `handleShadingChange(mode)` sets `shadingMode`; `effectiveShadingMode` forces `uv-checker` when tool is `uv`; `shadingMode === 'normals'` also matches `matcap-normal`
- **Triggers:** shader sphere buttons in ViewportToolOverlay; `activeTool === 'uv'` override

### F20. Camera preset — `features/workspace/Viewport/ViewportToolOverlay.tsx:50`
- **Kind:** explicit `activePreset: 'Front' | 'Top' | 'Side' | 'Iso'` useState
- **States:** `Front ↔ Top ↔ Side ↔ Iso`
- **Triggers:** preset snap buttons dispatch `setCameraPreset` custom event

### F21. Lighting tone + exposure slider — `features/workspace/Viewport/ViewportToolOverlay.tsx:52–53, 95–117`
- **Kind:** implicit (`lightingTone: 'studio' | 'neutral' | 'warm' | 'cool'` + `exposure: 0.5–2.5` numeric)
- **States:** lighting tone cycles; exposure slider moves 0.5→2.5
- **Triggers:** lighting tone buttons dispatch `setViewportLighting`; exposure range input dispatches `setViewportExposure`

### F22. Snapshot flow — `features/workspace/Viewport/ViewportToolOverlay.tsx:88–102`
- **Kind:** implicit
- **States:** `idle → capturing → idle`
- **Triggers:** snapshot button dispatches `takeViewportSnapshot` custom event

### F23. Export modal open/close — `features/workspace/store/WorkspaceContext.tsx:631, 104–105`; `stores/useAnimationStore.ts:907–908`
- **Kind:** implicit boolean (`isExportModalOpen`)
- **States:** `closed ↔ open`
- **Triggers:** export buttons in dynamic inspectors; close/dismiss

### F24. Comparison divider drag — `features/workspace/Viewport/MeshViewer.tsx` (~1104–1163)
- **Kind:** implicit
- **States:** `idle ↔ dragging` (pointer capture)
- **Triggers:** divider pointerdown/move/up

## Frontend — Animation + dynamic inspectors

### A1. Animation playback — `stores/useAnimationStore.ts` `tickPlayback` (semi-explicit) + `DynamicAnimationInspector.tsx` (implicit)
- **States:** `stopped → playing → stopped`; `at-end` implicit (`currentTime >= duration`, `isPlaying` forced false if non-looping)
- **Clocks unified:** inspector now runs a single rAF that ticks the store's `tickPlayback`; the duplicate local rAF clock was removed. Store clock is the single source of truth for playing→ended.

### A2. Rig status — removed
- **Was:** `not_rigged → preparing → rigging → rigged / failed` via `rigStatus`/`setRigStatus` in `stores/useAnimationStore.ts`.
- **Action:** state + action deleted — **zero callers** and no rigging pipeline exists to drive it, so it was removed rather than wired up with fake transitions.

### A3–A8. Explicit enums/toggles in `useAnimationStore` — studio mode, inspector tab, viewport tool/render/camera preset, constraint/waypoint/time/ARDY mode, motion AI generation (`idle → generating → completed/failed`), bone/weight/waypoint booleans.

### B1. 3D model load — `stores/useViewerStore.ts:61–62, 86–87, 106–120, 136–142` (implicit)
- **States:** `unloaded (loadedModelUrl === null) → loaded (url + activeModelObject) → replaced` (old blob URL revoked first)
- **Risk:** no `loading`/`error` status enum; state inferred from presence of URL/object.

### C1. Upload lifecycle — `hooks/useMeshAssetUpload.ts:9–16, 30, 34–146` (explicit typed union)
- **States:** `idle → uploading → verifying → saved →(2s) idle`; `error` now emitted on backend failure, then `(2s) idle`.

### D1–D5. Dynamic inspectors — all implicit:
- **Export busy flags** (×4: Animation, UV, Rigging, Segmentation inspectors): `idle ↔ exporting`; each inspector now records `exportError` (set in `catch`, cleared at export start, shown under the button) so a failed export is distinguishable from success once the busy flag returns to idle.
- **UV presence:** `uvData === null` ("No UV Map Found") → non-null (via `handleQuickPlanarUV` / Smart UV Unwrap bumping `forceRefresh`).
- **Selected bone:** `null ↔ bone id`; defaults to `bones[0]`.
- **Pose preset:** `t_pose / a_pose / combat / sitting` applied as values, not stored as mode.
- **Selected part:** `null ↔ part id`; real-model load resets to first part.
- **View angle:** `'front' / 'ortho' / 'side'` (explicit).
- **Part visibility:** per-part `visible` boolean + scene-graph `node.visible`; all-visibility toggle collapses mixed states to "show all".
- **Hover:** `null ↔ id` on `RealModelPreviewCanvas`.
- **Drag-over:** `idle ↔ dragging` via `isDragOver` boolean + `dragCounterRef` counter (nested enter/leave handling) — located in `RiggingPanel.tsx:247–351` and `GeneratePanel.tsx:355–368`, not the dynamic inspectors.

### E1–E5. Panels:
- **RiggingPanel execution:** `idle → executing (progress 10→30→100) → idle`; error → `idle`, progress 0, step = error message. Local state `isLocalExecuting`/`localProgress`/`localStep` wired to render so local rig runs reflect in the progress bar; workspace `isExecuting`/`executionProgress`/`executionStep` still used when no local run. Render source derived once with fixed local-then-workspace priority and no merged flag, so concurrent runs show deterministic progress/step (risk R3 resolved).
- **GeneratePanel flow:** input tab `'image' / 'mesh'`; generation `idle → queued → running → completed/failed` (delegated to WorkspaceContext F1/F4); flyout modals open/closed with outside-click/Escape; `useMeshAssetUpload` hook state rendered via inline progress UI (`GeneratePanel.tsx:898–932`); `MeshUploadStatus` is imported but **not mounted** in this panel, so the hook's `error` state is currently never surfaced here (gap).
- **MeshUploadStatus:** stateless view only — renders `idle`/`uploading`/`verifying`/`saved`/`error` from the hook state.

## Backend — Implicit state machines

### B9. Job lifecycle — `backend/core/scheduler/job_queue.py:57–74` (explicit `JobStatus` enum) + `backend/core/scheduler/database_models.py:25–30` (duplicate `JobStatus` enum)
- **States:** `QUEUED → PROCESSING → COMPLETED / FAILED / CANCELLED`; recovery `PROCESSING → QUEUED`; retry `COMPLETED / FAILED / CANCELLED → PROCESSING` (postprocess, when `asset_root` present)
- **Transitions:** `enqueue()` QUEUED; `dequeue()` → processing cache; `mark_job_started()` PROCESSING; `complete_job()` COMPLETED; `fail_job()` FAILED (error classified by `classify_job_error()` into CUDA_OOM/INSUFFICIENT_VRAM/MODEL_NOT_READY/INPUT_NOT_FOUND/JOB_TIMEOUT/JOB_CANCELLED/JOB_FAILED); `cancel_job()` CANCELLED; `recover_processing_jobs()` on restart; `prepare_postprocess_retry()` terminal → PROCESSING when `asset_root` present.
- **Status:** resolved. `dequeue()`, `fail_job()`, `cancel_job()`, `complete_job()`, and `requeue_job()` persist to SQLite before moving caches and roll back (or skip) the move on save failure, so status and cache residency no longer drift.
- **Risk:** none remaining on these paths; status enum and physical container are still updated separately without a transaction, but every transition now persists first and only moves containers on success.

### B10. Queue residency — `backend/core/scheduler/job_queue.py:290–292` (cache declarations: `_queue_cache`, `_processing_cache`, `_completed_cache`) + `redis_job_queue.py:78–86` (Redis key constants), transitions in `enqueue` (185–217), `dequeue` (219–274), `requeue_job` (276–312), `complete_job` (314–338), `fail_job` (377–412)
- **States:** pending / processing / completed (by cache or Redis set membership)
- **Risk:** dual bookkeeping (status enum + container membership updated separately).

### B11. Worker process lifecycle — `backend/core/scheduler/multiprocess_scheduler.py:351–559` (implicit)
- **States:** `starting (load model at init) → idle (main loop waiting on control_queue/job_queue) → processing (_process_job_in_worker) → idle → shutdown`
- **Triggers:** `WorkerMessage.Type`: PROCESS_JOB, LOAD_MODEL, UNLOAD_MODEL, GET_STATUS, SHUTDOWN, HEALTH_CHECK. Model load failure at init → worker exits (terminal). `processing_job` variable is the busy guard.

### B12. Worker busy/idle bookkeeping — `backend/core/scheduler/multiprocess_scheduler.py:1328, 1338, 2099`
- **States:** worker idle / busy (`worker_status: Dict[str, bool]`, `worker_current_job`, `worker_current_callback`)
- **Status:** resolved. Serialized behind `worker_bookkeeping_lock` (`threading.Lock`) in `_mark_worker_busy`, `_mark_worker_busy_async`, `_find_available_worker_async`, and `_mark_worker_available`, so the event loop and the worker-response handler thread can no longer interleave check-then-mark.

### B13. Admission / placement outcome — `backend/core/scheduler/multiprocess_scheduler.py` (implicit string sentinels)
- **States:** `NO_FEATURE` (2910–2911, 2931–2933) → fail immediately; `MODEL_LOAD_FAILED` (3035) → fallback-chain retry (1990–2049) → fail; `WORKERS_BUSY` (2963) / `NO_VRAM` (3026) → requeue + sleep → retry (2056–2074); `worker_id` → mark busy, enqueue (2091–2109)
- **Cooldown:** `_vram_wait_until` checked at 1912, set at 2058/2069
- **Cancellation:** `_cancel_requested_jobs: set[str]`, `_active_postprocess_cancels: Dict[str, threading.Event]`

### B14. Model load state — `backend/core/models/base.py:16–21` (explicit `ModelStatus`)
- **States:** `UNLOADED → LOADING → LOADED → PROCESSING → LOADED/ERROR → UNLOADED`

### B15. GPU VRAM tracking — `backend/core/scheduler/gpu_monitor.py:38–39` (implicit)
- **States:** tracked allocated VRAM per GPU mutated by `allocate_vram()` / `deallocate_vram()`

### B16. Rate limiter — `backend/api/dependencies.py:345–412` (implicit)
- **States:** disabled (passthrough) / enabled; Redis Lua atomic INCR+EXPIRE per 60s window per hashed IP, or process-local two-window counter (single-worker only, unsafe multi-worker)

### B17. Deployment mode switch — `backend/api/dependencies.py:28–47` (implicit)
- **States:** `single_worker / multi_worker` (fixed at construction, branches on `if self._scheduler`)

### B18. SSE log stream — `backend/api/routers/system.py:685–806` (implicit)
- **States:** `fresh (tail + emit sync) → streaming (read chunks, idle-poll backoff, heartbeat) → reset (file replaced/truncated or identity mismatch) → disconnected (terminal)`

### B19. App lifespan — `backend/api/main_multiworker.py:97–183` + `backend/api/dependencies.py:195–219` (implicit)
- **States:** globals `redis_job_queue`/`file_store` None → connected at startup → None at shutdown

### B20. Scheduler start/stop lifecycle — `backend/core/scheduler/multiprocess_scheduler.py`
- **Kind:** implicit
- **States:** `stopped → running → stopped`
- **Transitions:** `start()` (1519–1557): guard if running, `self.running=True`, `job_queue.start_persistence()`, `recover_processing_jobs()`, response-handler thread, `_job_processing_loop` task, idle/dead-worker and queue cleanup tasks. `stop()` (1559–1593): guard if not running, `self.running=False`, cancel tasks, `stop_persistence()`, `_destroy_worker` per worker. `enable_processing=False` yields queue-only sub-mode.
- **Triggers:** `scheduler.start()` / `scheduler.stop()` from app bootstrap (singleworker lifespan: start at `main_singleworker.py:132`, stop at `:191`)
- **Loops:** guarded by `while self.running` at 1907, 3597, 3684, 3726, 3792

### B21. JobQueue background persistence — `backend/core/scheduler/job_queue.py:349–354, 377–379, 392–426`
- **Kind:** implicit
- **States:** `stopped → running → stopped`
- **Transitions:** `start_persistence()`: if not `_running`: `_running=True`, create_task(`_periodic_cleanup()`). `stop_persistence()`: `_running=False`. `_periodic_cleanup` loops while `_running`, evicting stale completed jobs from cache and DB.
- **Triggers:** called by scheduler `start()`/`stop()`

### B22. RedisJobQueue persistence hooks — `backend/core/scheduler/redis_job_queue.py:712–724`
- **Kind:** implicit no-op compatibility shims (Redis persistence always active)
- **Transitions:** `start_persistence()` → `recover_orphaned_jobs()`; `stop_persistence()` → no-op
- **Triggers:** called by scheduler `start()`/`stop()` in multi-worker mode

### B23. Single-worker app lifespan — `backend/api/main_singleworker.py:91–193`
- **Kind:** implicit (globals None → connected → None)
- **States:** `scheduler=None → scheduler created + started → scheduler stopped`
- **Transitions:** lifespan startup: `get_settings`, `setup_logging`, `GPUMonitor`, factory scheduler (production multiprocess / development async), `await scheduler.start()`, `app.state.scheduler`, `InMemoryFileStore`; yield; finally: `await scheduler.stop()` (global scheduler not nulled, unlike multi-worker)
- **Triggers:** uvicorn `api.main:app` startup/shutdown

### B24. Postprocess stage/progress sub-axis on terminal jobs — `backend/core/scheduler/job_queue.py:655–726, 731–746, 748–768, 770–788`
- **Kind:** implicit two-axis (completion + postprocess stage/progress)
- **States:** completed job → postprocess retry (stage='postprocess', `postprocess_progress` 0→1) → terminal again
- **Transitions:** `prepare_postprocess_retry` moves terminal job to PROCESSING (stage postprocess); `update_completed_result` / `update_job_result` merge postprocess result into `job.result`; `update_job_progress` writes `postprocess_progress`/`postprocess_stage` on completed jobs
- **Triggers:** job result with `asset_root`; background post-processing completion

## Backend — implicit state machines NOT in files list (verified present, not yet added)

### B25–B29. Admin / utility toggles (verified present, fully inventoried)

#### B25. ModelComparisonViewer isLoading — `features/workspace/Viewport/ModelComparisonViewer.tsx:69` (implicit)
- **States:** `idle ↔ loading`
- **Transitions:** `idle → loading` when model comparison data is being fetched; `loading → idle` when data is loaded or fails
- **Triggers:** Model comparison data fetch start/complete
- **Kind:** implicit (`isLoading` useState)

#### B26. ResourceMonitor isLoading — `features/workspace/Header/ResourceMonitor.tsx:39` (implicit)
- **States:** `idle ↔ loading`
- **Transitions:** `idle → loading` when resource stats are being fetched; `loading → idle` when stats are received
- **Triggers:** Resource stats fetch start/complete
- **Kind:** implicit (`isLoading` useState)

#### B27. DatabaseTab redisLoading — `features/workspace/admin/tabs/DatabaseTab.tsx:107` (implicit)
- **States:** `idle ↔ inspecting`
- **Transitions:** `idle → inspecting` when Redis keys are being inspected; `inspecting → idle` when inspection completes
- **Triggers:** Redis key inspection start/complete
- **Kind:** implicit (`redisLoading` useState)

#### B28. LogsTab isPolling — `features/workspace/admin/tabs/LogsTab.tsx:124–163` (implicit)
- **States:** `idle ↔ polling`
- **Transitions:** `idle → polling` when live log-tail polling starts; `polling → idle` when polling stops
- **Triggers:** Log tail poll start/stop
- **Kind:** implicit (`isPolling` useState)

#### B29. _initialized lazy-init guards — `backend/core/scheduler/multiprocess_scheduler.py:1287`, `backend/core/scheduler/database_manager.py:56` (implicit)
- **States:** `uninitialized → initialized`
- **Transitions:** `uninitialized → initialized` on first initialization call
- **Triggers:** First scheduler/database manager initialization
- **Kind:** implicit (`_initialized` flag)

## Negative findings (checked, NOT state machines)
- `backend/core/planner.py` — pure function; only memoization caches
- `backend/core/scheduler/model_factory.py` — `ADAPTER_REGISTRY` is a mutable class attribute with runtime `register_adapter()` inserts; not a state machine but not "no runtime state"
- `backend/core/logging_filters.py` — stateless `JobContextFilter`
- `backend/core/config.py` — singleton `get_settings()` + `reload_settings()`
- `backend/adapters/__init__.py` — static `_ADAPTER_MAP`
- `backend/scripts/download_models.sh` — procedural, skip-if-cached gates (`manager.sh` does not exist in current tree)
- `features/workspace/lib/api.ts` — `ApiClient` is an event emitter; `getSystemStats` computes `online/offline` per call, not persistent

## Top risks / recommended actions

1. **setRigStatus never called** — RESOLVED: rigStatus FSM was dead code (zero callers, no rigging pipeline); removed from `useAnimationStore`.
2. **Duplicated animation clocks** — RESOLVED: inspector rAF now ticks the store's single `tickPlayback`; duplicate local clock removed from `DynamicAnimationInspector.tsx`.
3. **Execution flag coupling** — RESOLVED: RiggingPanel no longer merges local + workspace `isExecuting`; local execution state (`isLocalExecuting`/`localProgress`/`localStep`) is derived and rendered separately with fixed local-then-workspace priority. Concurrent runs show deterministic progress/step.
4. **Export machines collapse failure into idle** — RESOLVED: all four `isExporting*` flags (Animation, UV, Rigging, Segmentation inspectors) now record `exportError` on failure, set in `catch`, cleared at export start, rendered under the button. Image upload progress also records `error` state on failure (`GeneratePanel.tsx`).
5. **Job status / container drift** — RESOLVED: `complete_job()` and `requeue_job()` in `job_queue.py` now persist to SQLite before moving containers; on save failure the in-memory move is rolled back. All queue transitions persist first, then move containers only on success.

## New findings verified by 10-agent audit (additional)

### F25. Image upload progress — `features/workspace/Panels/GeneratePanel.tsx:344, 539–586, 989–1015` (implicit)
- **Kind:** implicit — `imageUploadProgress: { loaded: number; total: number; percent: number; uploading: boolean; error: string \| null }`
- **States:** `idle (percent=0) → uploading (percent rising 0→100) → idle after success (percent=100)` / `idle after error (error message shown)`
- **Transitions:** `idle → uploading` when image picked/dropped (`processImageFile` resets loaded/total/percent/error and sets `uploading=true`). `uploading → idle` on backend success (percent=100). `uploading → idle` on failure with `error` set (error surface displayed, error toast).
- **Triggers:** image file input/drop; `getApiClient().uploadImageFile` progress callback; promise success/failure.
- **Risk:** none — image upload failures now show `error` state via `MeshUploadStatus` component rendered in GeneratePanel (`GeneratePanel.tsx:991–1015`).

### F26. Image presence (`imagePreview`) — `features/workspace/Panels/GeneratePanel.tsx:365, 383–387, 535–537, 664–666, 783–803` (implicit)
- **States:** `empty (null) ↔ selected (data URL string)`
- **Transitions:** `empty → selected` on FileReader `onload`; `selected → empty` on Remove image; re-synced from `generationSettings.image` via useEffect.
- **Triggers:** image file read; `handleRemoveImage`; `generationSettings.image` change.

### F27. Seed mode — `features/workspace/Panels/GeneratePanel.tsx:379, 1369–1401` (implicit)
- **States:** `random (seed === '') ↔ fixed (seed = number)`
- **Transitions:** `random → fixed` when user types number or clicks New; `fixed → random` on Reset to Random (`setSeed('')`); empty/negative input ignored.
- **Triggers:** seed input change; Reset to Random; New random button.

### F28. Post-processing toggle (`enablePostprocess`) — `features/workspace/Panels/GeneratePanel.tsx:372, 1045–1049, 1193, 1246` (implicit)
- **States:** `off ↔ on`
- **Transitions:** toggled via switch; value also written into `generationSettings.enablePostprocess`; when off, Topology/Polycount controls disabled/dimmed.
- **Triggers:** toggle button click.

### F29. Texture toggle (`enableTexture`) — `features/workspace/Panels/GeneratePanel.tsx:373, 1061–1066` (implicit)
- **States:** `off ↔ on`
- **Transitions:** toggled via switch; value also written into `generationSettings` (`generateTexture`, `texture_enabled`, `textureEnabled`).
- **Triggers:** toggle button click.

### F30. Remove lighting toggle (`removeLighting`) — `features/workspace/Panels/GeneratePanel.tsx:375, 1132–1137` (implicit)
- **States:** `off ↔ on`
- **Transitions:** toggled via switch; value written into `generationSettings.removeBackground`.
- **Triggers:** toggle button click.

### F31. PBR toggle (`enablePbr`) — `features/workspace/Panels/GeneratePanel.tsx:376, 1161–1166` (implicit)
- **States:** `off ↔ on`
- **Transitions:** toggled via switch; value written into `generationSettings.highResolutionNormalBaking`.
- **Triggers:** toggle button click.

### F32. Advanced rigging flyout — `features/workspace/Panels/RiggingPanel.tsx:256, 279–303, 690–715, 731` (implicit)
- **States:** `closed ↔ open` (`isAdvancedOpen`)
- **Transitions:** `closed → open` on trigger button; `open → closed` on close button, outside click, Escape (document mousedown/touchstart/keydown with cleanup).
- **Triggers:** trigger button toggle; close button; outside click; Escape key.

### F33. Symmetry snapping toggle (`symmetrySnapping`) — `features/workspace/Panels/RiggingPanel.tsx:261, 90–132, 848–851` (implicit)
- **States:** `off ↔ on`
- **Transitions:** when on, bone rotation edits in `handleRotationChange` mirror to paired `_l`/`_r` bone (Y negated) in both local bones state and live Three.js skeleton.
- **Triggers:** toggle button click in Advanced flyout.

### F34. UV seam highlight toggle (`highlightSeams`) — `features/workspace/dynamic/DynamicUVInspector.tsx:15, 194–218, 352–360` (implicit)
- **States:** `off ↔ on`
- **Transitions:** `off → on`: traverses active model, adds/shows `__isSeamLine` EdgesGeometry child on each mesh. `on → off`: hides seam lines.
- **Triggers:** Highlight Seam Cuts switch click.

### F35. UV viewport checker toggle (`viewportChecker`) — `features/workspace/dynamic/DynamicUVInspector.tsx:16, 221–260, 365–374` (implicit)
- **States:** `off ↔ on`
- **Transitions:** `off → on`: replaces each mesh `material.map` with 256×256 checker CanvasTexture, backing up original in `mat.userData.__origMap`. `on → off`: restores original map from `userData`.
- **Triggers:** Test Grid Material switch click.

### F36. Trajectory arc toggle (`showTrajectory`) — `features/workspace/dynamic/DynamicAnimationInspector.tsx:41, 260–269` (implicit)
- **States:** `off ↔ on`
- **Transitions:** toggled via switch; local state only, drives switch UI.
- **Triggers:** Trajectory Arc switch click.

### F37. X-ray bones mode (`xrayMode`) — `features/workspace/dynamic/DynamicRiggingInspector.tsx:69, 262, 344–352` (implicit)
- **States:** `off ↔ on`
- **Transitions:** passed to `RealModelPreviewCanvas` as `xrayBones`, flipping skeleton helper depthTest/renderOrder and joint sphere depthTest.
- **Triggers:** X-Ray Bones Mode switch click.

### F38. Part seam highlight toggle (`highlightBoundaries`) — `features/workspace/dynamic/DynamicSegmentationInspector.tsx:111, 416–424` (implicit)
- **States:** `off ↔ on`
- **Transitions:** passed to `RealModelPreviewCanvas` as `highlightBoundaries` to toggle boundary wire edges on segmentation meshes.
- **Triggers:** Highlight Part Seams switch click.

### F39. Viewport colorize toggle (`colorizeViewport`) — `features/workspace/dynamic/DynamicSegmentationInspector.tsx:112, 426–437` (implicit)
- **States:** `off ↔ on`
- **Transitions:** passed to `RealModelPreviewCanvas` as `colorizeViewport` to toggle per-part colors vs neutral gray on segmentation meshes.
- **Triggers:** Colorize Viewport switch click.

### F40. Download lifecycle — `stores/useAppStore.ts:76–86, 492–508` (implicit)
- **States:** `queued → downloading → completed / error`; `downloading ↔ paused`
- **Transitions:** `setDownload()` upserts entry with status; `removeDownload()` deletes entry; `clearCompletedDownloads()` drops completed/error entries.
- **Triggers:** `setDownload`, `removeDownload`, `clearCompletedDownloads`.

### F41. Task registry — `stores/useAppStore.ts:64–73, 473–489` (implicit)
- **States:** `queued → running → completed / failed / cancelled`
- **Transitions:** `setTask()` upserts task with status/progress; `removeTask()` deletes entry; `clearCompletedTasks()` drops completed/cancelled entries.
- **Triggers:** `setTask`, `removeTask`, `clearCompletedTasks`.

### F42. Current job — `stores/useAppStore.ts:20, 127–128, 309–324` (implicit)
- **States:** `null → job (queued/running) → completed / failed / cancelled`
- **Transitions:** `setCurrentJob(job)` installs job; `updateJobProgress(jobId, progress, status)` mutates progress/status; `cancelJob()` sets status cancelled.
- **Triggers:** `setCurrentJob`, `updateJobProgress`, `cancelJob`.

### F43. Install progress — `stores/useAppStore.ts:89, 174–175, 511–517` + `features/workspace/types.ts:329–344` (implicit)
- **States:** `idle → starting → downloading → extracting → installing → completed / failed / error`
- **Transitions:** `setInstallProgress(modelId, progress)` upserts per-model `InstallProgress` (status is typed union); `clearInstallProgress(modelId)` removes entry.
- **Triggers:** `setInstallProgress`, `clearInstallProgress`.

### F44. History load — `stores/useAppStore.ts:21, 23–24, 330–350` (implicit)
- **States:** `idle → loading → loaded / error`
- **Transitions:** `loadHistory()` sets `isLoadingHistory=true`, `loadingError=null`; on success sets `jobHistory`, `isLoadingHistory=false`; on catch sets `loadingError`, `isLoadingHistory=false`.
- **Triggers:** `loadHistory()` call (invoked by consumers on mount).

### F45. Reference model — `stores/useAppStore.ts:31, 138–139` (implicit)
- **States:** `null → populated`
- **Transitions:** `setReferenceModel(model)` installs reference model; passing `null` clears it.
- **Triggers:** `setReferenceModel`.

### F46. Cloned job id — `stores/useAppStore.ts:57, 460` (implicit)
- **States:** `null → id → null`
- **Transitions:** `setClonedJobId(id)` sets cloned job id; `setClonedJobId(null)` clears it.
- **Triggers:** `setClonedJobId` (called from `JobDetailView` handleCloneAndEdit).

### F47. Command palette open/close — `stores/useAppStore.ts:51, 458–459` (implicit)
- **States:** `closed ↔ open`
- **Transitions:** `setCommandPaletteOpen(open)` / `toggleCommandPalette()` flip flag.
- **Triggers:** `setCommandPaletteOpen`, `toggleCommandPalette`, command palette button.

### F48. Sidebar / mobile panel open/close — `stores/useAppStore.ts:39–44, 429–434` (implicit)
- **States:** `collapsed ↔ expanded` (left/right/bottom); `closed ↔ open` (mobile left/right/menu)
- **Transitions:** `toggleLeftSidebar`/`toggleRightSidebar`/`toggleBottomPanel` flip collapsed flags; `setMobile*Open` flip mobile open flags.
- **Triggers:** `toggle*` actions; `setMobile*Open` actions.

### F49. Workspace mode dropdown — `features/workspace/Header/TopHeader.tsx:42–43, 46–62, 100, 121–176` (implicit)
- **States:** `closed ↔ open`
- **Transitions:** workspace switcher button toggles `workspaceMenuOpen`; menu item click closes it (calls `navigateToTool`); outside click / Escape dismisses it.
- **Triggers:** button click; menu item click; document mousedown outside; keydown Escape.

### F50. Recent jobs dropdown — `features/workspace/Header/RecentJobsChip.tsx:40, 91, 112–222` (implicit)
- **States:** `closed ↔ open`
- **Transitions:** chip button toggles open; job click / "All Jobs" / "Open Jobs View" close it.
- **Triggers:** chip click; job click; footer links.

### F51. Recent jobs load — `features/workspace/Header/RecentJobsChip.tsx:41, 43–63` (implicit)
- **States:** `idle → loading → loaded / error` (→ empty array)
- **Transitions:** `loadJobs()` sets `loading=true`; on success sets `jobs`, `loading=false`; on catch sets `jobs=[]`, `loading=false`.
- **Triggers:** mount effect; 8s poll interval.

### F52. Recent jobs poll cadence — `features/workspace/Header/RecentJobsChip.tsx:65–69` (implicit)
- **States:** `polling active ↔ stopped (on unmount)`
- **Transitions:** mount sets 8s `setInterval` calling `loadJobs`; unmount clears interval.
- **Triggers:** mount; unmount.

### F53. Jobs list load — `features/admin/tabs/JobsTab.tsx:38–41, 43–63, 85–95` (implicit)
- **States:** `idle → loading → loaded / error` (error shown only when jobs empty, with retry)
- **Transitions:** `load()` sets `loading=true`; success sets `jobs`, `loading=false` (error if empty); catch sets `error`, `loading=false`.
- **Triggers:** mount; 5s interval (skipped when `document.hidden`); retry button.

### F54. Jobs list poll cadence — `features/admin/tabs/JobsTab.tsx:65–73` (implicit)
- **States:** `polling ↔ paused-when-hidden`
- **Transitions:** mount sets 5s interval; each tick returns early when `document.hidden`; unmount clears interval.
- **Triggers:** mount; `visibilitychange`; unmount.

### F55. Jobs filter tab — `features/admin/tabs/JobsTab.tsx:39, 136–151` (implicit)
- **States:** `all / generating / queued / completed / failed`
- **Transitions:** `setFilter(f)` on filter pill click.
- **Triggers:** filter pill clicks.

### F56. Job selection — `features/workspace/Jobs/JobDetailView.tsx:56, 86–88, 382–391` (implicit)
- **States:** `none → selected job id`
- **Transitions:** `fetchJobs()` auto-selects first job when none selected; list item click sets `selectedJobId`; `propJobId` re-initializes on mount.
- **Triggers:** `fetchJobs` auto-select; job list click; `propJobId` change.

### F57. Selected-job detail load — `features/workspace/Jobs/JobDetailView.tsx:58, 109–139, 148–160` (implicit)
- **States:** `idle → loading → idle`
- **Transitions:** `fetchSelectedJobDetails(id)` sets `loading=true`; finally sets `loading=false`.
- **Triggers:** `selectedJobId` change effect; interval poll.

### F58. Raw JSON / table view toggle — `features/workspace/Jobs/JobDetailView.tsx:62, 678–682` (implicit)
- **States:** `table ↔ raw JSON`
- **Transitions:** `setIsRawJsonOpen(!isRawJsonOpen)` on Raw JSON / Table View button.
- **Triggers:** toggle button click.

### F59. Backend online/offline status — `features/workspace/store/WorkspaceContext.tsx:612–628` (implicit)
- **States:** `online ↔ offline`
- **Transitions:** system-stats query refetch updates `systemStats.status`; online→offline edge triggers `toast.warning('Backend is offline')`; offline→online updates tracking ref only.
- **Triggers:** system-stats React Query refetch (5s).

### F60. Settings / export modal open/close — `features/workspace/store/WorkspaceContext.tsx:630–631, 102–105` (implicit)
- **States:** `closed ↔ open` (settings); `closed ↔ open` (export)
- **Transitions:** `setIsSettingsOpen(open)` / `setIsExportModalOpen(open)` flip each boolean.
- **Triggers:** `setIsSettingsOpen`, `setIsExportModalOpen`.

### F61. Active transform tool — `features/workspace/store/WorkspaceContext.tsx:609, 78–79` (implicit)
- **States:** `select / rotate / pan / frame`
- **Transitions:** `setActiveTransformTool(tool)` sets active transform tool.
- **Triggers:** `setActiveTransformTool` calls.

### F62. Model details load — `features/workspace/store/WorkspaceContext.tsx:757, 759–767` (implicit)
- **States:** `empty → populated`
- **Transitions:** mount effect calls `getAvailableModels()` and sets `modelDetails`; catch logs warning (no error state).
- **Triggers:** mount.

## Backend — New findings verified by 10-agent audit (additional)

### B30. Job processing timeout (expiry detection) — `backend/core/scheduler/job_queue.py:222–227, 881–884`; `backend/core/scheduler/multiprocess_scheduler.py:3790–3808` (implicit)
- **States:** `active (PROCESSING with started_at set) → expired (started_at + timeout_seconds elapsed)`
- **Transitions:** `active → expired` when `JobRequest.is_expired()` returns true; cleanup loop stops owning worker and `fail_job()` marks FAILED ("Job processing timed out after 3600 seconds").
- **Triggers:** timeout elapsed since job started; `_job_queue_cleanup_loop` calls `cleanup_expired_jobs()` every 60s.

### B31. Queue-age staleness (impossible-job detection) — `backend/core/scheduler/job_queue.py:229–232`; `backend/core/scheduler/multiprocess_scheduler.py:1782–1783, 1971–1974` (implicit)
- **States:** `fresh (queued, age < 3600s) → stale (age > 3600s) → job failed as impossible`
- **Transitions:** `fresh → stale` when `created_at + 3600s < now`; `_is_job_impossible()` fails job before dequeue. Staleness check invoked at line 1782-1783; fail path at 1971-1974.
- **Triggers:** job age exceeding 1 hour; impossibility check at dequeue in `_job_processing_loop`.

### B32. Redis cancel-request signaling — `backend/core/scheduler/redis_job_queue.py:86, 636–659, 660–709`; `backend/core/scheduler/multiprocess_scheduler.py:1498–1512, 1873–1896` (implicit)
- **States:** `none → cancel-requested (job_id member of 3daigc:cancel_requested set) → cleared/processed`
- **Transitions:** `request_cancel()` sadds cancel_request_key for processing jobs; `_process_external_cancellations()` consumes via `get_cancel_requests()`, stops worker, `clear_request()` sremoves; `cancel_job()` removes from set on completion.
- **Triggers:** user cancel via `request_cancel()`; scheduler loop polls `get_cancel_requests()` each iteration.

### B33. Worker process creation and model-init handshake — `backend/core/scheduler/multiprocess_scheduler.py:2899–3035, 3111–3210` (implicit)
- **States:** `not_created → creating (mp.Process spawned, awaiting init WorkerResponse on control_response_queue) → ready / init_failed (process terminated; error cached in last_worker_error[model_id]; tracking removed)`
- **Transitions:** `_find_or_create_worker_for_job()` → `_create_worker_for_model()` spawns worker, polls control response queue up to `max_load_timeout` (600s default, 1800s for large models); init success → ready; failure/timeout/death → init_failed.
- **Triggers:** job needs worker for its model; WorkerResponse 'init' success/failure; worker load timeout.

### B34. Model residency: idle TTL eviction and auto-unload-after-job — `backend/core/scheduler/multiprocess_scheduler.py:102–129, 1205–1216, 3682–3788` (implicit)
- **States:** `resident (worker holds loaded model, idle timer ticking) → evicted (idle >= TTL) / auto-unloaded after job → unloaded`; dead-process variant → destroyed
- **Transitions:** `_cleanup_idle_workers()` evicts idle workers when `idle_time >= ttl` (default 300s; 0 = immediate via `AUTO_UNLOAD_AFTER_JOB`); `_process_job_in_worker()` unloads model after job completion/failure when `auto_unload_after_job_enabled()` (checked at line 1205); `_cleanup_dead_workers()` destroys dead workers.
- **Triggers:** idle TTL expiry; job completion or failure; worker process death.

### B35. Batch max-parallel concurrency slot — `backend/core/scheduler/multiprocess_scheduler.py:1945–1974, 1963–1982` (implicit)
- **States:** `slot available (active < max_parallel) → slot exhausted (active >= max_parallel)`
- **Transitions:** `available → exhausted` when another same-batch job enters PROCESSING; `exhausted → available` as batch jobs complete; blocked job requeued (front=False, sleep 0.25s) while exhausted.
- **Triggers:** `_batch_slot_available()` checked per job in `_job_processing_loop`; `batch_id`/`batch_max_parallel` in job metadata.

### B36. Application settings lazy initialization and reload — `backend/core/config.py:393–426 (get_settings), 526–566 (get_quality_config cache), 580–585 (reload_settings)` (implicit)
- **States:** `uninitialized ↔ initialized`
- **Transitions:** `uninitialized → initialized` on first `get_settings()` call (loads system.yaml + models.yaml, applies P3D_API_KEY env, forces api_key_required when user_auth_enabled); `initialized → uninitialized + reinitialized` on `reload_settings()` (also clears get_quality_config lru_cache).
- **Triggers:** first call to `get_settings()`; explicit `reload_settings()` call.

### B37. Model download / verify lifecycle — `backend/scripts/download_models.sh:86–114 (hf_download fallback chain), 352–399 (per-model idempotency skip/download), 917–1063 (TaoFlowForge 4-level fallback), 1199–1316 (main loop + failed flag + exit)` (implicit)
- **States:** `flag_parse → tool_availability_check → verify_only` / `per_model_download → cached_skipped → downloading → verified → failed`
- **Transitions:** `flag_parse → tool_availability_check` (hf/wget presence, exit 1 if missing); `tool_availability_check → verify_only` when `VERIFY_ONLY=true`, else → `per_model_download`; `per_model_download → cached_skipped` when not `FORCE_DOWNLOAD` and `verify_file`/`verify_directory` passes; `per_model_download → downloading → verified` on successful download + verification; `per_model_download → failed` on any download/verify failure; `failed=true → exit 1` after loop; all success → exit 0.
- **Triggers:** `FORCE_DOWNLOAD` flag; `VERIFY_ONLY` flag; `verify_file()`/`verify_directory()` result; download command exit code.

### B38. Service lifecycle and menu navigation — `manager.sh:72–83 (status_badge), 85–91 (health), 112–158 (render_status_pills), 613–650 (main_menu loop)` (implicit)
- **States:** `stopped / healthy / building / main_menu / submenu`
- **Transitions:** `stopped → healthy` (pid file present, `kill -0` OK, `curl /health` OK); `stopped → building` (pid file present, process alive, /health failing/absent); `healthy/building → stopped` (process exits, `kill -0` fails); `main_menu → submenu` (numeric selection opens submenu loop); `submenu → main_menu` on 'b'/'B'; any state → exit on 'q'.
- **Triggers:** pid file presence in `.pids/`; `kill -0` liveness check; `curl $BACKEND_URL/health`; `redis-cli ping`; `docker ps` name match; user menu selection.

## Overlaps (already covered above, not re-listed)
- Camera preset / lighting tone / shading mode → F19–F21
- Export modal open/close → F23 / F60
- Worker creation handshake partially overlaps B11/B33
- Job result handling / postprocess / auto-rig → B24
- Texture support state machine → F63 (GeneratePanel.tsx:369-391)
- `buildGenerationParameters` emits both `texture_enabled` and `generate_texture` from single `textureEnabled` flag — fixed missing `generate_texture` key that caused 2 frontend test failures (features/workspace/utils/buildGenerationParameters.ts:208)
- `MeshUploadStatus` now rendered in GeneratePanel when `meshUploadState.status === 'error'` — backend mesh-upload failures previously went unseen (hook emitted `error` but component was imported yet unrendered). Fix in GeneratePanel.tsx:956-960.

### F63. Texture support state machine — `features/workspace/Panels/GeneratePanel.tsx:369-391` (implicit)
- **States:** `none` (model has no texture pipeline) → `2k` (texture up to 2048 atlas) → `4k` (texture up to 4096+ atlas)
- **Transitions:** driven by `TEXTURE_CAPABILITY` lookup on `selectedModel` change. Raw mesh models → `none`; TRELLIS paint → `2k`; Hunyuan3D-Paint/TRELLIS.2 paint/Stable Fast 3D → `4k`.
- **Triggers:** `selectedModel` changes (user picks different AI model from dropdown)
- **Kind:** implicit (derived from capability map, not a useState enum — computed each render)
- **Visibility rule:** `textureSupport === 'none'` → entire Texture section hidden from UI; `textureSupport === '2k'` → only 2K resolution pill shows; `textureSupport === '4k'` → both 2K and 4K pills show
- **Upgrade path:** read `texture_generation` + `output_resolution` from `backend/config/models.yaml` dynamically instead of hardcoded map

