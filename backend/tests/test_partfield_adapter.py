"""
Contract tests for the trained PartField adapter and registry integration.
These tests do not require a local GPU or multi-gigabyte checkpoint.
"""
import sys
from pathlib import Path

import pytest
import yaml

backend_root = Path(__file__).resolve().parents[1]
repo_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.adapters.partfield_adapter import (
    PartFieldSegmentationAdapter,
    _labels_from_merge_tree,
)
from backend.core.models.base import BaseModel, ModelStatus
from backend.api.routers.mesh_segmentation import MeshSegmentationRequest


def test_partfield_adapter_initialization():
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    assert isinstance(adapter, BaseModel)
    assert adapter.model_id == "partfield_segmentation"
    assert adapter.vram_requirement == 8192
    assert adapter.status == ModelStatus.UNLOADED
    assert adapter.feature_type == "mesh_segmentation"


def test_partfield_checkpoint_resolution():
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    checkpoint = adapter._resolve_checkpoint()
    assert checkpoint.name == "model_objaverse.ckpt"
    assert "PartField" in str(checkpoint) or "PartUV" in str(checkpoint)


def test_partfield_readiness_contract():
    readiness = PartFieldSegmentationAdapter.get_readiness()
    assert isinstance(readiness["available"], bool)
    assert readiness["model_id"] == "partfield_segmentation"
    assert readiness["device"] in {"cuda", "cpu"}
    assert isinstance(readiness["checkpoint_available"], bool)
    assert isinstance(readiness["missing_dependencies"], list)
    assert isinstance(readiness["reason"], str)
    if not readiness["available"]:
        assert readiness["reason"]


def test_partfield_parameter_schema_and_formats():
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    schema = adapter.get_parameter_schema()
    assert "properties" in schema
    props = schema["properties"]
    assert props["method"]["enum"] == ["semantic"]
    assert props["num_parts"]["minimum"] == 2
    assert props["num_parts"]["maximum"] == 32
    assert "hierarchical" in props
    assert "min_face_island_threshold" in props
    assert "colorize_preview" in props
    assert "save_individual_parts" in props
    assert props["output_format"]["enum"] == ["glb", "obj"]
    assert adapter.get_supported_formats() == ["glb", "obj"]


def test_partfield_models_yaml_registration():
    config_path = backend_root / "config" / "models.yaml"
    assert config_path.exists()
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    cfg = config["mesh_segmentation"]["partfield_segmentation"]
    assert cfg["enabled"] is True
    assert cfg["vram_requirement"] == 8192
    assert "glb" in cfg["supported_outputs"]


def test_partfield_model_factory_mapping():
    factory_path = backend_root / "core" / "scheduler" / "model_factory.py"
    content = factory_path.read_text(encoding="utf-8")
    assert '"partfield_segmentation":' in content
    assert '"adapters.partfield_adapter"' in content
    assert '"PartFieldSegmentationAdapter"' in content


def test_partfield_api_method_defaults_follow_selected_engine():
    ai_request = MeshSegmentationRequest(mesh_path="source.obj")
    script_request = MeshSegmentationRequest(mesh_path="source.obj", engine="script")
    assert ai_request.method == "semantic"
    assert script_request.method == "geometric"

    connected_request = MeshSegmentationRequest(
        mesh_path="source.obj",
        engine="script",
        method="connected_components",
    )
    assert connected_request.method == "connected_components"


def test_partfield_merge_tree_cuts_to_requested_part_count():
    # Four source faces; the first two official merges form two parts.
    tree = {
        4: {"left": 0, "right": 1},
        5: {"left": 2, "right": 3},
        6: {"left": 4, "right": 5},
    }
    labels = _labels_from_merge_tree(tree, face_count=4, target_parts=2)
    assert labels.tolist() == [0, 0, 1, 1]
    assert len(set(labels.tolist())) == 2


def test_partfield_merge_tree_supports_single_cut_and_caps_part_count():
    tree = {
        3: {"left": 0, "right": 1},
        4: {"left": 3, "right": 2},
    }
    assert _labels_from_merge_tree(tree, 3, 2).tolist() == [0, 0, 1]
    assert _labels_from_merge_tree(tree, 3, 32).tolist() == [0, 1, 2]


def test_partfield_merge_tree_rejects_invalid_tree():
    with pytest.raises(ValueError, match="invalid"):
        _labels_from_merge_tree({4: {"left": 0, "right": 9}}, 3, 2)


def test_partfield_ai_never_uses_an_unloaded_geometric_fallback():
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    with pytest.raises(RuntimeError, match="PartField is not loaded"):
        adapter.execute({"mesh_path": "unused.obj", "num_parts": 4})
