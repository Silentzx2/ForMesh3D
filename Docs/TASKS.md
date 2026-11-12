# ForMash3D — Implicit State Machine Inventory

Read-only audit (no code changes). 4 subagents scanned: frontend (Viewport, MeshViewer, panels, stores, hooks) and backend (scheduler, job queue, adapters, API routers). 12+ implicit state machines found, plus explicit enums for reference.

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
- **Kind:** implicit (`hasModel`, `loadError`, `isComparisonLoading`, `isCancelled` ref)
- **States:** `empty → loading → loaded / error`; comparison adds `comparison loading` sub-state
- **Transitions:** `modelUrl` change clears previous model + starts loader (cancellation-safe via `isCancelled`). Success → `setHasModel(true)`, `setLoadError(null)`. Failure → `setLoadError(msg)`. Falsy URL → `setHasModel(false)`, cleared stats.
- **Triggers:** `modelUrl` change (derived from `currentAsset.source.*` / `loadedModelUrl`), `viewportResetTrigger`, `isComparing` toggling `comparisonBeforeGroup`.

### F4. Image/mesh upload FSM — `hooks/useMeshAssetUpload.ts:9–146`, `features/workspace/Panels/GeneratePanel.tsx:345, 514–561`
- **Kind:** implicit on top of explicit `status: 'idle' | 'uploading' | 'saved' | 'error'` useState
- **States:** `idle → uploading → saved →(2s timeout) idle`; error degrades to `saved` (never actually enters `error`)
- **Transitions:** `upload()` sets `uploading`, `onProgress` updates percent. Success → `saved`, percent=100, auto-reset to `idle` after 2000ms. Catch block sets `saved` with `error: null` — **`'error'` state is dead code** (declared but never emitted).
- **Triggers:** file drop/paste input, backend success/failure, 2s timeout reset.
- **Risk:** backend failures look like success to the UI; `MeshUploadStatus` error branch (Panels/MeshUploadStatus.tsx:54–56) is unreachable via this hook.

### F5. Task polling FSMs — `hooks/useTaskPolling.ts:19–168`, `hooks/useTaskManager.ts:51–257`
- **Kind:** implicit (`isPolling` guard, `pollTickCountRef` with exponential backoff 5s→7.5s→10s)
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
- **Implicit coupling:** `activeTool === 'remesh'` forces `showWireframe=true` (974–975). `effectiveShadingMode` forces `uv-checker` when tool is `uv` (662–665).

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

### F12. Composite UI shell — `features/workspace/Viewport/MeshViewer.tsx:1054–1156`
- **Kind:** implicit overlapping render conditions (no single UI-status enum)
- **States/branches:** empty (`!hasModel && !isExecuting`) vs execution overlay (`isExecuting`) vs comparison UI (`isComparing && canCompareModels && hasModel`) vs error toast (`loadError`)
- **Risk:** JSX order resolves overlaps; fragile when adding flags.

### F13. Settings popover — `features/workspace/Viewport/ViewportToolOverlay.tsx:59–85, 51`
- **Kind:** explicit `isSettingsOpen` useState + implicit outside-click/Escape dismiss
- **States:** `closed → open → closed`
- **Triggers:** settings button toggle; outside click / Escape (document listeners); close button.

### F14. Job detail poll cadence — `features/workspace/Jobs/JobDetailView.tsx:94–106` (list) and `:141–154` (selected)
- **Kind:** implicit interval-length machine
- **States:** slow poll (30s) ↔ fast poll (5s / 1200ms when any job running / selected job running)
- **Triggers:** computed `hasRunningJobs` / `selectedJobIsRunning`; `visibilitychange`

### F15. Job status lifecycle — `features/workspace/Jobs/JobDetailView.tsx:141, 294–296, 477–497`
- **Kind:** implicit two-axis status (inference axis `queued/processing/running → completed/failed`; production axis `absent → ready/degraded/failed`)
- **Derived booleans:** `isRunning`, `isCompleted`, `isFailed`; production badges
- **Triggers:** polling `fetchSelectedJobDetails`
- **Risk:** no single source of truth; two independent status axes scattered as booleans.

### F16. Copy-ID toast — `features/workspace/Jobs/JobDetailView.tsx:156–163`
- **Kind:** implicit timeout machine
- **States:** `cleared → showing → cleared after 2000ms`
- **Triggers:** `handleCopyId`; `setTimeout`

### F17. Retry-postprocess guard — `features/workspace/Jobs/JobDetailView.tsx:186–199`
- **Kind:** implicit
- **States:** `idle → retrying (button disabled) → idle`
- **Triggers:** `handleRetryPostprocess`; `finally` resets flag.

---

## Frontend — Animation + dynamic inspectors (subagent 2)

### A1. Animation playback — `stores/useAnimationStore.ts:203–215, 430–448` (semi-explicit) + `DynamicAnimationInspector.tsx:40–41, 58–83, 181–207` (implicit)
- **States:** `stopped → playing → stopped`; `at-end` implicit (`currentTime >= duration`, `isPlaying` forced false if non-looping)
- **Risk:** two clocks — inspector rAF effect and store `tickPlayback` (appears unused by this inspector).

### A2. Rig status — `stores/useAnimationStore.ts:242–243, 523–524` (explicit, dead)
- **States:** `not_rigged → preparing → rigging → rigged / failed`
- **Risk:** `setRigStatus` has **zero callers** — declared but never driven.

### A3–A8. Explicit enums/toggles in `useAnimationStore` — studio mode, inspector tab, viewport tool/render/camera preset, constraint/waypoint/time/ARDY mode, motion AI generation (`idle → generating → completed/failed`), bone/weight/waypoint booleans.

### B1. 3D model load — `stores/useViewerStore.ts:61–62, 86–87, 106–120, 136–142` (implicit)
- **States:** `unloaded (loadedModelUrl === null) → loaded (url + activeModelObject) → replaced` (old blob URL revoked first)
- **Risk:** no `loading`/`error` status enum; state inferred from presence of URL/object.

### C1. Upload lifecycle — `hooks/useMeshAssetUpload.ts:9–16, 30, 34–146` (explicit typed union)
- **States:** `idle → uploading → verifying → saved →(2s) idle`; `error` declared but never emitted (dead state).

### D1–D5. Dynamic inspectors — all implicit:
- **Export busy flags** (×4: Animation, UV, Rigging, Segmentation inspectors): `idle ↔ exporting`, `finally` resets to idle regardless of success/failure → failed exports indistinguishable from success except via toast.
- **UV presence:** `uvData === null` ("No UV Map Found") → non-null (via `handleQuickPlanarUV` / Smart UV Unwrap bumping `forceRefresh`).
- **Selected bone:** `null ↔ bone id`; defaults to `bones[0]`.
- **Pose preset:** `t_pose / a_pose / combat / sitting` applied as values, not stored as mode.
- **Selected part:** `null ↔ part id`; real-model load resets to first part.
- **View angle:** `'front' / 'ortho' / 'side'` (explicit).
- **Part visibility:** per-part `visible` boolean + scene-graph `node.visible`; all-visibility toggle collapses mixed states to "show all".
- **Hover:** `null ↔ id` on `RealModelPreviewCanvas`.
- **Drag-over:** `idle ↔ dragging` via `isDragOver` boolean + `dragCounterRef` counter (nested enter/leave handling).

### E1–E5. Panels:
- **RiggingPanel execution:** `idle → executing (progress 10→30→100) → idle`; error → `idle`, progress 0, step = error message. Coupling trap: `isExecuting = isLocalExecuting || isWorkspaceExecuting` — concurrent local + workspace runs produce ambiguous progress/step.
- **GeneratePanel flow:** input tab `'image' / 'mesh'`; generation `idle → queued → running → completed/failed` (delegated to WorkspaceContext F1/F4); flyout modals open/closed with outside-click/Escape.
- **MeshUploadStatus:** stateless view only.

---

## Backend — Implicit state machines

### B9. Job lifecycle — `backend/core/scheduler/job_queue.py:57–74` (explicit `JobStatus` enum) + `database_models.py:25–30` (duplicate `DBJobStatus`)
- **States:** `QUEUED → PROCESSING → COMPLETED / FAILED / CANCELLED`; recovery `PROCESSING → QUEUED`; retry `COMPLETED → PROCESSING`
- **Transitions:** `enqueue()` QUEUED; `dequeue()` → processing cache; `mark_job_started()` PROCESSING; `complete_job()` COMPLETED; `fail_job()` FAILED (error classified by `classify_job_error()` into CUDA_OOM/INSUFFICIENT_VRAM/MODEL_NOT_READY/INPUT_NOT_FOUND/JOB_TIMEOUT/JOB_CANCELLED/JOB_FAILED); `cancel_job()` CANCELLED; `recover_processing_jobs()` on restart; `prepare_postprocess_retry()` COMPLETED → PROCESSING.
- **Risk:** status enum and physical container (`_queue_cache` / `_processing_cache` / `_completed_cache`) updated separately without transaction — can drift. Duplicate enum in `database_models.py` kept in sync by convention only.

### B10. Queue residency — `backend/core/scheduler/job_queue.py:301–303` + `redis_job_queue.py:78–96` (implicit)
- **States:** pending / processing / completed (by cache or Redis set membership: `3daigc:queue:pending`, `3daigc:queue:processing`, `3daigc:jobs`)
- **Risk:** dual bookkeeping (status enum + container membership updated separately).

### B11. Worker process lifecycle — `backend/core/scheduler/multiprocess_scheduler.py:351–559` (implicit)
- **States:** `starting (load model at init) → idle (main loop waiting on control_queue/job_queue) → processing (_process_job_in_worker) → idle → shutdown`
- **Triggers:** `WorkerMessage.Type`: PROCESS_JOB, LOAD_MODEL, UNLOAD_MODEL, GET_STATUS, SHUTDOWN, HEALTH_CHECK. Model load failure at init → worker exits (terminal). `processing_job` variable is the busy guard.

### B12. Worker busy/idle bookkeeping — `backend/core/scheduler/multiprocess_scheduler.py:1328, 1338, 2099` (implicit)
- **States:** worker idle / busy (`worker_status: Dict[str, bool]`, `worker_current_job`)
- **Risk:** if busy-marking fails between check and mark, job requeued.

### B13. Admission / placement outcome — `backend/core/scheduler/multiprocess_scheduler.py:2896, 1960` (implicit string sentinels)
- **States:** `NO_FEATURE → fail immediately`; `MODEL_LOAD_FAILED → fallback-chain retry → fail`; `WORKERS_BUSY / NO_VRAM → requeue + sleep → retry`; `worker_id → mark busy, enqueue`
- **Cooldown:** `_vram_wait_until` cooldown honored by `_job_processing_loop`.
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

---

## Negative findings (checked, NOT state machines)
- `backend/core/planner.py` — pure function; only memoization caches
- `backend/core/scheduler/model_factory.py` — static `ADAPTER_REGISTRY`, no runtime state
- `backend/core/logging_filters.py` — stateless `JobContextFilter`
- `backend/core/config.py` — singleton `get_settings()` + `reload_settings()`
- `backend/adapters/__init__.py` — static `_ADAPTER_MAP`
- `backend/scripts/download_models.sh` / `manager.sh` — procedural, skip-if-cached gates
- `features/workspace/lib/api.ts` — `ApiClient` is an event emitter; `getSystemStats` computes `online/offline` per call, not persistent

---

## Top risks / recommended actions

1. **MeshUploadStatus error branch unreachable** — upload hook catch degrades to `saved` with `error: null`; backend failures look like success. Consider emitting `error` or removing dead branch.
2. **setRigStatus never called** — rigStatus FSM is dead code.
3. **Duplicated animation clocks** — inspector rAF and store `tickPlayback` both model playing→ended; only inspector wired.
4. **Execution flag coupling** — RiggingPanel merges local + workspace `isExecuting`; concurrent runs produce ambiguous progress/step.
5. **Export machines collapse failure into idle** — all four `isExporting*` flags reset in `finally` regardless of outcome.
6. **Job status / container drift** — status enum and physical container updated separately without transaction.
7. **MeshViewer composite UI shell** — overlapping JSX render conditions (no single UI-status enum); fragile when adding flags.
8. **JobDetailView two-axis status** — inference × production status scattered as derived booleans, no enum.
