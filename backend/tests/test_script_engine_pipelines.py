"""Targeted tests for Script Engine pipelines: Retopo, Smart UV, and Segment.

Verifies:
- Flat backend pipeline contracts (retopo, smart_uv, segment, mesh_utils)
- Density safety integration
- Accurate output format and stats
- No regressions on modern GPU flows
"""
import tempfile
from pathlib import Path
import pytest
import trimesh

from pipelines.mesh_utils import compute_mesh_stats, export_mesh_safe, load_mesh_safe, to_single_trimesh
from pipelines.retopo import execute_retopo
from pipelines.smart_uv import execute_smart_uv
from pipelines.segment import execute_segment


@pytest.fixture
def sample_mesh_path():
    """Create a temporary test mesh."""
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        temp_path = Path(f.name)
    mesh.export(str(temp_path), file_type="glb")
    yield temp_path
    if temp_path.exists():
        temp_path.unlink()


def test_mesh_utils_stats_and_export(sample_mesh_path):
    loaded = load_mesh_safe(sample_mesh_path)
    mesh = to_single_trimesh(loaded)
    stats = compute_mesh_stats(mesh)

    assert stats["face_count"] > 0
    assert stats["vertex_count"] > 0
    assert stats["is_watertight"] is True
    assert len(stats["bounds"]) == 6

    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as out_f:
        out_path = Path(out_f.name)
    try:
        exported = export_mesh_safe(mesh, out_path, "glb")
        assert exported.is_file()
        assert exported.stat().st_size > 0
    finally:
        if out_path.exists():
            out_path.unlink()


def test_execute_retopo(sample_mesh_path):
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as out_f:
        out_path = Path(out_f.name)
    try:
        result = execute_retopo(
            sample_mesh_path,
            out_path,
            options={
                "target_faces": 100,
                "quads": False,
                "watertight": True,
                "adaptive": True,
            },
        )
        assert result["success"] is True
        assert Path(result["output_path"]).is_file()
        assert result["stats"]["face_count"] <= 320
        assert "topology" in result["stats"]
    finally:
        if out_path.exists():
            out_path.unlink()


def test_execute_smart_uv(sample_mesh_path):
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as out_f:
        out_path = Path(out_f.name)
    try:
        result = execute_smart_uv(
            sample_mesh_path,
            out_path,
            options={
                "resolution": 1024,
                "padding_texels": 4,
                "method": "xatlas",
            },
        )
        assert result["success"] is True
        assert Path(result["output_path"]).is_file()
        assert result["stats"]["atlas_resolution"] == 1024
    finally:
        if out_path.exists():
            out_path.unlink()


def test_execute_segment(sample_mesh_path):
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as out_f:
        out_path = Path(out_f.name)
    try:
        result = execute_segment(
            sample_mesh_path,
            out_path,
            options={
                "num_parts": 4,
                "colorize_preview": True,
                "save_individual_parts": True,
            },
        )
        assert result["success"] is True
        assert Path(result["output_path"]).is_file()
        assert result["stats"]["actual_parts"] == 4
        assert len(result["stats"]["individual_part_files"]) == 4
        for sub_p in result["stats"]["individual_part_files"]:
            assert Path(sub_p).is_file()
    finally:
        if out_path.exists():
            out_path.unlink()
        parts_dir = out_path.parent / f"{out_path.stem}_parts"
        if parts_dir.is_dir():
            import shutil
            shutil.rmtree(parts_dir, ignore_errors=True)



def test_execute_retopo_quad_requires_quadriflow(sample_mesh_path, monkeypatch):
    import pipelines.retopo as retopo

    monkeypatch.setattr(retopo, "find_blender_binary", lambda: None)
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as out_f:
        out_path = Path(out_f.name)
    try:
        with pytest.raises(RuntimeError, match="QuadriFlow requires Blender"):
            execute_retopo(sample_mesh_path, out_path, options={"target_faces": 100, "quads": True})
    finally:
        out_path.unlink(missing_ok=True)


def test_execute_segment_honors_part_count_and_island_threshold(sample_mesh_path):
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as out_f:
        out_path = Path(out_f.name)
    try:
        result = execute_segment(
            sample_mesh_path,
            out_path,
            options={
                "num_parts": 6,
                "method": "geometric",
                "min_face_island_threshold": 5,
                "hierarchical": True,
                "colorize_preview": False,
            },
        )
        assert result["stats"]["requested_parts"] == 6
        assert 1 <= result["stats"]["actual_parts"] <= 6
        assert result["stats"]["face_coverage"] == result["stats"]["face_count"]
        assert result["stats"]["hierarchical"] is True
        assert result["stats"]["hierarchy"]["id"] == "root"
    finally:
        out_path.unlink(missing_ok=True)


def test_script_pipelines_emit_ordered_stage_progress(sample_mesh_path):
    output_path = Path(tempfile.mktemp(suffix=".glb"))
    events = []
    try:
        result = execute_segment(
            sample_mesh_path,
            output_path,
            options={
                "num_parts": 4,
                "method": "geometric",
                "colorize_preview": True,
                "save_individual_parts": True,
            },
            progress_callback=lambda message, progress: events.append((message, progress)),
        )
        assert result["success"] is True
        progress_values = [value for _message, value in events if value is not None]
        assert progress_values == sorted(progress_values)
        assert any("Loaded mesh" in message for message, _value in events)
        assert any("individual part" in message.lower() for message, _value in events)
        assert any("verifying segmentation" in message.lower() for message, _value in events)
        assert progress_values[-1] >= 0.94
    finally:
        output_path.unlink(missing_ok=True)
        parts_dir = output_path.parent / f"{output_path.stem}_parts"
        if parts_dir.is_dir():
            import shutil
            shutil.rmtree(parts_dir, ignore_errors=True)
