"""Regression coverage for Batch 1 mesh-pipeline fixes."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import trimesh
import yaml

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


def test_remesh_contract_keeps_triflow_default_and_fastmesh_fixed_v1k():
    panel = (ROOT / "features" / "workspace" / "Panels" / "RemeshPanel.tsx").read_text(encoding="utf-8")
    workspace = (ROOT / "features" / "workspace" / "store" / "WorkspaceContext.tsx").read_text(encoding="utf-8")
    workspace_types = (ROOT / "features" / "workspace" / "types.ts").read_text(encoding="utf-8")
    registry = (ROOT / "constants" / "models.ts").read_text(encoding="utf-8")
    bridge = (ROOT / "features" / "workspace" / "services" / "meshProcessingBridge.ts").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "routers" / "mesh_retopology.py").read_text(encoding="utf-8")
    factory = (ROOT / "backend" / "core" / "scheduler" / "model_factory.py").read_text(encoding="utf-8")
    adapter = (ROOT / "backend" / "adapters" / "fastmesh_adapter.py").read_text(encoding="utf-8")
    inspector = (ROOT / "features" / "workspace" / "RightPanel" / "RightPropertyPanel.tsx").read_text(encoding="utf-8")

    # The workspace currently routes AI remeshing to TriFlow. FastMesh remains
    # a separately registered API-selectable adapter with a fixed V1K checkpoint.
    assert "model_preference: 'triflow_retopology'" in workspace
    assert "triflow_retopology" in bridge
    assert "fastmesh_v1k_retopology" in registry
    assert '"fastmesh_v1k_retopology"' in factory
    assert "FastMesh-V1K" in adapter
    assert "output_vertex_count" in adapter
    assert "target_vertex_count" not in adapter
    assert "fastmesh_v4k_retopology" not in registry
    assert "V4K" not in api
    assert "Deprecated compatibility field" in api

    # The former V1K variant state was written by the panel but never read or
    # forwarded to the API; the checkpoint identity belongs to the adapter.
    assert "variant: 'V1K'" not in panel
    assert "FastMesh Variant" not in inspector
    assert "variant" not in workspace_types
    assert "variant?: 'V1K'" not in workspace


def test_runtime_probe_inventory_includes_enabled_specialist_adapters():
    from backend.adapters import _ADAPTER_MAP
    from backend.core.runtime_probe import _get_installed_adapters

    installed = set(_get_installed_adapters())
    model_config = yaml.safe_load(
        (ROOT / "backend" / "config" / "models.yaml").read_text(encoding="utf-8")
    )
    enabled_model_ids = {
        model_id
        for section in model_config.values()
        if isinstance(section, dict)
        for model_id, config in section.items()
        if isinstance(config, dict) and config.get("enabled") is True
    }
    assert enabled_model_ids <= installed
    assert {
        "triflow_retopology",
        "fastmesh_v1k_retopology",
        "partfield_segmentation",
    } <= installed
    assert _ADAPTER_MAP["triflow_retopology"] == "backend.adapters.triflow_adapter"
    assert _ADAPTER_MAP["fastmesh_v1k_retopology"] == "backend.adapters.fastmesh_adapter"
    assert _ADAPTER_MAP["partfield_segmentation"] == "backend.adapters.partfield_adapter"


def test_trellis_text_painting_manifest_alias_is_registered():
    from backend.adapters import _ADAPTER_MAP
    from backend.core.config import load_models_config
    from core.scheduler.model_factory import get_model_configs_from_settings

    manifest = load_models_config(str(ROOT / "backend" / "config" / "models.yaml"))
    model = manifest["text_mesh_painting"]["trellis_text_mesh_painting"]

    assert model.enabled is True
    assert model.model_type == "texture"
    assert model.vram_requirement == 11776
    assert model.model_path == "backend/pretrained/TRELLIS"
    assert model.capabilities["texture_generation"] is True

    scheduler_config = get_model_configs_from_settings(manifest)["trellis_text_mesh_painting"]
    assert scheduler_config["feature_type"] == "text_mesh_painting"
    assert ModelFactory.ADAPTER_REGISTRY["trellis_text_mesh_painting"] == {
        "module": "adapters.trellis_adapter",
        "class": "TrellisTextMeshPaintingAdapter",
    }
    assert _ADAPTER_MAP["trellis_text_mesh_painting"] == "backend.adapters.trellis_adapter"
