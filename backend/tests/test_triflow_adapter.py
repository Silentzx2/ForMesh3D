"""
Test suite for TriFlow Retopology Adapter and Scheduler Integration.
"""
import sys
import tempfile
from pathlib import Path
import pytest
import yaml
import trimesh

# Ensure backend is on sys.path
backend_root = Path(__file__).resolve().parents[1]
repo_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.adapters.triflow_adapter import TriFlowRetopologyAdapter
from backend.core.models.base import BaseModel, ModelStatus


def test_triflow_adapter_initialization():
    """Verify TriFlow adapter initializes with correct metadata and base contracts."""
    adapter = TriFlowRetopologyAdapter(vram_requirement=10240)
    assert isinstance(adapter, BaseModel)
    assert adapter.model_id == "triflow_retopology"
    assert adapter.vram_requirement == 10240
    assert adapter.status == ModelStatus.UNLOADED
    assert adapter.feature_type == "mesh_retopology"


def test_triflow_checkpoint_resolution():
    """Verify TriFlow resolves the 3 required checkpoint paths under pretrained/TriFlow."""
    adapter = TriFlowRetopologyAdapter(vram_requirement=10240)
    ckpts = adapter._resolve_checkpoints()
    assert "flow_model" in ckpts
    assert "sdf_vae" in ckpts
    assert "nvv_vae" in ckpts
    assert ckpts["flow_model"].name == "flow_model.safetensors"
    assert ckpts["sdf_vae"].name == "sdf_vae.safetensors"
    assert ckpts["nvv_vae"].name == "nvv_vae.safetensors"


def test_triflow_parameter_schema_and_formats():
    """Verify TriFlow parameter schema and supported formats."""
    adapter = TriFlowRetopologyAdapter(vram_requirement=10240)
    schema = adapter.get_parameter_schema()
    params = schema["parameters"]
    assert "target_polycount" in params
    assert "poly_type" in params
    assert "quad_ratio" in params
    assert "qem_threshold" in params
    assert "preserve_features" in params
    assert "watertight" in params
    assert "output_format" in params

    formats = adapter.get_supported_formats()
    assert "glb" in formats["output"]
    assert "obj" in formats["output"]


def test_triflow_models_yaml_registration():
    """Verify triflow_retopology is properly registered in backend/config/models.yaml."""
    config_path = backend_root / "config" / "models.yaml"
    assert config_path.exists(), "models.yaml not found"

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    retopo_models = config.get("mesh_retopology", {})
    assert "triflow_retopology" in retopo_models, "triflow_retopology missing in models.yaml"

    triflow_cfg = retopo_models["triflow_retopology"]
    assert triflow_cfg["enabled"] is True
    assert triflow_cfg["vram_requirement"] == 10240
    assert triflow_cfg["model_path"] == "backend/pretrained/TriFlow"
    assert triflow_cfg["capabilities"]["retopology"] is True
    assert triflow_cfg["capabilities"]["target_polycount"] is True
    assert triflow_cfg["capabilities"]["quad_ratio"] is True


def test_triflow_fallback_processing():
    """Verify adapter process_request succeeds via fallback decimation when checkpoints are pending."""
    adapter = TriFlowRetopologyAdapter(vram_requirement=10240)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
        in_mesh_path = tmp_path / "test_sphere.obj"
        mesh.export(str(in_mesh_path))

        inputs = {
            "mesh_path": str(in_mesh_path),
            "target_polycount": 500,
            "poly_type": "quad",
            "quad_ratio": 0.95,
            "qem_threshold": 12.0,
            "output_dir": str(tmp_path),
            "output_format": "obj",
        }

        result = adapter._process_request(inputs)
        assert result["success"] is True
        assert "output_mesh_path" in result
        assert Path(result["output_mesh_path"]).exists()
        assert "stats" in result
        assert result["stats"]["face_count"] > 0
