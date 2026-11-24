"""Regression coverage for Batch 1 mesh-pipeline fixes."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import trimesh
import yaml

from core.scheduler.model_factory import ModelFactory


ROOT = Path(__file__).resolve().parents[2]


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


def test_remesh_contract_keeps_triflow_default():
    panel = (ROOT / "features" / "workspace" / "Panels" / "RemeshPanel.tsx").read_text(encoding="utf-8")
    workspace = (ROOT / "features" / "workspace" / "store" / "WorkspaceContext.tsx").read_text(encoding="utf-8")
    workspace_types = (ROOT / "features" / "workspace" / "types.ts").read_text(encoding="utf-8")
    registry = (ROOT / "constants" / "models.ts").read_text(encoding="utf-8")
    bridge = (ROOT / "features" / "workspace" / "services" / "meshProcessingBridge.ts").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "routers" / "mesh_retopology.py").read_text(encoding="utf-8")
    factory = (ROOT / "backend" / "core" / "scheduler" / "model_factory.py").read_text(encoding="utf-8")
    inspector = (ROOT / "features" / "workspace" / "RightPanel" / "RightPropertyPanel.tsx").read_text(encoding="utf-8")

    # The workspace routes AI remeshing to TriFlow. FastMesh is fully removed.
    assert "model_preference: 'triflow_retopology'" in workspace
    assert "triflow_retopology" in bridge
    assert "fastmesh_v1k_retopology" not in registry
    assert "fastmesh_v1k_retopology" not in factory
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
        "partfield_segmentation",
    } <= installed
    assert _ADAPTER_MAP["triflow_retopology"] == "backend.adapters.triflow_adapter"
    assert _ADAPTER_MAP["partfield_segmentation"] == "backend.adapters.partfield_adapter"
    assert "fastmesh_v1k_retopology" not in _ADAPTER_MAP


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
