"""Regression coverage for Batch 1 mesh-pipeline fixes."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import trimesh

from backend.adapters.fastmesh_adapter import _prepare_fastmesh_point_cloud
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
