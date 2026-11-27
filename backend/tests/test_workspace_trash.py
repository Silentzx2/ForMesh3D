from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.scheduler.database_models import AssetModel, Base, JobModel, OperationModel, WorkspaceModel
from backend.services import workspace_trash


class _Database:
    def __init__(self, factory):
        self.factory = factory

    @contextmanager
    def get_session(self):
        session = self.factory()
        try:
            yield session
        finally:
            session.close()


@pytest.fixture
def trash_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    storage = tmp_path / "storage"
    trash_root = tmp_path / "trash"
    storage.mkdir()
    trash_root.mkdir()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(workspace_trash, "get_storage_base_dir", lambda: storage)
    monkeypatch.setattr(workspace_trash, "get_trash_root", lambda: trash_root)
    return _Database(factory), storage, trash_root, factory


def _asset(asset_id: str, workspace_id: str, path: str, operation_type: str, operation_id=None):
    return AssetModel(
        asset_id=asset_id,
        workspace_id=workspace_id,
        operation_id=operation_id,
        operation_type=operation_type,
        asset_type="mesh",
        file_type="mesh",
        relative_path=path,
        original_filename=f"{asset_id}.glb",
        byte_size=4,
        sha256="a" * 64,
    )


def test_workspace_trash_and_restore_round_trip(trash_env):
    db, storage, trash_root, factory = trash_env
    workspace_id = "fox_abc123"
    workspace_dir = storage / workspace_id
    mesh_dir = workspace_dir / "mesh"
    mesh_dir.mkdir(parents=True)
    (mesh_dir / "fox.glb").write_bytes(b"mesh")

    with factory() as session:
        session.add(WorkspaceModel(workspace_id=workspace_id, name="Fox", active_mesh_asset_id="ast_base"))
        session.add(_asset("ast_base", workspace_id, "mesh/fox.glb", "generate"))
        session.add(OperationModel(operation_id="op_texture", workspace_id=workspace_id, operation_type="texture"))
        session.add(JobModel(
            job_id=workspace_id,
            feature="generation",
            inputs={"workspace_id": workspace_id},
            status="completed",
            progress=1.0,
        ))
        session.commit()

    result = workspace_trash.trash_workspace(db, workspace_id)
    assert result["success"] is True
    assert result["trash_id"]
    assert not workspace_dir.exists()
    assert workspace_trash.list_trash()[0]["name"] == "Fox"

    with factory() as session:
        assert session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first() is None
        assert session.query(AssetModel).filter_by(workspace_id=workspace_id).count() == 0
        assert session.query(OperationModel).filter_by(workspace_id=workspace_id).count() == 0
        assert session.query(JobModel).filter_by(job_id=workspace_id).first() is None

    restored = workspace_trash.restore_trash_item(db, result["trash_id"])
    assert restored["success"] is True
    assert (workspace_dir / "mesh" / "fox.glb").read_bytes() == b"mesh"
    with factory() as session:
        assert session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first() is not None
        assert session.query(AssetModel).filter_by(asset_id="ast_base").first() is not None
        assert session.query(OperationModel).filter_by(operation_id="op_texture").first() is not None
        assert session.query(JobModel).filter_by(job_id=workspace_id).first() is not None
    assert workspace_trash.list_trash() == []


def test_derived_asset_trash_preserves_shared_operation_and_restores_file(trash_env):
    db, storage, trash_root, factory = trash_env
    workspace_id = "fox_abc123"
    workspace_dir = storage / workspace_id
    (workspace_dir / "mesh").mkdir(parents=True)
    (workspace_dir / "texture").mkdir()
    (workspace_dir / "mesh" / "base.glb").write_bytes(b"base")
    (workspace_dir / "texture" / "one.glb").write_bytes(b"one")
    (workspace_dir / "texture" / "two.glb").write_bytes(b"two")

    with factory() as session:
        session.add(WorkspaceModel(workspace_id=workspace_id, name="Fox", active_mesh_asset_id="ast_base"))
        session.add(_asset("ast_base", workspace_id, "mesh/base.glb", "generate"))
        session.add(_asset("ast_one", workspace_id, "texture/one.glb", "texture", "op_shared"))
        session.add(_asset("ast_two", workspace_id, "texture/two.glb", "texture", "op_shared"))
        session.add(OperationModel(operation_id="op_shared", workspace_id=workspace_id, operation_type="texture"))
        session.commit()

    result = workspace_trash.trash_workspace_asset(db, workspace_id, "ast_one")
    assert result["success"] is True
    assert not (workspace_dir / "texture" / "one.glb").exists()
    with factory() as session:
        assert session.query(AssetModel).filter_by(asset_id="ast_one").first() is None
        assert session.query(AssetModel).filter_by(asset_id="ast_two").first() is not None
        assert session.query(OperationModel).filter_by(operation_id="op_shared").first() is not None

    workspace_trash.restore_trash_item(db, result["trash_id"])
    assert (workspace_dir / "texture" / "one.glb").read_bytes() == b"one"
    with factory() as session:
        assert session.query(AssetModel).filter_by(asset_id="ast_one").first() is not None
        assert session.query(OperationModel).filter_by(operation_id="op_shared").first() is not None


def test_base_mesh_cannot_be_deleted_as_a_single_version(trash_env):
    db, storage, trash_root, factory = trash_env
    workspace_id = "fox_abc123"
    workspace_dir = storage / workspace_id
    (workspace_dir / "mesh").mkdir(parents=True)
    (workspace_dir / "mesh" / "base.glb").write_bytes(b"base")
    with factory() as session:
        session.add(WorkspaceModel(workspace_id=workspace_id, name="Fox"))
        session.add(_asset("ast_base", workspace_id, "mesh/base.glb", "generate"))
        session.commit()

    with pytest.raises(ValueError, match="Base mesh"):
        workspace_trash.trash_workspace_asset(db, workspace_id, "ast_base")
    assert (workspace_dir / "mesh" / "base.glb").exists()


def test_trash_rejects_dot_ids_and_workspace_symlinks(trash_env, tmp_path):
    db, storage, trash_root, factory = trash_env
    with pytest.raises(ValueError, match="Invalid workspace_id"):
        workspace_trash.trash_workspace(db, ".")
    with pytest.raises(ValueError, match="Invalid trash_id"):
        workspace_trash.purge_trash_item(".")

    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.glb").write_bytes(b"keep")
    (storage / "fox_abc123").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlink paths"):
        workspace_trash.trash_workspace(db, "fox_abc123")
    assert (outside / "keep.glb").read_bytes() == b"keep"


def test_derived_asset_symlink_is_rejected(trash_env, tmp_path):
    db, storage, trash_root, factory = trash_env
    workspace_id = "fox_abc123"
    workspace_dir = storage / workspace_id
    (workspace_dir / "texture").mkdir(parents=True)
    outside = tmp_path / "outside.glb"
    outside.write_bytes(b"keep")
    (workspace_dir / "texture" / "linked.glb").symlink_to(outside)

    with factory() as session:
        session.add(WorkspaceModel(workspace_id=workspace_id, name="Fox"))
        session.add(_asset("ast_derived", workspace_id, "texture/linked.glb", "texture"))
        session.commit()

    with pytest.raises(ValueError, match="Symlink paths"):
        workspace_trash.trash_workspace_asset(db, workspace_id, "ast_derived")
    assert outside.read_bytes() == b"keep"
