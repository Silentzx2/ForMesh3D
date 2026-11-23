## 2026-11-23 — Model Artifact, Inference Telemetry & PartField Color Fixes
- Fixed PartField RGBA face-color assignment for both the combined mesh and individual part exports.
- Made PartUV export GLB by default while retaining OBJ as an explicit option; the scheduler now builds download URLs from the published artifact extension.
- Added explicit sampling/decoding telemetry for PartField, PartUV and TriFlow inference stages.

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

