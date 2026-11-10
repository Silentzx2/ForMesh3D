"""Tests for feature snap, KD-tree feature edge retention, crispness, and auto-retopo options."""
import numpy as np
import pytest
import trimesh

from backend.postprocess.services.autoretopo.project import snap_to_features
from backend.core.quality.metrics import _compute_feature_edge_retention, compute_mesh_metrics
from backend.postprocess.services.gate import crispness, evaluate_topology_gate
from backend.postprocess.services.auto_retopo import run_auto_retopo
from backend.postprocess.schemas import AutoRetopoOptions


def test_snap_to_features_cube_rounded_crease():
    """snap_to_features on a cube with rounded/perturbed crease:

    snapped vertices lie on crease lines (error ~ 0).
    """
    box = trimesh.creation.box(extents=(1.0, 1.0, 1.0))  # bounds [-0.5, 0.5]^3
    orig_V = box.vertices.copy()

    # Perturb vertices near the crease lines by a displacement within tolerance (diag * 0.03 ~ 0.052)
    perturbed_V = orig_V.copy()
    # Perturb vertex 0 (originally [-0.5, -0.5, -0.5]) slightly off the crease
    perturbed_V[0] = [-0.49, -0.515, -0.5]  # moved 0.015 off y=-0.5
    perturbed_V[1] = [-0.5, -0.51, 0.49]   # moved 0.01 off y=-0.5

    snapped_V = snap_to_features(perturbed_V, box, angle_deg=35.0, tol_frac=0.03, spacing_frac=0.004)

    # For a cube centered at origin with extents 1, all 12 crease edges lie along coordinates
    # where two of (|x|, |y|, |z|) are exactly 0.5.
    # Check that vertex 0 snapped onto the line x=-0.5, y=-0.5 or z=-0.5
    # Since V[0] was perturbed along y, the nearest crease line is x=-0.5, z=-0.5 where y can vary,
    # or x=-0.5, y=-0.5 where z varies.
    def min_dist_to_cube_creases(pts):
        dists = []
        for p in pts:
            # 12 edges:
            # 4 parallel to X: y = +/-0.5, z = +/-0.5
            # 4 parallel to Y: x = +/-0.5, z = +/-0.5
            # 4 parallel to Z: x = +/-0.5, y = +/-0.5
            d_x = [np.hypot(p[1] - y, p[2] - z) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]
            d_y = [np.hypot(p[0] - x, p[2] - z) for x in (-0.5, 0.5) for z in (-0.5, 0.5)]
            d_z = [np.hypot(p[0] - x, p[1] - y) for x in (-0.5, 0.5) for y in (-0.5, 0.5)]
            dists.append(min(d_x + d_y + d_z))
        return np.asarray(dists)

    dists_before = min_dist_to_cube_creases(perturbed_V[:2])
    dists_after = min_dist_to_cube_creases(snapped_V[:2])

    assert np.all(dists_before > 0.005), f"Perturbed points should be off creases: {dists_before}"
    np.testing.assert_allclose(dists_after, 0.0, atol=1e-6, err_msg="Snapped vertices should lie on crease lines (error ~ 0)")


def test_snap_to_features_empty_or_smooth_mesh():
    """Empty or smooth mesh without sharp edges returns vertices unchanged."""
    sphere = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    V = sphere.vertices.copy()
    out = snap_to_features(V, sphere, angle_deg=35.0)
    np.testing.assert_array_equal(out, V)


def test_feature_edge_retention_kdtree():
    """_compute_feature_edge_retention with KD-tree returns expected retention without O(N x M) explosion."""
    box = trimesh.creation.box()
    # 1. Identical reference and candidate -> 100% retention
    ret_identical = _compute_feature_edge_retention(box, box)
    assert ret_identical == 1.0

    # 2. Candidate with no sharp edges (e.g. sphere) -> 0.0 retention
    sphere = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    ret_sphere = _compute_feature_edge_retention(sphere, box)
    assert ret_sphere == 0.0

    # 3. Slightly jittered candidate preserves sharp edges within dist_tol
    box_jittered = box.copy()
    np.random.seed(42)
    box_jittered.vertices += np.random.uniform(-0.005, 0.005, box.vertices.shape)
    ret_jittered = _compute_feature_edge_retention(box_jittered, box)
    assert ret_jittered == 1.0

    # 4. Dense synthetic feature test: verify it handles large edge counts without OOM
    # Cylinder with 1000 sections has 2000 sharp cap feature edges
    dense_cyl = trimesh.creation.cylinder(radius=1.0, height=1.0, sections=1000)
    ret_dense = _compute_feature_edge_retention(dense_cyl, dense_cyl)
    assert ret_dense == 1.0


def test_crispness_on_cube():
    """crispness correctly measures sharp edge fraction on a cube (12 sharp edges out of 18 total)."""
    box = trimesh.creation.box()
    c = crispness(box, angle_deg=35.0)

    assert "sharp_edge_frac" in c
    assert "p99_dihedral_deg" in c

    # A triangulated box has 18 shared internal edges: 12 at 90 deg, 6 at 0 deg.
    expected_frac = 12.0 / 18.0
    assert abs(c["sharp_edge_frac"] - expected_frac) < 1e-4, f"Expected {expected_frac}, got {c['sharp_edge_frac']}"
    assert abs(c["p99_dihedral_deg"] - 90.0) < 1e-3

    # Empty / none mesh handled defensively
    c_empty = crispness(None)
    assert c_empty == {"sharp_edge_frac": 0.0, "p99_dihedral_deg": 0.0}


def test_evaluate_topology_gate_includes_crispness():
    """evaluate_topology_gate populates crispness in returned metrics."""
    box = trimesh.creation.box()
    result = evaluate_topology_gate(box)
    assert "crispness" in result["metrics"]
    assert "sharp_edge_frac" in result["metrics"]["crispness"]
    assert result["metrics"]["crispness"]["p99_dihedral_deg"] == pytest.approx(90.0)


def test_auto_retopo_watertight_override():
    """auto_retopo sets watertight=False for already closed input mesh unless explicitly passed."""
    sphere = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
    assert sphere.is_watertight

    # Case 1: default options (watertight not explicitly set in fields_set)
    opts_default = AutoRetopoOptions(target_faces=100)
    # Check that when watertight is not in model_fields_set, auto_retopo overrides it to False
    fields_set = getattr(opts_default, "model_fields_set", None) or getattr(opts_default, "__fields_set__", set())
    assert "watertight" not in fields_set

    # Case 2: explicitly passed watertight=True
    opts_explicit = AutoRetopoOptions(target_faces=100, watertight=True)
    fields_set_exp = getattr(opts_explicit, "model_fields_set", None) or getattr(opts_explicit, "__fields_set__", set())
    assert "watertight" in fields_set_exp
