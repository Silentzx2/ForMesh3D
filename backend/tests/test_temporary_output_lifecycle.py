from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from backend.core.models.base import BaseModel, ModelStatus
from backend.core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler


class _TemporaryOutputAdapter(BaseModel):
    def __init__(self, *, fail: bool = False):
        super().__init__(vram_requirement=0, model_id="temp-test")
        self.status = ModelStatus.LOADED
        self.fail = fail
        self.created_dir = None

    def _load_model(self):
        return None

    def _unload_model(self):
        return None

    def _process_request(self, _inputs):
        self.created_dir = self._create_temporary_output_dir("temp_test")
        (self.created_dir / "mesh.glb").write_bytes(b"glTF")
        if self.fail:
            raise RuntimeError("simulated adapter failure")
        return {"success": True, "output_mesh_path": str(self.created_dir / "mesh.glb")}

    def get_supported_formats(self):
        return {"input": [], "output": ["glb"]}

    def get_parameter_schema(self):
        return {"parameters": {}}


def test_successful_output_is_cleaned_by_scheduler_after_persistence():
    adapter = _TemporaryOutputAdapter()
    result = adapter.process({})
    output_dir = adapter.created_dir

    assert output_dir.is_dir()
    assert result["_temporary_output_dirs"] == [str(output_dir)]

    scheduler = object.__new__(MultiprocessModelScheduler)
    scheduler._cleanup_adapter_temporary_output(result, nested=False)

    assert not output_dir.exists()
    assert "_temporary_output_dirs" not in result


def test_failed_adapter_call_cleans_its_temp_dir_immediately():
    adapter = _TemporaryOutputAdapter(fail=True)

    with pytest.raises(RuntimeError, match="simulated adapter failure"):
        adapter.process({})

    assert adapter.created_dir is not None
    assert not adapter.created_dir.exists()


def test_scheduler_refuses_symlinked_temp_output(tmp_path):
    target = tmp_path / "user-output"
    target.mkdir()
    link = Path(__import__("tempfile").gettempdir()) / "formesh3d_test_link"
    if link.exists() or link.is_symlink():
        if link.is_dir() and not link.is_symlink():
            shutil.rmtree(link)
        else:
            link.unlink()
    link.symlink_to(target, target_is_directory=True)
    result = {"_temporary_output_dirs": [str(link)]}

    try:
        scheduler = object.__new__(MultiprocessModelScheduler)
        scheduler._cleanup_adapter_temporary_output(result, nested=False)
        assert target.exists()
        assert link.is_symlink()
    finally:
        link.unlink(missing_ok=True)
