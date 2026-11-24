# ForMesh3D Changelog

## 2026-11-24 — Workspace-Scoped Derived Operation Storage
- Prevented retopology, UV, segmentation and rigging jobs from creating duplicate `storage/<job_id>/` directories.
- Kept durable outputs and thumbnails under the existing workspace operation folders; legacy empty job directories are removed conservatively without recursive deletion.


## 2026-11-24 — PartField Multipart Persistence & AI-Only Tool Modes
- Persisted individual PartField part meshes in versioned workspace storage and registered each part as a mesh asset.
- Added a workspace-backed ZIP archive for the actual individual part files; combined colored GLB remains the active result.
- Removed obsolete Script-engine selectors and deterministic script segmentation execution while preserving the PartField island-merging utility.

## 2026-11-23 — Workspace Operation Telemetry & Live Execution Logs
- Persisted bounded per-operation progress/debug events in SQLite and exposed them through job history and operation status APIs.
- Added colored Operation Trace with per-stage progress bars, lifecycle banners, timestamps and debug/error levels.
- Streamed headless Blender stdout/stderr while running; added operation-specific stage checkpoints and mesh diagnostics for Retopology, Smart UV and Segmentation.
- Added safe operation settings summaries, output validation/publish/hash milestones and failure tracebacks.

## 2026-11-23 — Model Artifact, Inference Telemetry & PartField Color Fixes
- Fixed PartField RGBA face-color assignment for both the combined mesh and individual part exports.
- Made PartUV export GLB by default while retaining OBJ as an explicit option; the scheduler now builds download URLs from the published artifact extension.
- Added explicit sampling/decoding telemetry for PartField, PartUV and TriFlow inference stages.

## 2026-11-23 — Desktop Workspace Controls & Overlay Collision Fixes
- Made header popovers mutually exclusive across workspace mode, resource monitor, recent jobs, snapshots and notifications.
- Centralized desktop advanced-tool flyout positioning in `app/globals.css`, with bounded height, internal scrolling and clearance above the viewport material dock.
- Removed duplicate viewport shading/toggle controls; the material dock owns shading modes and the viewport rail owns primary wireframe, turntable and grid toggles.
- Added explicit pressed-state semantics to viewport toggles and removed the inert navigation-help button affordance.
