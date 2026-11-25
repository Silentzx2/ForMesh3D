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
## 10. Unified viewport comparison — 2026-11-23
- Reused the existing MeshViewer scene, camera, renderer and source-lineage contract.
- Implemented a real 14-degree diagonal wipe with two render-target passes and mode-aware labels.
- Added deterministic shader/geometry coverage; frontend and backend runtime CI passed. No manual browser visual run is claimed.

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
- Unified selection with actual loader completion/error handling and stale-request protection.
- Made deletion ownership-aware; persisted Collections/Favorites; enforced exact workspace filtering.
- Fixed pagination, thumbnail retry identity, upload guidance and per-consumer GLB cancellation with focused regressions.

## 15. Desktop inspector and asset controls — 2026-11-24
- Persisted Generator accordion state and per-asset Favorites; tool changes auto-expand only until manual override, and favorites use stable asset identity.
- Cleared stale geometry stats during selection while retaining the previous rendered mesh; unavailable manifold/UV metrics remain unknown. Desktop only; mobile unchanged.

## 16. PartField merge-tree label stability — 2026-11-24
- Labels follow first source-face occurrence, preserving deterministic partial-cut order without changing merge ancestry or requested part count; regression covers leaf-versus-parent internal ID ordering.

## 17. Task cancellation, batch retries and polling — 2026-11-24
- Explicit cancellation records `cancelled`, aborts pending batch submissions, resolves local/backend task IDs, and uses `/cancel` rather than destructive job deletion.
- Batch retries retain original settings; polling ignores stale terminal-state responses and stops scheduling when no backend jobs remain.

## 18. TripoSR unified image-to-mesh, optional texture and mesh painting — 2026-11-25
**Plan/implementation:** one adapter imports the official `TSR` pipeline and serves both `image_to_raw_mesh` and `image_mesh_painting`. The generation UI's texture switch controls the official pipeline branch; the Texture Painting page supplies an existing mesh plus a reference image.
**Texture OFF:** call upstream `TSR.extract_mesh(scene_codes, True, resolution=256)`, export raw GLB, and do not import or invoke `tsr.bake_texture`.
**Texture ON:** call upstream `TSR.extract_mesh(scene_codes, False, resolution=256)`, then official `tsr.bake_texture.bake_texture(generated_mesh, model, scene_code, resolution)`; export one GLB with a base-color atlas.
**Texture Painting page:** call official `bake_texture(existing_mesh, model, scene_code, resolution)` and preserve the supplied mesh geometry. No normal, roughness, metallic or AO maps are claimed.
**Compatibility:** upstream `positions_to_colors` is patched per TripoSR worker to move query chunks onto the scene-code device and return colors to CPU. Upstream mesh extraction, atlas generation, rasterization and baking remain unchanged.
**Dependencies:** `torchmcubes` comes from the released CPython 3.10 wheel via install.sh's existing wheelhouse helper; it is not installed from Git. `moderngl` stays model-only and the baker is lazy-imported only when texture is requested.
**Third-party prerequisite:** upstream source is expected at `backend/thirdparty/TripoSR`; checkpoints at `backend/pretrained/TripoSR`. The third-party submodule is not edited here.
**Verification:** tests cover texture-off extraction without baker import, texture-on extraction+baking, existing-mesh painting, geometry preservation, device-safe queries, registry and wheelhouse contracts. GPU visual quality still requires source/checkpoints and a real GPU smoke test.
