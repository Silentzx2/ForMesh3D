"""Regression tests for the Stable Fast 3D adapter contract."""
from __future__ import annotations

import shutil
import sys
import types
from pathlib import Path

import pytest
import trimesh
from PIL import Image

import backend.adapters.stable_fast_3d_adapter as adapter_module
from backend.adapters.stable_fast_3d_adapter import StableFast3DAdapter


class _FakePipeline:
    device = "cpu"

    def __init__(self, mesh):
        self.mesh = mesh
        self.received = None

    def run_image(self, image, **kwargs):
        self.received = (image, kwargs)
        return self.mesh, {}


def _make_adapter(pipeline):
    adapter = StableFast3DAdapter.__new__(StableFast3DAdapter)
    adapter._pipeline = pipeline
    adapter._rembg_session = object()
    adapter._remove_background = lambda image, _session: image
    adapter._resize_foreground = lambda image, _ratio: image
    adapter.device = "cpu"
    return adapter


def test_model_key_matches_configured_and_downloaded_checkpoint_directory():
    assert StableFast3DAdapter.MODEL_KEY == "stable-fast-3d"
    assert StableFast3DAdapter.supports_seed_variants is False


def test_process_request_passes_preprocessed_rgba_pil_image_to_upstream(tmp_path, monkeypatch):
    source_path = tmp_path / "input.jpg"
    Image.new("RGB", (64, 48), (120, 80, 40)).save(source_path)
    mesh = trimesh.creation.box()
    pipeline = _FakePipeline(mesh)
    adapter = _make_adapter(pipeline)

    calls = {}

    def remove_background(image, session):
        calls["remove_background_mode"] = image.mode
        calls["session"] = session
        return image

    def resize_foreground(image, ratio):
        calls["resize_ratio"] = ratio
        return image

    sf3d_package = types.ModuleType("sf3d")
    sf3d_package.__path__ = []
    sf3d_utils = types.ModuleType("sf3d.utils")
    sf3d_utils.remove_background = remove_background
    sf3d_utils.resize_foreground = resize_foreground
    monkeypatch.setitem(sys.modules, "sf3d", sf3d_package)
    monkeypatch.setitem(sys.modules, "sf3d.utils", sf3d_utils)
    monkeypatch.setattr(adapter_module, "torch", None)

    result = adapter._process_request(
        {
            "image_path": str(source_path),
            "seed": 17,
            "texture_resolution": 1024,
            "remesh_option": "none",
            "target_vertex_count": -1,
        }
    )

    received_image, received_kwargs = pipeline.received
    assert isinstance(received_image, Image.Image)
    assert received_image.mode == "RGBA"
    assert calls["remove_background_mode"] == "RGBA"
    assert calls["session"] is adapter._rembg_session
    assert calls["resize_ratio"] == 0.85
    assert received_kwargs == {
        "bake_resolution": 1024,
        "remesh": "none",
        "vertex_count": -1,
    }
    assert result["success"] is True
    assert result["texture_enabled"] is True
    assert result["generation_info"]["seed"] == 17
    assert result["generation_info"]["seed_applied"] is False
    output_path = Path(result["output_mesh_path"])
    assert output_path.is_file()
    assert output_path.read_bytes()[:4] == b"glTF"
    assert Path(result["_temporary_output_dir"]) == output_path.parent
    shutil.rmtree(result["_temporary_output_dir"], ignore_errors=True)


@pytest.mark.parametrize(
    ("parameters", "message"),
    [
        ({"texture_resolution": 256}, "texture_resolution"),
        ({"remesh_option": "invalid"}, "remesh_option"),
        ({"target_vertex_count": 0}, "target_vertex_count"),
        ({"seed": -1}, "seed"),
    ],
)
def test_process_request_rejects_invalid_model_parameters(tmp_path, parameters, message):
    source_path = tmp_path / "input.png"
    Image.new("RGBA", (32, 32), (255, 255, 255, 255)).save(source_path)
    adapter = _make_adapter(_FakePipeline(trimesh.creation.box()))

    with pytest.raises(ValueError, match=message):
        adapter._process_request({"image_path": str(source_path), **parameters})


def test_supported_output_contract_matches_actual_glb_export():
    formats = StableFast3DAdapter.__new__(StableFast3DAdapter).get_supported_formats()
    assert formats["output"] == ["glb"]
    schema = StableFast3DAdapter.__new__(StableFast3DAdapter).get_parameter_schema()
    assert schema["parameters"]["seed"]["description"].find("no seed control") >= 0
    assert schema["parameters"]["remesh_option"]["enum"] == ["none", "quad", "triangle"]
