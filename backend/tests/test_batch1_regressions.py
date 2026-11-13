"""Regression coverage for Batch 1 mesh-pipeline fixes."""
from __future__ import annotations

import ast
import logging
from pathlib import Path

import numpy as np
import pytest
import trimesh
import yaml

from backend.adapters.fastmesh_adapter import _prepare_fastmesh_point_cloud
from backend.postprocess.services.hole_repair import (
    _boundary_cycles,
    fill_hole_ear_clip,
    repair_holes_targeted,
    triangulate_boundary_loop,
)
from core.scheduler.model_factory import ModelFactory


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
    assert np.max(np.abs(point_cloud[:, :3])) <= 0.951
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
    assert captured["max_ram_fraction"] == 0.80


def test_model_factory_keeps_native_textured_model_on_textured_feature():
    textured = ModelFactory.create_model_from_config(
        {
            "model_id": "stable_fast_3d_image_to_textured_mesh",
            "feature_type": "image_to_textured_mesh",
            "vram_requirement": 6144,
        }
    )
    assert textured.feature_type == "image_to_textured_mesh"
    assert textured.model_id == "stable_fast_3d_image_to_textured_mesh"

    legacy = ModelFactory.create_model_from_config(
        {
            "model_id": "trellis_image_to_textured_mesh",
            "feature_type": "image_to_textured_mesh",
            "vram_requirement": 1024,
        }
    )
    assert legacy.feature_type == "image_to_raw_mesh"


def test_bake_config_keeps_scale_aware_cage_and_ray_autosizing_enabled():
    quality = yaml.safe_load(
        (ROOT / "backend" / "config" / "quality.yaml").read_text(encoding="utf-8")
    )
    bake_config = quality["bake"]
    assert bake_config["cage_extrusion"] == 0.0
    assert bake_config["max_ray_distance"] == 0.0

    pipeline_source = (ROOT / "backend" / "postprocess" / "pipeline.py").read_text(encoding="utf-8")
    assert 'bake_cfg.get("cage_extrusion", 0.0)' in pipeline_source
    assert 'bake_cfg.get("max_ray_distance", 0.0)' in pipeline_source


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



def test_mesh_limit_enforcement_does_not_run_discarded_repair_or_smoothing(monkeypatch):
    source = trimesh.creation.icosphere(subdivisions=1)
    original_vertices = source.vertices.copy()
    original_faces = source.faces.copy()

    def unexpected_call(*_args, **_kwargs):
        raise AssertionError("Raw-source size enforcement must not repair or smooth geometry")

    monkeypatch.setattr(trimesh.repair, "fill_holes", unexpected_call)
    monkeypatch.setattr(trimesh.repair, "fix_winding", unexpected_call)
    monkeypatch.setattr(trimesh.repair, "fix_normals", unexpected_call)
    monkeypatch.setattr(trimesh.smoothing, "filter_taubin", unexpected_call)

    namespace = {
        "trimesh": trimesh,
        "get_quality_config": lambda: {
            "mesh": {
                "max_vertices_per_mesh": 500000,
                "max_faces_per_mesh": 1000000,
            },
            "shared": {"feature_edge_angle_deg": 35.0},
        },
        "memory_safe_decimate": lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("An in-cap mesh must not be decimated")
        ),
        "logger": logging.getLogger("batch2-test"),
    }
    path = ROOT / "backend" / "postprocess" / "pipeline.py"
    enforce_mesh_limits = _load_function_from_source(
        path, "_enforce_mesh_limits", namespace
    )

    result = enforce_mesh_limits(source, "in-cap-model")

    assert result is source
    np.testing.assert_array_equal(result.vertices, original_vertices)
    np.testing.assert_array_equal(result.faces, original_faces)


def _make_noisy_open_sphere(edge_count: int, scale: float = 1.0) -> trimesh.Trimesh:
    """Create a UV-sphere shell with one noisy, non-planar boundary loop."""
    rng = np.random.default_rng(7)
    angles = np.linspace(0.0, 2.0 * np.pi, edge_count, endpoint=False)
    latitudes = np.linspace(0.1, np.pi - 0.1, 20)
    vertices = []
    for latitude in latitudes:
        for angle in angles:
            radius = scale * (1.0 + 0.01 * rng.normal())
            vertices.append(
                [
                    radius * np.sin(latitude) * np.cos(angle),
                    radius * np.sin(latitude) * np.sin(angle),
                    radius * np.cos(latitude),
                ]
            )

    south_pole = len(vertices)
    vertices.append([0.0, 0.0, -scale])
    faces = []
    for ring in range(len(latitudes) - 1):
        for index in range(edge_count):
            first = ring * edge_count + index
            following = ring * edge_count + (index + 1) % edge_count
            lower = (ring + 1) * edge_count + index
            lower_following = (ring + 1) * edge_count + (index + 1) % edge_count
            faces.extend([[first, lower, following], [following, lower, lower_following]])

    last_ring = (len(latitudes) - 1) * edge_count
    for index in range(edge_count):
        faces.append(
            [
                last_ring + index,
                south_pole,
                last_ring + (index + 1) % edge_count,
            ]
        )
    return trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float64),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )


def test_non_planar_hole_repair_fills_12_18_and_40_edge_loops_scale_independently():
    for scale in (0.1, 10.0):
        for edge_count in (12, 18, 40):
            source = _make_noisy_open_sphere(edge_count, scale=scale)
            assert not source.is_watertight

            loops, boundary_edges = _boundary_cycles(source)
            assert boundary_edges == edge_count
            assert len(loops) == 1 and len(loops[0]) == edge_count
            loop = loops[0]
            candidate_faces = triangulate_boundary_loop(loop, source.vertices)
            if candidate_faces is None:
                candidate_faces = fill_hole_ear_clip(source.vertices, loop)
            assert candidate_faces is not None, f"non-planar ear clipping failed: scale={scale}, edge_count={edge_count}"
            perimeter = sum(
                float(np.linalg.norm(source.vertices[loop[index]] - source.vertices[loop[(index + 1) % len(loop)]]))
                for index in range(len(loop))
            )
            bbox_diagonal = float(np.linalg.norm(np.ptp(source.vertices, axis=0)))
            assert perimeter <= bbox_diagonal * 0.25

            repaired, stats = repair_holes_targeted(
                source,
                max_hole_vertices=50,
                max_hole_perimeter_frac=0.25,
            )

            assert stats["holes_filled"] == 1, f"scale={scale}, edge_count={edge_count}, stats={stats}"
            assert stats["holes_remaining"] == 0
            assert stats["boundary_edges_after"] == 0
            assert repaired.is_watertight
            assert repaired.is_winding_consistent


def test_memory_safe_decimation_uses_shared_simplifier_once(monkeypatch):
    import importlib

    decimator = importlib.import_module(
        "backend.postprocess.services.memory_safe_decimate"
    )
    source = trimesh.creation.icosphere(subdivisions=2)
    target_faces = 100
    output = trimesh.Trimesh(
        vertices=source.vertices.copy(),
        faces=source.faces[:target_faces].copy(),
        process=False,
    )
    captured = []

    def fake_simplify(mesh, requested_faces, *, crease_angle_deg=None):
        captured.append((mesh, requested_faces, crease_angle_deg))
        return output, {"triangles": len(output.faces), "fallback_used": False}

    monkeypatch.setattr(decimator, "_simplify", fake_simplify)
    result, telemetry = decimator.memory_safe_decimate(
        source,
        target_faces,
        config_path={
            "decimation": {
                "memory_safe_threshold_triangles": 1,
                "max_ram_fraction": 0.99,
            },
            "shared": {"feature_edge_angle_deg": 42.0},
        },
    )

    assert result is output
    assert len(captured) == 1
    assert captured[0][1:] == (target_faces, 42.0)
    assert telemetry["triangles_after"] == target_faces
    assert telemetry["memory_safe_mode_engaged"] is True


def test_pymeshlab_untextured_qem_hits_target_and_keeps_box_watertight():
    pytest.importorskip("pymeshlab")
    from backend.postprocess.services.simplify import _simplify

    mesh = trimesh.creation.box()
    for _ in range(4):
        mesh = mesh.subdivide()

    reduced, stats = _simplify(mesh, 1500)

    assert len(reduced.faces) == 1500
    assert reduced.is_watertight
    assert stats["texture_preserved"] is False


def test_pymeshlab_textured_qem_preserves_uvs_and_open_mesh_boundary():
    pytest.importorskip("pymeshlab")
    from backend.postprocess.services.simplify import _simplify

    side = 40
    axis = np.linspace(-1.0, 1.0, side)
    vertices = np.asarray(
        [[x, y, 0.0] for y in axis for x in axis],
        dtype=np.float64,
    )
    faces = []
    for y in range(side - 1):
        for x in range(side - 1):
            first = y * side + x
            right = first + 1
            lower = first + side
            lower_right = lower + 1
            faces.extend([[first, right, lower], [right, lower_right, lower]])

    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    mesh.visual = trimesh.visual.TextureVisuals(uv=(vertices[:, :2] + 1.0) / 2.0)
    _, before_counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    boundary_before = int(np.count_nonzero(before_counts == 1))

    reduced, stats = _simplify(mesh, 1500)

    _, after_counts = np.unique(reduced.edges_sorted, axis=0, return_counts=True)
    boundary_after = int(np.count_nonzero(after_counts == 1))
    assert len(reduced.faces) == 1500
    assert boundary_after == boundary_before
    assert len(reduced.visual.uv) == len(reduced.vertices)
    assert stats["texture_preserved"] is True

def test_fastmesh_ui_and_registry_expose_only_fixed_v1k_contract():
    panel = (ROOT / "features" / "workspace" / "Panels" / "RemeshPanel.tsx").read_text(encoding="utf-8")
    workspace = (ROOT / "features" / "workspace" / "store" / "WorkspaceContext.tsx").read_text(encoding="utf-8")
    registry = (ROOT / "constants" / "models.ts").read_text(encoding="utf-8")
    bridge = (ROOT / "features" / "workspace" / "services" / "meshProcessingBridge.ts").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "routers" / "mesh_retopology.py").read_text(encoding="utf-8")
    adapter = (ROOT / "backend" / "adapters" / "fastmesh_adapter.py").read_text(encoding="utf-8")

    assert "FastMesh V1K" in panel
    assert "Checkpoint-fixed output" in panel
    assert "FastMesh Output" in panel
    assert "engineMode === 'script'" in panel
    assert "V4K" not in panel
    assert "fastmesh_v4k_retopology" not in registry
    assert "fastmesh_v4k_retopology" not in workspace
    assert "V4K" not in api
    assert "target_vertex_count" not in adapter
    assert "output_vertex_count" in adapter
    assert "fastmesh_v1k_retopology" in workspace
    assert "model_preference: 'fastmesh_v1k_retopology'" in workspace
    assert "target_vertex_count" not in workspace
    assert "preserve_edges:" not in workspace
    assert "feature_angle:" not in workspace
    assert "variant: 'V1K'" in bridge
