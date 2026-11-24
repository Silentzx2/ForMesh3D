# Current Tasks and Verified Cleanup Record

> **Audit date:** 2026-11-24  
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
- `features/workspace/types.ts`, `RemeshPanel.tsx`, and `WorkspaceContext.tsx`: removed the unused `RemeshSettings.variant` field. The panel only wrote `V1K` and the inspector displayed it as `FastMesh Variant`, but the active workspace AI remesh request always submits TriFlow and does not consume that value. Removed the stale field and misleading inspector row.
## 4. Workspace tool execution — current state

- The separate Script-engine execution path has been retired. Retopology (TriFlow), UV (PartUV), segmentation (PartField) and rigging (SkinTokens) dispatch through their configured AI adapters.
- Removed the Script engine selector, its frontend bridge, and deterministic geometric segmentation execution. The PartField island-merging helper remains in a shared utility because neural segmentation uses it for small-island cleanup.
- SQLite operation records remain the common queued/processing/completed/failed lifecycle and lineage mechanism; they are not a separate Script engine.
## 5. Wiring correction

`backend/core/runtime_probe.py` reads `backend.adapters._ADAPTER_MAP`, while `ModelFactory.ADAPTER_REGISTRY` already registered the enabled specialist adapters. The runtime map omitted:
- `triflow_retopology` → `backend.adapters.triflow_adapter`
- `partfield_segmentation` → `backend.adapters.partfield_adapter`

The map now includes these IDs, and `test_batch1_regressions.py` protects the inventory.
## 6. Reviewed and deliberately retained

These were false positives or unsafe deletion candidates:

- `backend/utils/trellis2_utils.py`, TRELLIS.2 adapters, patchers and validation code: retained because TRELLIS.2 is intentionally disabled, not retired. Do not remove disabled-model support.
- `backend/utils/image_super_utils.py`, `pipeline_utils.py`, `simplify_mesh_utils.py`, `multiview_utils.py`, `uvwrap_utils.py`, `torchvision_fix.py`, and `dinov3_vit.py`: compatibility/model support paths; not safe to delete from first-party import counts alone.
- `backend/adapters/trellis2_mesh_validation.py`: retained validation support.
- `backend/api/routers/script_execution.py`, `features/workspace/Panels/EngineModeSelector.tsx`, and `features/workspace/services/meshProcessingBridge.ts`: retired Script-mode execution/UI files; no active callers remain. The PartField island-merging helper was moved to `backend/core/utils/mesh_segmentation_utils.py` before deleting the old geometric segmentation pipeline.
- `features/workspace/Viewport/meshStats.ts`, `glbCache.ts`, and `components/index.ts`: active callers exist.
- Disabled models **Unique3D, Pixal3D, TRELLIS.2, TaoFlowForge**: configuration remains unchanged. No model was enabled or removed.
## 7. API endpoints deliberately preserved

No backend REST endpoint was deleted. Routes without a current frontend caller remain externally addressable and/or documented/tested API contracts. Examples include model parameters, supported-format metadata, candidate download/select, shutdown, adapter inventory, logs configuration, file counts, and database verification. The system router's direct `/api/v1` aliases are also retained for compatibility. Removing these requires a separate explicit API-breaking decision and contract/doc updates.
## 8. Verification baseline

The checked-in CI commands are documented in [CONTRIBUTING.md](../CONTRIBUTING.md). Frontend CI runs frozen Bun install, TypeScript check, lint, tests and production build. Backend CI compiles first-party Python packages, patchers and project scripts while excluding the pinned upstream `backend/thirdparty` submodule; it then runs selected backend contract tests, downloader shell syntax and resolver tests. The full-tree `python -m compileall -q backend` command currently reports an existing `IndentationError` in the pinned TRELLIS source (`backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py:57-58`), so that upstream tree is intentionally not part of the first-party syntax gate. CI does not validate GPU inference or checkpoint installation.
## 9. Viewport-only comparison and PartField AI segmentation

- Right-panel comparison UI, orphan viewer, and persisted picker state removed; viewport wipe remains the only model comparison surface.
- Segmentation is AI-only through PartField. The run action is gated by CUDA, checkpoint, vendored inference source and dependency readiness; no geometric/connected-components Script fallback is exposed.
- Backend readiness/API contracts, PartField adapter tests and UI/API docs were updated. Frontend and backend runtime contract CI passed on the implementation commit; GPU inference smoke test remains environment-dependent.
## 10. Unified viewport comparison — plan and implementation record (2026-11-23)

**Reference:** uploaded `1903.jpg`: same dragon, textured/PBR on one side and neutral white clay on the other, with a draggable diagonal boundary. Use only `MeshViewer.tsx` and `ViewportToolOverlay.tsx`; never restore Right Panel comparison or add another renderer.

**Invariants:** reuse existing Three.js scene, camera, lights, render loop, `isComparing` state and comparison-before group. Comparison is read-only. Load the before copy only while enabled; cancel stale loads and dispose comparison-owned resources on close/error/unmount. Do not dispose active-model resources. Keep alignment, camera, turntable, lighting and exposure consistent. Enable only for a renderable mesh and valid source/result lineage; never infer a predecessor from a filename or unrelated asset.

**Modes:** Texture/PBR = same mesh URL twice, clay override on before copy, textured active after copy. Retopo, Remesh and Segmentation = persisted source mesh versus completed processed mesh. UV = compare only when output is a distinct renderable mesh; atlas/metadata-only output is not comparable. Other tools use generic labels only with verified source/result URLs. Labels: Clay / Untextured ↔ PBR / Textured; Before Retopo ↔ After Retopo; Original Mesh ↔ Remeshed; Before UV ↔ After UV; Original ↔ Segmented.

**Phase 1 — Core contract:** resolve mode, URLs, labels and availability from active tool + asset lineage. Texture uses same URL and clay override; geometry uses distinct verified URLs. Running/failed/missing pairs are unavailable. Cancel stale loads and safely dispose comparison-owned resources.

**Phase 2 — Tool support:** trace existing persisted sourceAssetId/source artifact for Retopo, Remesh, UV and Segmentation. Use only actual mesh outputs; preserve alignment and never fabricate UV geometry.

**Phase 3 — Rail and interaction:** one viewport toggle, mode-specific tooltip/labels, pointer/touch/keyboard drag, no orbit while dragging. Renderer currently uses rectangular WebGL scissor; retain truthful vertical wipe until real diagonal polygon/stencil clipping is implemented and tested. A decorative diagonal over a vertical split is not acceptable.

**Phase 4 — Regression and delivery:** test texture URL availability, missing/equal geometry URLs, failed/running jobs, atlas-only UV, labels, asset/tool switch, stale-load cancellation and cleanup. Run TypeScript, lint, focused tests and production build; backend tests only if backend contracts change. Update design/task docs to shipped behavior.

**Implementation record:** [x] Reference inspected. [x] Texture/PBR same-mesh clay-vs-textured path wired to existing source-group loader. [x] Tool rail enables compare for a loaded Texture/PBR mesh without a separate predecessor. [x] Retopo/Remesh/UV/Segmentation labels use active tool when verified lineage exists. [x] True diagonal wipe implemented with two render-target passes and a full-screen composite shader in the existing WebGLRenderer; divider angle and shader boundary share the same 14-degree geometry. [x] Render targets resize with the viewport and are disposed with the renderer. [x] Frontend CI passed: TypeScript, ESLint, all Bun tests, and production build. [x] Backend Runtime Contract CI passed: Python compile, regression, workspace/API integration, and resolver checks. The shader boundary and divider geometry have deterministic unit coverage; no manual interactive-browser/WebGL visual result is claimed because this session has no running browser.

## 11. Desktop workspace controls — 2026-11-23
- Header popovers are mutually exclusive to prevent dropdown/resource-panel stacking.
- Viewport shading modes have one owner (bottom material dock); wireframe, turntable and grid each have one primary toggle.
- Advanced tool flyouts share the global desktop layout class in `app/globals.css`; height is bounded, overflow scrolls within the flyout, and placement clears the material dock.
- Desktop toggle state is exposed to assistive technology. Mobile-specific layout was not changed.

## 12. PartField multipart persistence and Script-mode retirement — 2026-11-24

- The combined colored GLB remains the active segmentation result.
- When Save Individual Part Files is enabled, every generated part is copied out of the adapter's temporary directory into a versioned workspace folder, registered as an independent mesh asset, and included in a durable ZIP archive.
- ZIP download resolves through the segmentation asset's operation record and serves only the saved part archive; it no longer mistakes a combined single-mesh GLB for a multipart export.
- The client-side fallback refuses to export one combined mesh as a one-file “parts” ZIP.
- Retopology, UV, rigging and segmentation panels expose only their AI model routes; obsolete Script-mode selectors and script-only branches were removed.
- Regression coverage verifies durable part copies, ZIP contents, path containment, and AI-only segmentation request validation.

## 13. Workspace-scoped derived-operation output — 2026-11-24

- Fixed scheduler result handling so retopology, UV, segmentation and rigging do not create an extra `storage/<job_id>/` directory before publishing.
- Derived meshes and thumbnails continue to publish into the existing `storage/<workspace_id>/<operation_type>/` folder and remain registered as immutable workspace assets.
- Adapter-owned temporary output is removed after durable publication. For compatibility, a legacy job-ID directory is removed only with `rmdir()` when it is empty, is not the active workspace, and resolves inside the configured storage root; non-empty directories are never recursively deleted.
- Generation jobs retain their existing canonical workspace creation path.
- Added a regression guard ensuring tool operations cannot create job-scoped roots while generation still can.

## 14. Asset library, selection and viewer lifecycle — 2026-11-24

**Scope:** fix the audited Asset panel and direct workspace/viewer/cache dependencies only. Preserve the current Next.js, React, Zustand, TanStack Query, FastAPI and Three.js architecture; no new dependency, parallel store, backend schema or asset-copy pipeline.

1. **Selection:** all selection entry points (`setCurrentAsset` and ID-based `selectAsset`) share `idle → selecting → verifying → loading`; `MeshViewer` commits `ready` or `error` from the actual loader. Request IDs reject stale outcomes. Retry starts a new request; route changes and deselection invalidate pending work.
2. **Identity:** return the normalized ID from `addAsset` and select that ID. Preserve intentional local duplicates while deduplicating true UUID/URL duplicates. Scope filename dedupe to a known workspace.
3. **Deletion:** resolve only validated job UUIDs, explicit workspace job IDs, or uploaded UUID/`ast_<12 hex>` IDs. Duplicates are local aliases and never delete their source. Do not infer destructive job deletion from category/tag alone. Check HTTP status before removing UI state; on success select another renderable asset or clear viewer, on failure retain the card.
4. **Workspace filter:** `Workspace` means exact workspace matches and stays empty if no workspace assets exist; never fall back to global assets. Include only exact workspace/asset/file identity matches.
5. **Collections:** persist collection names and asset assignments in the existing Zustand localStorage store. Expose a working collection filter; assignment/removal/new membership update UI and persisted mapping.
6. **Pagination/thumbnails:** reset page on category/favorite/collection/scope/workspace changes and clamp after list shrink. Key thumbnail failure by asset ID plus URL.
7. **Upload contract:** display GLB, GLTF, OBJ, FBX, STL and PLY, with the shared 200 MiB frontend/backend cap.
8. **GLB requests:** each caller has an independent abort subscription. Abort the shared controller only after the last consumer leaves; keep timeout active through body consumption and clean timers/listeners/maps on all exits.
9. **Tests:** cover legal/stale selection transitions, safe delete-target resolution and single-consumer versus last-consumer cancellation; validate filter/persistence/pagination behavior where pure logic is exposed.
10. **Delivery:** update task, UI design and changelog docs; run project frontend checks and inspect GitHub CI. Do not claim browser/WebGL or GPU validation unless actually run.

**Implementation record:** selection transitions share viewer loader outcomes; deletion targets are ownership-aware and response-checked; duplicates remain local aliases; workspace scope is strict; collections persist and filter; pagination and thumbnail retry are keyed; upload hints match validation; GLB cancellation is subscriber-aware. Focused Node/Bun regression tests were added.

**Validation:** source changes are committed as one dev update. TypeScript, lint, Bun tests, production build and browser interaction must be verified by CI after push; no GPU/inference code changed.
