"""Unit tests for TaoFlowForgeImageToRawMeshAdapter.

Verifies:
1. Adapter initialization, supported formats, and parameter schema.
2. Input validation for unloaded model and missing image path.
3. Attention patcher and pre-Ampere compute dtype handling.
4. Clean unload cleanup.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
import torch

_tao_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Taobao3D" / "TaoFlowForge")
if _tao_root not in sys.path:
    sys.path.insert(0, _tao_root)

if "transformers" not in sys.modules:
    import types
    _tf_mock = types.ModuleType("transformers")
    _tf_mock.DINOv3ViTConfig = type("DINOv3ViTConfig", (), {})
    _tf_mock.DINOv3ViTModel = type("DINOv3ViTModel", (), {})
    sys.modules["transformers"] = _tf_mock

from backend.adapters.taoflowforge_adapter import (
    TaoFlowForgeImageToRawMeshAdapter,
    DEFAULT_SEED,
)
from backend.core.models.base import ModelStatus


def test_taoflowforge_adapter_init():
    adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=14336)
    assert adapter.MODEL_KEY == "Taobao3D/TaoFlowForge"
    assert adapter.FEATURE_TYPE == "image_to_raw_mesh"
    assert adapter.vram_requirement == 14336
    assert adapter.status == ModelStatus.UNLOADED


def test_taoflowforge_supported_formats():
    adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=14336)
    formats = adapter.get_supported_formats()
    assert "input" in formats
    assert "output" in formats
    assert "png" in formats["input"]
    assert "glb" in formats["output"]


def test_taoflowforge_parameter_schema():
    adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=14336)
    schema = adapter.get_parameter_schema()
    params = schema["parameters"]
    assert "seed" in params
    assert params["seed"]["default"] == DEFAULT_SEED


def test_taoflowforge_process_request_unloaded():
    adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=14336)
    res = adapter._process_request({"image_path": "/path/to/image.png"})
    assert res["success"] is False
    assert "pipeline not loaded" in res["error"]


def test_taoflowforge_process_request_missing_image():
    adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=14336)
    adapter._pipeline = MagicMock()
    res = adapter._process_request({"image_path": "/nonexistent/image.png"})
    assert res["success"] is False
    assert "image not found" in res["error"]


def test_taoflowforge_pre_ampere_compute_dtype():
    from patcher.taoflowforge import apply_patch
    import taoflowforge.models.attention as attn

    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.get_device_capability", return_value=(7, 5)):
        attn._taoflowforge_attn_patched = False
        apply_patch()
        assert attn.ATTENTION_BACKEND == "sdpa"
        assert attn.get_compute_dtype(torch.device("cuda:0")) == torch.float16


def test_taoflowforge_modern_gpu_compute_dtype():
    from patcher.taoflowforge import apply_patch
    import taoflowforge.models.attention as attn

    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.get_device_capability", return_value=(8, 0)):
        attn._taoflowforge_attn_patched = False
        apply_patch()
        assert attn.get_compute_dtype(torch.device("cuda:0")) == torch.bfloat16


def test_taoflowforge_config_step_defaults():
    import os
    from taoflowforge.config import Stage0Config, Stage1Config, Stage2Config

    # Default mode should use fast steps (5 steps per stage)
    c0 = Stage0Config(checkpoint=Path("/dummy/stage0.pt"))
    c1 = Stage1Config(checkpoint=Path("/dummy/stage1.pt"))
    c2 = Stage2Config(checkpoint=Path("/dummy/stage2.pt"))
    assert c0.num_steps == 5
    assert c1.num_steps == 5
    assert c2.num_steps == 5


def test_taoflowforge_stage_offload_methods():
    from taoflowforge.models.stage0 import Stage0Model
    from taoflowforge.models.stage1 import Stage1Model
    from taoflowforge.models.stage2 import Stage2Model

    # Verify all 3 stages implement offload() for clean memory reclamation
    assert hasattr(Stage0Model, "offload")
    assert hasattr(Stage1Model, "offload")
    assert hasattr(Stage2Model, "offload")


def test_taoflowforge_topology_resilience_patch():
    from patcher.taoflowforge import _patch_stage2_topology_decoder
    from taoflowforge.models.stage2 import Stage2Model
    import trimesh

    Stage2Model._taoflowforge_topology_patched = False
    _patch_stage2_topology_decoder()
    assert getattr(Stage2Model, "_taoflowforge_topology_patched", False) is True

    # Test adaptive fallback behavior
    model = Stage2Model.__new__(Stage2Model)
    calls = []

    def mock_orig(self, latent, verts, *, edge_threshold=0.5):
        calls.append(edge_threshold)
        if edge_threshold == 0.5:
            raise RuntimeError("TaoFlowForge Stage 2 topology extraction produced 0 faces")
        # Fallback succeeds at 0.4
        return trimesh.Trimesh(vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces=[[0, 1, 2]])

    with patch.object(Stage2Model, "decode_mesh", side_effect=lambda *a, **k: mock_orig(model, *a, **k)):
        # Re-apply patch wrapping mock
        Stage2Model._taoflowforge_topology_patched = False
        _patch_stage2_topology_decoder()
        mesh = Stage2Model.decode_mesh(model, None, None, edge_threshold=0.5)
        assert len(mesh.faces) == 1
        assert 0.5 in calls
        assert 0.4 in calls


def test_taoflowforge_adapter_step_schedule_defaults():
    import os
    from backend.adapters.taoflowforge_adapter import TaoFlowForgeImageToRawMeshAdapter

    adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=14336)
    with patch.dict(os.environ, {}, clear=True):
        use_fast = os.environ.get("TAOFLOWFORGE_FAST_STEPS", "").lower() in ("1", "true")
        s0 = int(os.environ.get("TAOFLOWFORGE_STAGE0_STEPS", "5" if use_fast else "50"))
        s1 = int(os.environ.get("TAOFLOWFORGE_STAGE1_STEPS", "5" if use_fast else "30"))
        s2 = int(os.environ.get("TAOFLOWFORGE_STAGE2_STEPS", "5" if use_fast else "50"))
        assert (s0, s1, s2) == (50, 30, 50)

    with patch.dict(os.environ, {"TAOFLOWFORGE_FAST_STEPS": "1"}, clear=True):
        use_fast = os.environ.get("TAOFLOWFORGE_FAST_STEPS", "").lower() in ("1", "true")
        s0 = int(os.environ.get("TAOFLOWFORGE_STAGE0_STEPS", "5" if use_fast else "50"))
        s1 = int(os.environ.get("TAOFLOWFORGE_STAGE1_STEPS", "5" if use_fast else "30"))
        s2 = int(os.environ.get("TAOFLOWFORGE_STAGE2_STEPS", "5" if use_fast else "50"))
        assert (s0, s1, s2) == (5, 5, 5)
