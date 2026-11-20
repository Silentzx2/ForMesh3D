"""
Test suite for NVIDIA PartField Segmentation Adapter and Model Registry Integration.
"""
import sys
import tempfile
from pathlib import Path
import pytest
import yaml

# Ensure backend is on sys.path
backend_root = Path(__file__).resolve().parents[1]
repo_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.adapters.partfield_adapter import PartFieldSegmentationAdapter
from backend.core.models.base import BaseModel, ModelStatus


def test_partfield_adapter_initialization():
    """Verify PartField adapter initializes with correct metadata and base contracts."""
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    assert isinstance(adapter, BaseModel)
    assert adapter.model_id == "partfield_segmentation"
    assert adapter.vram_requirement == 8192
    assert adapter.status == ModelStatus.UNLOADED
    assert adapter.feature_type == "mesh_segmentation"


def test_partfield_checkpoint_resolution():
    """Verify PartField resolves checkpoint under pretrained/PartField."""
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    ckpt = adapter._resolve_checkpoint()
    assert ckpt.name == "model_objaverse.ckpt"
    assert "PartField" in str(ckpt) or "PartUV" in str(ckpt)


def test_partfield_parameter_schema_and_formats():
    """Verify PartField parameter schema and supported formats."""
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    schema = adapter.get_parameter_schema()
    assert "properties" in schema
    props = schema["properties"]
    assert "num_parts" in props
    assert "method" in props
    assert "hierarchical" in props
    assert "min_face_island_threshold" in props
    assert "colorize_preview" in props
    assert "save_individual_parts" in props
    assert "output_format" in props

    formats = adapter.get_supported_formats()
    assert "glb" in formats
    assert "obj" in formats


def test_partfield_models_yaml_registration():
    """Verify partfield_segmentation is properly registered in backend/config/models.yaml."""
    config_path = backend_root / "config" / "models.yaml"
    assert config_path.exists(), "models.yaml not found"

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    seg_models = config.get("mesh_segmentation", {})
    assert "partfield_segmentation" in seg_models, "partfield_segmentation missing in models.yaml"

    cfg = seg_models["partfield_segmentation"]
    assert cfg["enabled"] is True
    assert cfg["vram_requirement"] == 8192
    assert "glb" in cfg["supported_outputs"]


def test_partfield_model_factory_mapping():
    """Verify partfield_segmentation is mapped in model_factory.py."""
    factory_path = backend_root / "core" / "scheduler" / "model_factory.py"
    assert factory_path.exists(), "model_factory.py not found"
    content = factory_path.read_text(encoding="utf-8")
    assert '"partfield_segmentation":' in content
    assert '"adapters.partfield_adapter"' in content
    assert '"PartFieldSegmentationAdapter"' in content


def test_partfield_execution():
    """Verify PartField execution on test mesh produces valid parts and colored outputs."""
    import trimesh
    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
        in_mesh_path = tmp_path / "test_sphere.obj"
        mesh.export(str(in_mesh_path))

        request = {
            "mesh_path": str(in_mesh_path),
            "num_parts": 4,
            "method": "semantic",
            "hierarchical": True,
            "min_face_island_threshold": 10,
            "colorize_preview": True,
            "save_individual_parts": True,
            "output_dir": str(tmp_path),
            "output_format": "obj",
        }

        result = adapter.execute(request)
        assert result["status"] == "success"
        assert result["num_parts"] >= 2
        assert "parts" in result
        assert len(result["parts"]) == result["num_parts"]
        assert Path(result["output_path"]).exists()
        assert "stats" in result
        assert result["stats"]["actual_parts"] == result["num_parts"]
        assert len(result["individual_part_paths"]) > 0
