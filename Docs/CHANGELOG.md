# ForMesh3D Changelog

## 2026-11-12 — Model-Aware Texture Settings + Texture Parameter Fix

- **Texture state machine:** Added implicit `textureSupport` state machine (`none → 2k → 4k`) derived from `selectedModel` via `TEXTURE_CAPABILITY` map (`GeneratePanel.tsx:369-391`). States: `none` = model has no texture pipeline, `2k` = texture up to 2048 atlas, `4k` = texture up to 4096+ atlas. Triggers on `selectedModel` change.
- **Texture moved to main panel:** Removed Texture toggle + Texture Quality pills from the Geometry & Texture flyout. Added model-aware Texture section directly in the main GeneratePanel (after AI Model, before Seed).
- **Model-gated visibility:** Texture section hidden when `textureSupport === 'none'` (raw mesh models). 2K-only models show 2K pill; 4K-capable models show both.
- **Fixed `buildGenerationParameters` texture param:** Added missing `generate_texture` key (alongside `texture_enabled`) emitted from single `textureEnabled` flag — fixes 2 failing frontend tests (`preserves texture options`, `honors texture disable`).
- **Tests:** `npx tsc --noEmit` 0 errors; `bun test` 11 pass / 0 fail (was 9/2 before fix).

---\n## 2026-11-12 — Floating Mesh Details HUD with Live Geometry Metrics

- **Viewport UI:** Replaced the existing bottom-left stats pill with a collapsible Mesh Details card styled from the supplied reference and positioned above the shader dock / clear of the XYZ gizmo.
- **Real data:** Faces, Verts, Edges, and Materials come from the loaded Three.js model; Size comes from the uploaded file or actual generated-job file metadata. Unsupported metrics are omitted.
- **Performance:** Geometry stats are captured once on model load. Exact edge enumeration is capped at 250,000 faces; larger scenes omit only Edges.
- **Metadata and tests:** Asset normalization retains real backend material counts and file size; added geometry-stat tests for indexed, non-indexed and instanced meshes. CI type-check and all three new geometry tests passed; the wider suite still has two pre-existing `generate_texture` contract failures, so the workflow skipped the production build.
- **Documentation:** Updated design, architecture, system blueprint, project memory, task tracker, and README.

---

## 2026-11-12 — Reference-Matched Floating XYZ Orientation Gizmo

- **Viewport artwork:** Replaced the old 64×64 circular button cluster with the supplied XYZ sphere artwork at `public/assets/xyz-orientation-gizmo.png`. The image is cropped to the artwork bounds and blends into the dark viewport.
- **Six-axis interaction:** The visible X/Y/Z labels snap to positive X/Y/Z views; reverse-axis hit targets snap to negative X/Y/Z and reveal their labels on hover or keyboard focus.
- **Camera correctness:** Added explicit `back` (−Z) and `bottom` (−Y) cases in `MeshViewer.tsx`; both now snap to their intended cardinal view instead of the isometric fallback.
- **Documentation:** Updated the design, architecture, system blueprint, task tracker, audited memory, and README.

---

## 2026-11-12 — Upload Error State, Single Viewport UI Status, Single Job Status Source

- **Upload:** `useMeshAssetUpload` catch now emits `status: 'error'` with the failure message instead of degrading to `saved` with `error: null`, so the `MeshUploadStatus` error branch is reachable and backend failures no longer look like success.
- **Viewport UI:** `MeshViewer` renders one mutually exclusive `viewportStatus` enum (`idle | empty | executing | comparing | error`) instead of overlapping JSX conditions.
- **Jobs:** `JobDetailView` derives a single `jobStatus` from `selectedJob.status`; scattered `isRunning`/`isCompleted`/`isFailed` booleans and the duplicate `selectedJobIsRunning` are removed.
- **Tests:** `npx tsc --noEmit` passed with 0 errors.
- **Documentation:** TASKS.md state-machine inventory updated (F4, C1, F12, F15); resolved risks 1, 7 and 8 removed from the top-risks list.
- **RiggingPanel:** resolved risk R3 (execution flag coupling) — local auto-rig run and workspace job execution are no longer merged into one executing flag; the render source is derived once with fixed local-then-workspace priority, so concurrent runs show deterministic progress/step.
