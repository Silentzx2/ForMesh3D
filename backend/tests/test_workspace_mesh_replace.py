from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.api.routers.file_upload import _replace_workspace_mesh_asset
from backend.core.scheduler.database_models import AssetModel, Base, OperationModel, WorkspaceModel
from backend.core.utils.file_utils import WorkspaceStorageManager


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

    def get_workspace(self, workspace_id):
        with self.get_session() as session:
            row = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first()
            if row:
                session.expunge(row)
            return row

    def list_workspace_assets(self, workspace_id):
        with self.get_session() as session:
            rows = session.query(AssetModel).filter_by(workspace_id=workspace_id).all()
            for row in rows:
                session.expunge(row)
            return rows


@pytest.fixture
def mesh_replace_env(tmp_path: Path):
    storage_root = tmp_path / "storage"
    manager = WorkspaceStorageManager(storage_root)
    workspace_id = "rabbit_a8f32c"
    workspace_dir = manager.create_workspace_tree(workspace_id)
    mesh_path = workspace_dir / "mesh" / "rabbit.glb"
    thumbnail_path = workspace_dir / "mesh" / "thumbnail.png"
    mesh_path.write_bytes(b"original-glb")
    thumbnail_path.write_bytes(b"old-thumbnail")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        session.add(WorkspaceModel(
            workspace_id=workspace_id,
            name="Rabbit",
            active_mesh_asset_id="ast_rabbit",
            status="active",
        ))
        session.add(AssetModel(
            asset_id="ast_rabbit",
            workspace_id=workspace_id,
            operation_type="generate",
            asset_type="mesh",
            file_type="mesh",
            relative_path="mesh/rabbit.glb",
            original_filename="rabbit.glb",
            byte_size=11,
            sha256="a" * 64,
            thumbnail_path="mesh/thumbnail.png",
            is_retained=1,
            status="available",
        ))
        session.commit()

    return _Database(factory), manager, workspace_id, workspace_dir, factory, mesh_path, thumbnail_path


def test_orientation_replaces_same_mesh_file_and_asset_row(mesh_replace_env, tmp_path):
    db, manager, workspace_id, workspace_dir, factory, mesh_path, thumbnail_path = mesh_replace_env
    oriented = tmp_path / "oriented.glb"
    thumbnail = tmp_path / "new-thumbnail.png"
    oriented.write_bytes(b"rotated-glb-content")
    thumbnail.write_bytes(b"new-thumbnail")

    result = _replace_workspace_mesh_asset(
        db, manager, workspace_id, "ast_rabbit", oriented, thumbnail,
        oriented.stat().st_size, "b" * 64,
    )

    assert result["success"] is True
    assert result["asset_id"] == "ast_rabbit"
    assert result["asset"]["relative_path"] == "mesh/rabbit.glb"
    assert mesh_path.read_bytes() == b"rotated-glb-content"
    assert thumbnail_path.read_bytes() == b"new-thumbnail"
    assert len(list((workspace_dir / "mesh").glob("*.glb"))) == 1

    with factory() as session:
        workspace = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).one()
        assets = session.query(AssetModel).filter_by(workspace_id=workspace_id).all()
        asset = assets[0]
        assert len(assets) == 1
        assert workspace.active_mesh_asset_id == "ast_rabbit"
        assert asset.asset_id == "ast_rabbit"
        assert asset.byte_size == oriented.stat().st_size
        assert asset.sha256 == "b" * 64
        assert asset.thumbnail_path == "mesh/thumbnail.png"

    manifest = (workspace_dir / "metadata.json").read_text()
    assert '"sha256": "' + "b" * 64 + '"' in manifest


def test_orientation_rejects_mesh_from_another_workspace(mesh_replace_env, tmp_path):
    db, manager, workspace_id, workspace_dir, factory, mesh_path, _ = mesh_replace_env
    with factory() as session:
        session.add(WorkspaceModel(workspace_id="other_123456", name="Other", status="active"))
        session.add(AssetModel(
            asset_id="ast_other",
            workspace_id="other_123456",
            file_type="mesh",
            relative_path="mesh/other.glb",
            original_filename="other.glb",
            byte_size=1,
            sha256="c" * 64,
            is_retained=1,
            status="available",
        ))
        session.commit()

    oriented = tmp_path / "oriented.glb"
    oriented.write_bytes(b"must-not-save")
    with pytest.raises(ValueError, match="not found"):
        _replace_workspace_mesh_asset(
            db, manager, workspace_id, "ast_other", oriented, None,
            oriented.stat().st_size, "d" * 64,
        )
    assert mesh_path.read_bytes() == b"original-glb"


def test_orientation_rejects_while_workspace_operation_is_active(mesh_replace_env, tmp_path):
    db, manager, workspace_id, workspace_dir, factory, mesh_path, _ = mesh_replace_env
    with factory() as session:
        session.add(OperationModel(
            operation_id="op_running",
            workspace_id=workspace_id,
            operation_type="generation",
            execution_status="processing",
            persistence_status="saving",
        ))
        session.commit()

    oriented = tmp_path / "oriented.glb"
    oriented.write_bytes(b"must-not-save")
    with pytest.raises(ValueError, match="running workspace operation"):
        _replace_workspace_mesh_asset(
            db, manager, workspace_id, "ast_rabbit", oriented, None,
            oriented.stat().st_size, "e" * 64,
        )
    assert mesh_path.read_bytes() == b"original-glb"
