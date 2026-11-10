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

The original audit below was performed against commit `2d5fd0c`. The current `dev` branch was checked at `fd0e57c` on 2026-11-10 and is **two commits ahead** of that audit baseline (`16898a2`, `fd0e57c`).

The following audit findings have already been addressed in those two commits and must not be reimplemented:

- **FastMesh adapter (partial):** `sys` is imported; the adapter normalizes a copy of the source mesh, uses the sampled face indices to select matching face normals, selects a deterministic 8,192-point subset, and moves the tensor to the adapter's selected device. CPU regression coverage exists in `backend/tests/test_batch1_regressions.py`. The UI/model-registry mismatch, displayed target-count contract, and output-coordinate/export behavior still require verification.
- **`_enforce_mesh_limits` (partial):** the `(mesh, telemetry)` return value from `memory_safe_decimate()` is unpacked, and `shared.feature_edge_angle_deg` is read from the root quality configuration. CPU regression coverage exists in `backend/tests/test_batch1_regressions.py`. The separately reported work performed on an in-memory copy and then discarded still needs review.
- **Blender cage assignment (resolved):** the worker now assigns the computed cage to `bake.cage_extrusion`. The YAML and pipeline defaults use `0.0` for automatic, scale-aware cage/ray distances. CPU regression coverage exists in `backend/tests/test_batch1_regressions.py`.

This reconciliation is based on the Git diff and current source changes, not on a fresh runtime execution. The tests listed above were found in the repository but were **not run during this documentation update**. GPU inference, FastMesh weights, and a Blender runtime bake remain **NOT RUN** here. Revalidate all remaining findings against the current source before implementing them.

---

## 0. Summary

| # | File | Problem | Priority | Evidence |
|---|---|---|---|---|
| 1 | `adapters/fastmesh_adapter.py` | Import and point-cloud preparation fixed on current dev; UI/model-registry and target-count contract still need review | P0 | PARTIAL |
| 2 | `postprocess/services/hole_repair.py` | Fills only exactly planar holes | P0 | RUN |
| 3 | `postprocess/pipeline.py::_enforce_mesh_limits` | Tuple-unpacking crash and shared-config lookup fixed on current dev; discarded in-memory work remains | P1 | PARTIAL |
| 4 | `core/mesh_processor.py::feature_preserving_decimate` | Misses the target and is very slow | P0 | RUN |
| 5 | `services/uv_backend_resolver.py::_unwrap_massive_mesh_safe` | Invalid UV for >50K tris | P0 | STATIC |
| 6 | `postprocess/tools/bake_worker.py` | Cage extrusion is now applied and scale-aware on current dev | P0 (resolved) | CURRENT DEV DIFF |
| 7 | `postprocess/services/bake.py` | Nearest-vertex normals, fake AO, no anti-aliasing | P0 | RUN (sampling) |
| 8 | Segmentation "AI" mode | No model is registered, but this is the UI default | P0 | STATIC |
| 9 | `autoretopo/*` | Triangle-only isotropic remeshing; edges become rounded and quads are not exported | P1 | RUN (snap) |
| 10 | `services/gate.py`, `core/quality/metrics.py` | No sharpness measurement; O(N×M) matrix | P1 | STATIC |
| 11 | `services/segment.py` | Proxy-resolution boundaries | P1 | RUN (small gain) |
| 12 | UI panels / bridge | Hard-coded values, misleading labels, missing inspect modes | P1 | STATIC |
| 13 | Config | yaml vs schema vs UI drift | P2 | STATIC |

Correction (my earlier assumption was wrong): `_enforce_mesh_limits` smooths the raw mesh with Taubin, but when the mesh is already under the cap, the on-disk `master/source.glb` is not changed (the pipeline reads the master file again around line 2033). Therefore, the root cause of a "smooth raw mesh" is on the adapter/model side, not in post-processing.

---

## 1. FastMesh adapter — `backend/adapters/fastmesh_adapter.py`

**Current-dev status: PARTIAL.** The missing `sys` import and incorrect point-cloud construction were fixed after the audit baseline. A regression test is checked in. Do not reapply the old preprocessing replacement blindly. The UI/model registry and target-count mismatch remain to be checked; also verify the model output coordinate space and export transform with the actual adapter/upstream implementation.

**Issues identified at the audit baseline (`2d5fd0c`)**
- `sys.path` is used (lines 73–74) without importing `sys`, causing a `NameError` in `_load_model`.
- Point-cloud preparation: the face indices returned by `mesh.sample(..., return_index=True)` are discarded, while normals are selected for *random faces* using `np.random.choice`; therefore, the normals do not correspond to the sampled points. The mesh is also not normalized to `[-1, 1]`, and 50,000 points are passed through. The project's own reference implementation, `utils/fastmesh_utils.py`, normalizes using `*2*0.95` and uses `input_pc_num=8192`.
- The UI default is `variant: 'V4K'` (`RemeshPanel.tsx:276`, `WorkspaceContext.tsx:668,1819,1890`), while `models.yaml` contains only `fastmesh_v1k_retopology`; the default AI retopology request will therefore fail validation.
- FastMesh produces approximately 1K vertices, while the UI displays "Target 50,000 quads". The scheduler log reports `adapter_received_target_polycount: not_sent`.

**Historical fix proposal from the audit baseline (do not reapply the parts already resolved on current dev).**

```python
# adapters/fastmesh_adapter.py — add this to the imports
import sys
```

```python
# In `_process_request`, replace the code from `mesh = trimesh.load(...)` through `input_shape = ...` with this:
import numpy as np
mesh = trimesh.load(mesh_path, force="mesh", process=False).copy()
bounds = mesh.bounds
center = (bounds[0] + bounds[1]) / 2.0
scale = float((bounds[1] - bounds[0]).max())
mesh.apply_translation(-center)
mesh.apply_scale(2.0 * 0.95 / scale)            # same as fastmesh_utils._apply_normalize

points, face_idx = mesh.sample(50000, return_index=True)
normals = mesh.face_normals[face_idx]            # Normals of the SAME faces that produced the points
rng = np.random.default_rng(seed)
keep = rng.choice(len(points), min(8192, len(points)), replace=False)
pc_normal = np.concatenate([points[keep], normals[keep]], axis=-1).astype(np.float16)
input_shape = torch.from_numpy(pc_normal).unsqueeze(0).to(self.model.device if hasattr(self.model, "device") else "cpu")
```

> Verify this: the output mesh is in normalized space, so before export you must apply `V = V * scale / (2.0*0.95) + center` (`fastmesh_utils.py` contains the remaining reference logic).

**UI/backend contract (AGENTS.md: "No Control Without a Verified Consumer")**
- Either register `fastmesh_v4k_retopology` again (weights + `models.yaml`) or remove V4K from the UI.
- In AI mode, remove the polycount slider or label it clearly as "FastMesh output is fixed at approximately 1K/4K vertices".

---

## 2. Hole repair — `postprocess/services/hole_repair.py`

**Issue (RUN):** `triangulate_boundary_loop` requires the loop to be planar within machine epsilon. Of three holes in a noisy sphere (2% radial noise; 12, 18, and 40 boundary edges), **zero were filled**. Holes in generative meshes are rarely perfectly planar. `max_hole_perimeter: 0.5` is also an absolute value, not scale-aware.

**Fix:** If the planar check fails in `triangulate_boundary_loop`, call this fallback (RUN-verified: all three holes filled, `watertight=True`, consistent winding, 0.16 seconds maximum):

```python
import numpy as np

def fill_hole_ear_clip(V, loop):
    """Triangulate ONE 3D boundary loop (planarity is not required).
    Greedy strategy: at each step, clip the ear with the best worst-case angle. Returns `list[[a,b,c]]` or `None`."""
    P = np.asarray(V, float); L = list(loop); tris = []
    n = np.zeros(3)
    for i in range(len(L)):                      # Newell normal of loop
        n += np.cross(P[L[i]], P[L[(i + 1) % len(L)]])
    if np.linalg.norm(n) < 1e-18:
        return None
    n /= np.linalg.norm(n)

    def ang(p, q, r):
        u, v = q - p, r - p
        return np.arccos(np.clip(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-18), -1, 1))

    def ear_score(a, b, c):
        if np.dot(np.cross(b - a, c - a), n) <= 1e-18:
            return -1.0                          # reflex / flipped
        return min(ang(a, b, c), ang(b, c, a), ang(c, a, b))

    def inside(a, b, c, p):
        return all(np.dot(np.cross(y - x, p - x), n) >= 0 for x, y in ((a, b), (b, c), (c, a)))

    while len(L) > 3:
        best, bi = -1.0, -1
        for i in range(len(L)):
            ia, ib, ic = L[i - 1], L[i], L[(i + 1) % len(L)]
            s = ear_score(P[ia], P[ib], P[ic])
            if s <= best:
                continue
            if any(inside(P[ia], P[ib], P[ic], P[k]) for k in L if k not in (ia, ib, ic)):
                continue
            best, bi = s, i
        if bi < 0:
            return None
        tris.append([L[bi - 1], L[bi], L[(bi + 1) % len(L)]])
        del L[bi]
    tris.append(L[:])
    return tris
```

Wire this into `repair_holes_targeted` immediately after `loop_faces = triangulate_boundary_loop(...)`:
`if loop_faces is None: loop_faces = fill_hole_ear_clip(mesh.vertices, loop)`.
Keep the existing edge-count safety check (`edge_counts + additions > 2`). Replace the absolute `0.5` perimeter limit with a fraction of the bounding-box diagonal (`quality.yaml: holes.max_hole_perimeter_frac`).

Optional for large holes: use `pymeshlab.meshing_close_holes` followed by fairing (`pymeshlab` is already a dependency).

---

## 3. `_enforce_mesh_limits` — `postprocess/pipeline.py` line ~1754-1810

**Current-dev status: PARTIAL.** The tuple-unpacking crash and top-level `shared` configuration lookup were fixed after the audit baseline, with CPU regression coverage checked in. Do not reapply those two fixes. The wasted in-memory `fill_holes` / Taubin work described below remains a separate issue to verify.

**Original findings at the audit baseline (`2d5fd0c`):** items 1 and 3 were fixed on current `dev`; item 2 remains open.
1. **Resolved on current dev:** the decimator returns a `(mesh, telemetry)` tuple. The audit baseline assigned that tuple directly to `mesh`, which caused the next `len(mesh.vertices)` access to raise `AttributeError` for meshes above the cap (>500K vertices / >1M faces). Current code unpacks the tuple.
2. Even when the mesh is under the cap, `fill_holes` and `filter_taubin` operate on an in-memory copy that is later discarded (the master file is read again around line 2033). This is wasted computation.
3. **Resolved on current dev:** the baseline read `shared` from `mesh_cfg`; current code reads it from the root quality configuration, where `shared` is a top-level key.

```python
# Around line 1768: crease angle
crease_angle = float(cfg.get("shared", {}).get("feature_edge_angle_deg", 35.0))
```
```python
# Remove the Taubin line (or make it opt-in behind a flag in quality.yaml):
# trimesh.smoothing.filter_taubin(mesh, lamb=0.3, nu=-0.34, iterations=4)
```
```python
# Historical fix from the audit baseline; already present on current dev.
# Around the former line ~1792:
mesh, _telemetry = memory_safe_decimate(
    mesh,
    target_faces=target_faces,
    max_deviation_deg=45.0,
    crease_angle_deg=crease_angle,
    max_ram_fraction=0.80,
)
```

---

## 4. Decimation — `core/mesh_processor.py::feature_preserving_decimate`

**RUN result** (box subdivided, pure-Python QEM vs `fast_simplification`):

| Input faces | Target | Pure-Python result | Time | `fast_simplification` result | Time |
|---|---|---|---|---|---|
| 3,072 | 1,500 | 2,424 | 0.9s | 1,500 | ~0.00s |
| 12,288 | 6,000 | 10,674 | 4.2s | 6,000 | 0.01s |

In addition: midpoint placement (rather than optimal placement) rounds corners; UVs are averaged across seams during collapse; and there is no link-condition check. This function is called where the mesh is largest (`memory_safe_decimate` above 2M triangles and `_enforce_mesh_limits`). Extrapolation to 1M faces suggests it would be very slow, but this was not measured.

**Fix (`AGENTS.md`: reuse existing code):** `simplify._simplify` already provides textured- and boundary-aware QEM through `pymeshlab`. In `memory_safe_decimate.py`:

```python
# memory_safe_decimate.py
from .simplify import _simplify

def _qem(mesh, target_faces, **_ignored):
    out, _stats = _simplify(mesh, int(target_faces))
    return out

# Replace both call sites of `feature_preserving_decimate(`:
current_mesh = _qem(prev_mesh, step_target)
decimated_mesh = _qem(working_mesh, target_faces)
```

The staged 50% loop is no longer necessary (`pymeshlab` runs in C++); retain only `gc.collect()` if a RAM guard is needed. Then delete `feature_preserving_decimate` (deletion over addition).

For sharp edges, add `planarquadric=True` to the untextured branch of `simplify._simplify` (it is already used in retopo's `decimate_to_target`).

---

## 5. UV — `services/uv_backend_resolver.py`

**Issue (STATIC):** For meshes above `xatlas_max_safe_triangles` (50,000), `_unwrap_massive_mesh_safe` creates a voxel-cluster proxy, unwraps the proxy with xatlas, and then assigns each original vertex the UV of its **nearest proxy vertex** (`cKDTree`). As a result, seams are not created (vertices are not duplicated), and the three vertices of one triangle may receive UVs from different charts. This can produce triangles stretched across the atlas; baking then uses those invalid UVs. The "Game/Cine" presets (100K–200K) use this path.

**Fix**
- Always unwrap the *final low-poly mesh* (after decimation/retopology). xatlas should normally handle 100K–200K triangles; I did not reproduce the SIGSEGV claim, so the agent must benchmark the actual limit.
- Remove the proxy-transfer branch. If the mesh exceeds the limit, raise a clear error or decimate it first:

```python
# Replace the proxy branch in `_unwrap_xatlas` with:
if len(f) > max_safe_faces:
    raise ValueError(
        f"UV unwrap needs <= {max_safe_faces} triangles (got {len(f)}). Decimate first."
    )
```
- Move `xatlas_max_safe_triangles` into `quality.yaml: uv:` (configuration ownership rule).
- `xatlas.ChartOptions` currently uses defaults. Tune `normal_seam_weight` and `max_iterations` for organic generative meshes, and enable `pack_opts.bruteForce=True` for small meshes (<20K).

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

This path is used in environments such as Kaggle where Blender is unavailable.

**Problems**
- High-poly lookup uses a `cKDTree` over vertices and face centers, then takes the nearest sample's normal. This is piecewise-constant and does not use ray casting.
- `cage` is used only to calculate the default `max_ray`; ray origins are not offset.
- `ao` is an entirely white image (`np.full(..., 255)`), which is a fake map; `ao` is included in the default maps. `AGENTS.md` says: "No cosmetic controls".
- Raster `u*(res-1)` vs sample `(x+0.5)/res` — half-pixel mismatch.
- 1 sample per texel (aliasing).

**RUN comparison** (sphere, high = 1,280 faces, 6,000 samples, truth = analytic normal):

| Method | Mean angle error | p95 |
|---|---|---|
| Current KD nearest | 1.78° | 2.80° |
| Cage ray + barycentric interpolation | **0.10°** | **0.26°** |

The facet effect is more visible on a small high-poly mesh; the gap may be smaller at 900K faces, but thin or protruding details remain important.

**Replacement** (`embreex` is already listed in `requirements.txt`):

```python
def sample_high_normals(high, P, N_low, cage, max_ray):
    """P, N_low: (n,3) low-poly surface points and unit normals.
    Rays start outside the surface by `cage` and travel inward (matching the Blender model)."""
    origins = P + N_low * cage
    loc, ridx, tidx = high.ray.intersects_location(origins, -N_low, multiple_hits=True)
    out = N_low.copy(); hit = np.zeros(len(P), bool)
    if len(ridx):
        d = np.linalg.norm(loc - origins[ridx], axis=1)
        ok = d <= (cage + max_ray)
        ridx, loc, tidx, d = ridx[ok], loc[ok], tidx[ok], d[ok]
        order = np.lexsort((d, ridx))                    # nearest hit per ray
        ridx, loc, tidx = ridx[order], loc[order], tidx[order]
        first = np.r_[True, ridx[1:] != ridx[:-1]]
        ridx, loc, tidx = ridx[first], loc[first], tidx[first]
        bary = trimesh.triangles.points_to_barycentric(high.triangles[tidx], loc)
        n = np.einsum('ij,ijk->ik', bary, vn[high.faces[tidx]])
        out[ridx] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        hit[ridx] = True
    return out, hit
```

```python
# In `bake.py`, replace the code from `"dists, nearest_idx = high_tree.query(P_3d, k=1)"` through `"N_high[exceed] = N_low[exceed]"` with:
N_high, _hit = sample_high_normals(high_mesh, P_3d, N_low, cage, max_ray)
# `high_tree`, `high_pts`, and `high_n` are no longer needed; remove them.
```

Baaki:
1. Keep the `cage` / `max_ray` fallback scale-aware (derive it from the diagonal, as in the Blender worker).
2. For AO, either implement real hemisphere AO using ray casting (UNTESTED), or remove `ao` from the maps and report it under `unsupported_maps`. Do not return a white image.
3. Anti-aliasing: bake at 2×2 supersampling (at `res*2`) and then downsample.
4. Use the same raster/sample convention in both paths: `(x+0.5)/res`.

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
| Remesh defaults to V4K / quad / 50K | `RemeshPanel.tsx:273-276`, `WorkspaceContext.tsx:668` | Align with the registry (section 1) |
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
3. Work order: (3) remaining in-memory cleanup → (1) UI/model-registry contract → (2) hole fallback → (4) decimator replacement → (7) bake sampling → (5) UV guard → (9) feature snap → (10) crispness metric → (8) segmentation default + adapter → (11) UI.
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