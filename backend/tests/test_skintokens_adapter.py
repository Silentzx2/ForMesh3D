"""Unit tests for SkinTokensAdapter.

Verifies:
1. Adapter instantiation, feature type, and locked inference profile.
2. Parameter schema and supported formats.
3. Checkpoint resolution logic.
4. Input validation (unloaded model, missing mesh path).
5. Clean unload and resource cleanup.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.adapters.skintokens_adapter import SkinTokensAdapter, DEFAULT_SEED
from backend.core.models.base import ModelStatus


def test_skintokens_adapter_init():
    adapter = SkinTokensAdapter(vram_requirement=14336)
    assert adapter.MODEL_KEY == "SkinTokens"
    assert adapter.FEATURE_TYPE == "auto_rig"
    assert adapter.vram_requirement == 14336
    assert adapter.status == ModelStatus.UNLOADED
    assert adapter._LOCKED_INFERENCE_PROFILE["architecture"] == "TokenRig"
    assert adapter._LOCKED_INFERENCE_PROFILE["precision"] == "bfloat16"
    assert adapter._LOCKED_INFERENCE_PROFILE["attention"] == "flash_attention_2"


def test_skintokens_supported_formats():
    adapter = SkinTokensAdapter(vram_requirement=14336)
    formats = adapter.get_supported_formats()
    assert "input" in formats
    assert "output" in formats
    assert "glb" in formats["output"]
    assert "obj" in formats["input"]


def test_skintokens_parameter_schema():
    adapter = SkinTokensAdapter(vram_requirement=14336)
    schema = adapter.get_parameter_schema()
    params = schema["parameters"]
    assert "seed" in params
    assert params["seed"]["default"] == DEFAULT_SEED
    assert "top_k" in params
    assert params["top_k"]["default"] == 5
    assert "top_p" in params
    assert params["top_p"]["default"] == 0.95
    assert "use_transfer" in params
    assert params["use_transfer"]["default"] is True
    assert "use_skeleton" in params
    assert params["use_skeleton"]["default"] is False


def test_skintokens_process_request_unloaded():
    adapter = SkinTokensAdapter(vram_requirement=14336)
    res = adapter._process_request({"mesh_path": "/path/to/mesh.glb"})
    assert res["success"] is False
    assert "not loaded" in res["error"].lower()


def test_skintokens_process_request_missing_mesh(tmp_path: Path):
    adapter = SkinTokensAdapter(vram_requirement=14336)
    adapter._model = MagicMock()
    res = adapter._process_request({"mesh_path": str(tmp_path / "nonexistent.glb")})
    assert res["success"] is False
    assert "not found" in res["error"].lower()


def test_skintokens_resolve_checkpoint(tmp_path: Path):
    weights_dir = tmp_path / "weights"
    skintokens_root = tmp_path / "thirdparty"
    ckpt = weights_dir / "experiments" / "articulation_xl_quantization_256_token_4" / "grpo_1400.ckpt"
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    ckpt.write_text("mock checkpoint")

    resolved = SkinTokensAdapter._resolve_checkpoint(weights_dir, skintokens_root)
    assert resolved == str(ckpt)


def test_skintokens_unload_cleanup():
    adapter = SkinTokensAdapter(vram_requirement=14336)
    mock_proc = MagicMock()
    adapter._bpy_proc = mock_proc
    adapter._model = MagicMock()
    adapter.status = ModelStatus.LOADED

    adapter._unload_model()
    mock_proc.terminate.assert_called_once()
    assert adapter._model is None
    assert adapter._bpy_proc is None
    assert adapter.status == ModelStatus.UNLOADED
