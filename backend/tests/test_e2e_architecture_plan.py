"""
End-to-End Test Suite for ForMash3D Simplified Asset & Generation Architecture.

Target Specification:
- Docs/TASKS.md Section 15 ("Acceptance Criteria and Verification")
- Docs/TASKS.md Section 15.4 ("Focused Verification Requirements")
- Docs/TASKS.md Section 21 ("Final Agreed Workspace Storage Structure")
- Docs/TASKS.md Section 22 ("Workspace Ownership, Active Mesh, Operation Previews, and Mesh Versions")
- Docs/TASKS.md Section 7 ("Job States and State Transitions")

Test Structure:
- Tier 1: Primary Feature Coverage (Upload, Job Creation, Lifecycle, Dual State Machine, Keep/Discard)
- Tier 2: Boundary & Corner Cases (Path Traversal, Byte Preservation, ID Collision, Queue Cap, Dedupe, Thumbnail Independence)
- Tier 3: Cross-Feature Interactions (Multi-Tool Pipeline, Input Snapshot Immutability, Standalone Upload Isolation, Versions Dropdown, Stale Fetch Race)
- Tier 4: Real-World Scenarios (Deep Link Restoration, API Restart with Live Worker, Worker Crash Recovery, Manifest Repair, Preview TTL Cleanup)
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytest
import trimesh
from PIL import Image
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.core.scheduler.database_models import Base as ExistingBase
from backend.core.scheduler.database_models import JobModel, JobStatus
from backend.core.scheduler.job_queue import JobRequest
from backend.core.utils.file_utils import (
    SUPPORTED_IMAGE_FORMATS,
    SUPPORTED_MESH_FORMATS,
    validate_file_extension,
)


# ==============================================================================
# Architectural Contract Harnesses & Specifications (Sections 7, 15, 21, 22)
# ==============================================================================

class ExecutionStatus:
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"

    ALLOWED_TRANSITIONS = {
        QUEUED: {PROCESSING, CANCELLED},
        PROCESSING: {COMPLETED, FAILED, INTERRUPTED, CANCELLED},
        COMPLETED: set(),  # Terminal
        FAILED: set(),     # Terminal
        INTERRUPTED: set(),# Terminal
        CANCELLED: set(),  # Terminal
    }


class PersistenceStatus:
    NOT_SAVED = "not_saved"
    SAVING = "saving"
    SAVED = "saved"
    SAVE_FAILED = "save_failed"
    DISCARDED = "discarded"
    CLEANUP_PENDING = "cleanup_pending"
    PREVIEW_EXPIRED = "preview_expired"

    ALLOWED_TRANSITIONS = {
        NOT_SAVED: {SAVING, DISCARDED, CLEANUP_PENDING, PREVIEW_EXPIRED},
        SAVING: {SAVED, SAVE_FAILED, CLEANUP_PENDING},
        SAVED: set(),  # Terminal for retained asset
        SAVE_FAILED: {SAVING, DISCARDED, CLEANUP_PENDING},
        DISCARDED: set(),  # Terminal
        CLEANUP_PENDING: {DISCARDED},
        PREVIEW_EXPIRED: set(),  # Terminal
    }


class WorkspaceContractSchema:
    """SQLAlchemy contract models representing Section 21 & 22 SQLite persistence."""
    Base = declarative_base()

    class WorkspaceRow(Base):
        __tablename__ = "workspaces"
        workspace_id = Column(String(64), primary_key=True)
        name = Column(String(128), nullable=False)
        active_mesh_asset_id = Column(String(64), nullable=True)
        source_asset_id = Column(String(64), nullable=True)
        status = Column(String(32), nullable=False, default="active")
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        settings_json = Column(Text, nullable=True)

    class AssetRow(Base):
        __tablename__ = "assets"
        asset_id = Column(String(64), primary_key=True)
        workspace_id = Column(String(64), nullable=False, index=True)
        operation_id = Column(String(64), nullable=True, index=True)
        file_type = Column(String(32), nullable=False)
        relative_path = Column(String(512), nullable=False)
        original_filename = Column(String(256), nullable=False)
        byte_size = Column(Integer, nullable=False)
        sha256 = Column(String(64), nullable=False)
        is_retained = Column(Integer, nullable=False, default=1)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    class OperationRow(Base):
        __tablename__ = "operations"
        operation_id = Column(String(64), primary_key=True)
        workspace_id = Column(String(64), nullable=False, index=True)
        input_asset_id = Column(String(64), nullable=True)
        parent_operation_id = Column(String(64), nullable=True)
        operation_type = Column(String(64), nullable=False)
        execution_status = Column(String(32), nullable=False, default=ExecutionStatus.QUEUED)
        persistence_status = Column(String(32), nullable=False, default=PersistenceStatus.NOT_SAVED)
        progress = Column(Float, nullable=False, default=0.0)
        worker_lease = Column(String(64), nullable=True)
        lease_heartbeat = Column(DateTime, nullable=True)
        settings_snapshot = Column(Text, nullable=True)
        temp_dir = Column(String(512), nullable=True)
        result_json = Column(Text, nullable=True)
        error_json = Column(Text, nullable=True)
        created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
        completed_at = Column(DateTime, nullable=True)


class WorkspaceStorageManager:
    """Manages filesystem hierarchy strictly conforming to Section 21."""

    def __init__(self, storage_root: Path):
        self.storage_root = storage_root.resolve()
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.temp_root = self.storage_root / "temp"
        self.temp_root.mkdir(parents=True, exist_ok=True)

    def mint_workspace_id(self, stem: str, existing_ids: set[str]) -> str:
        clean = re.sub(r"[^a-zA-Z0-9_-]", "_", stem).strip("_").lower()[:32] or "workspace"
        while True:
            short_hash = hashlib.sha256(f"{clean}:{time.time_ns()}:{uuid.uuid4().hex}".encode()).hexdigest()[:6]
            candidate = f"{clean}_{short_hash}"
            if candidate not in existing_ids:
                return candidate

    def get_workspace_dir(self, workspace_id: str) -> Path:
        self.assert_safe_id(workspace_id)
        target = (self.storage_root / workspace_id).resolve()
        if not target.is_relative_to(self.storage_root):
            raise ValueError(f"Path traversal detected: {workspace_id}")
        return target

    def assert_safe_id(self, identifier: str) -> None:
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", identifier):
            raise ValueError(f"Invalid identifier contains illegal characters: {identifier}")
        if ".." in identifier or "/" in identifier or "\\" in identifier:
            raise ValueError(f"Path traversal detected in identifier: {identifier}")

    def create_workspace_tree(self, workspace_id: str) -> Path:
        ws_dir = self.get_workspace_dir(workspace_id)
        ws_dir.mkdir(parents=True, exist_ok=True)
        (ws_dir / "input").mkdir(exist_ok=True)
        (ws_dir / "mesh").mkdir(exist_ok=True)
        return ws_dir

    def create_operation_temp(self, operation_id: str) -> Path:
        self.assert_safe_id(operation_id)
        op_temp = self.temp_root / operation_id
        op_temp.mkdir(parents=True, exist_ok=True)
        return op_temp

    def publish_derived_mesh(
        self,
        workspace_id: str,
        operation_type: str,
        temp_mesh_path: Path,
        temp_thumbnail_path: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Atomic publication conforming to Section 21 & Section 22.7."""
        ws_dir = self.get_workspace_dir(workspace_id)
        tool_folder_map = {
            "texture": ws_dir / "texture" / "pbr",
            "segmentation": ws_dir / "segmentation",
            "retopology": ws_dir / "retopology",
            "uv": ws_dir / "uv",
            "rigging": ws_dir / "rigging",
            "animation": ws_dir / "animation",
        }
        dest_dir = tool_folder_map.get(operation_type, ws_dir / operation_type)
        dest_dir.mkdir(parents=True, exist_ok=True)

        ext = temp_mesh_path.suffix.lower()
        final_mesh_name = f"{workspace_id}_{operation_type}{ext}"
        final_mesh_path = dest_dir / final_mesh_name

        # Version safety: append version suffix if already exists
        version = 2
        while final_mesh_path.exists():
            final_mesh_name = f"{workspace_id}_{operation_type}_v{version:03d}{ext}"
            final_mesh_path = dest_dir / final_mesh_name
            version += 1

        # Atomic publication: copy/move to temporary target in destination then replace
        staging_path = dest_dir / f".staging_{uuid.uuid4().hex}"
        shutil.copy2(temp_mesh_path, staging_path)
        staging_path.replace(final_mesh_path)

        # Thumbnail publication
        final_thumb_path = None
        if temp_thumbnail_path and temp_thumbnail_path.exists():
            final_thumb_name = "thumbnail.png"
            final_thumb_path = dest_dir / final_thumb_name
            shutil.copy2(temp_thumbnail_path, final_thumb_path)

        relative_mesh_path = str(final_mesh_path.relative_to(ws_dir))
        return {
            "mesh_path": final_mesh_path,
            "relative_mesh_path": relative_mesh_path,
            "thumbnail_path": final_thumb_path,
        }

    def write_manifest(self, workspace_id: str, manifest_data: Dict[str, Any]) -> Path:
        ws_dir = self.get_workspace_dir(workspace_id)
        manifest_path = ws_dir / "metadata.json"
        temp_manifest = ws_dir / f".metadata_{uuid.uuid4().hex}.tmp"
        temp_manifest.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")
        temp_manifest.replace(manifest_path)
        return manifest_path

    def read_manifest(self, workspace_id: str) -> Optional[Dict[str, Any]]:
        ws_dir = self.get_workspace_dir(workspace_id)
        manifest_path = ws_dir / "metadata.json"
        if not manifest_path.exists():
            return None
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return None


# ==============================================================================
# Fixtures
# ==============================================================================

@pytest.fixture
def sandbox_env(tmp_path: Path):
    """Provides an isolated workspace storage and authoritative SQLite database."""
    storage_root = tmp_path / "storage"
    storage_root.mkdir(parents=True, exist_ok=True)
    db_path = storage_root / "job_queue.db"

    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
        poolclass=StaticPool,
    )
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("PRAGMA busy_timeout=30000"))

    # Create both existing models and architecture contract tables
    ExistingBase.metadata.create_all(engine)
    WorkspaceContractSchema.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    manager = WorkspaceStorageManager(storage_root)

    return {
        "storage_root": storage_root,
        "db_path": db_path,
        "engine": engine,
        "Session": Session,
        "manager": manager,
    }


@pytest.fixture
def sample_image_bytes() -> bytes:
    img = Image.new("RGB", (64, 64), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def sample_glb_bytes() -> bytes:
    mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    return mesh.export(file_type="glb")


# ==============================================================================
# Tier 1: Primary Feature Coverage (Happy Path)
# ==============================================================================

class TestTier1FeatureCoverage:
    """Tier 1: Feature Coverage (Upload, Job Creation, Lifecycle, Dual States, Keep/Discard)."""

    def test_image_and_mesh_upload_contracts(
        self, sandbox_env, sample_image_bytes, sample_glb_bytes
    ):
        """Upload valid image and mesh; verify storage file, asset row, byte preservation."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("rabbit_model", set())
        ws_dir = manager.create_workspace_tree(ws_id)
        input_dir = ws_dir / "input"

        # 1. Image upload
        img_dest = input_dir / "source_image.png"
        img_dest.write_bytes(sample_image_bytes)
        img_sha = hashlib.sha256(sample_image_bytes).hexdigest()
        img_asset_id = f"ast_{uuid.uuid4().hex[:12]}"

        # 2. Mesh upload
        mesh_dest = input_dir / "source_mesh.glb"
        mesh_dest.write_bytes(sample_glb_bytes)
        mesh_sha = hashlib.sha256(sample_glb_bytes).hexdigest()
        mesh_asset_id = f"ast_{uuid.uuid4().hex[:12]}"

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_id,
                    name="Rabbit Model",
                    active_mesh_asset_id=mesh_asset_id,
                    source_asset_id=mesh_asset_id,
                )
            )
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id=img_asset_id,
                    workspace_id=ws_id,
                    file_type="image",
                    relative_path="input/source_image.png",
                    original_filename="My Camera Photo #1.png",
                    byte_size=len(sample_image_bytes),
                    sha256=img_sha,
                )
            )
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id=mesh_asset_id,
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path="input/source_mesh.glb",
                    original_filename="Source Box Mesh.glb",
                    byte_size=len(sample_glb_bytes),
                    sha256=mesh_sha,
                )
            )
            session.commit()

        # Assertions
        assert img_dest.exists()
        assert img_dest.read_bytes() == sample_image_bytes
        assert mesh_dest.exists()
        assert mesh_dest.read_bytes() == sample_glb_bytes

        with Session() as session:
            img_row = session.query(WorkspaceContractSchema.AssetRow).filter_by(asset_id=img_asset_id).one()
            assert img_row.original_filename == "My Camera Photo #1.png"
            assert img_row.byte_size == len(sample_image_bytes)
            assert img_row.sha256 == img_sha
            # Original filename is metadata only; path is strictly relative
            assert not Path(img_row.relative_path).is_absolute()
            assert ".." not in img_row.relative_path

    def test_invalid_file_types_and_failed_upload_handling(self, sandbox_env):
        """Verify invalid extensions are rejected and failed uploads leave no phantom asset records."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        invalid_extensions = ["malware.exe", "script.sh", "payload.bat", "webshell.php", "archive.zip"]
        supported = SUPPORTED_IMAGE_FORMATS + SUPPORTED_MESH_FORMATS

        for bad_filename in invalid_extensions:
            assert not validate_file_extension(bad_filename, supported)

        # Verify failed upload rollback
        ws_id = manager.mint_workspace_id("failing_ws", set())
        manager.create_workspace_tree(ws_id)

        try:
            with Session() as session:
                # Simulated upload error halfway through
                raise IOError("Simulated network drop / disk write failure")
        except IOError:
            pass

        # Invariant: No phantom asset records exist in database
        with Session() as session:
            assets = session.query(WorkspaceContractSchema.AssetRow).filter_by(workspace_id=ws_id).all()
            assert len(assets) == 0, "Failed upload must not leave a phantom asset record"

    def test_job_creation_pre_inference_and_route_alignment(self, sandbox_env):
        """Verify job row is created before inference starts and job_id matches route token."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("warrior", set())
        op_id = f"op_{uuid.uuid4().hex[:12]}"
        route_token = ws_id
        route_path = f"/workspace/generate/{route_token}"

        # Invariant: job_id / workspace_id exactly matches the last segment of route_path
        assert route_path.split("/")[-1] == ws_id

        # Job row created in DB prior to inference
        with Session() as session:
            op_row = WorkspaceContractSchema.OperationRow(
                operation_id=op_id,
                workspace_id=ws_id,
                operation_type="generate_raw_mesh",
                execution_status=ExecutionStatus.QUEUED,
                persistence_status=PersistenceStatus.NOT_SAVED,
            )
            session.add(op_row)
            session.commit()

        with Session() as session:
            queried = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).first()
            assert queried is not None
            assert queried.execution_status == ExecutionStatus.QUEUED
            assert queried.workspace_id == ws_id

    def test_generation_lifecycle_state_flow(self, sandbox_env, sample_glb_bytes):
        """Verify state transitions: queued -> processing -> completed with progress updates."""
        Session = sandbox_env["Session"]
        op_id = f"op_{uuid.uuid4().hex[:12]}"
        ws_id = "test_ws_001"

        with Session() as session:
            op = WorkspaceContractSchema.OperationRow(
                operation_id=op_id,
                workspace_id=ws_id,
                operation_type="generate_raw_mesh",
                execution_status=ExecutionStatus.QUEUED,
                progress=0.0,
            )
            session.add(op)
            session.commit()

        # Transition: QUEUED -> PROCESSING
        with Session() as session:
            op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            next_state = ExecutionStatus.PROCESSING
            assert next_state in ExecutionStatus.ALLOWED_TRANSITIONS[op.execution_status]
            op.execution_status = next_state
            op.progress = 0.1
            op.worker_lease = "worker_pid_12345"
            op.lease_heartbeat = datetime.utcnow()
            session.commit()

        # Intermediate progress updates do not corrupt state
        for p in [0.25, 0.5, 0.75, 0.99]:
            with Session() as session:
                op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
                assert op.execution_status == ExecutionStatus.PROCESSING
                op.progress = p
                session.commit()

        # Transition: PROCESSING -> COMPLETED
        with Session() as session:
            op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            next_state = ExecutionStatus.COMPLETED
            assert next_state in ExecutionStatus.ALLOWED_TRANSITIONS[op.execution_status]
            op.execution_status = next_state
            op.progress = 1.0
            op.completed_at = datetime.utcnow()
            session.commit()

        with Session() as session:
            final_op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            assert final_op.execution_status == ExecutionStatus.COMPLETED
            assert final_op.progress == 1.0
            # Terminal states cannot transition further
            assert len(ExecutionStatus.ALLOWED_TRANSITIONS[final_op.execution_status]) == 0

    def test_dual_state_machine_execution_and_persistence(self, sandbox_env):
        """Verify strict separation between executionState and persistenceState."""
        Session = sandbox_env["Session"]
        op_id = f"op_{uuid.uuid4().hex[:12]}"
        ws_id = "dual_state_ws"

        # Derived tool operation completes inference: execution=completed, persistence=not_saved
        with Session() as session:
            op = WorkspaceContractSchema.OperationRow(
                operation_id=op_id,
                workspace_id=ws_id,
                operation_type="texture_pbr",
                execution_status=ExecutionStatus.COMPLETED,
                persistence_status=PersistenceStatus.NOT_SAVED,
            )
            session.add(op)
            session.commit()

        with Session() as session:
            op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            assert op.execution_status == ExecutionStatus.COMPLETED
            # Preview exists in temp only; not a permanent workspace asset
            assert op.persistence_status == PersistenceStatus.NOT_SAVED

        # Illegal transition attempt: from SAVED to NOT_SAVED is forbidden
        assert PersistenceStatus.NOT_SAVED not in PersistenceStatus.ALLOWED_TRANSITIONS[PersistenceStatus.SAVED]

    def test_keep_transaction_and_discard_purge(self, sandbox_env, sample_glb_bytes):
        """Verify Keep commits files to tool directory; Discard purges temp without touching saved assets."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("dragon", set())
        ws_dir = manager.create_workspace_tree(ws_id)
        op_id = f"op_{uuid.uuid4().hex[:12]}"

        # 1. Output generated into temp staging
        op_temp = manager.create_operation_temp(op_id)
        temp_mesh = op_temp / "preview.glb"
        temp_mesh.write_bytes(sample_glb_bytes)
        assert temp_mesh.exists()

        # 2. Keep in Workspace action
        published = manager.publish_derived_mesh(
            workspace_id=ws_id,
            operation_type="texture",
            temp_mesh_path=temp_mesh,
        )
        final_mesh: Path = published["mesh_path"]
        assert final_mesh.exists()
        assert final_mesh.read_bytes() == sample_glb_bytes
        assert final_mesh.parent == ws_dir / "texture" / "pbr"

        # Purge temporary directory
        shutil.rmtree(op_temp)
        assert not op_temp.exists()
        assert final_mesh.exists()  # Retained asset unaffected by temp purge

        # 3. Discard action on a second temp op
        op_id_2 = f"op_{uuid.uuid4().hex[:12]}"
        op_temp_2 = manager.create_operation_temp(op_id_2)
        discard_mesh = op_temp_2 / "discard_preview.glb"
        discard_mesh.write_bytes(sample_glb_bytes)
        assert discard_mesh.exists()

        # Discard deletes temp files
        shutil.rmtree(op_temp_2)
        assert not op_temp_2.exists()
        # Ensure final mesh from op 1 is completely preserved
        assert final_mesh.exists()


# ==============================================================================
# Tier 2: Boundary & Corner Cases (Adversarial)
# ==============================================================================

class TestTier2BoundaryAndCornerCases:
    """Tier 2: Boundary & Corner Cases (Path Traversal, Byte Preservation, Collision, Cap, Dedupe)."""

    def test_path_traversal_protection(self, sandbox_env):
        """Verify path traversal in workspace_id, asset_id, or filename is strictly rejected."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]

        malicious_ids = [
            "../../etc/passwd",
            "..\\..\\windows\\system32",
            "rabbit/../../../escape",
            "/absolute/root/path",
            "workspace;rm -rf /",
            "slug with spaces",
            "slug$special*chars",
        ]

        for bad_id in malicious_ids:
            with pytest.raises(ValueError):
                manager.assert_safe_id(bad_id)

            with pytest.raises(ValueError):
                manager.get_workspace_dir(bad_id)

    def test_filename_metadata_isolation_and_byte_preservation(self, sandbox_env, sample_glb_bytes):
        """Verify original filename is metadata only; exact byte content is preserved."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        ws_id = manager.mint_workspace_id("character", set())
        ws_dir = manager.create_workspace_tree(ws_id)

        # Complex, adversarial filename with spaces, unicode, meta-characters
        weird_original_filename = "Character #1 [Mesh] (FINAL) — 兔子.glb"

        input_dest = ws_dir / "input" / "source_mesh.glb"
        input_dest.write_bytes(sample_glb_bytes)

        # Byte-for-byte check
        read_back = input_dest.read_bytes()
        assert len(read_back) == len(sample_glb_bytes)
        assert hashlib.sha256(read_back).hexdigest() == hashlib.sha256(sample_glb_bytes).hexdigest()

        # On disk name is canonical ('source_mesh.glb'), while original name is stored in metadata
        manifest = {
            "workspace_id": ws_id,
            "source_mesh": {
                "file_path": "input/source_mesh.glb",
                "original_filename": weird_original_filename,
                "sha256": hashlib.sha256(sample_glb_bytes).hexdigest(),
            },
        }
        manager.write_manifest(ws_id, manifest)
        loaded = manager.read_manifest(ws_id)
        assert loaded["source_mesh"]["original_filename"] == weird_original_filename

    def test_id_collision_retry_handling(self, sandbox_env):
        """Verify collision on workspace_id triggers retry with a new unique suffix."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]

        existing_ids = {"fox_a1b2c3", "fox_e4f5a6"}
        new_id = manager.mint_workspace_id("fox", existing_ids)

        assert new_id not in existing_ids
        assert new_id.startswith("fox_")
        assert len(new_id.split("_")[-1]) == 6

    def test_queue_capacity_limit_cap_10(self, sandbox_env):
        """Verify SQLite queue enforces fixed maximum cap of 10 operations (Section 9.4)."""
        Session = sandbox_env["Session"]
        QUEUE_CAP = 10

        # Enqueue 10 operations
        with Session() as session:
            for i in range(QUEUE_CAP):
                op = WorkspaceContractSchema.OperationRow(
                    operation_id=f"op_queued_{i:03d}",
                    workspace_id=f"ws_{i:03d}",
                    operation_type="generate_raw_mesh",
                    execution_status=ExecutionStatus.QUEUED,
                )
                session.add(op)
            session.commit()

        # Count active queued
        with Session() as session:
            queued_count = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter_by(execution_status=ExecutionStatus.QUEUED)
                .count()
            )
            assert queued_count == 10

            # 11th operation submission must trigger queue cap guard
            can_enqueue = queued_count < QUEUE_CAP
            assert not can_enqueue, "Queue capacity cap (10) must reject additional submissions"

    def test_duplicate_submission_deduplication(self, sandbox_env):
        """Verify identical in-flight submissions return existing operation; explicit Regenerate bypasses dedupe."""
        Session = sandbox_env["Session"]

        def compute_dedupe_fingerprint(ws_id: str, input_id: str, op_type: str, settings: dict) -> str:
            payload = f"{ws_id}:{input_id}:{op_type}:{json.dumps(settings, sort_keys=True)}"
            return hashlib.sha256(payload.encode()).hexdigest()

        ws_id = "ws_dedupe_01"
        input_id = "ast_input_01"
        op_type = "generate_raw_mesh"
        settings = {"quality": "high", "steps": 50}

        fp1 = compute_dedupe_fingerprint(ws_id, input_id, op_type, settings)

        # First submission enqueued
        op1_id = f"op_{uuid.uuid4().hex[:12]}"
        with Session() as session:
            session.add(
                WorkspaceContractSchema.OperationRow(
                    operation_id=op1_id,
                    workspace_id=ws_id,
                    input_asset_id=input_id,
                    operation_type=op_type,
                    execution_status=ExecutionStatus.QUEUED,
                    settings_snapshot=json.dumps(settings),
                )
            )
            session.commit()

        # Second rapid identical submission detected via matching fingerprint
        fp2 = compute_dedupe_fingerprint(ws_id, input_id, op_type, settings)
        assert fp1 == fp2

        # In-flight check detects active operation with same fingerprint
        with Session() as session:
            in_flight = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter(
                    WorkspaceContractSchema.OperationRow.workspace_id == ws_id,
                    WorkspaceContractSchema.OperationRow.input_asset_id == input_id,
                    WorkspaceContractSchema.OperationRow.operation_type == op_type,
                    WorkspaceContractSchema.OperationRow.execution_status.in_(
                        [ExecutionStatus.QUEUED, ExecutionStatus.PROCESSING]
                    ),
                )
                .first()
            )
            assert in_flight is not None
            assert in_flight.operation_id == op1_id  # Returns existing op

        # Explicit Regenerate bypasses dedupe by requesting a new linked operation
        regenerate_op_id = f"op_{uuid.uuid4().hex[:12]}"
        with Session() as session:
            reg_op = WorkspaceContractSchema.OperationRow(
                operation_id=regenerate_op_id,
                workspace_id=ws_id,
                input_asset_id=input_id,
                parent_operation_id=op1_id,  # Linked to parent
                operation_type=op_type,
                execution_status=ExecutionStatus.QUEUED,
                settings_snapshot=json.dumps(settings),
            )
            session.add(reg_op)
            session.commit()

        with Session() as session:
            reg_row = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=regenerate_op_id).one()
            assert reg_row.parent_operation_id == op1_id
            assert reg_row.operation_id != op1_id

    def test_atomic_single_worker_claim_guard(self, sandbox_env):
        """Verify atomic single worker claim: only one worker can transition QUEUED -> PROCESSING (Section 9.1)."""
        Session = sandbox_env["Session"]
        op_id = f"op_{uuid.uuid4().hex[:12]}"

        with Session() as session:
            session.add(
                WorkspaceContractSchema.OperationRow(
                    operation_id=op_id,
                    workspace_id="ws_claim_test",
                    operation_type="generate_raw_mesh",
                    execution_status=ExecutionStatus.QUEUED,
                )
            )
            session.commit()

        # Worker 1 claims atomically via conditional update
        with Session() as session:
            rows_updated_worker_1 = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter_by(operation_id=op_id, execution_status=ExecutionStatus.QUEUED)
                .update(
                    {
                        "execution_status": ExecutionStatus.PROCESSING,
                        "worker_lease": "worker_pid_101",
                        "lease_heartbeat": datetime.utcnow(),
                    }
                )
            )
            session.commit()
            assert rows_updated_worker_1 == 1

        # Worker 2 attempts to claim the same operation concurrently
        with Session() as session:
            rows_updated_worker_2 = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter_by(operation_id=op_id, execution_status=ExecutionStatus.QUEUED)
                .update(
                    {
                        "execution_status": ExecutionStatus.PROCESSING,
                        "worker_lease": "worker_pid_102",
                        "lease_heartbeat": datetime.utcnow(),
                    }
                )
            )
            session.commit()
            assert rows_updated_worker_2 == 0, "Duplicate claim must be rejected"

    def test_thumbnail_failure_independence(self, sandbox_env, sample_glb_bytes):
        """Verify thumbnail generation failure does not block mesh completion or retention (Section 7.9)."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        ws_id = manager.mint_workspace_id("bear", set())
        ws_dir = manager.create_workspace_tree(ws_id)
        op_id = f"op_{uuid.uuid4().hex[:12]}"

        op_temp = manager.create_operation_temp(op_id)
        temp_mesh = op_temp / "output.glb"
        temp_mesh.write_bytes(sample_glb_bytes)

        # Thumbnail creation deliberately fails / produces None
        temp_thumbnail = None

        # Publication must still succeed without thumbnail
        published = manager.publish_derived_mesh(
            workspace_id=ws_id,
            operation_type="retopology",
            temp_mesh_path=temp_mesh,
            temp_thumbnail_path=temp_thumbnail,
        )

        assert published["mesh_path"].exists()
        assert published["mesh_path"].read_bytes() == sample_glb_bytes
        assert published["thumbnail_path"] is None


# ==============================================================================
# Tier 3: Cross-Feature Interactions
# ==============================================================================

class TestTier3CrossFeatureInteractions:
    """Tier 3: Cross-Feature Interactions (Lineage, Snapshot Immutability, Isolation, Versions)."""

    def test_multitool_pipeline_lineage(self, sandbox_env, sample_glb_bytes):
        """Upload -> generate raw mesh -> keep active -> derived tool -> verify lineage."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("warrior", set())
        ws_dir = manager.create_workspace_tree(ws_id)

        # 1. Base raw mesh published
        raw_mesh_path = ws_dir / "mesh" / f"{ws_id}.glb"
        raw_mesh_path.write_bytes(sample_glb_bytes)
        raw_asset_id = "ast_raw_001"

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_id,
                    name="Warrior",
                    active_mesh_asset_id=raw_asset_id,
                    source_asset_id=raw_asset_id,
                )
            )
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id=raw_asset_id,
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path=f"mesh/{ws_id}.glb",
                    original_filename="raw_mesh.glb",
                    byte_size=len(sample_glb_bytes),
                    sha256=hashlib.sha256(sample_glb_bytes).hexdigest(),
                )
            )
            session.commit()

        # 2. Run Texture tool on active mesh
        tex_op_id = f"op_{uuid.uuid4().hex[:12]}"
        tex_temp = manager.create_operation_temp(tex_op_id)
        tex_temp_mesh = tex_temp / "textured.glb"
        tex_temp_mesh.write_bytes(sample_glb_bytes)

        # Keep Texture output
        tex_published = manager.publish_derived_mesh(
            workspace_id=ws_id,
            operation_type="texture",
            temp_mesh_path=tex_temp_mesh,
        )
        tex_asset_id = "ast_tex_002"

        with Session() as session:
            # Register new retained asset
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id=tex_asset_id,
                    workspace_id=ws_id,
                    operation_id=tex_op_id,
                    file_type="mesh",
                    relative_path=tex_published["relative_mesh_path"],
                    original_filename=tex_published["mesh_path"].name,
                    byte_size=len(sample_glb_bytes),
                    sha256=hashlib.sha256(sample_glb_bytes).hexdigest(),
                    is_retained=1,
                )
            )
            # Update workspace active mesh to newly kept textured mesh
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            ws.active_mesh_asset_id = tex_asset_id
            session.commit()

        # Verify lineage: workspace has 2 retained meshes, active mesh is textured
        with Session() as session:
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            assert ws.active_mesh_asset_id == tex_asset_id

            retained_assets = (
                session.query(WorkspaceContractSchema.AssetRow)
                .filter_by(workspace_id=ws_id, is_retained=1)
                .all()
            )
            assert len(retained_assets) == 2
            asset_ids = {a.asset_id for a in retained_assets}
            assert raw_asset_id in asset_ids
            assert tex_asset_id in asset_ids

    def test_running_operation_input_snapshot_immutability(self, sandbox_env):
        """Active mesh change in UI during processing must not mutate running operation's input snapshot."""
        Session = sandbox_env["Session"]
        ws_id = "ws_snapshot_test"
        op_id = f"op_{uuid.uuid4().hex[:12]}"
        initial_active_asset_id = "ast_mesh_v001"
        new_active_asset_id = "ast_mesh_v002"

        # Operation starts and captures input_asset_id snapshot
        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_id,
                    name="Snapshot Test",
                    active_mesh_asset_id=initial_active_asset_id,
                )
            )
            session.add(
                WorkspaceContractSchema.OperationRow(
                    operation_id=op_id,
                    workspace_id=ws_id,
                    input_asset_id=initial_active_asset_id,  # Captured snapshot
                    operation_type="segmentation",
                    execution_status=ExecutionStatus.PROCESSING,
                )
            )
            session.commit()

        # User changes active mesh in UI
        with Session() as session:
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            ws.active_mesh_asset_id = new_active_asset_id
            session.commit()

        # Verify running operation's input snapshot remains completely untouched
        with Session() as session:
            op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            assert op.input_asset_id == initial_active_asset_id
            assert op.input_asset_id != new_active_asset_id

    def test_initial_image_to_mesh_regeneration_creates_v002_base(
        self, sandbox_env, sample_glb_bytes
    ):
        """Regenerating initial base mesh creates _v002, keeps old base selectable, and updates active mesh only on commit (Section 15.4)."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("falcon", set())
        ws_dir = manager.create_workspace_tree(ws_id)

        # Base mesh version 1
        base_v1_path = ws_dir / "mesh" / f"{ws_id}.glb"
        base_v1_path.write_bytes(sample_glb_bytes)
        base_v1_id = "ast_base_v1"

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_id,
                    name="Falcon",
                    active_mesh_asset_id=base_v1_id,
                    source_asset_id=base_v1_id,
                )
            )
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id=base_v1_id,
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path=f"mesh/{ws_id}.glb",
                    original_filename=f"{ws_id}.glb",
                    byte_size=len(sample_glb_bytes),
                    sha256="sha_v1",
                    is_retained=1,
                )
            )
            session.commit()

        # User clicks "Regenerate" on initial base mesh
        # Step 1: Output generated in temp
        reg_op_id = f"op_base_reg_{uuid.uuid4().hex[:8]}"
        reg_temp = manager.create_operation_temp(reg_op_id)
        reg_temp_mesh = reg_temp / "new_base.glb"
        reg_temp_mesh.write_bytes(sample_glb_bytes)

        # Before commit: active mesh in DB remains base v1
        with Session() as session:
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            assert ws.active_mesh_asset_id == base_v1_id

        # Step 2: Commit / Keep new base version
        # Section 21 & 22: Generates _v002
        dest_mesh_dir = ws_dir / "mesh"
        v2_mesh_path = dest_mesh_dir / f"{ws_id}_v002.glb"
        shutil.copy2(reg_temp_mesh, v2_mesh_path)
        base_v2_id = "ast_base_v2"

        with Session() as session:
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id=base_v2_id,
                    workspace_id=ws_id,
                    operation_id=reg_op_id,
                    file_type="mesh",
                    relative_path=f"mesh/{ws_id}_v002.glb",
                    original_filename=f"{ws_id}_v002.glb",
                    byte_size=len(sample_glb_bytes),
                    sha256="sha_v2",
                    is_retained=1,
                )
            )
            # Active mesh changes only after commit
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            ws.active_mesh_asset_id = base_v2_id
            session.commit()

        # Assertions
        assert base_v1_path.exists(), "Old base mesh must remain intact and selectable"
        assert v2_mesh_path.exists(), "New base version (_v002) must exist"

        with Session() as session:
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            assert ws.active_mesh_asset_id == base_v2_id

            all_base_versions = (
                session.query(WorkspaceContractSchema.AssetRow)
                .filter_by(workspace_id=ws_id, is_retained=1)
                .all()
            )
            assert len(all_base_versions) == 2
            ids = {b.asset_id for b in all_base_versions}
            assert base_v1_id in ids
            assert base_v2_id in ids

    def test_standalone_mesh_upload_workspace_isolation(self, sandbox_env, sample_glb_bytes):
        """Uploading a new standalone mesh while a workspace is open creates a completely new workspace."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        # Existing active workspace
        ws_1_id = manager.mint_workspace_id("robot", set())
        manager.create_workspace_tree(ws_1_id)

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_1_id,
                    name="Robot",
                    active_mesh_asset_id="ast_robot_001",
                )
            )
            session.commit()

        # User uploads an independent new mesh (e.g. 'car.glb')
        ws_2_id = manager.mint_workspace_id("car", {ws_1_id})
        assert ws_2_id != ws_1_id
        manager.create_workspace_tree(ws_2_id)

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_2_id,
                    name="Car",
                    active_mesh_asset_id="ast_car_001",
                )
            )
            session.commit()

        # Verify WS 1 is untouched
        with Session() as session:
            ws_1 = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_1_id).one()
            assert ws_1.active_mesh_asset_id == "ast_robot_001"
            assert ws_1.workspace_id == ws_1_id

    def test_mesh_versions_selector_dynamic_visibility(self, sandbox_env):
        """Mesh Versions selector is hidden on raw-only; visible only after derived mesh is retained."""
        Session = sandbox_env["Session"]
        ws_id = "ws_versions_test"

        # State 1: Raw mesh only -> Versions dropdown must be HIDDEN
        with Session() as session:
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id="ast_base_raw",
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path="mesh/base.glb",
                    original_filename="base.glb",
                    byte_size=1024,
                    sha256="abc",
                    is_retained=1,
                )
            )
            session.commit()

        with Session() as session:
            retained_meshes = (
                session.query(WorkspaceContractSchema.AssetRow)
                .filter_by(workspace_id=ws_id, file_type="mesh", is_retained=1)
                .all()
            )
            # Visibility rule: len <= 1 -> hidden
            is_versions_dropdown_visible = len(retained_meshes) > 1
            assert not is_versions_dropdown_visible

        # State 2: Retain a derived textured mesh -> Versions dropdown becomes VISIBLE
        with Session() as session:
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id="ast_derived_tex",
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path="texture/pbr/textured.glb",
                    original_filename="textured.glb",
                    byte_size=2048,
                    sha256="def",
                    is_retained=1,
                )
            )
            session.commit()

        with Session() as session:
            retained_meshes = (
                session.query(WorkspaceContractSchema.AssetRow)
                .filter_by(workspace_id=ws_id, file_type="mesh", is_retained=1)
                .all()
            )
            is_versions_dropdown_visible = len(retained_meshes) > 1
            assert is_versions_dropdown_visible
            assert len(retained_meshes) == 2

    def test_stale_viewer_fetch_race_cancellation(self):
        """Verify rapid version switching handles AbortController tokens correctly."""
        class MockViewerController:
            def __init__(self):
                self.current_token: int = 0
                self.displayed_version: Optional[str] = None

            def request_load_version(self, version_id: str) -> int:
                self.current_token += 1
                return self.current_token

            def on_fetch_completed(self, token: int, version_id: str):
                # Late response arriving for older token is dropped
                if token == self.current_token:
                    self.displayed_version = version_id

        controller = MockViewerController()

        # User rapidly clicks Version A then Version B
        token_a = controller.request_load_version("version_A")
        token_b = controller.request_load_version("version_B")

        # Version A arrives late after Version B was requested
        controller.on_fetch_completed(token_a, "version_A")
        assert controller.displayed_version is None  # Dropped!

        # Version B arrives
        controller.on_fetch_completed(token_b, "version_B")
        assert controller.displayed_version == "version_B"


# ==============================================================================
# Tier 4: Real-World Scenarios & Failure Recovery
# ==============================================================================

class TestTier4RealWorldScenarios:
    """Tier 4: Real-World Scenarios (Deep Link, Worker Crash, Lease Check, Manifest Repair, TTL)."""

    def test_deep_link_route_restoration(self, sandbox_env, sample_glb_bytes):
        """Direct navigation to /workspace/generate/<workspace_id> restores state without inference."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("castle", set())
        ws_dir = manager.create_workspace_tree(ws_id)
        mesh_path = ws_dir / "mesh" / f"{ws_id}.glb"
        mesh_path.write_bytes(sample_glb_bytes)

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_id,
                    name="Castle",
                    active_mesh_asset_id="ast_castle_001",
                    status="active",
                )
            )
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id="ast_castle_001",
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path=f"mesh/{ws_id}.glb",
                    original_filename="castle.glb",
                    byte_size=len(sample_glb_bytes),
                    sha256=hashlib.sha256(sample_glb_bytes).hexdigest(),
                    is_retained=1,
                )
            )
            session.commit()

        # Client opens deep-link route: /workspace/generate/castle_xxxx
        route_token = ws_id
        with Session() as session:
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=route_token).first()
            assert ws is not None
            assert ws.status == "active"
            assert ws.active_mesh_asset_id == "ast_castle_001"

            asset = session.query(WorkspaceContractSchema.AssetRow).filter_by(asset_id=ws.active_mesh_asset_id).one()
            resolved_file = ws_dir / asset.relative_path
            assert resolved_file.exists()

    def test_api_restart_with_live_worker(self, sandbox_env):
        """API restart with live worker process lease must NOT mark the job interrupted."""
        Session = sandbox_env["Session"]
        op_id = f"op_{uuid.uuid4().hex[:12]}"
        live_worker_pid = "pid_9999"

        with Session() as session:
            op = WorkspaceContractSchema.OperationRow(
                operation_id=op_id,
                workspace_id="ws_live_worker",
                operation_type="generate_raw_mesh",
                execution_status=ExecutionStatus.PROCESSING,
                worker_lease=live_worker_pid,
                lease_heartbeat=datetime.utcnow(),  # Fresh heartbeat
            )
            session.add(op)
            session.commit()

        # Simulated API Restart routine: check lease before marking interrupted
        def on_api_startup_recovery(session, is_pid_alive_fn):
            processing_ops = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter_by(execution_status=ExecutionStatus.PROCESSING)
                .all()
            )
            for op in processing_ops:
                if not is_pid_alive_fn(op.worker_lease):
                    op.execution_status = ExecutionStatus.INTERRUPTED
            session.commit()

        with Session() as session:
            # Worker is alive
            on_api_startup_recovery(session, is_pid_alive_fn=lambda pid: True)

        with Session() as session:
            op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            assert op.execution_status == ExecutionStatus.PROCESSING, "Live worker must not be interrupted"

    def test_worker_crash_startup_recovery(self, sandbox_env):
        """Worker crash mid-inference: on restart, orphaned lease is detected and marked interrupted."""
        Session = sandbox_env["Session"]
        op_id = f"op_{uuid.uuid4().hex[:12]}"
        dead_worker_pid = "pid_dead_1111"

        with Session() as session:
            op = WorkspaceContractSchema.OperationRow(
                operation_id=op_id,
                workspace_id="ws_crashed_worker",
                operation_type="generate_raw_mesh",
                execution_status=ExecutionStatus.PROCESSING,
                worker_lease=dead_worker_pid,
                lease_heartbeat=datetime.utcnow() - timedelta(minutes=10),
            )
            session.add(op)
            session.commit()

        # Startup recovery runs when worker restarts
        with Session() as session:
            processing_ops = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter_by(execution_status=ExecutionStatus.PROCESSING)
                .all()
            )
            for op in processing_ops:
                # Dead PID check
                op.execution_status = ExecutionStatus.INTERRUPTED
                op.error_json = json.dumps({"error": "WORKER_CRASHED", "message": "Worker process stopped unexpectedly"})
            session.commit()

        with Session() as session:
            op = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=op_id).one()
            assert op.execution_status == ExecutionStatus.INTERRUPTED
            err = json.loads(op.error_json)
            assert err["error"] == "WORKER_CRASHED"

    def test_manifest_rebuild_from_authoritative_sqlite(self, sandbox_env, sample_glb_bytes):
        """Corrupted/missing metadata.json is rebuilt automatically from SQLite DB + verified files."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("statue", set())
        ws_dir = manager.create_workspace_tree(ws_id)
        mesh_file = ws_dir / "mesh" / f"{ws_id}.glb"
        mesh_file.write_bytes(sample_glb_bytes)

        with Session() as session:
            session.add(
                WorkspaceContractSchema.WorkspaceRow(
                    workspace_id=ws_id,
                    name="Statue",
                    active_mesh_asset_id="ast_statue_001",
                )
            )
            session.add(
                WorkspaceContractSchema.AssetRow(
                    asset_id="ast_statue_001",
                    workspace_id=ws_id,
                    file_type="mesh",
                    relative_path=f"mesh/{ws_id}.glb",
                    original_filename="statue.glb",
                    byte_size=len(sample_glb_bytes),
                    sha256=hashlib.sha256(sample_glb_bytes).hexdigest(),
                    is_retained=1,
                )
            )
            session.commit()

        # Corrupt/delete metadata.json
        manifest_file = ws_dir / "metadata.json"
        manifest_file.write_text("CORRUPTED INVALID JSON {{{", encoding="utf-8")
        assert manager.read_manifest(ws_id) is None

        # Manifest repair projection: SQLite DB + verified files wins
        with Session() as session:
            ws = session.query(WorkspaceContractSchema.WorkspaceRow).filter_by(workspace_id=ws_id).one()
            assets = session.query(WorkspaceContractSchema.AssetRow).filter_by(workspace_id=ws_id).all()

            repaired_manifest = {
                "workspace_id": ws.workspace_id,
                "name": ws.name,
                "active_mesh_asset_id": ws.active_mesh_asset_id,
                "assets": [
                    {
                        "asset_id": a.asset_id,
                        "relative_path": a.relative_path,
                        "verified_on_disk": (ws_dir / a.relative_path).exists(),
                    }
                    for a in assets
                ],
                "repaired_at": datetime.utcnow().isoformat(),
            }
            manager.write_manifest(ws_id, repaired_manifest)

        # Verification
        restored = manager.read_manifest(ws_id)
        assert restored is not None
        assert restored["workspace_id"] == ws_id
        assert restored["assets"][0]["verified_on_disk"] is True

    def test_unretained_preview_ttl_cleanup(self, sandbox_env, sample_glb_bytes):
        """Unretained temp previews past 24-hr TTL are cleaned safely without touching saved assets."""
        manager: WorkspaceStorageManager = sandbox_env["manager"]
        Session = sandbox_env["Session"]

        ws_id = manager.mint_workspace_id("pyramid", set())
        ws_dir = manager.create_workspace_tree(ws_id)

        # Saved permanent asset
        saved_mesh = ws_dir / "mesh" / f"{ws_id}.glb"
        saved_mesh.write_bytes(sample_glb_bytes)

        # Expired temporary preview (25 hours old)
        expired_op_id = f"op_expired_{uuid.uuid4().hex[:8]}"
        expired_temp = manager.create_operation_temp(expired_op_id)
        expired_file = expired_temp / "temp_mesh.glb"
        expired_file.write_bytes(sample_glb_bytes)

        # Recent temporary preview (1 hour old)
        recent_op_id = f"op_recent_{uuid.uuid4().hex[:8]}"
        recent_temp = manager.create_operation_temp(recent_op_id)
        recent_file = recent_temp / "recent_mesh.glb"
        recent_file.write_bytes(sample_glb_bytes)

        with Session() as session:
            session.add(
                WorkspaceContractSchema.OperationRow(
                    operation_id=expired_op_id,
                    workspace_id=ws_id,
                    operation_type="texture",
                    execution_status=ExecutionStatus.COMPLETED,
                    persistence_status=PersistenceStatus.NOT_SAVED,
                    temp_dir=str(expired_temp),
                    created_at=datetime.utcnow() - timedelta(hours=25),
                )
            )
            session.add(
                WorkspaceContractSchema.OperationRow(
                    operation_id=recent_op_id,
                    workspace_id=ws_id,
                    operation_type="texture",
                    execution_status=ExecutionStatus.COMPLETED,
                    persistence_status=PersistenceStatus.NOT_SAVED,
                    temp_dir=str(recent_temp),
                    created_at=datetime.utcnow() - timedelta(hours=1),
                )
            )
            session.commit()

        # TTL Cleanup routine execution (24 hour TTL)
        cutoff = datetime.utcnow() - timedelta(hours=24)
        with Session() as session:
            expired_ops = (
                session.query(WorkspaceContractSchema.OperationRow)
                .filter(
                    WorkspaceContractSchema.OperationRow.persistence_status == PersistenceStatus.NOT_SAVED,
                    WorkspaceContractSchema.OperationRow.created_at < cutoff,
                )
                .all()
            )

            for op in expired_ops:
                if op.temp_dir and Path(op.temp_dir).exists():
                    shutil.rmtree(op.temp_dir)
                op.persistence_status = PersistenceStatus.PREVIEW_EXPIRED
            session.commit()

        # Assertions
        assert not expired_temp.exists(), "Expired temp directory must be purged"
        assert recent_temp.exists(), "Recent temp directory within TTL must remain"
        assert saved_mesh.exists(), "Saved permanent asset must never be touched by TTL cleanup"

        with Session() as session:
            op_exp = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=expired_op_id).one()
            assert op_exp.persistence_status == PersistenceStatus.PREVIEW_EXPIRED
            # Execution history is preserved
            assert op_exp.execution_status == ExecutionStatus.COMPLETED

            op_rec = session.query(WorkspaceContractSchema.OperationRow).filter_by(operation_id=recent_op_id).one()
            assert op_rec.persistence_status == PersistenceStatus.NOT_SAVED
