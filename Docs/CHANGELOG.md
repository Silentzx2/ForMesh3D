# ForMesh3D Changelog

## 2026-11-24 — Asset Library and Viewer Lifecycle Reliability
- Connected selection requests to actual Three.js load completion/failure and protected newer selections from stale responses.
- Made deletion ownership-aware, prevented duplicate aliases from deleting source files, and checked backend responses before updating the library.
- Fixed strict workspace filtering, persistent collection assignments/filtering, pagination clamping, thumbnail retry identity and upload hints.
- Made shared GLB fetches independently cancellable per consumer and added focused regression tests.
- Fixed desktop Generator accordion state, added persisted Favorites toggling, and stopped stale or fabricated geometry metrics from appearing during asset selection.
- Stabilized PartField merge-tree labels by first source-face occurrence, fixing the partial-cut cluster ordering regression.
- Corrected cancellation terminal states, batch task identity mapping and abort behavior; batch cancellation no longer calls the destructive job-deletion endpoint.

## 2026-11-24 — Workspace-Scoped Derived Operation Storage
- Prevented retopology, UV, segmentation and rigging jobs from creating duplicate `storage/<job_id>/` directories.
- Kept durable outputs and thumbnails under the existing workspace operation folders; legacy empty job directories are removed conservatively.

## 2026-11-24 — PartField Multipart Persistence & AI-Only Tool Modes
- Persisted individual PartField part meshes in versioned workspace storage and registered each part as a mesh asset.
- Added a workspace-backed ZIP archive for the actual individual part files; combined colored GLB remains the active result.
- Removed obsolete Script-engine selectors and deterministic script segmentation execution while preserving the PartField island-merging utility.
