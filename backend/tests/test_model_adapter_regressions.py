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


def test_partuv_defaults_to_glb_and_honors_obj_override(tmp_path):
    source_path = tmp_path / "source.obj"
    trimesh.creation.box().export(source_path)

    adapter = PartUVUnwrappingAdapter(vram_requirement=4096, model_id="partuv_uv_unwrapping")
    adapter.model = tmp_path
    adapter._preprocess = lambda *_args, **_kwargs: (
        trimesh.creation.box(),
        None,
        {},
        {"sampling": 0.1, "decoding": 0.2},
    )

    glb_result = adapter._process_request({"mesh_path": str(source_path)})
    assert glb_result["success"] is True
    assert glb_result["format"] == "glb"
    assert Path(glb_result["output_mesh_path"]).suffix == ".glb"
    assert Path(glb_result["output_mesh_path"]).is_file()

    obj_result = adapter._process_request({
        "mesh_path": str(source_path),
        "output_format": "obj",
    })
    assert obj_result["success"] is True
    assert obj_result["format"] == "obj"
    assert Path(obj_result["output_mesh_path"]).suffix == ".obj"
    assert Path(obj_result["output_mesh_path"]).is_file()


def test_scheduler_download_format_uses_the_published_mesh_extension():
    from backend.core.scheduler.multiprocess_scheduler import _result_artifact_format

    assert _result_artifact_format({"output_mesh_path": "/storage/workspace/uv/result.obj"}) == "obj"
    assert _result_artifact_format({"output_mesh_path": "/storage/workspace/uv/result.glb"}) == "glb"
    assert _result_artifact_format({"format": "ply"}) == "ply"
    assert _result_artifact_format({}) == "glb"
