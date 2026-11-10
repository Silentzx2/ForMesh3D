# ForMesh3D — Mesh Pipeline Audit (Tripo-Level Quality Target)

- Repository: `Silentzx2/ForMesh3D`, branch **`dev`** (lowercase; there is no `Dev` branch), audit baseline commit `2d5fd0c`
- Scope: postprocess scripts (hole repair, decimation, retopo, UV, normal bake, segmentation), FastMesh adapter, workspace UI panels
- Docs read: `AGENTS.md`, `Docs/CHANGELOG.md`, `Docs/MEMORY.md`, postprocess sections of `Docs/ARCHITECTURE.md`, `backend/postprocess/README.md`
- Docs NOT fully read: `Docs/TASKS.md`, `DESIGN.md`, `PRD.md`, `SYSTEM-BLUEPRINT.md`. `pipeline.py` (3.3K lines) only partly read. `backend/thirdparty` submodule not cloned. Raw adapters (Hunyuan etc.) not audited.

## Evidence labels

| Label | Meaning |
|---|---|
| **RUN** | Executed and tested by me on a synthetic mesh using CPU |
| **STATIC** | Reviewed the code only; not executed |
| **UNTESTED** | A snippet is proposed but has not been run; the agent must add and run a test |

No GPU model or Blender runtime was executed. Treat all such checks as **NOT RUN** until the agent runs them, in accordance with `AGENTS.md`.

## Current branch reconciliation — 2026-11-10

The original audit below was performed against commit `2d5fd0c`. The current dev branch was checked at 0282a55 on 2026-11-10 before the Batch 1 completion work; the original audit baseline remains 2d5fd0c.

The following audit findings have already been addressed in those two commits and must not be reimplemented:

- **FastMesh (source-level resolved):** the UI, TypeScript model registry, bridge defaults, workspace request, and backend model preference now expose V1K only. AI mode shows the checkpoint-fixed approximately 1K-vertex output; script-only topology and target-face controls are hidden in AI mode. The vendored upstream FastMesh inference.py at submodule commit 48ca8dc normalizes the input and exports model output without an inverse transform, so the adapter deliberately preserves the normalized output coordinates. No GPU inference or weights validation was run.
- **`_enforce_mesh_limits` (partial):** the `(mesh, telemetry)` return value from `memory_safe_decimate()` is unpacked, and `shared.feature_edge_angle_deg` is read from the root quality configuration. CPU regression coverage exists in `backend/tests/test_batch1_regressions.py`. The separately reported work performed on an in-memory copy and then discarded still needs review.
- **Blender cage assignment (resolved):** the worker now assigns the computed cage to `bake.cage_extrusion`. The YAML and pipeline defaults use `0.0` for automatic, scale-aware cage/ray distances. CPU regression coverage exists in `backend/tests/test_batch1_regressions.py`.
- **Hole repair (source-level resolved):** a Newell-normal 3D ear-clipping fallback now handles non-planar loops after the existing planar triangulator, with the edge-count safety guard retained. Perimeter limits use holes.max_hole_perimeter_frac against the full mesh bounding-box diagonal. The UV-preserving repair path uses the same fallback and scale rule.
- **Decimation (source-level resolved):** memory_safe_decimate now delegates to the existing PyMeshLab _simplify path once, uses planarquadric=True for untextured meshes, and no longer calls the slow pure-Python QEM. The old feature_preserving_decimate function and re-export were removed.

This reconciliation is based on the Git diff and current source changes, not on a fresh runtime execution. The tests listed above were found in the repository but were **not run during this documentation update**. GPU inference, FastMesh weights, and a Blender runtime bake remain **NOT RUN** here. Revalidate all remaining findings against the current source before implementing them.

---

## 0. Summary

| # | File | Problem | Priority | Evidence |
|---|---|---|---|---|
| 1 | FastMesh adapter / workspace UI | V1K-only registry and request; fixed-output UI contract; upstream normalized export verified from vendored source | P0 | PASS — static contract; GPU NOT RUN |
| 2 | `postprocess/services/hole_repair.py` | Non-planar 3D ear-clipping fallback and scale-aware perimeter limit implemented | P0 | PASS — CI regression test |
| 3 | `postprocess/pipeline.py::_enforce_mesh_limits` | Tuple-unpacking, shared-config lookup, and discarded raw-stage repair/smoothing are resolved on current dev | P1 | PASS — regression unit test |
| 4 | Shared PyMeshLab decimation | One-shot _simplify dispatch; PyMeshLab target/UV/boundary integration tests added | P0 | PASS — 2 PyMeshLab tests PASS |
| 5 | `services/uv_backend_resolver.py` | Proxy-transfer removed; max_safe_triangles guard and xatlas tuning added | P0 | PASS — unit regression |
| 6 | `postprocess/tools/bake_worker.py` | Cage extrusion is now applied and scale-aware on current dev | P0 | RESOLVED on current dev |
| 7 | `postprocess/services/bake.py` | sample_high_normals raycasting, scale-aware cage/ray, no fake AO, half-pixel alignment | P0 | PASS — unit regression |
| 8 | Segmentation "AI" mode & smoothing | UI defaults to script; AI disabled with honest label; boundary majority-vote label smoothing implemented | P0 | PASS — unit regression & UI |
| 9 | `autoretopo/*` | snap_to_features crease snapping implemented; watertight default on closed meshes | P1 | PASS — unit regression |
| 10 | `services/gate.py`, `core/quality/metrics.py` | KD-tree midpoint edge retention; crispness metric implemented | P1 | PASS — unit regression |
| 11 | UI panels / bridge / viewer | Honest labels, bridge defaults cleaned, interactive 3D UV checkerboard inspection mode | P1 | PASS — tsc & bun test |
| 12 | Config | Canonical quality.yaml ownership, BakeOptions alignment | P2 | PASS — quality.yaml |

Correction: `_enforce_mesh_limits` previously ran hole filling, winding/normal repair, and Taubin smoothing before the size check. The caller only persisted the returned mesh when vertex or face counts decreased, so those edits were discarded for in-cap meshes; for oversized meshes, they could be included in the persisted decimated result. The raw-stage repair/smoothing calls have now been removed. This stage only enforces hard size caps; topology repair remains on the derived post-processing copy. Raw-mesh smoothness still requires adapter/model-side investigation.

---

## 1. FastMesh adapter — V1K-only contract

**Current-dev status: IMPLEMENTED; static contract regression PASS; GPU inference NOT RUN.**

- The backend manifest and adapter factory already registered only fastmesh_v1k_retopology; the frontend's stale V4K entry, selector option, default, bridge parameters, and request branch have now been removed.
- Workspace AI mode identifies FastMesh V1K and displays its checkpoint-fixed output (approximately 1K vertices). The adjustable target-face budget and topology selector are shown only in Script mode, where the bridge consumes them.
- The API keeps target_vertex_count only as a deprecated compatibility field. The adapter no longer reports the requested value as if it were an inference target; it reports the actual output vertex count.
- Coordinate contract was checked against the vendored FastMesh source at ThirdParty submodule commit 48ca8dc20ad97bb7f011e4cadb4de9e3ecd32ee9: FastMesh/inference.py normalizes the input mesh to a 1.9-unit longest extent, calls the model, then exports the generated mesh directly. There is no inverse transform in that upstream inference path. The adapter therefore intentionally does not apply one.
- The V1K-only UI/registry/API contract regression passed in CI. No checkpoint load, GPU inference, output-mesh inspection, or visual quality test was run.

## 2. Hole repair — postprocess/services/hole_repair.py

**Current-dev status: IMPLEMENTED; CPU regression PASS in CI.**

- The planar ear-clipping path remains first choice.
- If a loop is not planar, fill_hole_ear_clip uses a Newell normal and a 3D-aware ear score/containment test to triangulate the original boundary vertices while preserving loop winding.
- The existing candidate-edge count guard remains in place; a candidate that would create an edge with more than two incident faces is rejected.
- The absolute max_hole_perimeter was replaced by holes.max_hole_perimeter_frac (0.25), multiplied by the full mesh bounding-box diagonal. Both the targeted repair and UV-preserving repair paths use the same scale-aware limit and non-planar fallback.
- Boundary cycles and edge-incidence checks are derived directly from oriented triangle faces, avoiding assumptions about Trimesh edges/edges_sorted ordering across versions.
- Appending faces now uses the supported Trimesh.faces setter rather than extend_faces, which is not present in the tested Trimesh API surface.
- CI passed the noisy open-sphere regression for 12, 18, and 40 boundary edges at two scales; the test asserts one detected loop, zero remaining boundary edges, watertightness, and winding consistency.

## 3. `_enforce_mesh_limits` — `postprocess/pipeline.py` line ~1754-1810

**Current-dev status: RESOLVED for this function's audited issues.** The tuple-unpacking crash and root-level `shared` configuration lookup were fixed in Batch 1. The discarded `fill_holes` / winding / normal / Taubin work was removed in Batch 2. A regression test was added to prove an in-cap mesh is returned unchanged and that no repair, smoothing, or decimation function is invoked. That new test was not run in this editing session.

**Original findings at the audit baseline (`2d5fd0c`):** items 1 and 3 were fixed on current `dev`; item 2 remains open.
1. **Resolved on current dev:** the decimator returns a `(mesh, telemetry)` tuple. The audit baseline assigned that tuple directly to `mesh`, which caused the next `len(mesh.vertices)` access to raise `AttributeError` for meshes above the cap (>500K vertices / >1M faces). Current code unpacks the tuple.
2. **Resolved on current dev (Batch 2):** raw-stage repair and smoothing calls were removed. `_enforce_mesh_limits` now only measures the mesh and decimates when a configured hard cap is exceeded. Repair is left to the derived post-processing pipeline.
3. **Resolved on current dev:** the baseline read `shared` from `mesh_cfg`; current code reads it from the root quality configuration, where `shared` is a top-level key.

```python
# Around line 1768: crease angle
crease_angle = float(cfg.get("shared", {}).get("feature_edge_angle_deg", 35.0))
```
```python
# Batch 2 resolution: no raw-stage repair or smoothing call belongs here.
```
```python
# Historical fix from the audit baseline; already present on current dev.
# Around the former line ~1792:
mesh, _telemetry = memory_safe_decimate(
    mesh,
    target_faces=target_faces,
    crease_angle_deg=crease_angle,
    max_ram_fraction=0.80,
)
```

---

## 4. Decimation — shared PyMeshLab QEM

**Current-dev status: IMPLEMENTED; dispatch regression PASS; PyMeshLab integration tests SKIPPED.**

- memory_safe_decimate now calls the existing simplify._simplify implementation once, instead of the custom pure-Python QEM and its staged 50% loop.
- The size threshold and host-RAM fraction remain as a memory guard; when either is exceeded, garbage collection runs before the native C++ decimator.
- The untextured PyMeshLab QEM path now enables planarquadric=True, preservenormal=True, preserveboundary=True, and preservetopology=True.
- The textured path continues to use per-wedge UV coordinates and reconstructs the UV/material data after decimation. The old Python QEM implementation, class wrapper, and utility re-export were deleted.
- The non-PyMeshLab fallback now uses Trimesh's quadric simplifier rather than re-entering the removed Python QEM.
- CI passed the one-shot _simplify dispatch regression. The optional PyMeshLab tests for 3,072 → 1,500 face reduction, UV retention, watertightness, and open-boundary preservation were collected but SKIPPED because PyMeshLab is not installed in the CI test environment.

## 5. UV — `services/uv_backend_resolver.py`

**Current-dev status: IMPLEMENTED; regression PASS in `backend/tests/test_bake_and_uv.py`.**

- The proxy-transfer KDTree branch in `_unwrap_massive_mesh_safe` was removed.
- Meshes with face counts exceeding `max_safe_faces` raise a clean `ValueError("UV unwrap needs <= {max_safe_faces} triangles (got {len(f)}). Decimate first.")`.
- `max_safe_triangles: 100000` is canonically owned by `backend/config/quality.yaml: uv: max_safe_triangles` and registered in `_QUALITY_REQUIRED_KEYS`.
- `xatlas.ChartOptions` tunes `normal_seam_weight=2.0` and `max_iterations=4`, and `pack_opts.bruteForce=True` is enabled for meshes < 20,000 triangles.

---

## 6. Blender bake — `postprocess/tools/bake_worker.py`

**Current-dev status: RESOLVED for the reported cage-assignment bug.** The current worker assigns `bake.cage_extrusion = cage`, and the pipeline plus `quality.yaml` use `0.0` defaults to enable scale-aware automatic values. Regression coverage is checked in. Do not add the same assignment again. A Blender runtime bake was not run during this documentation update.

**Original issue at the audit baseline (STATIC, grep-verified; resolved on current dev):** `cage` was computed (around lines 789–793) and reported in stats (line 913), but `bake.cage_extrusion` was not assigned. Rays therefore started at the low-poly surface, potentially missing portions of the high-poly mesh that extended beyond it. The current worker now applies the computed cage; see the current-dev status above.

```python
# Historical one-line fix from the audit baseline; already present on current dev:
bake.cage_extrusion = cage
```

Other bake concerns:
- The current `dev` branch now passes `0.0` (= auto) from `quality.yaml` and the pipeline, allowing the worker to derive the cage from 2% of the low-poly bounding-box diagonal and the maximum ray distance from 2.5× the cage. Keep these values scale-aware; do not restore absolute defaults.
- `samples=8` is reasonable for normals but too low for AO; use a separate sample count for the AO pass.
- `quality.yaml` sets `bake.texture_size: 1024`, while the `BakeOptions.resolution` default is 2048. Establish a single source of truth.

---

## 7. Pure-Python bake fallback — `postprocess/services/bake.py`

**Current-dev status: IMPLEMENTED; regression PASS in `backend/tests/test_bake_and_uv.py`.**

- `sample_high_normals` replaces nearest-neighbor cKDTree with inward ray casting (`high_mesh.ray.intersects_location(origins, -N_low, multiple_hits=True)`) and barycentric normal interpolation.
- Cage extrusion (2% of low bounding-box diagonal) and max ray distance (2.5× cage) are derived scale-aware.
- Fake white AO generation (`np.full(..., 255)`) was removed; when requested, `ao` is reported in `unsupported_maps`.
- Rasterization polygon mapping is aligned to `(x + 0.5) / res` matching the sampling points.
- CI unit tests verify sphere normal angle error < 0.5 degrees, UV range [0, 1], and no fake AO map.

---

## 8. Segmentation

### 8.1 The AI mode is non-functional
- `backend/config/models.yaml:599` contains `mesh_segmentation: {}` (no adapter is registered).
- `SegmentationPanel.tsx:275` sets `useState<EngineMode>('ai')` as the default.
- `meshProcessingBridge.ts` lists `neural_part_seg` in its registry, and the Changelog also mentions "Neural Semantic Part Segmentation".

Result: when the user clicks Run, the request returns "No models available for feature 'mesh_segmentation'". Under the `AGENTS.md` rule, the control must be disabled or labeled honestly.

**Immediate fix:** Set the default to `'script'` and keep the AI option disabled with the label "No model installed" until a model is available.

**Long-term fix (Tripo-level):** Add a neural adapter. Candidate approaches (the papers were checked; **code licenses were not verified**):
- **P3-SAM** (Tencent Hunyuan, arXiv 2509.06784): native 3D, automatic + point-prompt, point masks → mesh faces.
- **PartField** (Liu et al. 2025): feature field + clustering, part count control.

Implement `adapters/<name>_adapter.py` + `patcher/<name>/` (per `AGENTS.md` rule 3) + a `models.yaml` entry. Preserve the same `mapping` (per-face labels) output format produced by `segment.py::run_segment`, so the UI replay logic does not need to change.

### 8.2 Script mode (`services/segment.py`) — improvements
- Boundaries are limited by the proxy resolution (3,000 faces, `_map_to_proxy`). Full-resolution label smoothing produced a small improvement in a RUN test: synthetic-sphere accuracy increased from 94.89% to 95.78%, and incorrect faces decreased from 1,046 to 865:

```python
    """Edge-length-weighted majority vote over face adjacency."""
    a, b = mesh.face_adjacency.T
    e = mesh.face_adjacency_edges
    w = np.linalg.norm(mesh.vertices[e[:, 0]] - mesh.vertices[e[:, 1]], axis=1)
    k = int(labels.max()) + 1; lab = labels.copy()
    for _ in range(iters):
        votes = np.zeros((len(lab), k))
        votes[np.arange(len(lab)), lab] += self_w * np.bincount(a, w, len(lab)).clip(1e-9)
        np.add.at(votes, (a, lab[b]), w); np.add.at(votes, (b, lab[a]), w)
        new = votes.argmax(1)
        if (new == lab).all(): break
        lab = new
    return lab
```
`run_segment`: call this after `labels` are created and before submeshes are built. The real improvement will come from graph-cut (with concave-edge cost) and a neural model; this is only a cleanup step.
- `proxy_faces=3000` and `sdf_rays=20` are hard-coded in the bridge (`meshProcessingBridge.ts`); use the backend `SegmentOptions` defaults instead.
- The per-face Python loop `for fi in np.flatnonzero(counts)` in `_compute_sdf` is acceptable at 3,000 faces; vectorize it if the proxy resolution is increased.
- Without `embreex`, ray queries fall back to the proxy for meshes above 20K faces (the UI displays a note). Add an installation check to `manager.sh`.

---

## 9. Retopology — `postprocess/services/autoretopo/*`

**Current behaviour**: voxel shell (optional) → `isotropic_explicit_remeshing` → decimate → projection (displacement field Laplacian-smoothed) → optional `to_quad_dominant`.

**Problems**
- The output is an isotropic triangle mesh, not edge-flow- or field-aligned topology. A different algorithm is needed for clean Tripo-style quads.
- With `quads=True`, the quad list is stored only in `stats["quad_faces"]`; the interactive route still returns a GLB containing triangles. The UI displays "Target: N Quads".
- The interactive bridge defaults to `watertight: true`, so the voxel shell resolution (diagonal/384) rounds edges. The production pipeline correctly uses `watertight=False` for already-closed meshes.
- The bridge hard-codes `feature_angle: 45`, while the backend default is 25.
- `project._lap_smooth` smooths the displacement field, which blurs crease lines.
- `quadriflow_remesh()` is implemented but is not called anywhere.

**Feature snap (RUN):** a cube was rounded with Laplacian smoothing, projected, and then snapped:

| Stage | Distance of edge vertices from the crease line (mean / max, % of diagonal) |
|---|---|
| Rounded | 2.597 / 3.371 |
| Projected only | 1.901 / 2.913 |
| Projected + snap | **0.000 / 0.000** (0 degenerate faces) |

```python
from scipy.spatial import cKDTree
import numpy as np

def snap_to_features(V, src, angle_deg=35.0, tol_frac=0.03, spacing_frac=0.004):
    """Snap vertices near sharp source edges onto the exact edge line."""
    diag = np.linalg.norm(src.bounds[1] - src.bounds[0])
    sharp = src.face_adjacency_angles > np.radians(angle_deg)
    E = src.face_adjacency_edges[sharp]
    if len(E) == 0:
        return V
    A, B = src.vertices[E[:, 0]], src.vertices[E[:, 1]]
    ln = np.linalg.norm(B - A, axis=1); step = spacing_frac * diag
    pts, seg = [], []
    for i in range(len(E)):
        m = max(2, int(ln[i] / step) + 1)
        pts.append(A[i] + (B[i] - A[i]) * np.linspace(0, 1, m)[:, None]); seg.append(np.full(m, i))
    pts, seg = np.vstack(pts), np.concatenate(seg)
    d, idx = cKDTree(pts).query(V)
    sel = d < tol_frac * diag
    a, b = A[seg[idx[sel]]], B[seg[idx[sel]]]
    ab = b - a
    t = np.clip(np.einsum('ij,ij->i', V[sel] - a, ab) / np.maximum(np.einsum('ij,ij->i', ab, ab), 1e-18), 0, 1)
    out = V.copy(); out[sel] = a + ab * t[:, None]
    return out
```

Wiring (`autoretopo/pipeline.py`): insert this immediately after projection and before `finalize_watertight`:

```python
if cfg.preserve_features:
    V = project.snap_to_features(V, original, angle_deg=cfg.feature_angle)
```

Limitations: noisy generative meshes can produce many false sharp edges in `face_adjacency_angles` (marching-cubes ripples). First apply light smoothing/denoising to the source for feature detection, or increase the angle threshold (45–60 degrees). Testing on real meshes is required.

**Quads**
- If quads are a required deliverable, route `quad_faces` through OBJ export (the production pipeline already has `_export_quad_obj`); also set `format=obj` in the interactive `/mesh-tools/auto-retopo` route.
- For true quad topology, consider QuadWild / Instant Meshes / QuadriFlow as optional engines (verify their licenses). Wire `quadriflow_remesh` into `remesh.py` or delete it.

**Defaults (UI bridge):** default `watertight` to `false` when the input is already closed; use the backend's `feature_angle` default.

---

## 10. Gate & metrics

- `services/gate.py::evaluate_topology_gate` checks only manifoldness, holes, floaters, degenerates, and aspect ratio. It does **not** measure sharpness. A smooth but manifold mesh passes as "clean", causing `skip_retopo=True`—so the gate cannot detect the reported smooth Hunyuan 2.1 mesh issue. Add a crispness metric (UNTESTED):

```python
def crispness(mesh, angle_deg=35.0):
    ang = np.degrees(mesh.face_adjacency_angles)
    return {"sharp_edge_frac": float((ang > angle_deg).mean()),
            "p99_dihedral_deg": float(np.percentile(ang, 99))}
```
Compare against a reference/source mesh; keep the threshold under `quality.yaml gate:`.

- `core/quality/metrics.py::_compute_feature_edge_retention`: `align = np.abs(np.dot(ref_u, cand_u.T))` creates a dense (reference-sharp-edges × candidate-sharp-edges) matrix and is followed by a Python loop per reference edge. This risks OOM or slow performance on a 900K-face master mesh (STATIC). Replace it with a KD-tree approach (UNTESTED):

```python
from scipy.spatial import cKDTree
cand_mid = (cand_v0 + cand_v1) * 0.5
d, nbr = cKDTree(cand_mid).query(ref_mid, k=8, distance_upper_bound=dist_tol)
valid = np.isfinite(d)
nbr_safe = np.where(valid, nbr, 0)
dots = np.abs(np.einsum('ij,ikj->ik', ref_u, cand_u[nbr_safe]))
retained = int((valid & (dots >= cos_angle_tol)).any(axis=1).sum())
```
(This uses midpoint distance and may differ slightly from segment distance; compare the two approaches with tests.)

---

## 11. UI / UX (workspace)

Pages: `/workspace` (Generate, Texture, Remesh, UV, Segmentation, Rigging, Animation panels), `/dashboard`, `/admin`, `/system`.

| Issue | Where | Fix |
|---|---|---|
| Segmentation defaults to AI, but no model is installed | `SegmentationPanel.tsx:275` | Default to `'script'`; disable AI and use an honest label |
| Remesh defaults to V4K / quad / 50K | RemeshPanel.tsx and WorkspaceContext.tsx | Resolved: V1K only; AI output is checkpoint-fixed, and target/topology controls are Script-only |
| UI says "Target: N Quads", but output is triangles | `RemeshPanel.tsx:1256` | Wire quad OBJ export or correct the label |
| Hard-coded `proxy_faces`, `sdf_rays`, `feature_angle || 45` | `meshProcessingBridge.ts` | Use backend defaults; remove UI-owned duplicates |
| Script mode defaults to `watertight: true` | Bridge + RemeshPanel | Default to false for already-closed meshes |
| `method: 'auto'` and `max_cone_deg` are mapped from the Blender button | Bridge | Check Blender runtime availability (`blender_runtime_available`); otherwise disable the button |
| Viewer has wireframe / normals / matcap, but **no UV checker** | `MeshViewer.tsx` | Add checker-texture shading for UV/bake debugging |
| Quality report / sharpness badge | Planned in prior notes | Add the `crispness` metric and display `quality_report.json` as a badge in the Asset panel |
| Bake-result visibility | Texture panel PBR route | Show normal/AO previews plus `unsupported_maps` / `degraded` status |

---

## 12. Config drift (P2)

- `bake.texture_size: 1024` (yaml) vs `BakeOptions.resolution` default 2048 vs pipeline `texture_resolution`.
- The current `dev` branch uses `0.0` auto defaults for `bake.cage_extrusion` / `max_ray_distance`; verify the schema and ensure no absolute override is reintroduced.
- `xatlas_max_safe_triangles` is a code-level default and is not defined in YAML.
- `mesh.decimation_trigger_*` exists in YAML but is not used in code.
- `BakeOptions(normal_space=..., convention=...)` (around `pipeline.py` line 2640): verify that these fields exist in the schema; Pydantic may silently ignore extra fields. The Blender worker hard-codes `TANGENT` + `POS_Y`.

---

## 13. Agent task checklist (must follow `AGENTS.md`)

1. Read `AGENTS.md` and all `Docs/*.md` files top-to-bottom, then bottom-to-top.
2. Do not modify the native `sm >= 80` path (Rule 1); these changes concern CPU post-processing and adapter input preparation.
3. Work order: (1) UI/model-registry contract → (2) hole fallback → (4) decimator replacement → (7) bake sampling → (5) UV guard → (9) feature snap → (10) crispness metric → (8) segmentation default + adapter → (11) UI. The raw-stage in-memory cleanup item is complete.
4. Add a checked-in test under `backend/tests/` for every fix:
   - hole fill: noisy sphere 12/18/40 edge holes → watertight
   - decimate: box 3072→1500 target hit
   - `_enforce_mesh_limits`: a mesh above the cap does not crash (the current branch already has regression coverage for tuple unpacking/config ownership).
   - bake: sphere high/low, mean angle error < 0.5°
   - Snap: cube crease vertices lie exactly on the crease line.
5. Report test results as `PASS / FAIL / NOT RUN` honestly. Use `NOT RUN` when GPU, Blender, or weights are unavailable.
6. Update the relevant documentation: `Docs/MEMORY.md` (audited state), `Docs/CHANGELOG.md` (keep only the last 3 entries), `Docs/ARCHITECTURE.md` (post-processing section), and `Docs/TASKS.md`.
7. Configuration ownership: quality policy → `quality.yaml`; model facts → `models.yaml`. Do not duplicate these values in the UI.
8. Final deliverable: a ZIP containing only the modified files.

## 14. Items not covered by this audit

- The root cause of raw-mesh smoothness (Hunyuan 2.1 adapter / octree / marching cubes) requires a separate audit.
- No run was performed with real GPU hardware, Blender, or FastMesh weights.
- No side-by-side quality comparison against Tripo was performed.
- `RemeshPanel`, `UVPanel`, and `TexturePanel` did not receive a line-by-line UX review; only grep-level wiring was inspected.