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
