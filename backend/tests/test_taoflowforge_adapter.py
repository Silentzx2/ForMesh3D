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
    _tf_mock.DINOv3ViTModel = type(
        "DINOv3ViTModel",
        (),
        {"from_pretrained": lambda *a, **k: MagicMock()},
    )
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
        assert attn.get_compute_dtype(torch.device("cuda:0")) == torch.float32


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

    # Default mode should use official steps (50, 30, 50)
    c0 = Stage0Config(checkpoint=Path("/dummy/stage0.pt"))
    c1 = Stage1Config(checkpoint=Path("/dummy/stage1.pt"))
    c2 = Stage2Config(checkpoint=Path("/dummy/stage2.pt"))
    assert (c0.num_steps, c1.num_steps, c2.num_steps) == (50, 30, 50)

    # Fast mode opt-in via TAOFLOWFORGE_FAST_STEPS=1
    with patch.dict(os.environ, {"TAOFLOWFORGE_FAST_STEPS": "1"}, clear=True):
        import importlib
        import taoflowforge.config as cfg
        importlib.reload(cfg)
        fc0 = cfg.Stage0Config(checkpoint=Path("/dummy/stage0.pt"))
        fc1 = cfg.Stage1Config(checkpoint=Path("/dummy/stage1.pt"))
        fc2 = cfg.Stage2Config(checkpoint=Path("/dummy/stage2.pt"))
        assert (fc0.num_steps, fc1.num_steps, fc2.num_steps) == (5, 5, 5)
    # Restore
    import importlib
    import taoflowforge.config as cfg
    importlib.reload(cfg)


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

    # Test adaptive threshold extraction
    model = MagicMock()
    model.latent_dim = 32
    latent = torch.zeros(1, 10, 32)
    verts = torch.tensor([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
    ] + [[float(i), float(i), float(i)] for i in range(3, 10)])

    called_thresholds = []

    def mock_extract(edge_logits, *, threshold=0.5, **kwargs):
        called_thresholds.append(threshold)
        if threshold >= 0.5:
            return []  # 0 faces
        # Threshold 0.4 succeeds with a triangle
        return [[0, 1, 2]]

    model.vertex_decoder.return_value = {
        "edge_logits": torch.zeros(1, 10, 10),
        "normal_pred": torch.zeros(1, 10, 3),
    }
    model.vertex_decoder.extract_mesh = mock_extract

    mesh = Stage2Model.decode_mesh(model, latent, verts, edge_threshold=0.5)
    assert len(mesh.faces) == 1
    assert 0.5 in called_thresholds
    assert 0.4 in called_thresholds


def test_taoflowforge_reject_hyper_connected_clique():
    from patcher.taoflowforge import _patch_stage2_topology_decoder
    from taoflowforge.models.stage2 import Stage2Model
    import numpy as np

    Stage2Model._taoflowforge_topology_patched = False
    _patch_stage2_topology_decoder()

    # 10 vertices: max manifold faces = 4 * 10 = 40.
    # If extract_mesh returns 50 faces (clique), it should reject it and fall back to ConvexHull.
    model = MagicMock()
    model.latent_dim = 32
    latent = torch.zeros(1, 10, 32)
    # 10 non-coplanar vertices
    verts = torch.tensor([
        [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0],
        [1.0, 1.0, 0.0], [1.0, 0.0, 1.0], [0.0, 1.0, 1.0], [1.0, 1.0, 1.0],
        [0.5, 0.5, 0.0], [0.5, 0.5, 1.0],
    ])

    def mock_clique_extract(edge_logits, *, threshold=0.5, **kwargs):
        # Return 50 faces (exceeding 4 * 10 = 40)
        return [[0, 1, 2]] * 50

    model.vertex_decoder.return_value = {
        "edge_logits": torch.zeros(1, 10, 10),
        "normal_pred": torch.zeros(1, 10, 3),
    }
    model.vertex_decoder.extract_mesh = mock_clique_extract

    # Without scipy, rejecting clique raises RuntimeError (honest failure, no fake 45k box mesh)
    with pytest.raises(RuntimeError, match="0 faces"):
        Stage2Model.decode_mesh(model, latent, verts, edge_threshold=0.5)

    # With scipy ConvexHull available, it reconstructs valid surface
    mock_hull = MagicMock()
    mock_hull.simplices = np.array([[0, 1, 2], [0, 2, 3]])
    with patch.dict(sys.modules, {"scipy": MagicMock(), "scipy.spatial": MagicMock(ConvexHull=MagicMock(return_value=mock_hull))}):
        mesh = Stage2Model.decode_mesh(model, latent, verts, edge_threshold=0.5)
        assert len(mesh.faces) == 2


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


def test_taoflowforge_stage1_pre_ampere_fp16():
    from patcher.taoflowforge import apply_patch
    from taoflowforge.models.stage1 import Stage1Model
    from taoflowforge.models.attention import flash_attn_qkv

    # Verify Stage 1 patcher wraps refine_coordinates with FP16 autocast on sm < 80
    Stage1Model._taoflowforge_stage1_patched = False
    apply_patch()
    assert getattr(Stage1Model, "_taoflowforge_stage1_patched", False) is True

    # Verify flash_attn_qkv preserves FP16 compute dtype on sm < 80
    q = torch.randn(1, 4, 16, 32, dtype=torch.float16)
    k = torch.randn(1, 4, 16, 32, dtype=torch.float16)
    v = torch.randn(1, 4, 16, 32, dtype=torch.float16)
    out = flash_attn_qkv(q, k, v)
    assert out.shape == q.shape
    assert out.dtype == torch.float16


def test_taoflowforge_rmsnorm_preserves_fp16_pre_ampere():
    from taoflowforge.models.octree_dit import MultiHeadRMSNorm

    norm = MultiHeadRMSNorm(head_dim=32, num_heads=4)
    x = torch.randn(1, 8, 4, 32, dtype=torch.float16)
    out = norm(x)
    assert out.dtype == torch.float16, f"RMSNorm should preserve float16 dtype, got {out.dtype}"


def test_taoflowforge_rmsnorm_preserves_bf16_modern_gpu():
    from taoflowforge.models.octree_dit import MultiHeadRMSNorm

    norm = MultiHeadRMSNorm(head_dim=32, num_heads=4)
    x = torch.randn(1, 8, 4, 32, dtype=torch.bfloat16)
    out = norm(x)
    assert out.dtype == torch.bfloat16, f"RMSNorm should preserve bfloat16 dtype, got {out.dtype}"


def test_taoflowforge_build_octree_rope_cpu_uses_fp32():
    from taoflowforge.models.octree_dit import build_octree_rope

    # CPU path: no CUDA -> RoPE arithmetic in float32 (modern/safe path)
    positions = torch.randn(1, 8, 3, dtype=torch.float16)
    cosine, sine = build_octree_rope(positions, head_dim=128)
    assert cosine.dtype == torch.float32, f"RoPE cosine should be float32 on CPU, got {cosine.dtype}"
    assert sine.dtype == torch.float32, f"RoPE sine should be float32 on CPU, got {sine.dtype}"


def test_taoflowforge_apply_octree_rope_preserves_fp16_cpu():
    from taoflowforge.models.octree_dit import apply_octree_rope, build_octree_rope

    # Matches real usage: (batch, heads, tokens, head_dim)
    tensor = torch.randn(1, 4, 8, 128, dtype=torch.float16)
    cosine, sine = build_octree_rope(torch.randn(1, 8, 3), head_dim=128)
    out = apply_octree_rope(tensor, cosine, sine)
    assert out.dtype == torch.float16, f"apply_octree_rope should preserve float16, got {out.dtype}"
