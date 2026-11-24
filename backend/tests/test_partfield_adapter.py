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
from backend.core.utils.segmentation_artifacts import persist_individual_parts


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


def test_partfield_api_is_ai_only():
    ai_request = MeshSegmentationRequest(mesh_path="source.obj")
    assert ai_request.method == "semantic"
    assert "engine" not in MeshSegmentationRequest.model_fields

    with pytest.raises(ValueError):
        MeshSegmentationRequest(mesh_path="source.obj", method="connected_components")


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



def test_individual_segmentation_parts_are_persisted_and_archived(tmp_path):
    workspace_dir = tmp_path / "storage" / "rabbit_a8f32c"
    destination_dir = workspace_dir / "segmentation"
    destination_dir.mkdir(parents=True)

    worker_dir = tmp_path / "worker"
    worker_dir.mkdir()
    source_mesh = worker_dir / "source_partfield_segmented.glb"
    source_mesh.write_bytes(b"combined")
    source_parts_dir = worker_dir / "source_partfield_segmented_parts"
    source_parts_dir.mkdir()
    part_paths = []
    for index in range(2):
        part_path = source_parts_dir / f"part_{index + 1:02d}.glb"
        part_path.write_bytes(f"part-{index + 1}".encode())
        part_paths.append(str(part_path))

    published_mesh = destination_dir / "rabbit_a8f32c_segmentation.glb"
    published_mesh.write_bytes(b"combined")

    result = persist_individual_parts(part_paths, source_mesh, published_mesh, workspace_dir)

    assert result["individual_part_count"] == 2
    assert len(result["individual_part_paths"]) == 2
    assert all(Path(path).is_file() for path in result["individual_part_paths"])
    assert all((workspace_dir / path).is_file() for path in result["individual_part_relative_paths"])
    archive_path = Path(result["parts_archive_path"])
    assert archive_path.is_file()
    import zipfile
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
    assert len(names) == 2
    assert all(name.endswith(".glb") for name in names)


def test_individual_segmentation_parts_reject_paths_outside_adapter_output(tmp_path):
    workspace_dir = tmp_path / "storage" / "rabbit_a8f32c"
    destination_dir = workspace_dir / "segmentation"
    destination_dir.mkdir(parents=True)
    worker_dir = tmp_path / "worker"
    worker_dir.mkdir()
    source_mesh = worker_dir / "source.glb"
    source_mesh.write_bytes(b"combined")
    source_parts_dir = worker_dir / "source_parts"
    source_parts_dir.mkdir()
    outside_part = tmp_path / "outside.glb"
    outside_part.write_bytes(b"part")
    published_mesh = destination_dir / "rabbit_segmentation.glb"
    published_mesh.write_bytes(b"combined")

    with pytest.raises(ValueError, match="outside adapter output"):
        persist_individual_parts([str(outside_part)], source_mesh, published_mesh, workspace_dir)
