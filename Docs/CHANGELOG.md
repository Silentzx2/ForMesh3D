# ForMesh3D Changelog

## 2026-11-23 — Desktop Workspace Controls & Overlay Collision Fixes
- Made header popovers mutually exclusive across workspace mode, resource monitor, recent jobs, snapshots and notifications.
- Centralized desktop advanced-tool flyout positioning in `app/globals.css`, with bounded height, internal scrolling and clearance above the viewport material dock.
- Removed duplicate viewport shading/toggle controls; the material dock owns shading modes and the viewport rail owns primary wireframe, turntable and grid toggles.
- Added explicit pressed-state semantics to viewport toggles and removed the inert navigation-help button affordance.
- Updated `Docs/DESIGN.md` and `Docs/TASKS.md`. Mobile layout was intentionally left out of scope.

## 2026-11-22 — README, Model Manifest and Text-Paint Adapter Wiring
- Restored the README banner, workspace screenshot and Mermaid architecture flow; rewrote the page as a project overview with verified features, setup, architecture and checks.
- Removed unused model-manifest metadata, normalized YAML formatting, and registered TRELLIS text painting as an alias over its existing checkpoint/adapter.
- Added regression coverage and strengthened the model contract verifier to check enabled IDs against both adapter registries.

## 2026-11-22 — Dead-Code Audit, Registry Wiring and Documentation Correction
- Re-audited the `dev` branch against imports, dynamic references, router registration, tests, API contracts and the pinned third-party submodule.
- Removed 11 unreferenced/broken first-party files, 14 unused API-client methods, five unused exports, and the deprecated synchronous `resolve_file_id()` stub.
- Preserved REST endpoints with no current UI caller, disabled model support trees, third-party compatibility shims, and shared script-execution helpers.
- Corrected runtime adapter inventory for TriFlow Retopology, FastMesh V1K and PartField Segmentation; added a regression test.
- Rewrote current-state, architecture, product, blueprint, API, task and README docs to match checked-in wiring. No disabled model was enabled or removed.
- Scoped backend syntax CI to first-party Python sources; the pinned TRELLIS submodule is excluded from first-party syntax checks.
- Removed unused remesh `variant` state and misleading inspector row; corrected script-mode execution to schedule the pipeline as a FastAPI background task and refreshed integration tests.
