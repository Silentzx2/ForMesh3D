# ForMesh3D Changelog

## 2026-11-22 — README, Model Manifest and Text-Paint Adapter Wiring

- Restored the README banner, workspace screenshot and Mermaid architecture flow; rewrote the page as a project overview with verified features, setup, architecture and checks.
- Removed unused model-manifest metadata, normalized YAML formatting, and registered TRELLIS text painting as an alias over its existing checkpoint/adapter.
- Added regression coverage and strengthened the model contract verifier to check enabled IDs against both adapter registries.

## 2026-11-22 — Dead-Code Audit, Registry Wiring and Documentation Correction
- Re-audited the `dev` branch against imports, dynamic references, router registration, tests, API contracts and the pinned third-party submodule.
- Removed 11 unreferenced/broken first-party files, 14 unused API-client methods, five unused exports, and the deprecated synchronous `resolve_file_id()` stub.
- Preserved REST endpoints with no current UI caller, disabled model support trees, third-party compatibility shims, and shared script-execution helpers.
- Corrected runtime adapter inventory for TriFlow Retopology, FastMesh V1K and PartField Segmentation; added a regression test.
- Rewrote the current-state, architecture, product, blueprint, API, task and README documentation to match the checked-in wiring. No disabled model was enabled or removed.
- Scoped backend syntax CI to first-party Python sources so an existing syntax error in the pinned TRELLIS submodule does not mask project-owned syntax or contract failures.
- Removed the unused remesh `variant` state and misleading FastMesh inspector row; regression checks now reflect the TriFlow workspace default and fixed V1K adapter contract.
- Corrected script-mode execution to schedule its pipeline as a FastAPI background task rather than awaiting it before responding; refreshed integration tests for the raw-first generation contract and current FastAPI route schema.

## 2026-11-21 — Workspace Viewport Idle-Render & Bundle Optimization
- Replaced the unconditional main viewport RAF loop with invalidation-based rendering.
- Inspector preview now renders on interaction, damping, resize, model rebuild and preview-setting changes.
- Added shared invalidation for in-place inspector/property mutations.
- UV, segmentation, animation and rigging inspectors load only when their matching tool is selected.
- Replaced broad Zustand subscriptions with focused selectors. Browser/GPU performance gains require separate profiling; no unmeasured FPS claim is made.
