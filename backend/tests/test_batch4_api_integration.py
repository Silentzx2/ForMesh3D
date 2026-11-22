"""
Unit and Integration Tests for Milestone 4 (Batch 4):
- B4-T1: Canonical /generate request, feature dispatch, and SQLite operation contracts
- B4-T2: Durable Route & Deep-Link Lookup (/jobs/{job_id} fallback, /workspace/generate/{workspace_id} DB query without inference)
- B4-T3: Specialist Tool Endpoints Operation Integration (WorkspaceStorageManager, operation records, prerequisite validation)
- B4-T4: API Deprecation Guard & Error Hardening (Path sanitization, /mesh-generation/cancel/{job_id} delegation)
"""

import io
import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from api.dependencies import sanitize_error_message
from api.routers import (
    auto_rigging,
    file_upload,
    mesh_generation,
    mesh_retopology,
    mesh_segmentation,
    mesh_uv_unwrapping,
    motion_generation,
    system,
)
from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import (
    AssetModel,
    ExecutionStatus,
    JobModel,
    OperationModel,
    PersistenceStatus,
    WorkspaceModel,
    generate_asset_id,
    generate_operation_id,
    generate_workspace_id,
)
from core.scheduler.job_queue import JobRequest
from core.utils.file_utils import WorkspaceStorageManager, get_storage_base_dir


class MockScheduler:
    """Mock scheduler for testing API routers without real GPU hardware."""

    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
        self.scheduled_jobs: Dict[str, JobRequest] = {}
        self.cancelled_jobs = set()

    async def schedule_job(self, job_request: JobRequest) -> str:
        job_id = getattr(job_request, "job_id", None) or str(uuid.uuid4())
        job_request.job_id = job_id
        self.scheduled_jobs[job_id] = job_request
        return job_id

    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        # Simulate in-memory job if present, else None
        if job_id in self.scheduled_jobs:
            req = self.scheduled_jobs[job_id]
            return {
                "job_id": job_id,
                "status": "queued",
                "progress": 0.0,
                "model_preference": req.model_preference,
                "inputs": req.inputs,
                "metadata": req.metadata,
            }
        return None

    async def cancel_job(self, job_id: str) -> bool:
        self.cancelled_jobs.add(job_id)
        return True

    def validate_model_preference(self, model_id: str, feature: str) -> bool:
        if model_id == "stable_fast_3d_image_to_textured_mesh":
            return feature == "image_to_textured_mesh"
        return True

    def get_available_models(self, feature: Optional[str] = None) -> Dict[str, Any]:
        return {}


class MockFileStore:
    def __init__(self):
        self.store = {}

    async def store_file_metadata(self, file_id: str, info: dict) -> bool:
        self.store[file_id] = info
        return True

    async def get_file_metadata(self, file_id: str):
        return self.store.get(file_id)


@pytest.fixture
def batch4_app_client(tmp_path, monkeypatch):
    """Set up an isolated test app with mock scheduler, isolated SQLite DB and storage directory."""
    storage_root = tmp_path / "storage"
    storage_root.mkdir(parents=True, exist_ok=True)
    db_file = storage_root / "test_formesh3d.db"
    db_url = f"sqlite:///{db_file}"

    # Patch storage base dir and database URL
    monkeypatch.setenv("DATA_DIR", str(storage_root))
    monkeypatch.setenv("P3D_STORAGE_ROOT", str(storage_root))
    db_file = storage_root / "job_queue.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setenv("DATABASE_URL", db_url)

    db_manager = DatabaseManager(database_url=db_url)
    ws_manager = WorkspaceStorageManager(storage_root=storage_root)

    import core.utils.file_utils as fu
    fu._workspace_storage_instance = ws_manager

    # Monkeypatch singleton helpers to use our isolated instances
    monkeypatch.setattr("api.dependencies.get_database_manager", lambda: db_manager)
    monkeypatch.setattr("core.utils.file_utils.get_storage_base_dir", lambda: storage_root)
    monkeypatch.setattr("api.routers.file_upload.get_storage_base_dir", lambda: storage_root)
    monkeypatch.setattr("api.routers.system.get_storage_base_dir", lambda: storage_root)
    monkeypatch.setattr("api.routers.auto_rigging.get_storage_base_dir", lambda: storage_root)
    monkeypatch.setattr("core.utils.file_utils.get_workspace_storage_manager", lambda: ws_manager)

    test_app = FastAPI()
    mock_scheduler = MockScheduler(db_manager)
    mock_filestore = MockFileStore()

    test_app.state.scheduler = mock_scheduler
    test_app.state.file_store = mock_filestore

    # Register routers matching production API prefix structure
    test_app.include_router(system.router, prefix="/api/v1/system")
    test_app.include_router(system.router, prefix="/api/v1")
    test_app.include_router(file_upload.router, prefix="/api/v1")
    test_app.include_router(mesh_generation.router, prefix="/api/v1")
    test_app.include_router(auto_rigging.router, prefix="/api/v1")
    test_app.include_router(mesh_retopology.router, prefix="/api/v1")
    test_app.include_router(mesh_segmentation.router, prefix="/api/v1")
    test_app.include_router(mesh_uv_unwrapping.router, prefix="/api/v1")
    test_app.include_router(motion_generation.router, prefix="/api/v1")

    client = TestClient(test_app)

    return {
        "client": client,
        "app": test_app,
        "db": db_manager,
        "ws_manager": ws_manager,
        "storage_root": storage_root,
        "scheduler": mock_scheduler,
    }


def _create_sample_png(path: Path) -> bytes:
    img = Image.new("RGBA", (32, 32), color=(0, 255, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = buf.getvalue()
    path.write_bytes(data)
    return data


def _create_sample_mesh(path: Path) -> bytes:
    data = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    path.write_bytes(data)
    return data


# ==============================================================================
# B4-T1: Existing API Endpoint Refactor
# ==============================================================================

def test_b4_t1_image_to_raw_mesh_response_and_operation_registration(batch4_app_client):
    """Verify /api/v1/generate resolves workspace_id, enqueues operation, and returns canonical envelope."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]
    storage_root = batch4_app_client["storage_root"]

    # First upload an image via file_upload
    img_bytes = io.BytesIO()
    Image.new("RGB", (64, 64), color="blue").save(img_bytes, format="PNG")
    up_resp = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("test_input.png", img_bytes.getvalue(), "image/png")},
    )
    assert up_resp.status_code == 200, up_resp.text
    up_data = up_resp.json()
    asset_id = up_data["asset_id"]
    ws_id = up_data["workspace_id"]

    # Trigger image-to-raw-mesh
    gen_resp = client.post(
        "/api/v1/generate",
        json={
            "image_file_id": asset_id,
            "workspace_id": ws_id,
            "quality_mode": "high",
            "model_preference": "hunyuan3d_shape_v21_image_to_raw_mesh",
        },
    )
    assert gen_resp.status_code == 200, gen_resp.text
    gen_data = gen_resp.json()

    # Verify canonical response envelope
    assert gen_data["job_id"] == ws_id
    assert gen_data["workspace_id"] == ws_id
    assert gen_data["status"] == "queued"
    assert gen_data["route_path"] == f"/workspace/generate/{ws_id}"
    assert gen_data["operation_id"].startswith("op_")

    # Verify operation record created in SQLite DB
    op = db.get_operation(gen_data["operation_id"])
    assert op is not None
    assert op.operation_type == "generate_raw_mesh"
    assert op.workspace_id == ws_id
    assert op.execution_status == ExecutionStatus.QUEUED
    assert op.persistence_status == PersistenceStatus.NOT_SAVED



def test_b4_t1_generate_dispatches_textured_only_model_and_registers_operation(batch4_app_client):
    """The single /generate endpoint dispatches textured-only models by their registry feature."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]
    scheduler = batch4_app_client["scheduler"]

    image = io.BytesIO()
    Image.new("RGB", (64, 64), color="red").save(image, format="PNG")
    upload = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("textured_input.png", image.getvalue(), "image/png")},
    )
    assert upload.status_code == 200, upload.text

    workspace_id = upload.json()["workspace_id"]
    response = client.post(
        "/api/v1/generate",
        json={
            "image_file_id": upload.json()["asset_id"],
            "workspace_id": workspace_id,
            "model_preference": "stable_fast_3d_image_to_textured_mesh",
            "model_parameters": {"texture_resolution": "4K"},
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    operation = db.get_operation(data["operation_id"])
    job = scheduler.scheduled_jobs[data["job_id"]]

    assert data["status"] == "queued"
    assert data["workspace_id"] == workspace_id
    assert data["route_path"] == f"/workspace/generate/{workspace_id}"
    assert operation is not None
    assert operation.operation_type == "generate_textured_mesh"
    assert job.feature == "image_to_textured_mesh"
    assert job.inputs["texture_enabled"] is True
    assert job.inputs["texture_resolution"] == 4096
    assert job.inputs["production_texture_resolution"] == 4096


def test_b4_t1_generate_keeps_raw_models_on_raw_feature(batch4_app_client):
    """Texture generation on a raw-capable adapter stays inside the raw feature."""
    client = batch4_app_client["client"]
    scheduler = batch4_app_client["scheduler"]

    image = io.BytesIO()
    Image.new("RGB", (64, 64), color="blue").save(image, format="PNG")
    upload = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("raw_input.png", image.getvalue(), "image/png")},
    )
    assert upload.status_code == 200, upload.text

    response = client.post(
        "/api/v1/generate",
        json={
            "image_file_id": upload.json()["asset_id"],
            "workspace_id": upload.json()["workspace_id"],
            "model_preference": "hunyuan3d_shape_v21_image_to_raw_mesh",
            "texture_enabled": True,
        },
    )
    assert response.status_code == 200, response.text
    job = scheduler.scheduled_jobs[response.json()["job_id"]]
    assert job.feature == "image_to_raw_mesh"
    assert job.inputs["texture_enabled"] is True


def test_b4_t1_texture_dispatches_prompt_only_painting(batch4_app_client):
    """The unified /texture endpoint routes prompt-only painting to the text paint adapter."""
    client = batch4_app_client["client"]
    scheduler = batch4_app_client["scheduler"]
    mesh = client.post(
        "/api/v1/file-upload/mesh",
        files={"file": ("paint_target.obj", b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "application/octet-stream")},
    )
    assert mesh.status_code == 200, mesh.text

    response = client.post(
        "/api/v1/texture",
        json={
            "mesh_file_id": mesh.json()["file_id"],
            "text_prompt": "weathered copper with dark patina",
            "model_preference": "trellis_text_mesh_painting",
        },
    )
    assert response.status_code == 200, response.text
    job = scheduler.scheduled_jobs[response.json()["job_id"]]
    assert job.feature == "text_mesh_painting"
    assert job.inputs["text_prompt"] == "weathered copper with dark patina"


def test_b4_t1_texture_dispatches_image_guided_painting(batch4_app_client):
    """The unified /texture endpoint routes reference-image painting to the image paint adapter."""
    client = batch4_app_client["client"]
    scheduler = batch4_app_client["scheduler"]
    mesh = client.post(
        "/api/v1/file-upload/mesh",
        files={"file": ("paint_target.obj", b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "application/octet-stream")},
    )
    assert mesh.status_code == 200, mesh.text
    image = io.BytesIO()
    Image.new("RGB", (64, 64), color="green").save(image, format="PNG")
    upload = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("paint_reference.png", image.getvalue(), "image/png")},
    )
    assert upload.status_code == 200, upload.text

    response = client.post(
        "/api/v1/texture",
        json={
            "mesh_file_id": mesh.json()["file_id"],
            "image_file_id": upload.json()["file_id"],
            "model_preference": "hunyuan3d_paint_v21_image_mesh_painting",
        },
    )
    assert response.status_code == 200, response.text
    job = scheduler.scheduled_jobs[response.json()["job_id"]]
    assert job.feature == "image_mesh_painting"


def test_b4_t1_legacy_workspace_routes_are_not_mounted(batch4_app_client):
    """No retired workspace API path remains registered as a redirect or alias."""
    paths = set(batch4_app_client["app"].openapi()["paths"])
    canonical = {
        "/api/v1/generate",
        "/api/v1/texture",
        "/api/v1/retopo",
        "/api/v1/unwrap",
        "/api/v1/rig",
        "/api/v1/motion",
        "/api/v1/segment",
    }
    retired = {
        "/api/v1/mesh-generation/image-to-raw-mesh",
        "/api/v1/mesh-generation/image-to-textured-mesh",
        "/api/v1/mesh-generation/text-mesh-painting",
        "/api/v1/mesh-generation/image-mesh-painting",
        "/api/v1/mesh-retopology/retopologize-mesh",
        "/api/v1/mesh-uv-unwrapping/unwrap-mesh",
        "/api/v1/auto-rigging/generate-rig",
        "/api/v1/motion-generation/generate-motion",
        "/api/v1/mesh-segmentation/segment-mesh",
        "/api/v1/mesh-editing/text-mesh-editing",
        "/api/v1/mesh-editing/image-mesh-editing",
    }
    assert canonical <= paths
    assert not (retired & paths)

def test_b4_t1_regeneration_creates_new_operation_with_parent_lineage(batch4_app_client):
    """Regeneration must reuse the image/settings/workspace and preserve the parent operation."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]

    image = io.BytesIO()
    Image.new("RGB", (64, 64), color="purple").save(image, format="PNG")
    upload = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("lineage_input.png", image.getvalue(), "image/png")},
    )
    assert upload.status_code == 200, upload.text
    asset_id = upload.json()["asset_id"]
    workspace_id = upload.json()["workspace_id"]

    original_request = {
        "image_file_id": asset_id,
        "workspace_id": workspace_id,
        "quality_mode": "high",
        "model_preference": "trellis2_image_to_raw_mesh",
    }
    first = client.post("/api/v1/generate", json=original_request)
    assert first.status_code == 200, first.text
    first_data = first.json()
    parent_id = first_data["operation_id"]
    parent = db.get_operation(parent_id)
    assert parent is not None

    # An active parent cannot be regenerated.
    rejected = client.post(
        "/api/v1/generate",
        json={**original_request, "parent_operation_id": parent_id},
    )
    assert rejected.status_code == 409

    db.update_operation_execution_status(parent_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(
        parent_id, ExecutionStatus.COMPLETED, result={"preview": "parent-output"}
    )

    changed_settings = client.post(
        "/api/v1/generate",
        json={**original_request, "quality_mode": "low", "parent_operation_id": parent_id},
    )
    assert changed_settings.status_code == 409

    regenerated = client.post(
        "/api/v1/generate",
        json={**original_request, "parent_operation_id": parent_id},
    )
    assert regenerated.status_code == 200, regenerated.text
    child_data = regenerated.json()
    assert child_data["operation_id"] != parent_id
    assert child_data["workspace_id"] == workspace_id
    assert child_data["job_id"] == workspace_id
    assert child_data["route_path"] == f"/workspace/generate/{workspace_id}"

    child = db.get_operation(child_data["operation_id"])
    parent_after = db.get_operation(parent_id)
    assert child is not None
    assert child.parent_operation_id == parent_id
    assert child.input_asset_id == parent.input_asset_id == asset_id
    assert child.operation_type == parent.operation_type == "generate_raw_mesh"
    assert parent_after is not None
    assert parent_after.execution_status == ExecutionStatus.COMPLETED
    assert json.loads(parent_after.result_json) == {"preview": "parent-output"}
    assert json.loads(child.settings_snapshot) == json.loads(parent.settings_snapshot)


def test_b4_t1_image_to_textured_mesh_response_and_operation_registration(batch4_app_client):
    """An explicit textured-only model dispatches to the textured operation type."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]

    img_bytes = io.BytesIO()
    Image.new("RGB", (64, 64), color="red").save(img_bytes, format="PNG")
    up_resp = client.post(
        "/api/v1/file-upload/image",
        files={"file": ("textured_input.png", img_bytes.getvalue(), "image/png")},
    )
    assert up_resp.status_code == 200
    asset_id = up_resp.json()["asset_id"]

    ws_id = up_resp.json()["workspace_id"]

    gen_resp = client.post(
        "/api/v1/generate",
        json={
            "image_file_id": asset_id,
            "workspace_id": ws_id,
            "quality_mode": "high",
            "model_preference": "stable_fast_3d_image_to_textured_mesh",
        },
    )
    assert gen_resp.status_code == 200, gen_resp.text
    gen_data = gen_resp.json()

    assert gen_data["status"] == "queued"
    assert gen_data["workspace_id"] is not None
    assert gen_data["operation_id"] is not None
    assert gen_data["route_path"] == f"/workspace/generate/{gen_data['workspace_id']}"

    op = db.get_operation(gen_data["operation_id"])
    assert op is not None
    assert op.operation_type == "generate_textured_mesh"
    assert op.workspace_id == gen_data["workspace_id"]


# ==============================================================================
# B4-T2: Durable Route & Deep-Link Lookup
# ==============================================================================

def test_b4_t2_system_job_status_sqlite_fallback(batch4_app_client):
    """Verify /system/jobs/{job_id} resolves workspace and operation state from SQLite when scheduler cache is empty."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]
    storage_root = batch4_app_client["storage_root"]

    ws_id = "ws_persisted_test_001"
    db.create_workspace(workspace_id=ws_id, name="Test Persisted Workspace")

    # Add active mesh asset
    mesh_rel = "mesh/active_mesh.glb"
    mesh_abs = storage_root / ws_id / mesh_rel
    mesh_abs.parent.mkdir(parents=True, exist_ok=True)
    mesh_abs.write_bytes(b"dummy glb bytes")

    ast = db.add_asset(
        asset_id="ast_mesh_123456",
        workspace_id=ws_id,
        file_type="mesh",
        relative_path=mesh_rel,
        original_filename="model.glb",
        byte_size=len(b"dummy glb bytes"),
        sha256="dummy_sha",
    )
    db.update_workspace_active_mesh(ws_id, ast.asset_id)

    # Add completed operation
    db.enqueue_operation(
        operation_id="op_gen_123456",
        workspace_id=ws_id,
        operation_type="generate_raw_mesh",
        input_asset_id=None,
        settings={},
    )
    db.update_operation_execution_status(
        operation_id="op_gen_123456",
        new_status=ExecutionStatus.PROCESSING,
    )
    db.update_operation_execution_status(
        operation_id="op_gen_123456",
        new_status=ExecutionStatus.COMPLETED,
        result={"mesh_path": str(mesh_abs)},
    )
    db.update_operation_persistence_status(
        operation_id="op_gen_123456",
        new_status=PersistenceStatus.SAVING,
    )
    db.update_operation_persistence_status(
        operation_id="op_gen_123456",
        new_status=PersistenceStatus.SAVED,
    )

    # Scheduler does not have this job in memory, should resolve from SQLite
    resp = client.get(f"/api/v1/system/jobs/{ws_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["job_id"] == ws_id
    assert data["workspace_id"] == ws_id
    assert data["execution_status"] == ExecutionStatus.COMPLETED
    assert data["persistence_status"] == PersistenceStatus.SAVED
    assert data["active_mesh_asset_id"] == ast.asset_id
    assert data["route_path"] == f"/workspace/generate/{ws_id}"
    assert "result" in data
    assert f"/api/v1/system/jobs/{ws_id}/download" in data["result"]["mesh_url"]


def test_b4_t2_workspace_generate_deeplink_route_lookup(batch4_app_client):
    """Verify /workspace/generate/{workspace_id} loads authoritative state without re-running inference."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]
    storage_root = batch4_app_client["storage_root"]

    ws_id = "ws_deeplink_test_002"
    db.create_workspace(workspace_id=ws_id, name="Deep Link Test")

    # Add active mesh
    mesh_abs = storage_root / ws_id / "mesh" / "source_mesh.glb"
    mesh_abs.parent.mkdir(parents=True, exist_ok=True)
    mesh_abs.write_bytes(b"sample glb binary")

    ast = db.add_asset(
        asset_id="ast_dl_mesh_001",
        workspace_id=ws_id,
        file_type="mesh",
        relative_path="mesh/source_mesh.glb",
        original_filename="source_mesh.glb",
        byte_size=17,
        sha256="sample_hash",
    )
    db.update_workspace_active_mesh(ws_id, ast.asset_id)

    # Query deep-link endpoint
    resp = client.get(f"/api/v1/system/workspace/generate/{ws_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["workspace_id"] == ws_id
    assert data["name"] == "Deep Link Test"
    assert data["route_path"] == f"/workspace/generate/{ws_id}"
    assert data["active_mesh_asset_id"] == ast.asset_id
    assert data["active_mesh"]["asset_id"] == ast.asset_id
    assert data["mesh_url"] is not None
    assert f"/api/v1/system/jobs/{ws_id}/download" in data["mesh_url"]

    # Verify download resolves active mesh
    dl_resp = client.get(f"/api/v1/system/jobs/{ws_id}/download")
    assert dl_resp.status_code == 200
    assert dl_resp.content == b"sample glb binary"


# ==============================================================================
# B4-T3: Specialist Tool Endpoints Operation Integration
# ==============================================================================

def test_b4_t3_auto_rigging_operation_and_prerequisites(batch4_app_client):
    """Verify auto-rigging checks mesh prerequisite and enqueues operation record."""
    client = batch4_app_client["client"]
    db = batch4_app_client["db"]
    storage_root = batch4_app_client["storage_root"]

    ws_id = "ws_rig_test"
    db.create_workspace(workspace_id=ws_id, name="Rig Test")

    # 1. Prerequisite failure: Pass an image asset instead of a mesh asset
    img_ast = db.add_asset(
        asset_id="ast_img_prereq_fail",
        workspace_id=ws_id,
        file_type="image",
        relative_path="input/source.png",
        original_filename="source.png",
        byte_size=100,
        sha256="img_hash",
    )

    bad_resp = client.post(
        "/api/v1/rig",
        json={"mesh_file_id": img_ast.asset_id},
    )
    assert bad_resp.status_code == 400
    assert "Prerequisite failed" in bad_resp.text

    # 2. Prerequisite success: Pass a valid mesh asset
    mesh_path = storage_root / ws_id / "mesh" / "valid_model.glb"
    mesh_path.parent.mkdir(parents=True, exist_ok=True)
    mesh_path.write_bytes(b"valid glb content")

    mesh_ast = db.add_asset(
        asset_id="ast_mesh_prereq_ok",
        workspace_id=ws_id,
        file_type="mesh",
        relative_path="mesh/valid_model.glb",
        original_filename="valid_model.glb",
        byte_size=len(b"valid glb content"),
        sha256="mesh_hash",
    )

    good_resp = client.post(
        "/api/v1/rig",
        json={"mesh_file_id": mesh_ast.asset_id},
    )
    assert good_resp.status_code == 200, good_resp.text
    data = good_resp.json()
    assert data["status"] == "queued"
    assert data["workspace_id"] == ws_id
    assert data["operation_id"] is not None

    # Check operation created in DB
    op = db.get_operation(data["operation_id"])
    assert op is not None
    assert op.operation_type == "rigging"
    assert op.workspace_id == ws_id


def test_b4_t3_direct_save_workspace_persistence(batch4_app_client):
    """Verify operations persist directly to workspace storage without temporary preview gating."""
    db = batch4_app_client["db"]
    ws_manager = batch4_app_client["ws_manager"]

    workspace_id = "ws_api_persistence_004"
    ws_manager.create_workspace_tree(workspace_id)
    db.create_workspace(workspace_id=workspace_id, name="API Persistence Test")

    keep_id = "op_api_keep_004"
    keep_temp = ws_manager.create_operation_temp(keep_id)
    keep_mesh = keep_temp / "output.glb"
    keep_mesh.write_bytes(b"glTF\\x02\\x00\\x00\\x00keep-api")
    db.enqueue_operation(
        operation_id=keep_id,
        workspace_id=workspace_id,
        operation_type="retopology",
        temp_dir=str(keep_temp),
    )
    db.update_operation_execution_status(keep_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(keep_id, ExecutionStatus.COMPLETED)

    kept = db.keep_operation_in_workspace(keep_id, storage_manager=ws_manager)
    assert kept["asset_id"].startswith("ast_")
    assert Path(kept["mesh_path"]).is_file()
    assert db.get_operation(keep_id).persistence_status == PersistenceStatus.SAVED

    discard_id = "op_api_discard_004"
    discard_temp = ws_manager.create_operation_temp(discard_id)
    (discard_temp / "preview.glb").write_bytes(b"glTF\\x02\\x00\\x00\\x00discard-api")
    db.enqueue_operation(
        operation_id=discard_id,
        workspace_id=workspace_id,
        operation_type="texture",
        temp_dir=str(discard_temp),
    )
    db.update_operation_execution_status(discard_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(discard_id, ExecutionStatus.COMPLETED)

    assert db.discard_operation_preview(discard_id, storage_manager=ws_manager) is True
    assert not (discard_temp / "preview.glb").exists()
    assert db.get_operation(discard_id).persistence_status == PersistenceStatus.DISCARDED
    assert Path(kept["mesh_path"]).is_file(), "Discard must not remove a retained asset"


# ==============================================================================
# B4-T4: API Deprecation Guard & Error Hardening
# ==============================================================================

def test_b4_t4_sanitize_error_message():
    """Verify internal VPS paths are sanitized from error messages."""
    raw_error = "FileNotFoundError: [Errno 2] No such file or directory: '/workspaces/ForMash3D/backend/temp/secret.glb'"
    sanitized = sanitize_error_message(raw_error)
    assert "/workspaces/ForMash3D/backend/temp/" not in sanitized
    assert "secret.glb" in sanitized

    home_error = "Error loading weights from /home/codespace/models/weights.bin"
    sanitized_home = sanitize_error_message(home_error)
    assert "/home/codespace/models/" not in sanitized_home
    assert "weights.bin" in sanitized_home


def test_b4_t4_cancel_delegation_to_system_endpoint(batch4_app_client):
    """Verify /mesh-generation/cancel/{job_id} delegates directly to /system/jobs/{job_id}/cancel."""
    client = batch4_app_client["client"]
    scheduler = batch4_app_client["scheduler"]

    job_id = "test_cancel_job_99"
    scheduler.scheduled_jobs[job_id] = JobRequest(
        feature="image_to_raw_mesh",
        model_preference="triposr",
        inputs={},
    )

    resp = client.post(f"/api/v1/generate/cancel/{job_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["success"] is True
    assert data["job_id"] == job_id
    assert job_id in scheduler.cancelled_jobs


def test_script_engine_specialist_routes_use_sqlite_preview_lifecycle(batch4_app_client, monkeypatch):
    """Script mode executes local pipelines without scheduler access and supports Keep/Discard."""
    from api.routers import mesh_retopology, mesh_segmentation, mesh_uv_unwrapping
    from pipelines import retopo, segment, smart_uv

    client = batch4_app_client["client"]
    db = batch4_app_client["db"]
    storage_root = batch4_app_client["storage_root"]
    ws_manager = batch4_app_client["ws_manager"]

    workspace_id = "ws_script_routes_001"
    ws_manager.create_workspace_tree(workspace_id)
    db.create_workspace(workspace_id=workspace_id, name="Script Routes Test")
    input_path = storage_root / workspace_id / "input" / "source.glb"
    input_path.parent.mkdir(parents=True, exist_ok=True)
    input_path.write_bytes(b"glTF-test-input")

    input_asset = db.add_asset(
        asset_id="ast_script_input01",
        workspace_id=workspace_id,
        file_type="mesh",
        relative_path="input/source.glb",
        original_filename="source.glb",
        byte_size=input_path.stat().st_size,
        sha256="script-test-input",
    )

    async def resolve_input(_file_id, _file_store=None):
        return str(input_path)

    def fake_pipeline(_input_path, output_path, _options, progress_callback):
        output_path.write_bytes(b"glTF-test-preview")
        progress_callback("test pipeline complete", 0.9)
        return {"success": True, "output_path": str(output_path), "stats": {"face_count": 12, "vertex_count": 8}}

    for router_module in (mesh_retopology, mesh_uv_unwrapping, mesh_segmentation):
        monkeypatch.setattr(router_module, "resolve_file_id_async", resolve_input)
        monkeypatch.setattr(
            router_module,
            "get_scheduler",
            lambda *_args, **_kwargs: pytest.fail("Script mode must not acquire the AI scheduler"),
        )
    monkeypatch.setattr(retopo, "execute_retopo", fake_pipeline)
    monkeypatch.setattr(smart_uv, "execute_smart_uv", fake_pipeline)
    monkeypatch.setattr(segment, "execute_segment", fake_pipeline)

    requests = [
        ("/api/v1/retopo", {"target_polycount": 12000, "poly_type": "tri"}),
        ("/api/v1/unwrap", {"pack_method": "xatlas", "atlas_resolution": 1024}),
        ("/api/v1/segment", {"num_parts": 4, "method": "geometric"}),
    ]
    operation_ids = []
    for endpoint, options in requests:
        response = client.post(
            endpoint,
            json={
                "engine": "script",
                "workspace_id": workspace_id,
                "mesh_file_id": input_asset.asset_id,
                "output_format": "glb",
                **options,
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == "queued"
        assert data["workspace_id"] == workspace_id
        assert data["operation_id"].startswith("op_")
        operation = db.get_operation(data["operation_id"])
        assert operation is not None
        assert operation.execution_status == ExecutionStatus.COMPLETED
        assert operation.persistence_status == PersistenceStatus.SAVED
        status_response = client.get(f"/api/v1/system/workspace/operations/{data['operation_id']}")
        assert status_response.status_code == 200
        assert status_response.json()["execution_status"] == "completed"
        assert status_response.json()["result"]["stats"]["face_count"] == 12
        assert status_response.json()["result"]["asset_id"].startswith("ast_")
        operation_ids.append(data["operation_id"])

    assert len(operation_ids) == 3
