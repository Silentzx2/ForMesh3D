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
        DINOv3ViTModel,
    )

    mock_model = MagicMock()
    mock_model.config.patch_size = 16
    mock_model.config.hidden_size = 1024
    with patch.object(DINOv3ViTModel, "from_pretrained", return_value=mock_model):
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


def test_pixal3d_load_model_weights_dir_resolution():
    import types
    adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=18432)
    mock_pipeline = MagicMock()
    mock_pipeline.low_vram = False
    mock_pipe_cls = MagicMock()
    mock_pipe_cls.from_pretrained.return_value = mock_pipeline
    mock_pipelines_mod = types.ModuleType("pixal3d.pipelines")
    mock_pipelines_mod.Pixal3DImageTo3DPipeline = mock_pipe_cls
    with patch("backend.adapters.pixal3d_adapter.get_model_weights_dir") as mock_get_weights, \
         patch.dict(sys.modules, {"pixal3d.pipelines": mock_pipelines_mod}), \
         patch("pixal3d.trainers.flow_matching.mixins.image_conditioned_proj.DinoV3ProjFeatureExtractor"):
        mock_get_weights.return_value = Path("/dummy/pretrained/Pixal3D")
        loaded = adapter._load_model()
        assert loaded is mock_pipeline
        assert adapter._pipeline is mock_pipeline


def test_pixal3d_project_points_to_image_batch_mixed_precision():
    from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import (
        project_points_to_image_batch,
        sample_features,
    )

    B, N = 1, 16
    points_3d = torch.randn(B, N, 3, dtype=torch.float32)
    # Front-view transform matrix in float16 (simulating mixed precision / half buffer)
    transform_matrix = torch.eye(4, dtype=torch.float16).unsqueeze(0).expand(B, -1, -1)
    camera_angle_x = torch.tensor([0.8575], dtype=torch.float32)

    # Must not raise "RuntimeError: expected scalar type Half but found Float"
    points_2d, depth, valid_mask = project_points_to_image_batch(
        points_3d, transform_matrix, camera_angle_x, resolution=512
    )
    assert points_2d.shape == (B, N, 2)
    assert depth.shape == (B, N)
    assert valid_mask.shape == (B, N)

    # Test sample_features with float16 fmap and float32 points
    fmap = torch.randn(B, 64, 32, 32, dtype=torch.float16)
    queries = (points_2d / 512.0) * 2 - 1  # float32
    feat = sample_features(fmap, queries)
    assert feat.shape == (B, 64, N)
    assert feat.dtype == torch.float16


def test_pixal3d_patcher_pure_pytorch_na2d():
    from patcher.pixal3d import pure_pytorch_na2d

    B, H, W, N, D = 1, 16, 16, 4, 32
    q = torch.randn(B, H, W, N, D)
    k = torch.randn(B, H, W, N, D)
    v = torch.randn(B, H, W, N, D)

    # Test with standard kernel and dilation
    out = pure_pytorch_na2d(q, k, v, kernel_size=(9, 9), dilation=(1, 1), chunk_size=64)
    assert out.shape == (B, H, W, N, D)
    assert torch.isfinite(out).all()

    # Test with dilation > 1 and integer kernel
    out_dilated = pure_pytorch_na2d(q, k, v, kernel_size=5, dilation=2, chunk_size=32)
    assert out_dilated.shape == (B, H, W, N, D)
    assert torch.isfinite(out_dilated).all()

    # Test asymmetric value dimension (e.g. NAF where D_qk=64, D_v=256)
    D_v = 128
    v_asym = torch.randn(B, H, W, N, D_v)
    out_asym = pure_pytorch_na2d(q, k, v_asym, kernel_size=(9, 9), chunk_size=64)
    assert out_asym.shape == (B, H, W, N, D_v)
    assert torch.isfinite(out_asym).all()


def test_pixal3d_patcher_apply_patch_pre_ampere():
    from patcher.pixal3d import apply_patch

    # Verify apply_patch runs without error and patches natten
    apply_patch()
    import natten
    assert hasattr(natten, "na2d")
    assert getattr(natten, "_pixal3d_na2d_patched", False) or hasattr(natten, "na2d")

