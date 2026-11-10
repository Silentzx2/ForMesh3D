# ForMesh3D Changelog

## 2026-11-10 — Batch 3: UV Limits, Ray-Cast Baking, Feature Snapping, and UV Checker

- **UV & Baking:** Removed proxy-transfer cKDTree in `uv_backend_resolver.py`, moved `max_safe_triangles` (100K) to `quality.yaml`, and tuned xatlas options. In `bake.py`, replaced nearest KD with inward ray casting (`sample_high_normals`) and barycentric normal interpolation; removed fake white AO image and corrected raster/sample half-pixel alignment.
- **Retopology & Quality Gate:** Implemented sharp crease snapping (`snap_to_features`) in `autoretopo/pipeline.py` after projection; defaulted `watertight=False` on closed meshes. Replaced $O(N \times M)$ matrix in `_compute_feature_edge_retention` with KD-tree edge midpoints; added `crispness` metric in `gate.py`. In `segment.py`, added majority-vote label smoothing over face adjacency.
- **UI Integrity & Viewport:** Defaulted `SegmentationPanel` to Script mode with honest disabled state for AI mode. Added 3D procedural UV checkerboard inspection mode in `MeshViewer.tsx`, `ViewportToolOverlay.tsx`, and `UVPanel.tsx`. Cleaned hardcoded defaults from `meshProcessingBridge.ts`.
- **Tests:** 26 passed, 3 skipped in backend pytest; 8 passed, 0 failed in `bun test`; 0 TypeScript errors.

---

## 2026-11-10 — Batch 1 mesh-quality completion

- **FastMesh:** removed the stale V4K frontend registry/selector path, fixed workspace AI routing to V1K, and replaced the misleading AI target-budget UI with the checkpoint-fixed approximately 1K-vertex output. Verified the normalized-coordinate export contract against the vendored upstream inference entry point; adapter telemetry now records actual output vertices.
- **Hole repair:** added a non-planar 3D ear-clipping fallback, retained edge-count safety checks, derived boundary incidence directly from triangle faces, and changed the perimeter cap to a bounding-box-diagonal fraction shared by targeted and UV-preserving repair.
- **Decimation:** routed memory-safe decimation through the existing PyMeshLab QEM implementation in one pass, enabled planarquadric for untextured meshes, and removed the slow custom Python QEM implementation.
- **Tests:** CI passed backend compileall and the Batch 1 regression suite (9 passed, 2 skipped), compute-mode resolver tests, frontend TypeScript type-check, and production build. Two optional PyMeshLab QEM integration tests were skipped because PyMeshLab is absent; FastMesh weights/GPU inference, Blender runtime, and visual mesh-quality validation were not run.

---

## 2026-11-10 — Batch 2: Raw-Source Mesh Fidelity

- Narrowed `_enforce_mesh_limits()` to hard-cap enforcement only. Removed discarded hole filling, winding/normal repair, and Taubin smoothing from the pre-persistence raw-source stage.
- In-cap adapter geometry now passes through unchanged; oversized meshes are still reduced through the existing memory-safe decimator before the canonical source is persisted.
- Added a CPU regression test that rejects unexpected repair/smoothing/decimation calls for an in-cap mesh. The test was added but **NOT RUN** in this editing session; GPU and Blender checks also remain **NOT RUN**.
