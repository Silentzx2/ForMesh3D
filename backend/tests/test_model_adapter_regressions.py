import sys
from pathlib import Path

import pytest
import trimesh

backend_root = Path(__file__).resolve().parents[1]
repo_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.adapters.partfield_adapter import PartFieldSegmentationAdapter
from backend.adapters.partuv_adapter import PartUVUnwrappingAdapter


def test_partfield_rgba_palette_works_for_mesh_and_individual_part_exports(tmp_path):
    mesh = trimesh.Trimesh(
        vertices=[
            [1.0, 1.0, 1.0],
            [-1.0, -1.0, 1.0],
            [-1.0, 1.0, -1.0],
            [1.0, -1.0, -1.0],
        ],
        faces=[[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
        process=False,
    )
    source_path = tmp_path / "tetra.obj"
    mesh.export(source_path)

    class StubPartField:
        def process_face(self, *_args, **_kwargs):
            return (
                {
                    4: {"left": 0, "right": 1},
                    5: {"left": 2, "right": 3},
                    6: {"left": 4, "right": 5},
                },
                None,
                None,
            )

    adapter = PartFieldSegmentationAdapter(vram_requirement=8192)
    adapter.model = StubPartField()
    result = adapter._process_request({
        "mesh_path": str(source_path),
        "output_dir": str(tmp_path / "output"),
        "output_format": "obj",
        "num_parts": 2,
        "min_face_island_threshold": 0,
        "colorize_preview": True,
        "save_individual_parts": True,
    })

    assert result["success"] is True
    assert len(result["individual_part_paths"]) == 2
    assert Path(result["output_path"]).is_file()
    assert all(Path(path).is_file() for path in result["individual_part_paths"])


def test_partuv_runs_full_uv_pipeline_and_exports_uv_coordinates(tmp_path, monkeypatch):
    import numpy as np
    from types import SimpleNamespace
    import backend.adapters.partuv_adapter as partuv_module

    source_path = tmp_path / "source.obj"
    trimesh.creation.box().export(source_path)
    adapter = PartUVUnwrappingAdapter(vram_requirement=4096, model_id="partuv_uv_unwrapping")
    adapter.model = tmp_path
    adapter._pf_model = object()
    adapter._partuv_config = tmp_path / "config.yaml"
    adapter._partuv_pack_script = tmp_path / "pack_blender.py"

    processed_mesh = trimesh.creation.box()
    calls = {}
    final_parts = SimpleNamespace(num_components=2, distortion=1.12)

    def preprocess(*args, **kwargs):
        calls["preprocess"] = (args, kwargs)
        return processed_mesh, None, {0: {"left": 1, "right": 2}}, {"partfield": 0.2}

    def pipeline_numpy(**kwargs):
        calls["pipeline"] = kwargs
        return final_parts, [object(), object()]

    def save_results(output_dir, _parts, _individual_parts):
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        mesh = trimesh.creation.box()
        mesh.visual = trimesh.visual.TextureVisuals(
            uv=np.asarray(
                [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0],
                 [0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]
            )
        )
        mesh.export(output_dir / "final_components.obj")

    monkeypatch.setattr(partuv_module.shutil, "which", lambda _name: None)
    adapter._preprocess = preprocess
    adapter._pipeline_numpy = pipeline_numpy
    adapter._save_results = save_results

    result = adapter._process_request({
        "mesh_path": str(source_path),
        "output_format": "glb",
        "distortion_threshold": 1.35,
        "pack_method": "blender",
        "sample_on_faces": 12,
        "sample_batch_size": 2048,
    })

    assert result["success"] is True
    assert result["uv_unwrapped"] is True
    assert result["uv_packed"] is False
    assert calls["preprocess"][1]["sample_on_faces"] == 12
    assert calls["preprocess"][1]["sample_batch_size"] == 2048
    assert calls["pipeline"]["threshold"] == 1.35
    assert calls["pipeline"]["tree_dict"] == {0: {"left": 1, "right": 2}}
    output = Path(result["output_mesh_path"])
    assert output.is_file() and output.suffix == ".glb"
    exported = trimesh.load(output, force="mesh", process=False)
    assert exported.visual.uv is not None
    assert np.isfinite(exported.visual.uv).all()
    assert result["generation_info"]["uv_components"] == 2
    assert result["generation_info"]["uv_distortion"] == 1.12
    adapter._cleanup_active_temporary_output_dirs()
    assert not output.parent.exists()


def test_scheduler_download_format_uses_the_published_mesh_extension():
    from backend.core.scheduler.multiprocess_scheduler import _result_artifact_format

    assert _result_artifact_format({"output_mesh_path": "/storage/workspace/uv/result.obj"}) == "obj"
    assert _result_artifact_format({"output_mesh_path": "/storage/workspace/uv/result.glb"}) == "glb"
    assert _result_artifact_format({"format": "ply"}) == "ply"
    assert _result_artifact_format({}) == "glb"
