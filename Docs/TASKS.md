# ForMesh3D — Task Tracker & Findings

**Branch:** `dev` | **Profile:** Personal-use, self-hosted 3D studio | **Status:** Ready for next task

---

## 1. Completed Work

**Script Engine for Retopo, Smart UV, Segment** — Completed and verified (ADR-105, 2026-11-16).

- `backend/pipelines/retopo.py`, `smart_uv.py`, `segment.py`, `mesh_utils.py` with `mesh_guard.py` density capping.
- FastAPI endpoints `/api/v1/mesh-tools/auto-retopo`, `/auto-uv`, `/segment` with real SSE progress + SQLite operation registration.
- Workspace Preview Lifecycle: temp staging at `storage/temp/<op_id>/`, preview via `/api/v1/workspace/operations/{operation_id}/preview`, Keep/Discard/Regenerate.
- SQLite: `backend/storage/job_queue.db` (WAL, `busy_timeout=30000`).
- State machines: `ExecutionStatus` (queued→processing→completed|failed|interrupted|cancelled), `PersistenceStatus` (not_saved→saving→saved|save_failed|discarded|cleanup_pending|preview_expired).
- Tests: 4/4 Python pipeline tests, 55/55 Bun frontend tests, no GPU regressions.

---

## 2. Debug Fix: API Workers Crash — `ModuleNotFoundError: No module named 'backend'`

**Root cause:** `backend/api/routers/mesh_tools.py` used absolute imports `from backend.pipelines.retopo import ...`. When uvicorn runs `api.main_multiworker:app` from inside the `backend/` directory, `sys.path` contains `backend/` but not its parent, so `import backend` fails. Same broken pattern in all 4 pipeline files (`retopo.py`, `smart_uv.py`, `segment.py`, `mesh_utils.py`) and the test file.

**Fix:** Changed `backend.pipelines.X` → `pipelines.X` in:
- `backend/api/routers/mesh_tools.py` (lines 19-21)
- `backend/pipelines/retopo.py` (line 16)
- `backend/pipelines/smart_uv.py` (line 17)
- `backend/pipelines/segment.py` (line 19)
- `backend/pipelines/mesh_utils.py` (line 23)
- `backend/tests/test_script_engine_pipelines.py` (lines 14-17)

**Verification:** `PYTHONPATH=. python -c "from pipelines.retopo import execute_retopo"` now succeeds (was `ModuleNotFoundError: No module named 'backend'`).

---

## 3. UI Legacy Audit Findings — Resolved (2026-11-16)

Scan scope: `app/`, `components/`, `features/`, `hooks/`, `lib/`, `services/`, `stores/`, `types/`, `constants/`.
Deterministic legacy rules: 33 guides / 35 rules (~20% of corpus). Feature-specific guidance not yet searched (~80%).

### 2.1 IME-Unsafe Enter Handlers — Resolved

| File | Line | Code |
|------|------|------|
| `features/workspace/Header/SnapshotMenu.tsx` | 203 | `if (e.key === 'Enter') handleSaveSnapshot();` |
| `features/workspace/Modals/ExportModal.tsx` | 361 | `onKeyDown={e => { if (e.key === 'Enter') handleSaveCurrentAsProfile(); ... }}` |

**Resolution:** Both handlers prevent implicit submission and return while `nativeEvent.isComposing` or `keyCode === 229`.

### 2.2 Hex Color Literals — Resolved

Replaced the listed direct hex color values with existing HSL theme variables from `app/globals.css`.

| File | Examples |
|------|----------|
| `components/premium/NeonButton.tsx` | `#FFE066`, `#E09800`, `text-[#080808]`, `WebkitMask: 'linear-gradient(#fff 0 0)...'` |
| `components/premium/MetricCard.tsx` | `accent: '#FFD866'`, `accent: '#22C55E'` |
| `components/premium/ProgressBar.tsx` | `#FFE066`, `#E09800`, `rgba(255, 204, 0, 0.45)` |
| `app/error.tsx` | `text-[#080808]` |
| `app/not-found.tsx` | `text-[#080808]` |
| `app/admin/page.tsx` | `bg-[#0d0e12]` |
| `app/layout.tsx` | `radial-gradient(... #171717 ..., #0d0d0d ..., #080808 ...)` |
| `components/ui/chart.tsx` | `stroke='#ccc'`, `stroke='#fff'` |
| `components/ui/shimmer-button.tsx` | `shadow-[inset_0_-8px_10px_#ffffff1f]` |
| `components/ActivityLogger.tsx` | `text-[#080808]` |
| `features/workspace/store/WorkspaceContext.tsx` | `color: '#FFCC00'`, `gridColor: '#222222'`, `backgroundColor: 'radial-gradient(#3a3c40..., #2d2f33..., #1e1f22..., #121315..., #08090a...)'` |
| `features/workspace/Dashboard/StudioDashboard.tsx` | `from-[#181818]`, `to-[#0f0f0f]`, `bg-[#222222]`, `from-[#FFE066]`, `to-[#E09800]`, `text-[#080808]` |

~30 occurrences across 12 files.

### 2.3 `lucide-react` Imports — Resolved

Migrated all 15 listed workspace files to Hugeicons components backed by `@hugeicons/core-free-icons`; new UI should use `HugeiconsIcon` directly. Shared component wrappers are in `components/icons/hugeicons-components.tsx`.

Files: `GeneratePanel`, `TexturePanel`, `RemeshPanel`, `RiggingPanel`, `SegmentationPanel`, `AnimationPanel`, `EngineModeSelector`, `UVPanel`, `LeftNavigation`, `RightPropertyPanel`, `DynamicAnimationInspector`, `RealModelPreviewCanvas`, `DynamicUVInspector`, `DynamicSegmentationInspector`, `DynamicRiggingInspector`.

### 2.4 Direct DOM Manipulation — Resolved

| File | Code |
|------|------|
| `features/workspace/WorkspaceShell.tsx` | `document.querySelector<HTMLElement>('#left-tool-rail button')?.focus();` |

Replaced the query with a React ref attached to the first workspace tool button.

### 2.5 Browser APIs and SSR — Resolved

| File | Code |
|------|------|
| `features/admin/tabs/LogsTab.tsx` | `window.setInterval`, `window.setTimeout`, `window.clearInterval`, `window.clearTimeout` |
| `features/workspace/lib/artifactDownload.ts` | `window.setTimeout(() => URL.revokeObjectURL(...), 0)` |
| `features/workspace/RightPanel/RightAssetsPanel.tsx` | `window.prompt('New collection name:')` |
| `features/workspace/Modals/GenerationPresetDrawer.tsx` | `window.confirm('Delete preset ...')` |

Replaced `prompt` and `confirm` with accessible dialogs. Artifact download now guards the browser-only save path; `LogsTab` timer calls remain inside `useEffect`.

### 2.6 `dangerouslySetInnerHTML` — Reviewed

| File | Line | Code |
|------|------|------|
| `components/ui/chart.tsx` | 82 | Injects CSS custom properties from the chart configuration. Kept as requested for review only; no behavior change to the injection. |

### 2.7 Already Compliant (No Issues)

SSR guards (`typeof window`, `next/dynamic` `ssr:false`), ARIA labels on dialogs/switches/buttons, focus management, no `eval`/`new Function`/`innerHTML=`.

---

## 3. Implementation Status

All actionable UI audit findings above are resolved. The chart CSS injection was reviewed and intentionally retained. No dependencies were installed, and no build was run.

---

## 4. Verification Status

| Check | Result |
|-------|--------|
| Python pipeline tests | 4/4 passing |
| Bun frontend tests | 55/55 passing across 8 suites |
| UI audit source checks | 123 TS/TSX files syntax-transpiled; Hugeicons imports resolve; no hex literals in the 12 audited files; `git diff --check` passes. Full typecheck and UI runtime checks were not run. |
| GPU regression | None |
| Git status | `dev` branch; changes remain uncommitted as requested. Remote status was not checked. |
| .gitignore | `artifact/`, `.agent/` excluded |

---

## 5. Out of Scope

Do not rewrite AI adapters, change generation/texture flows, add new tool framework/queue, move routes, redesign Studio, or create separate UI surfaces. Keep changes focused.
