import sys
from contextlib import contextmanager
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
backend_root = Path(__file__).resolve().parents[1]
repo_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from core.scheduler.database_models import AssetModel, Base, WorkspaceModel
from core.utils.file_utils import WorkspaceStorageManager
from backend.services.workspace_orientation import persist_oriented_workspace_mesh


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

    def get_asset(self, asset_id):
        with self.get_session() as session:
            row = session.query(AssetModel).filter_by(asset_id=asset_id).first()
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
def orientation_env(tmp_path: Path):
    storage = tmp_path / "storage"
    manager = WorkspaceStorageManager(storage)
    workspace_id = "rabbit_a8f32c"
    workspace_dir = manager.create_workspace_tree(workspace_id)
    (workspace_dir / "mesh").mkdir(parents=True, exist_ok=True)
    (workspace_dir / "mesh" / "base.glb").write_bytes(b"original mesh")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        session.add(WorkspaceModel(
            workspace_id=workspace_id, name="Rabbit",
            active_mesh_asset_id="ast_source", status="active",
        ))
        session.add(AssetModel(
            asset_id="ast_source", workspace_id=workspace_id, operation_type="generate",
            file_type="mesh", relative_path="mesh/base.glb", original_filename="rabbit.glb",
            byte_size=13, sha256="a" * 64, is_retained=1, status="available",
        ))
        session.commit()
    return _Database(factory), manager, workspace_id, workspace_dir, factory


def test_orientation_creates_immutable_version_and_activates_it(orientation_env, tmp_path):
    db, manager, workspace_id, workspace_dir, factory = orientation_env
    first_input = tmp_path / "first.glb"
    first_input.write_bytes(b"oriented mesh v1")
    first = persist_oriented_workspace_mesh(
        db, manager, workspace_id, "ast_source", first_input, None,
        first_input.stat().st_size, "b" * 64,
    )
    assert first["success"] is True
    assert first["asset"]["operation_type"] == "orientation"
    assert first["asset"]["asset_type"] == "oriented_mesh"
    assert first["asset"]["source_asset_id"] == "ast_source"
    assert (workspace_dir / first["asset"]["relative_path"]).read_bytes() == b"oriented mesh v1"
    assert (workspace_dir / "mesh" / "base.glb").read_bytes() == b"original mesh"

    second_input = tmp_path / "second.glb"
    second_input.write_bytes(b"oriented mesh v2")
    second = persist_oriented_workspace_mesh(
        db, manager, workspace_id, first["asset"]["asset_id"], second_input, None,
        second_input.stat().st_size, "c" * 64,
    )
    assert second["asset"]["source_asset_id"] == first["asset"]["asset_id"]
    assert "_v002.glb" in second["asset"]["relative_path"]
    with db.get_session() as session:
        workspace = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).one()
        assert workspace.active_mesh_asset_id == second["asset"]["asset_id"]
        assert session.query(AssetModel).filter_by(workspace_id=workspace_id).count() == 3


def test_orientation_rejects_a_source_from_another_workspace(orientation_env, tmp_path):
    db, manager, workspace_id, workspace_dir, factory = orientation_env
    with factory() as session:
        session.add(WorkspaceModel(workspace_id="other_123456", name="Other", status="active"))
        session.add(AssetModel(
            asset_id="ast_other", workspace_id="other_123456", file_type="mesh",
            relative_path="mesh/other.glb", original_filename="other.glb", byte_size=1,
            sha256="d" * 64, is_retained=1, status="available",
        ))
        session.commit()
    temp_mesh = tmp_path / "oriented.glb"
    temp_mesh.write_bytes(b"oriented")
    with pytest.raises(ValueError, match="does not belong"):
        persist_oriented_workspace_mesh(
            db, manager, workspace_id, "ast_other", temp_mesh, None,
            temp_mesh.stat().st_size, "e" * 64,
        )
    assert not (workspace_dir / "orientation").exists()
