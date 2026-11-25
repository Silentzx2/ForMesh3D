from pathlib import Path
import shutil
from types import SimpleNamespace
import numpy as np
from PIL import Image
import pytest
import torch
import trimesh
from trimesh.visual.texture import TextureVisuals
from backend.adapters import _ADAPTER_MAP
from backend.adapters.triposr_adapter import TripoSRAdapter
from backend.core.scheduler.model_factory import ModelFactory
from patcher.triposr import patch_texture_baker


class FakePipeline:
    def __init__(self):
        self.renderer = SimpleNamespace(cfg=SimpleNamespace(radius=0.87))
        self.received_image = None
        self.extract_calls = []

    def __call__(self, images, device):
        self.received_image = images[0]
        return [torch.zeros((1, 4), device=device)]

    def extract_mesh(self, scene_codes, has_vertex_color, resolution):
        self.extract_calls.append((scene_codes, has_vertex_color, resolution))
        return [trimesh.creation.box(extents=(2.0, 4.0, 6.0))]


def setup_adapter(feature_type="image_to_raw_mesh", model_id="triposr_image_to_raw_mesh"):
    adapter = TripoSRAdapter(vram_requirement=6144, model_id=model_id, feature_type=feature_type)
    adapter.model = FakePipeline()
    adapter.device = "cpu"
    adapter._rembg_session = object()
    adapter._remove_background = lambda image, _session: image
    adapter._resize_foreground = lambda image, _ratio: image
    return adapter


def fake_official_baker(adapter, calls):
    def bake(mesh, model, scene_code, resolution):
        calls.append((mesh, model, scene_code, resolution))
        return {
            "vmapping": np.arange(len(mesh.vertices), dtype=np.int64),
            "indices": np.asarray(mesh.faces, dtype=np.int64),
            "uvs": np.full((len(mesh.vertices), 2), 0.5, dtype=np.float32),
            "colors": np.tile(np.array([0.6, 0.4, 0.2, 1.0], dtype=np.float32),
                              (resolution, resolution, 1)),
        }
    adapter._bake_texture = bake


def make_image(path):
    Image.new("RGB", (32, 32), (90, 120, 150)).save(path)
    return path


def test_registry_routes_generation_and_painting_to_one_adapter():
    assert _ADAPTER_MAP["triposr_image_to_raw_mesh"] == "backend.adapters.triposr_adapter"
    assert _ADAPTER_MAP["triposr_image_mesh_painting"] == "backend.adapters.triposr_adapter"
    for model_id in ("triposr_image_to_raw_mesh", "triposr_image_mesh_painting"):
        assert ModelFactory.ADAPTER_REGISTRY[model_id] == {
            "module": "adapters.triposr_adapter", "class": "TripoSRAdapter"
        }


def test_texture_off_runs_only_official_raw_mesh_extraction(tmp_path):
    adapter = setup_adapter()
    image_path = make_image(tmp_path / "reference.png")
    result = adapter._process_request({"image_path": str(image_path), "texture_enabled": False})
    try:
        assert adapter.model.extract_calls[0][1:] == (True, 256)
        assert adapter._bake_texture is None
        assert result["texture_enabled"] is False and result["texture_maps"] == []
        assert result["generation_info"]["mode"] == "image_to_raw_mesh"
        assert result["generation_info"]["geometry_generated"] is True
        raw = trimesh.load(result["output_mesh_path"], force="mesh")
        assert not isinstance(raw.visual, TextureVisuals)
    finally:
        shutil.rmtree(result["_temporary_output_dir"], ignore_errors=True)


def test_texture_on_extracts_mesh_then_runs_official_baker(tmp_path):
    adapter = setup_adapter()
    image_path = make_image(tmp_path / "reference.png")
    calls = []
    fake_official_baker(adapter, calls)
    result = adapter._process_request({
        "image_path": str(image_path), "texture_enabled": True, "texture_resolution": 1024,
    })
    try:
        assert adapter.model.extract_calls[0][1:] == (False, 256)
        assert calls and calls[0][1] is adapter.model and calls[0][3] == 1024
        assert result["texture_enabled"] is True
        assert result["generation_info"]["mode"] == "image_to_textured_mesh"
        assert result["generation_info"]["geometry_generated"] is True
        textured = trimesh.load(result["output_mesh_path"], force="mesh")
        assert isinstance(textured.visual, TextureVisuals)
        assert textured.visual.material.baseColorTexture.size == (1024, 1024)
    finally:
        shutil.rmtree(result["_temporary_output_dir"], ignore_errors=True)


def test_texture_page_paints_existing_mesh_without_generating_geometry(tmp_path):
    adapter = setup_adapter("image_mesh_painting", "triposr_image_mesh_painting")
    source_mesh = trimesh.creation.box(extents=(2.0, 4.0, 6.0))
    mesh_path, image_path = tmp_path / "input.glb", make_image(tmp_path / "reference.png")
    source_mesh.export(mesh_path)
    calls = []
    fake_official_baker(adapter, calls)
    result = adapter._process_request({
        "mesh_path": str(mesh_path), "image_path": str(image_path), "texture_resolution": 1024,
    })
    try:
        assert not adapter.model.extract_calls
        assert calls and calls[0][1] is adapter.model and calls[0][3] == 1024
        assert result["generation_info"]["mode"] == "image_mesh_painting"
        assert result["generation_info"]["geometry_generated"] is False
        painted = trimesh.load(result["output_mesh_path"], force="mesh")
        assert isinstance(painted.visual, TextureVisuals)
        assert painted.visual.material.baseColorTexture.size == (1024, 1024)
        np.testing.assert_allclose(painted.extents, source_mesh.extents, atol=1e-5)
        assert len(painted.faces) == len(source_mesh.faces)
    finally:
        shutil.rmtree(result["_temporary_output_dir"], ignore_errors=True)


def test_official_baker_device_patch_chunks_queries_on_scene_device():
    module = SimpleNamespace(positions_to_colors=lambda *_args: None)
    calls = []
    class Renderer:
        def query_triplane(self, _decoder, positions, _scene_code):
            calls.append((positions.device.type, len(positions)))
            return {"color": torch.full((len(positions), 3), 0.25, device=positions.device)}
    model = SimpleNamespace(renderer=Renderer(), decoder=object())
    scene_code = torch.zeros(1)
    position_atlas = np.zeros((2, 2, 4), dtype=np.float32)
    position_atlas[..., 3] = 1.0
    patch_texture_baker(module, torch_module=torch, chunk_size=2)
    colors = module.positions_to_colors(model, scene_code, position_atlas, 2)
    assert colors.shape == (2, 2, 4)
    assert calls and all(device == scene_code.device.type for device, _ in calls)
    assert max(size for _, size in calls) <= 2
    np.testing.assert_allclose(colors[..., :3], 0.25)


def test_triposr_rejects_unsupported_texture_resolution(tmp_path):
    adapter = setup_adapter()
    image_path = make_image(tmp_path / "reference.png")
    with pytest.raises(ValueError, match="texture_resolution"):
        adapter._process_request({
            "image_path": str(image_path), "texture_enabled": True, "texture_resolution": 1536,
        })


def test_manifest_exposes_both_modes_and_keeps_wheelhouse_dependency():
    root = Path(__file__).resolve().parents[2]
    import yaml
    config = yaml.safe_load((root / "backend/config/models.yaml").read_text())
    raw = config["image_to_raw_mesh"]["triposr_image_to_raw_mesh"]
    paint = config["image_mesh_painting"]["triposr_image_mesh_painting"]
    assert raw["supported_inputs"] == ["image"]
    assert raw["capabilities"]["raw_mesh"] is True and raw["capabilities"]["texture_generation"] is True
    assert raw["capabilities"]["supports_pbr"] is False
    assert paint["supported_inputs"] == ["mesh", "image"]
    assert paint["capabilities"]["texture_maps"] == ["base_color"]
    requirements = (root / "backend/requirements-models.txt").read_text()
    installer = (root / "backend/scripts/install.sh").read_text()
    assert "torchmcubes @" not in requirements
    assert "git+https://github.com/tatsy/torchmcubes.git" not in installer
    assert 'install_local_wheel "torchmcubes-*.whl" "torchmcubes"' in installer
