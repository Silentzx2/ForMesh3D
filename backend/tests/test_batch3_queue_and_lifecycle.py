"""
Unit and Integration Tests for Milestone 3 (Batch 3):
- B3-T1: SQLite FIFO Queue, Queue Cap (10), Single Worker Claim, Legacy Compatibility
- B3-T2: Dual State Machines (Execution & Persistence) with Transition Guards
- B3-T3: Input Snapshots, Deduplication Fingerprint, Regeneration Linking
- B3-T4: Preview, Keep in Workspace, and Discard Lifecycle
- B3-T5: Startup Recovery Lease Check, Structured Error Classification, Preview TTL Cleanup
"""

import hashlib
import io
import json
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict

import pytest
from PIL import Image

from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import (
    AssetModel,
    ExecutionStatus,
    JobModel,
    OperationModel,
    PersistenceStatus,
    WorkspaceModel,
    classify_operation_error,
    compute_dedupe_fingerprint,
    generate_asset_id,
    generate_operation_id,
    generate_workspace_id,
)
from core.scheduler.job_queue import JobQueue, JobRequest
from core.utils.file_utils import WorkspaceStorageManager, get_workspace_storage_manager


@pytest.fixture
def batch3_env():
    """Isolated environment with temporary storage and SQLite database."""
    temp_dir = tempfile.mkdtemp(prefix="p3d_batch3_test_")
    storage_root = Path(temp_dir) / "storage"
    storage_root.mkdir(parents=True, exist_ok=True)
    db_file = storage_root / "job_queue.db"
    db_url = f"sqlite:///{db_file}"

    ws_manager = WorkspaceStorageManager(storage_root=storage_root)
    db_manager = DatabaseManager(database_url=db_url)
    queue = JobQueue(max_size=10, database_url=db_url)

    yield {
        "temp_dir": temp_dir,
        "storage_root": storage_root,
        "db_file": db_file,
        "db_url": db_url,
        "ws_manager": ws_manager,
        "db_manager": db_manager,
        "queue": queue,
    }

    queue.close() if hasattr(queue, "close") else None
    db_manager.close()
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def sample_glb_bytes():
    return b"glTF\x02\x00\x00\x00fake-binary-content-for-3d-model-mesh-testing"


# ==============================================================================
# B3-T1 Tests: Queue Capacity Cap, Legacy Compatibility, Atomic Claiming
# ==============================================================================

def test_b3_t1_queue_cap_and_legacy_compatibility(batch3_env):
    db: DatabaseManager = batch3_env["db_manager"]
    ws_id = "test_cap_ws"
    db.create_workspace(workspace_id=ws_id, name="Queue Cap Test")

    # Enqueue up to default cap (10)
    for i in range(10):
        op_id = f"op_test_cap_{i:02d}"
        op, is_new = db.enqueue_operation(
            operation_id=op_id,
            workspace_id=ws_id,
            operation_type=f"retopology_{i}",
            settings={"index": i},
            queue_cap=10,
        )
        assert is_new is True
        assert op.execution_status == ExecutionStatus.QUEUED

    assert db.count_queued_operations() == 10

    # 11th operation must be rejected with QUEUE_FULL
    with pytest.raises(RuntimeError) as exc_info:
        db.enqueue_operation(
            operation_id="op_overflow_11",
            workspace_id=ws_id,
            operation_type="retopology_11",
            queue_cap=10,
        )
    assert "QUEUE_FULL" in str(exc_info.value)

    # Legacy JobRequest compatibility test
    legacy_job = JobRequest(
        feature="image_to_mesh",
        inputs={"image_file_id": "img_001", "name": "legacy_rabbit"},
    )
    assert db.save_job(legacy_job) is True
    reloaded_job = db.get_job(legacy_job.job_id)
    assert reloaded_job is not None
    assert reloaded_job.job_id == legacy_job.job_id


def test_b3_t1_atomic_single_worker_claim(batch3_env):
    db: DatabaseManager = batch3_env["db_manager"]
    ws_id = "test_claim_ws"
    db.create_workspace(workspace_id=ws_id, name="Claim Test")

    op_id = "op_claim_atomic_01"
    db.enqueue_operation(
        operation_id=op_id,
        workspace_id=ws_id,
        operation_type="texture",
    )

    # Worker 1 claims operation
    worker_1_lease = "worker_pid_1001"
    claimed_1 = db.claim_next_operation(worker_lease=worker_1_lease)
    assert claimed_1 is not None
    assert claimed_1.operation_id == op_id
    assert claimed_1.execution_status == ExecutionStatus.PROCESSING
    assert claimed_1.worker_lease == worker_1_lease

    # Worker 2 attempts concurrent claim: queue is now empty of queued operations
    worker_2_lease = "worker_pid_1002"
    claimed_2 = db.claim_next_operation(worker_lease=worker_2_lease)
    assert claimed_2 is None


# ==============================================================================
# B3-T2 Tests: Dual State Machines (Execution & Persistence)
# ==============================================================================

def test_b3_t2_dual_state_machines_and_terminal_immutability(batch3_env):
    db: DatabaseManager = batch3_env["db_manager"]
    ws_id = "test_dual_ws"
    db.create_workspace(workspace_id=ws_id, name="Dual State Test")

    op_id = "op_dual_state_01"
    op, _ = db.enqueue_operation(
        operation_id=op_id,
        workspace_id=ws_id,
        operation_type="retopology",
    )
    assert op.execution_status == ExecutionStatus.QUEUED
    assert op.persistence_status == PersistenceStatus.NOT_SAVED

    # Valid execution transition: queued -> processing
    assert db.update_operation_execution_status(op_id, ExecutionStatus.PROCESSING) is True

    # Valid execution transition: processing -> completed
    assert db.update_operation_execution_status(op_id, ExecutionStatus.COMPLETED, result={"polycount": 5000}) is True

    # Terminal state immutability: completed cannot transition to processing or queued
    with pytest.raises(ValueError) as exc:
        db.update_operation_execution_status(op_id, ExecutionStatus.PROCESSING)
    assert "Illegal execution state transition" in str(exc.value)

    # Persistence state transitions: not_saved -> saving -> saved
    assert db.update_operation_persistence_status(op_id, PersistenceStatus.SAVING) is True
    assert db.update_operation_persistence_status(op_id, PersistenceStatus.SAVED) is True

    # Terminal state immutability: saved cannot transition back to not_saved or discarded
    with pytest.raises(ValueError) as exc:
        db.update_operation_persistence_status(op_id, PersistenceStatus.NOT_SAVED)
    assert "Illegal persistence state transition" in str(exc.value)


# ==============================================================================
# B3-T3 Tests: Input Snapshots, Deduplication, and Regeneration
# ==============================================================================

def test_b3_t3_input_snapshot_deduplication_and_regenerate(batch3_env):
    db: DatabaseManager = batch3_env["db_manager"]
    ws_id = "test_snapshot_ws"
    input_id = "ast_source_mesh_01"
    db.create_workspace(workspace_id=ws_id, name="Snapshot Test")

    op_type = "segmentation"
    initial_settings = {"quality": "ultra", "parts": 8}

    # 1. First submission enqueued
    op1_id = "op_snap_001"
    op1, is_new1 = db.enqueue_operation(
        operation_id=op1_id,
        workspace_id=ws_id,
        operation_type=op_type,
        input_asset_id=input_id,
        settings=initial_settings,
    )
    assert is_new1 is True
    assert op1.operation_id == op1_id

    # Verify input snapshot immutability
    reloaded = db.get_operation(op1_id)
    assert json.loads(reloaded.settings_snapshot) == initial_settings

    # 2. Duplicate submission while op1 is active returns existing op1
    op2_id = "op_snap_duplicate"
    op2, is_new2 = db.enqueue_operation(
        operation_id=op2_id,
        workspace_id=ws_id,
        operation_type=op_type,
        input_asset_id=input_id,
        settings=initial_settings,
    )
    assert is_new2 is False
    assert op2.operation_id == op1_id

    # 3. Explicit Regenerate creates a new linked operation
    reg_op_id = "op_snap_regenerated_002"
    reg_op, is_new_reg = db.enqueue_operation(
        operation_id=reg_op_id,
        workspace_id=ws_id,
        operation_type=op_type,
        input_asset_id=input_id,
        parent_operation_id=op1_id,
        settings=initial_settings,
        regenerate=True,
    )
    assert is_new_reg is True
    assert reg_op.operation_id == reg_op_id
    assert reg_op.parent_operation_id == op1_id


# ==============================================================================
# B3-T4 Tests: Preview, Keep, and Discard Lifecycle
# ==============================================================================

def test_b3_t4_preview_keep_and_discard_lifecycle(batch3_env, sample_glb_bytes):
    db: DatabaseManager = batch3_env["db_manager"]
    ws_mgr: WorkspaceStorageManager = batch3_env["ws_manager"]

    ws_id = "ws_lifecycle_test"
    ws_mgr.create_workspace_tree(ws_id)
    db.create_workspace(workspace_id=ws_id, name="Lifecycle Test")

    # Part A: Keep Lifecycle
    op_keep_id = "op_keep_001"
    temp_dir_keep = ws_mgr.create_operation_temp(op_keep_id)
    temp_mesh = temp_dir_keep / "output.glb"
    temp_mesh.write_bytes(sample_glb_bytes)

    db.enqueue_operation(
        operation_id=op_keep_id,
        workspace_id=ws_id,
        operation_type="retopology",
        temp_dir=str(temp_dir_keep),
    )
    db.update_operation_execution_status(op_keep_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(op_keep_id, ExecutionStatus.COMPLETED)

    # Preview state: not_saved
    op_pre = db.get_operation(op_keep_id)
    assert op_pre.persistence_status == PersistenceStatus.NOT_SAVED

    # Keep in Workspace
    keep_result = db.keep_operation_in_workspace(op_keep_id, storage_manager=ws_mgr)
    assert keep_result["operation_id"] == op_keep_id
    assert Path(keep_result["mesh_path"]).exists()

    # Verified committed state
    op_post = db.get_operation(op_keep_id)
    assert op_post.persistence_status == PersistenceStatus.SAVED

    ws = db.get_workspace(ws_id)
    assert ws.active_mesh_asset_id == keep_result["asset_id"]

    manifest = ws_mgr.read_manifest(ws_id)
    assert manifest is not None
    assert manifest["active_mesh_asset_id"] == keep_result["asset_id"]

    # Part B: Discard Lifecycle
    op_discard_id = "op_discard_002"
    temp_dir_discard = ws_mgr.create_operation_temp(op_discard_id)
    discard_mesh = temp_dir_discard / "preview.glb"
    discard_mesh.write_bytes(sample_glb_bytes)

    db.enqueue_operation(
        operation_id=op_discard_id,
        workspace_id=ws_id,
        operation_type="texture",
        temp_dir=str(temp_dir_discard),
    )
    db.update_operation_execution_status(op_discard_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(op_discard_id, ExecutionStatus.COMPLETED)

    assert temp_dir_discard.exists()
    assert db.discard_operation_preview(op_discard_id, storage_manager=ws_mgr) is True

    # Temp purged, status discarded, saved asset untouched
    assert not temp_dir_discard.exists()
    op_disc = db.get_operation(op_discard_id)
    assert op_disc.persistence_status == PersistenceStatus.DISCARDED
    assert Path(keep_result["mesh_path"]).exists(), "Discard must not alter saved assets"


# ==============================================================================
# B3-T5 Tests: Startup Recovery, Error Classification, TTL Cleanup
# ==============================================================================

def test_b3_t5_startup_recovery_lease_check(batch3_env):
    db: DatabaseManager = batch3_env["db_manager"]
    ws_id = "ws_recovery_test"
    db.create_workspace(workspace_id=ws_id, name="Recovery Test")

    # Op 1: Alive worker
    op_alive_id = "op_worker_alive_01"
    db.enqueue_operation(operation_id=op_alive_id, workspace_id=ws_id, operation_type="texture")
    db.update_operation_execution_status(
        op_alive_id,
        ExecutionStatus.PROCESSING,
        worker_lease="worker_pid_8888",
    )

    # Op 2: Dead worker
    op_dead_id = "op_worker_dead_02"
    db.enqueue_operation(operation_id=op_dead_id, workspace_id=ws_id, operation_type="retopology")
    db.update_operation_execution_status(
        op_dead_id,
        ExecutionStatus.PROCESSING,
        worker_lease="worker_pid_9999",
    )

    # Startup recovery with simulated PID liveness function
    recovered = db.recover_orphaned_operations(
        is_pid_alive_fn=lambda lease: "8888" in lease
    )
    assert recovered == 1

    # Alive op remains PROCESSING
    alive_op = db.get_operation(op_alive_id)
    assert alive_op.execution_status == ExecutionStatus.PROCESSING

    # Dead op transitioned to INTERRUPTED with structured error
    dead_op = db.get_operation(op_dead_id)
    assert dead_op.execution_status == ExecutionStatus.INTERRUPTED
    err = json.loads(dead_op.error_json)
    assert err["error"] == "WORKER_CRASHED"
    assert err["retryable"] is True


def test_b3_t5_error_classification_and_preview_ttl_cleanup(batch3_env, sample_glb_bytes):
    # Error classification unit tests
    oom_err = classify_operation_error("CUDA out of memory in backward pass")
    assert oom_err["code"] == "CUDA_OOM"
    assert oom_err["retryable"] is True

    vram_err = classify_operation_error("Insufficient VRAM requirement: 16GB needed")
    assert vram_err["code"] == "INSUFFICIENT_VRAM"
    assert vram_err["retryable"] is False

    # TTL Cleanup tests
    db: DatabaseManager = batch3_env["db_manager"]
    ws_mgr: WorkspaceStorageManager = batch3_env["ws_manager"]
    ws_id = "ws_ttl_test"
    ws_mgr.create_workspace_tree(ws_id)
    db.create_workspace(workspace_id=ws_id, name="TTL Test")

    # Expired preview (26 hours ago)
    expired_op_id = "op_expired_preview_01"
    expired_temp = ws_mgr.create_operation_temp(expired_op_id)
    (expired_temp / "expired.glb").write_bytes(sample_glb_bytes)

    db.enqueue_operation(
        operation_id=expired_op_id,
        workspace_id=ws_id,
        operation_type="texture",
        temp_dir=str(expired_temp),
    )
    db.update_operation_execution_status(expired_op_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(expired_op_id, ExecutionStatus.COMPLETED)

    # Backdate created_at in DB
    with db.get_session() as session:
        op = session.query(OperationModel).filter_by(operation_id=expired_op_id).one()
        op.created_at = datetime.utcnow() - timedelta(hours=26)
        session.commit()

    # Recent preview (2 hours ago)
    recent_op_id = "op_recent_preview_02"
    recent_temp = ws_mgr.create_operation_temp(recent_op_id)
    (recent_temp / "recent.glb").write_bytes(sample_glb_bytes)

    db.enqueue_operation(
        operation_id=recent_op_id,
        workspace_id=ws_id,
        operation_type="retopology",
        temp_dir=str(recent_temp),
    )
    db.update_operation_execution_status(recent_op_id, ExecutionStatus.PROCESSING)
    db.update_operation_execution_status(recent_op_id, ExecutionStatus.COMPLETED)

    # Run TTL cleanup
    cleaned = db.cleanup_expired_previews(ttl_hours=24)
    assert cleaned == 1

    # Expired temp purged and status transitioned
    assert not expired_temp.exists()
    op_exp = db.get_operation(expired_op_id)
    assert op_exp.persistence_status == PersistenceStatus.PREVIEW_EXPIRED
    assert op_exp.execution_status == ExecutionStatus.COMPLETED

    # Recent preview intact
    assert recent_temp.exists()
    op_rec = db.get_operation(recent_op_id)
    assert op_rec.persistence_status == PersistenceStatus.NOT_SAVED
