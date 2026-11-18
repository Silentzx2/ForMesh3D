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

## 6. Active Plan: Storage System Migration — Workspace-ID Based (Per-Variant Subdirectories)

**Goal:** Remove the old `master/` + `game_ready/` subdirectory structure entirely. Replace with workspace-id based storage where every variant has its own subdirectory under `<workspace_id>/`:

`backend/storage/<workspace_id>/` — one directory per job, named by workspace ID.

### File System Structure

```
backend/storage/
├── uploads/                              ← user-uploaded images & thumbnails
│   ├── <uuid>.jpg
│   └── thumbnail_<uuid>.png
├── <workspace_id>/                       ← one directory per job (named by workspace ID)
│   ├── mesh/                             ← mesh variant (uploaded OR generated — SAME logic)
│   │   └── mesh.glb
│   ├── texture/                          ← textured variant + all PBR maps
│   │   ├── textured.glb
│   │   ├── base_color.png
│   │   ├── normal.png
│   │   ├── ao.png
│   │   ├── roughness.png
│   │   ├── metallic.png
│   │   └── orm.png
│   ├── rigging/                          ← rigged variant + all rig outputs (parts, skeleton, etc.)
│   │   ├── rigged.glb
│   │   └── <part_output>.glb
│   ├── retopo/                           ← retopo variant
│   │   └── retopo.glb
│   ├── smart_uv/                         ← smart UV variant
│   │   └── uv.glb
│   ├── segment/                          ← segment variant + all segment parts
│   │   ├── segment.glb
│   │   └── <segment_part>.glb
│   ├── previews/                         ← preview
│   │   └── thumbnail.png
│   ├── metadata/                         ← metadata (kept)
│   │   ├── job.json
│   │   ├── asset.json
│   │   ├── quality_report.json
│   │   └── physics.json
│   └── temp/                             ← temp staging per operation
│       └── <operation_id>/
├── temp/                                 ← global temp staging
│   └── <operation_id>/
```

**Removed entirely:** `master/`, `game_ready/`, `models/meshes/` parent dir, `collision/`, `lods/`

**Key rule:** Generated mesh and uploaded mesh BOTH use `<workspace_id>/mesh/mesh.glb` — same logic, same path.

### Database Tables & Rows (SQLite: `backend/storage/job_queue.db`)

| Table | Purpose | Stores |
|-------|---------|--------|
| `jobs` | Job requests & results | `job_id`, `feature`, `inputs`, `model_preference`, `status`, `result` (JSON with `asset_root`, `output_mesh_path`, `mesh_path`, `artifacts`), `error`, `created_at`, `completed_at` |
| `workspaces` | Workspace identity | `workspace_id`, `name`, `active_mesh_asset_id`, `source_asset_id`, `status`, `settings_json`, `created_at`, `updated_at` |
| `assets` | File location registry | `asset_id`, `workspace_id`, `operation_id`, `operation_type`, `file_type`, `relative_path` (e.g. `mesh/mesh.glb`, `texture/textured.glb`), `original_filename`, `byte_size`, `sha256`, `thumbnail_path`, `is_retained`, `status`, `created_at` |
| `operations` | Operation lifecycle | `operation_id`, `workspace_id`, `operation_type`, `execution_status`, `persistence_status`, `progress`, `result_json`, `error_json`, `temp_dir`, `created_at`, `completed_at` |

**How file locations are tracked:**
- `jobs.result.asset_root` = `backend/storage/<workspace_id>/`
- `jobs.result.output_mesh_path` = `backend/storage/<workspace_id>/mesh/mesh.glb`
- `jobs.result.mesh_path` = `backend/storage/<workspace_id>/mesh/mesh.glb`
- `assets.relative_path` = `mesh/mesh.glb`, `texture/textured.glb`, `rigging/rigged.glb`, etc. (relative to workspace root)
- `assets.thumbnail_path` = `previews/thumbnail.png` or operation-specific thumbnail
- `workspaces.active_mesh_asset_id` = asset_id of the currently active mesh asset

### State Machines

**ExecutionStatus** (jobs & operations):
```
queued → processing → completed
              ↘      ↘
              failed ← cancelled
              ↘
              interrupted
```
Transitions enforced in `database_models.py` `ExecutionStatus.ALLOWED_TRANSITIONS`.

**PersistenceStatus** (file saves):
```
not_saved → saving → saved
              ↘      ↘
            save_failed ← discarded
              ↘
            cleanup_pending
              ↘
            preview_expired
```
Transitions enforced in `database_models.py` `PersistenceStatus.ALLOWED_TRANSITIONS`.

**Mesh Guard** (density capping at 2M faces):
```
mesh loaded → face count ≤ 2,000,000 → PASS (untouched)
              → face count > 2,000,000 → decimate to 2M → CAPPED
```

### Complete Operation Flows

**Flow A: User uploads mesh on any page → runs operation**
1. Upload saves to `backend/storage/uploads/<uuid>.glb`
2. `prepare_asset_job_workspace()` copies to `<workspace_id>/mesh/mesh.glb` → `saving` → `saved`
3. `register_asset_job_manifest()` records `mesh_path: "mesh/mesh.glb"` in `<workspace_id>/metadata/job.json`
4. User runs operation → `queued` → `processing`
5. Operation output saved to variant subdir: `<workspace_id>/texture/textured.glb`, `<workspace_id>/rigging/rigged.glb`, etc.
6. `output_mesh_path` updated to variant path → `completed`

**Flow B: User generates mesh (Text-to-3D / Image-to-3D)**
1. Adapter generates mesh → temp staging → `processing`
2. Scheduler copies to `<workspace_id>/mesh/mesh.glb` → `saving` → `saved`
3. `output_mesh_path`, `mesh_path`, `asset_root` all = `<workspace_id>/mesh/mesh.glb`
4. `guard_mesh_density()` caps at 2M faces → `completed`

**Flow C: User runs operation on existing job (re-operation)**
1. System reads current mesh from `<workspace_id>/mesh/mesh.glb` → `completed`
2. Operation writes output to its variant subdir → `queued` → `processing` → `saved` → `completed`
3. Manifest updated with new artifact path
4. Old mesh NOT deleted — user can re-operate multiple times

**Flow D: User downloads mesh/variant**
| Format | File Path |
|--------|-----------|
| `glb`/`gltf`/`obj`/`stl`/`ply` | `<workspace_id>/mesh/mesh.glb` |
| `textured` | `<workspace_id>/texture/textured.glb` |
| `rigged` | `<workspace_id>/rigging/rigged.glb` |
| `retopo` | `<workspace_id>/retopo/retopo.glb` |
| `smart_uv` | `<workspace_id>/smart_uv/uv.glb` |
| `segment` | `<workspace_id>/segment/segment.glb` |
| `texture_base_color` | `<workspace_id>/texture/base_color.png` |
| `texture_normal` | `<workspace_id>/texture/normal.png` |
| `texture_ao` | `<workspace_id>/texture/ao.png` |
| `texture_roughness` | `<workspace_id>/texture/roughness.png` |
| `texture_metallic` | `<workspace_id>/texture/metallic.png` |
| `texture_orm` | `<workspace_id>/texture/orm.png` |
| `thumbnail` | `<workspace_id>/previews/thumbnail.png` |
| `qa_report` | `<workspace_id>/metadata/quality_report.json` |
| `job_json` | `<workspace_id>/metadata/job.json` |
| `asset_json` | `<workspace_id>/metadata/asset.json` |
| `physics_json` | `<workspace_id>/metadata/physics.json` |

**No fallback** to `master/` or `game_ready/` — those directories don't exist.

**Flow E: User selects candidate (T-06)**
1. User picks candidate → copied to `<workspace_id>/mesh/mesh.glb`
2. Unselected candidates deleted → cleaned
3. `output_mesh_path` = `<workspace_id>/mesh/mesh.glb` → `completed`

### Edge Cases — What Happens If…

| Scenario | Result |
|----------|--------|
| Upload mesh on Generate page, then Rig page runs rigging | Upload in `mesh/`, rig output in `rigging/` — both preserved |
| Generate mesh, then texture on same job | Mesh in `mesh/`, texture + PBR maps in `texture/` — coexist |
| Run same operation twice on same job | Second run overwrites variant file (same path), no duplicate dirs |
| Mesh exceeds 2M faces | `guard_mesh_density()` decimates to 2M faces → saved capped |
| Download variant that doesn't exist | 404: `"{format} artifact not found in workspace {job_id}"` |
| Workspace already exists from previous job | Reused cleanly, new `mesh.glb` overwrites old |
| Delete a job/workspace | Only `metadata/` removed; mesh & variant files remain (safe, no data loss) |
| Image upload then generation on same job | Upload stages image to `temp/upload_<asset_id>/` only (no storage-root dir). Generation creates one `<workspace_id>/` and copies image to `<workspace_id>/input/source_image<ext>` — one workspace dir per job |

### Implementation Phases

**Phase 1: artifact_utils.py** ✅ DONE
- `_storage_root()` → `get_storage_base_dir()` directly (`backend/storage/`)
- `canonical_asset_workspace()` → `_storage_root() / clean_job_id` = `backend/storage/<workspace_id>/`
- `prepare_asset_job_workspace()` → writes to `asset_root/mesh/mesh.glb` (subdirectory, not flat)
- `register_asset_job_manifest()` → `master_path` param renamed to `mesh_path`, stores `mesh_path: "mesh/mesh.glb"`

**Phase 2: scheduler.py** ✅ DONE
- Copy adapter output to `<workspace_id>/mesh/mesh.glb` (subdirectory)
- Set `output_mesh_path`, `mesh_path`, `asset_root` to `<workspace_id>/mesh/mesh.glb`
- `guard_mesh_density` max_faces 1M → 2M ✅ DONE
- Remove `master/` and `game_ready/` directory creation ✅ DONE
- Fix `register_asset_job_manifest` calls → pass `mesh_path` not `master_path` ✅ DONE
- Fix `source_master_path` metadata key → `source_mesh_path` ✅ DONE
- Fix rigging `expected_dir` → `asset_root` ✅ DONE

**Phase 3: system.py — Download endpoint** ✅ DONE
- Mesh formats: `<workspace_id>/mesh/mesh.glb` first, then variants
- Textured: `<workspace_id>/texture/textured.glb`
- Rigged: `<workspace_id>/rigging/rigged.glb`
- Retopo: `<workspace_id>/retopo/retopo.glb`
- Smart UV: `<workspace_id>/smart_uv/uv.glb`
- Segment: `<workspace_id>/segment/segment.glb`
- Texture maps: `<workspace_id>/texture/<name>.png`
- Thumbnail: `<workspace_id>/previews/thumbnail.png`
- Metadata: `<workspace_id>/metadata/<name>`
- Removed `lod0`…`lod3`, `collision` blocks entirely
- Remove `game_ready/` fallback entirely
- Fix `select_candidate_mesh()` → copy to `<workspace_id>/mesh/mesh.glb` ✅ DONE

**Phase 4: file_upload.py — Upload/download** ✅ DONE
- Upload validation: check `<workspace_id>/mesh/mesh.glb`
- Upload write path: `<workspace_id>/mesh/mesh.glb`
- Download candidates: `<workspace_id>/mesh/mesh.glb` first, then variant subdirs
- Cleanup: `<workspace_id>/metadata/` only

**Phase 5: database.py** ✅ DONE
- Fix `_models_root()` → `_storage_root()` (no `/models`)
- Fix disk stats path `storage / "models" / "meshes"` → `storage`
- Fix `check_job_asset_persistence()` — removed `game_ready`/`lods`/`collision` refs, added `textured`/`rigged`/`retopo`/`smart_uv`/`segment`

**Phase 6: Mesh guard** ✅ DONE
- `GLOBAL_MAX_FACES` 1M → 2M

**Phase 7: Verify** ✅ DONE
- `ast.parse()` all 6 Python files — 0 syntax errors
- Zero `master/`/`game_ready/` filesystem path references in backend code (only docstring comments remain)
- `canonical_asset_workspace()` returns `backend/storage/<workspace_id>/`

### Out of Scope
- Do not rewrite AI adapters.
- Do not change generation/texture inference flows.
- Do not move API routes.
- Do not add new tool framework or queue.
- Do not push unless explicitly requested.

