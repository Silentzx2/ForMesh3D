from __future__ import annotations

from pathlib import Path

import trimesh

import backend.adapters.hunyuan3d_21_unified as hunyuan_module
from backend.adapters.hunyuan3d_21_unified import Hunyuan3D21UnifiedAdapter


class _FakeShapePipeline:
    _execution_device = "cpu"

    def __init__(self):
        self.received = None

    def __call__(self, **kwargs):
        self.received = kwargs
        return trimesh.creation.box()


def test_hunyuan21_metadata_matches_actual_pipeline_arguments(tmp_path, monkeypatch):
    monkeypatch.setattr(hunyuan_module, "torch", None)
    image_path = tmp_path / "input.png"
    image_path.write_bytes(b"not-decoded-by-the-fake-pipeline")

    pipeline = _FakeShapePipeline()
    adapter = Hunyuan3D21UnifiedAdapter.__new__(Hunyuan3D21UnifiedAdapter)
    adapter.feature_type = "image_to_raw_mesh"
    adapter.gpu_id = None
    adapter._shape_pipeline = pipeline
    adapter._paint_pipeline = None
    adapter.model = pipeline

    expected = {
        "num_inference_steps": 31,
        "guidance_scale": 6.25,
        "octree_resolution": 384,
        "num_chunks": 4096,
    }
    result = adapter._process_request({
        "image_path": str(image_path),
        "seed": 19,
        **expected,
    })

    assert result["success"] is True
    assert {key: result["generation_info"][key] for key in expected} == expected
    assert {key: pipeline.received[key] for key in expected} == expected
    adapter._cleanup_active_temporary_output_dirs()
