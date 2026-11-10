# ForMesh3D Changelog

## 2026-11-10 — Batch 1: Critical Backend Mesh Fixes

- Fixed _enforce_mesh_limits() to unpack the (mesh, telemetry) result returned by memory_safe_decimate() and read shared.feature_edge_angle_deg from the root quality configuration.
- Aligned FastMesh adapter preprocessing with the upstream inference contract: normalize a copy of the input mesh, derive each sampled point's normal from its returned source-face index, use a deterministic 8,192-point subset, and move the input tensor to the model's scheduler-selected device. The adapter now imports sys for its model-specific third-party path setup and reports a clear failure when PyTorch is unavailable.
- Applied the resolved scale-aware cage_extrusion value to Blender's bake settings instead of only calculating and reporting it.
- Added checked-in CPU regression coverage for FastMesh point-cloud preparation, mesh-limit decimator tuple handling / config ownership, and Blender cage-setting wiring. Updated backend CI to run the new test file instead of a test path absent from the current branch.
- Scope boundary: no FastMesh weights/GPU inference or Blender runtime bake was executed in this source-editing session; those runtime checks remain environment-dependent.

---

## 2026-11-09 — Context-Aware Viewport Compare & In-Panel PBR Routing

- Added an on-demand Before / After wipe control to the viewport rail. It is enabled only when the selected asset has distinct source and processed model URLs.
- Reuses the persistent MeshViewer scene, camera and WebGL renderer. The source mesh is loaded only while comparison is active; scissored render passes and a DOM-driven divider avoid a second WebGL context and per-pointer React renders.
- Processing tasks retain their original input mesh URL on remesh, texture, segmentation, rigging and edit outputs, so the compare action can resolve genuine lineage rather than inventing a Before model.
- Added Texture / PBR routing inside the existing Texture panel. The hidden PBR route reuses the same panel and its existing map-baking controls, preserving the persistent workspace transition.

## 2026-11-09 — Workspace UI/UX Polish

- Removed internal scrolling from the seven tool panels, contextual property inspectors, and paginated asset view.
- Preserved existing controls, Studio Gold / matte-black styling, upload cards, Generate-panel reference, and permanently docked desktop side panels.
- Added viewport-height-aware upload previews/dropzones, compact tablet inspector sizing, tool-specific empty-state copy, and slightly more readable rail labels.
- No new tools, buttons, dependencies, or panel-collapse controls were introduced.