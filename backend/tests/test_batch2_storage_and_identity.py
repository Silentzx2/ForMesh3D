"""
Unit and integration tests for Milestone 2: Batch 2 Workspace-Centric Identity & Storage Layer.
Covers Tasks B2-T1 through B2-T5:
- B2-T1: WorkspaceModel, AssetModel, ID generators, DatabaseManager helpers, idempotent _init_db with hot backup.
- B2-T2: /api/v1/file-upload/image and /api/v1/file-upload/mesh workspace adaptation, byte-for-byte preservation.
- B2-T3: Workspace directory structure, atomic metadata.json projection, path traversal protection.
- B2-T4 & B2-T5: Active mesh, lineage, temp staging, version naming helper, publish primitives.
"""

import hashlib
import io
import os
import shutil
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from api.routers import file_upload
from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import (
    AssetModel,
    OperationModel,
    WorkspaceModel,
    generate_asset_id,
    generate_operation_id,
    generate_workspace_id,
)
from core.utils.file_utils import (
    WorkspaceStorageManager,
    get_storage_base_dir,
    get_workspace_storage_manager,
)

app = FastAPI()
app.include_router(file_upload.router, prefix="/api/v1")


@pytest.fixture
def temp_storage_env(tmp_path):
    storage_root = tmp_path / "storage"
    storage_root.mkdir(parents=True, exist_ok=True)
    db_file = storage_root / "test_workspace.db"
    db_url = f"sqlite:///{db_file}"
    db_manager = DatabaseManager(database_url=db_url)
    ws_manager = WorkspaceStorageManager(storage_root=storage_root)
    return {
        "storage_root": storage_root,
        "db_file": db_file,
        "db_url": db_url,
        "db_manager": db_manager,
        "ws_manager": ws_manager,
    }


@pytest.fixture
def sample_png_bytes():
    buf = io.BytesIO()
    img = Image.new("RGBA", (32, 32), color=(255, 0, 0, 255))
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def sample_mesh_obj_bytes():
    return (
        b"v 0.0 0.0 0.0\n"
        b"v 1.0 0.0 0.0\n"
        b"v 0.0 1.0 0.0\n"
        b"f 1 2 3\n"
    )


# ==============================================================================
# B2-T1 Tests: Identity & Database Models Migration
# ==============================================================================

def test_id_format_generators():
    # Workspace ID format: <name>_<short-hash>
    ws_id = generate_workspace_id("My Rabbit Model")
    assert ws_id.startswith("my_rabbit_model_")
    assert len(ws_id.split("_")[-1]) == 6

    # Collision avoidance with existing set
    existing = {ws_id}
    ws_id2 = generate_workspace_id("My Rabbit Model", existing_ids=existing)
    assert ws_id2 != ws_id

    # Asset ID format: ast_<12hex>
    ast_id = generate_asset_id()
    assert ast_id.startswith("ast_")
    assert len(ast_id) == 16  # "ast_" + 12 hex

    # Operation ID format: op_<12hex>
    op_id = generate_operation_id()
    assert op_id.startswith("op_")
    assert len(op_id) == 15  # "op_" + 12 hex


def test_database_manager_crud_and_idempotent_migration(temp_storage_env):
    db: DatabaseManager = temp_storage_env["db_manager"]
    ws_id = "test_ws_001"
    ast_id = "ast_001002003004"

    # Create workspace
    ws = db.create_workspace(
        workspace_id=ws_id,
        name="Test Project",
        source_asset_id=ast_id,
    )
    assert ws.workspace_id == ws_id
    assert ws.name == "Test Project"
    assert ws.source_asset_id == ast_id

    # Add asset
    asset = db.add_asset(
        asset_id=ast_id,
        workspace_id=ws_id,
        file_type="image",
        relative_path="input/source_image.png",
        original_filename="sample.png",
        byte_size=1024,
        sha256="abcdef123456",
        thumbnail_path=None,
    )
    assert asset.asset_id == ast_id
    assert asset.relative_path == "input/source_image.png"

    # Update active mesh
    mesh_ast_id = "ast_999888777666"
    assert db.update_workspace_active_mesh(ws_id, mesh_ast_id) is True
    reloaded_ws = db.get_workspace(ws_id)
    assert reloaded_ws.active_mesh_asset_id == mesh_ast_id

    # List workspace assets
    assets = db.list_workspace_assets(ws_id)
    assert len(assets) == 1
    assert assets[0].asset_id == ast_id

    # Automated hot backup verification before schema migration
    db._init_db()
    bak_path = Path(str(temp_storage_env["db_file"]) + ".bak")
    assert bak_path.exists()
    assert bak_path.stat().st_size > 0


# ==============================================================================
# B2-T3 Tests: Storage Manager & Workspace Manifest
# ==============================================================================

def test_workspace_storage_structure_and_path_traversal(temp_storage_env):
    ws_mgr: WorkspaceStorageManager = temp_storage_env["ws_manager"]
    ws_id = "rabbit_a8f32c"

    # Create workspace tree
    ws_dir = ws_mgr.create_workspace_tree(ws_id)
    assert (ws_dir / "input").is_dir()
    assert (ws_dir / "mesh").is_dir()

    # Path traversal protection
    with pytest.raises(ValueError, match="Path traversal detected"):
        ws_mgr.get_workspace_dir("../evil_dir")

    with pytest.raises(ValueError, match="Path traversal detected"):
        ws_mgr.assert_safe_id("../../secret")

    with pytest.raises(ValueError, match="Invalid identifier"):
        ws_mgr.assert_safe_id("bad@name!")

    with pytest.raises(ValueError, match="Path traversal detected"):
        ws_mgr.create_operation_temp("../evil_op")


def test_atomic_manifest_projection(temp_storage_env):
    ws_mgr: WorkspaceStorageManager = temp_storage_env["ws_manager"]
    db: DatabaseManager = temp_storage_env["db_manager"]
    ws_id = "manifest_ws_001"
    ws_dir = ws_mgr.create_workspace_tree(ws_id)

    # Add DB record and disk file
    ast_id = "ast_file_001"
    target_file = ws_dir / "input" / "source_image.png"
    target_file.write_bytes(b"sample bytes")

    db.create_workspace(ws_id, "Manifest Workspace", source_asset_id=ast_id)
    db.add_asset(
        asset_id=ast_id,
        workspace_id=ws_id,
        file_type="image",
        relative_path="input/source_image.png",
        original_filename="source_image.png",
        byte_size=len(b"sample bytes"),
        sha256=hashlib.sha256(b"sample bytes").hexdigest(),
    )

    projection = ws_mgr.build_manifest_projection(ws_id, db)
    assert projection["workspace_id"] == ws_id
    assert projection["assets"][0]["verified_on_disk"] is True

    manifest_on_disk = ws_mgr.read_manifest(ws_id)
    assert manifest_on_disk is not None
    assert manifest_on_disk["workspace_id"] == ws_id


# ==============================================================================
# B2-T4 & B2-T5 Tests: Active Mesh, Lineage, Temp Staging & Publish Primitives
# ==============================================================================

def test_temp_staging_and_publish_primitives(temp_storage_env):
    ws_mgr: WorkspaceStorageManager = temp_storage_env["ws_manager"]
    ws_id = "pipe_ws_001"
    ws_dir = ws_mgr.create_workspace_tree(ws_id)

    # 1. Temp staging
    op_id = generate_operation_id()
    temp_dir = ws_mgr.create_operation_temp(op_id)
    assert temp_dir.is_dir()
    assert temp_dir.parent == ws_mgr.temp_root

    # Mock operation output
    temp_mesh = temp_dir / "output.glb"
    temp_mesh.write_bytes(b"dummy glb payload")
    temp_thumb = temp_dir / "thumb.png"
    temp_thumb.write_bytes(b"dummy png payload")

    # 2. Publish derived mesh to texture tool folder
    pub_result = ws_mgr.publish_derived_mesh(
        workspace_id=ws_id,
        operation_type="texture",
        temp_mesh_path=temp_mesh,
        temp_thumbnail_path=temp_thumb,
    )

    published_mesh = pub_result["mesh_path"]
    assert published_mesh.exists()
    assert published_mesh.name == f"{ws_id}_texture.glb"
    assert "texture/pbr" in str(published_mesh)

    # 3. Version naming helper on subsequent publish (_v002)
    temp_mesh_v2 = temp_dir / "output2.glb"
    temp_mesh_v2.write_bytes(b"dummy glb v2")
    pub_result_v2 = ws_mgr.publish_derived_mesh(
        workspace_id=ws_id,
        operation_type="texture",
        temp_mesh_path=temp_mesh_v2,
    )
    assert pub_result_v2["mesh_path"].name == f"{ws_id}_texture_v002.glb"


# ==============================================================================
# B2-T2 Tests: Asset Ownership & Upload Handlers
# ==============================================================================

def test_upload_image_handler(sample_png_bytes):
    client = TestClient(app)
    response = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("my_concept.png", sample_png_bytes, "image/png")},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "workspace_id" in data
    assert "asset_id" in data
    assert data["file_id"] == data["asset_id"]
    assert data["filename"] == "my_concept.png"
    assert data["file_type"] == "image"

    # Verify storage layout and byte-for-byte preservation
    storage_root = get_storage_base_dir()
    saved_file = storage_root / data["workspace_id"] / "input" / "source_image.png"
    assert saved_file.exists()
    assert saved_file.read_bytes() == sample_png_bytes

    # Verify metadata.json was projected
    manifest_file = storage_root / data["workspace_id"] / "metadata.json"
    assert manifest_file.exists()

    # Verify download works via asset_id
    dl_resp = client.get(f"/api/v1/file-upload/download/{data['asset_id']}")
    assert dl_resp.status_code == 200
    assert dl_resp.content == sample_png_bytes


def test_upload_mesh_handler(sample_mesh_obj_bytes):
    client = TestClient(app)
    response = client.post(
        "/api/v1/file-upload/mesh",
        files={"file": ("box_geometry.obj", sample_mesh_obj_bytes, "application/wavefront-obj")},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "workspace_id" in data
    assert "asset_id" in data
    assert data["file_id"] == data["asset_id"]
    assert data["file_type"] == "mesh"
    assert "thumbnail_url" in data

    # Verify storage layout in mesh/ and input/
    storage_root = get_storage_base_dir()
    saved_mesh = storage_root / data["workspace_id"] / "mesh" / "source_mesh.obj"
    assert saved_mesh.exists()
    assert saved_mesh.read_bytes() == sample_mesh_obj_bytes

    # Verify active_mesh_asset_id is set in Database
    db = DatabaseManager()
    ws = db.get_workspace(data["workspace_id"])
    assert ws is not None
    assert ws.active_mesh_asset_id == data["asset_id"]
