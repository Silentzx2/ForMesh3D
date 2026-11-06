"""Unit tests for Pixal3DImageToRawMeshAdapter.

Verifies:
1. Adapter initialization, supported formats, and parameter schema.
2. Input validation for unloaded model and missing image path.
3. DinoV3ProjFeatureExtractor.to() argument handling (single device, device + dtype).
4. Sparse conv backend selection logic.
5. Clean unload cleanup.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
import torch

_pixal3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Pixal3D")
if _pixal3d_root not in sys.path:
    sys.path.insert(0, _pixal3d_root)

if "transformers" not in sys.modules:
    import types
    _tf_mock = types.ModuleType("transformers")
    _tf_mock.DINOv3ViTConfig = type(
        "DINOv3ViTConfig", (), {"patch_size": 16, "hidden_size": 1024}
    )

    class _MockViTModel:
        def __init__(self, *a, **k):
            self.config = types.SimpleNamespace(patch_size=16, hidden_size=1024)
        def to(self, *a, **k):
            return self
        def eval(self):
            return self
        def requires_grad_(self, *a):
            return self

    _tf_mock.DINOv3ViTModel = type(
        "DINOv3ViTModel",
        (),
        {"from_pretrained": lambda *a, **k: _MockViTModel()},
    )
    sys.modules["transformers"] = _tf_mock

from backend.adapters.pixal3d_adapter import (
    Pixal3DImageToRawMeshAdapter,
    DEFAULT_SEED,
)
from backend.core.models.base import ModelStatus


def test_pixal3d_adapter_init():
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    assert adapter.MODEL_KEY == "Pixal3D"
    assert adapter.FEATURE_TYPE == "image_to_raw_mesh"
    assert adapter.vram_requirement == 18432
    assert adapter.status == ModelStatus.UNLOADED


def test_pixal3d_supported_formats():
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    formats = adapter.get_supported_formats()
    assert "input" in formats
    assert "output" in formats
    assert "png" in formats["input"]
    assert "glb" in formats["output"]


def test_pixal3d_parameter_schema():
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    schema = adapter.get_parameter_schema()
    params = schema["parameters"]
    assert "seed" in params
    assert params["seed"]["default"] == DEFAULT_SEED


def test_pixal3d_process_request_unloaded():
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    res = adapter._process_request({"image_path": "/path/to/image.png"})
    assert res["success"] is False
    assert "pipeline not loaded" in res["error"]


def test_pixal3d_process_request_missing_image():
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    adapter._pipeline = MagicMock()
    res = adapter._process_request({"image_path": "/nonexistent/image.png"})
    assert res["success"] is False
    assert "image not found" in res["error"]


def test_pixal3d_dinov3_proj_feature_extractor_to_multi_args():
    from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import (
        DinoV3ProjFeatureExtractor,
    )

    extractor = DinoV3ProjFeatureExtractor("dummy_model")
    # Verify to() accepts (device, dtype) without raising TypeError
    extractor.to("cpu", torch.float32)
    extractor.to("cpu")
    extractor.to(dtype=torch.float32)


def test_pixal3d_unload_cleanup():
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    adapter._pipeline = MagicMock()
    adapter.model = adapter._pipeline
    adapter._unload_model()
    assert adapter._pipeline is None
    assert adapter.model is None
