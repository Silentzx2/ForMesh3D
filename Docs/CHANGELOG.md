# ForMesh3D Changelog

## 2026-11-12 — Snapshot, Icon Colors, Job ID Format, URL Management + Background Brightness

- **Snapshot capture:** Two separate buttons — header Snapshot captures entire workspace as-is (`<name>_<hash>-workspace.png`) at 1920×1080 PNG; tool rail Camera captures mesh only (grid/axes hidden) (`<name>_<hash>-mesh.png`) at 1080p 100% quality. Both save to current route identity (`rabbit_hash`). TASKS.md F64.
- **Icon colors + hover glow:** All icons across LeftNavigation and GeneratePanel use Studio Gold (`#F9CF00`) with `drop-shadow-[0_0_8px_rgba(249,207,0,0.5)]` hover glow (inactive) and `drop-shadow-[0_0_10px_rgba(249,207,0,0.6)]` (active). Resting: `#A1A1AA`. TASKS.md F66.
- **Job ID format:** Backend `job_id` changed from UUID (`380fbba4-e122-4a78-818d-3418dbb0ee46`) to `<name>_<hash>` (`rabbit_380fbb`). DB column `String(36)` → `String(64)`. UI shows `job_id=rabbit_<jobIdHash>`. Matches UI route format.
- **URL route management:** Same-tool nav click clears model + reverts URL to base `/workspace`; switching tools preserves `<name>_<hash>`; task reuse checks existing task before creating new job_id; stacked prefixes stripped via `/^(?:local_|upload_|hist_|job-)+/`. TASKS.md F65.
- **Background brightness:** Viewport (`--surface-0`) 3.1% → 6%; right panel (`--surface-2`) 11.5% → 14%; left nav (`--surface-1`) kept dark at 7.5%. TASKS.md F67.

---

## 2026-11-12 — Model-Aware Texture Settings + Texture Parameter Fix

- **Texture state machine:** Added implicit `textureSupport` state machine (`none → 2k → 4k`) derived from `selectedModel` via `TEXTURE_CAPABILITY` map (`GeneratePanel.tsx:369-391`). States: `none` = model has no texture pipeline, `2k` = texture up to 2048 atlas, `4k` = texture up to 4096+ atlas. Triggers on `selectedModel` change.
- **Texture moved to main panel:** Removed Texture toggle + Texture Quality pills from the Geometry & Texture flyout. Added model-aware Texture section directly in the main GeneratePanel (after AI Model, before Seed).
- **Model-gated visibility:** Texture section hidden when `textureSupport === 'none'` (raw mesh models). 2K-only models show 2K pill; 4K-capable models show both.
- **Fixed `buildGenerationParameters` texture param:** Added missing `generate_texture` key (alongside `texture_enabled`) emitted from single `textureEnabled` flag — fixes 2 failing frontend tests (`preserves texture options`, `honors texture disable`).
- **Tests:** `npx tsc --noEmit` 0 errors; `bun test` 11 pass / 0 fail (was 9/2 before fix).

---

## 2026-11-12 — Native Polycount Targeting + Post-Processing YAML Opt-In

- **Native polycount targeting:** User-set polycount (50K/20K) now reaches model adapter native extraction even when post-processing is disabled. Frontend sends `native_target_polycount`; backend preserves it in job inputs; TripoSG maps to native `faces` param; other adapters log and preserve native output. 3 new test cases added (8/8 pass).
- **Post-processing YAML opt-in:** `postprocessing.enabled: false` added to `backend/config/system.yaml`; `PostProcessingConfig` in `backend/core/config.py`; exposed via `GET /api/v1/system/models`; scheduler gate forces no post-processing when YAML is `false`; API defaults `enable_postprocess: False`; UI hides post-processing controls when disabled.
- **Verification:** `tsc --noEmit` 0 errors; `bun test` 8/8 pass; backend `pytest` 26 passed, 3 skipped; all Python files compile; `bun run lint` 0 errors.
- **State machine audit:** Full implicit state machine inventory in `Docs/TASKS.md` §14 (11 frontend + 4 backend machines). No new implicit state machine created.

- **Upload:** `useMeshAssetUpload` catch now emits `status: 'error'` with the failure message instead of degrading to `saved` with `error: null`, so the `MeshUploadStatus` error branch is reachable and backend failures no longer look like success.
- **Viewport UI:** `MeshViewer` renders one mutually exclusive `viewportStatus` enum (`idle | empty | executing | comparing | error`) instead of overlapping JSX conditions.
- **Jobs:** `JobDetailView` derives a single `jobStatus` from `selectedJob.status`; scattered `isRunning`/`isCompleted`/`isFailed` booleans and the duplicate `selectedJobIsRunning` are removed.
- **Tests:** `npx tsc --noEmit` passed with 0 errors.
- **Documentation:** TASKS.md state-machine inventory updated (F4, C1, F12, F15); resolved risks 1, 7 and 8 removed from the top-risks list.
- **RiggingPanel:** resolved risk R3 (execution flag coupling) — local auto-rig run and workspace job execution are no longer merged into one executing flag; the render source is derived once with fixed local-then-workspace priority, so concurrent runs show deterministic progress/step.

---
