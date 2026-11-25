# ForMesh3D Changelog
## 2026-11-25 — TripoSR Unified Raw, Textured and Painting Modes
- Added TripoSR to image-to-raw-mesh generation with the UI texture toggle controlling the official upstream bake step.
- Texture OFF runs official mesh extraction only and does not import or call the texture baker; Texture ON bakes a base-color atlas onto the generated mesh.
- Kept the Texture Painting page path for painting an existing user mesh from a reference image using the same adapter and model pipeline.
- Classified texture-enabled generation as a textured workspace operation for correct asset/version lifecycle.

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

