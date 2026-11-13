# ForMesh3D Changelog

## 2026-11-13 — Generate Panel Button State, Viewport Progress Bar & SF3D Adapter Fix

- **Generate Button State (`features/workspace/Panels/GeneratePanel.tsx`):** Generate and Cancel buttons now share one fixed position — clicking Generate immediately swaps the button to red "Cancel Generation" with an inline progress bar above it; on completion/cancel it returns to yellow "Generate Model". Button stays disabled without an image.
- **Viewport Progress Bar (`features/workspace/Viewport/MeshViewer.tsx`):** Replaced center-card execution overlay with a thin bottom-center progress bar (gray `bg-white/10` track, white fill growing with `executionProgress`, percentage count below). Only visible during execution.
- **Deleted Files:** `features/workspace/Notifications/ProgressOverlay.tsx` and `features/workspace/RightPanel/LiveExecutionPanel.tsx` removed; `ProgressOverlay` export removed from `features/workspace/index.ts`.
- **Right Panel (`features/workspace/RightPanel/RightWorkspacePanel.tsx`):** Removed `LiveExecutionPanel` rendering, Running/Pipeline toggle button, and auto-switch effect — right panel stays on Assets/Property tab during generation; user manually switches if desired.
- **Route URL Hash (`features/workspace/store/WorkspaceContext.tsx`):** All route URL settings (`startTask`, `bindBackendJob`, `generate3DModel`, `selectAsset`) now append a `crypto.randomUUID()` 6-char hash after the cropped name (`.slice(0, 24)`), preventing long-image-name collisions.
- **SF3D Adapter Path (`backend/adapters/stable_fast_3d_adapter.py`):** Fixed vendored `sf3d` import path from `thirdparty/stable-fast-3d` to `thirdparty/StableFast3D`, resolving `ModuleNotFoundError: No module named 'sf3d'`.
- **Thumbnail for Images (`backend/api/routers/file_upload.py`):** Thumbnail endpoint now serves uploaded images (returns image file directly); `thumbnail_url` set for both `mesh` and `image` file types in list response — fixes 404 on image thumbnails.
- **Registered Mesh Downloads (`backend/api/routers/file_upload.py`):** `/file-upload/download/{file_id}` now resolves registered `job-<job_id>` mesh sources only when their canonical asset/job manifest matches the job, including manifests that identify the job through `job_id`.
- **SF3D Model Deps (`backend/requirements-models.txt`):** Added `[SF3D]` section: `gpytoolbox==0.2.0`, `open_clip_torch==2.24.0`, `pynanoinstantmeshes==0.0.3` from `thirdparty/StableFast3D/requirements.txt`.
- **Backend Job Transitions:** Redis requeues now reset hot progress/stage/message fields and persist the queued status to SQLite; SQLite cancellation leaves the queued/processing cache untouched if persisting the terminal status fails. Worker-creation exceptions are preserved for job failure reporting.
- **Mesh Asset Loading (`MeshViewer.tsx`, `useMeshAssetUpload.ts`):** Mesh selection resolves artifact URLs or file IDs to download endpoints, exposes loading/error status, and clears stale viewport geometry; direct uploads preview immediately and late persistence responses do not replace a different selected asset.
- **Texture Model Selection (`buildTextureGenerationParameters.ts`):** The image-mesh-painting request now carries the user's selected model ID instead of forcing Hunyuan3D-Paint v2.1.

## 2026-11-13 — Full 59 State Machines Audit, UI Restructuring & TypeScript Clean Run

- **59 State Machines Audit:** Cataloged 59 state machines across frontend (F1–F40) and backend (B1–B19) in `Docs/TASKS.md` with complete states, transitions, triggers, and exact file+line references. Verified F1–F6, F37–F40, B1–B2, B15–B19 with zero regressions.
- **UI Restructuring in `GeneratePanel.tsx`:** Moved primary generation target controls (Target Polycount Slider 500–600K and Model-Aware Texture Settings) directly to Main Generate Panel. Kept secondary refinement parameters (Remove Lighting toggle, PBR toggle, and Topology Quad/Triangle mode buttons) inside the dynamic flyout. Removed Post-Processing master toggle completely from UI.
- **TypeScript & Build Health:** Fixed JSX unclosed div error in `features/workspace/Panels/GeneratePanel.tsx`; verified `bun tsc` completely clean with 0 errors across the entire codebase.

---

## 2026-11-12 — Snapshot, Icon Colors, Job ID Format, URL Management + Background Brightness

- **Snapshot capture:** Two separate buttons — header Snapshot captures entire workspace as-is (`<name>_<hash>-workspace.png`) at 1920×1080 PNG; tool rail Camera captures mesh only (grid/axes hidden) (`<name>_<hash>-mesh.png`) at 1080p 100% quality. Both save to current route identity (`rabbit_hash`). TASKS.md F64.
- **Icon colors + hover glow:** All icons across LeftNavigation and GeneratePanel use Studio Gold (`#F9CF00`) with `drop-shadow-[0_0_8px_rgba(249,207,0,0.5)]` hover glow (inactive) and `drop-shadow-[0_0_10px_rgba(249,207,0,0.6)]` (active). Resting: `#A1A1AA`. TASKS.md F66.
- **Job ID format:** Backend `job_id` changed from UUID (`380fbba4-e122-4a78-818d-3418dbb0ee46`) to `<name>_<hash>` (`rabbit_380fbb`). DB column `String(36)` → `String(64)`. UI shows `job_id=rabbit_<jobIdHash>`. Matches UI route format.
- **URL route management:** Same-tool nav click clears model + reverts URL to base `/workspace`; switching tools preserves `<name>_<hash>`; task reuse checks existing task before creating new job_id; stacked prefixes stripped via `/^(?:local_|upload_|hist_|job-)+/`. TASKS.md F65.
- **Background brightness:** Viewport (`--surface-0`) 3.1% → 6%; right panel (`--surface-2`) 11.5% → 14%; left nav (`--surface-1`) kept dark at 7.5%. TASKS.md F67.

---

## 2026-11-12 — Native Polycount Targeting + Post-Processing YAML Opt-In

- **Native polycount targeting:** User-set polycount (50K/20K) now reaches model adapter native extraction even when post-processing is disabled. Frontend sends `native_target_polycount`; backend preserves it in job inputs; TripoSG maps to native `faces` param; other adapters log and preserve native output. 3 new test cases added (8/8 pass).
- **Post-processing YAML opt-in:** `postprocessing.enabled: false` added to `backend/config/system.yaml`; `PostProcessingConfig` in `backend/core/config.py`; exposed via `GET /api/v1/system/models`; scheduler gate forces no post-processing when YAML is `false`; API defaults `enable_postprocess: False`; UI hides post-processing controls when disabled.
- **Verification:** `tsc --noEmit` 0 errors; `bun test` 8/8 pass; backend `pytest` 26 passed, 3 skipped; all Python files compile; `bun run lint` 0 errors.
- **State machine audit:** Full implicit state machine inventory in `Docs/TASKS.md` §14 (11 frontend + 4 backend machines). No new implicit state machine created.
