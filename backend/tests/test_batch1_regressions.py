"""Regression coverage for Batch 1 mesh-pipeline fixes."""
from __future__ import annotations

import ast
import logging
from pathlib import Path

import numpy as np
import trimesh

from backend.adapters.fastmesh_adapter import _prepare_fastmesh_point_cloud


ROOT = Path(__file__).resolve().parents[2]


def test_fastmesh_point_cloud_uses_matching_face_normals_and_normalized_coordinates(monkeypatch):
    source = trimesh.creation.box(extents=(2.0, 4.0, 6.0))

    def deterministic_sample(mesh, count, return_index=False):
        face_indices = np.arange(count, dtype=np.int64) % len(mesh.faces)
        points = mesh.triangles_center[face_indices]
        return (points, face_indices) if return_index else points

    monkeypatch.setattr(trimesh.Trimesh, "sample", deterministic_sample)
    seed = 17
    point_cloud = _prepare_fastmesh_point_cloud(
        source, seed=seed, input_points=8, sample_points=24
    )

    normalized = source.copy()
    bounds = normalized.bounds
    center = (bounds[0] + bounds[1]) * 0.5
    scale = float(np.max(bounds[1] - bounds[0]))
    normalized.apply_translation(-center)
    normalized.apply_scale((2.0 * 0.95) / scale)
    sampled_faces = np.arange(24, dtype=np.int64) % len(normalized.faces)
    selected = np.random.default_rng(seed).choice(24, size=8, replace=False)

    assert point_cloud.shape == (8, 6)
    assert point_cloud.dtype == np.float16
    assert np.isfinite(point_cloud).all()
    assert np.max(np.abs(point_cloud[:, :3])) <= 0.9501
    np.testing.assert_allclose(
        point_cloud[:, 3:].astype(np.float32),
        normalized.face_normals[sampled_faces[selected]].astype(np.float32),
        atol=1e-3,
    )
    # Preparing the input must not mutate the caller's source mesh.
    np.testing.assert_allclose(source.bounds, [[-1.0, -2.0, -3.0], [1.0, 2.0, 3.0]])


def test_fastmesh_point_cloud_rejects_zero_extent_mesh():
    degenerate = trimesh.Trimesh(
        vertices=np.zeros((3, 3), dtype=np.float64),
        faces=np.array([[0, 1, 2]], dtype=np.int64),
        process=False,
    )
    try:
        _prepare_fastmesh_point_cloud(degenerate, seed=1, input_points=1, sample_points=1)
    except ValueError as exc:
        assert "zero or invalid extent" in str(exc)
    else:
        raise AssertionError("A zero-extent FastMesh input must be rejected")


def _load_function_from_source(path: Path, function_name: str, namespace: dict):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    function = next(
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    )
    isolated = ast.Module(body=[function], type_ignores=[])
    exec(compile(isolated, str(path), "exec"), namespace)
    return namespace[function_name]


def test_mesh_limit_enforcement_unpacks_decimator_result_and_reads_shared_policy():
    output_mesh = trimesh.creation.box()
    captured = {}

    def fake_decimate(mesh, **kwargs):
        captured.update(kwargs)
        return output_mesh, {"triangles_before": len(mesh.faces), "triangles_after": len(output_mesh.faces)}

    namespace = {
        "trimesh": trimesh,
        "get_quality_config": lambda: {
            "mesh": {"max_vertices_per_mesh": 2, "max_faces_per_mesh": 2},
            "shared": {"feature_edge_angle_deg": 42.0},
        },
        "memory_safe_decimate": fake_decimate,
        "logger": logging.getLogger("batch1-test"),
    }
    path = ROOT / "backend" / "postprocess" / "pipeline.py"
    enforce_mesh_limits = _load_function_from_source(path, "_enforce_mesh_limits", namespace)

    result = enforce_mesh_limits(trimesh.creation.icosphere(subdivisions=1), "test-model")
    assert result is output_mesh
    assert captured["target_faces"] == 2
    assert captured["crease_angle_deg"] == 42.0
    assert captured["max_deviation_deg"] == 45.0
    assert captured["max_ram_fraction"] == 0.80


def test_blender_bake_worker_assigns_computed_cage_extrusion():
    path = ROOT / "backend" / "postprocess" / "tools" / "bake_worker.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assignments = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and isinstance(node.value, ast.Name)
        and node.value.id == "cage"
        and any(
            isinstance(target, ast.Attribute)
            and target.attr == "cage_extrusion"
            and isinstance(target.value, ast.Name)
            and target.value.id == "bake"
            for target in node.targets
        )
    ]
    assert assignments, "Computed cage distance must be assigned to Blender bake.cage_extrusion"
