"""
Database models for job queue persistence using SQLAlchemy.
"""

import hashlib
import json
import re
import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional, Set

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.types import TypeDecorator

Base = declarative_base()


class JobStatus(Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExecutionStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"


ExecutionStatus.ALLOWED_TRANSITIONS = {
    ExecutionStatus.QUEUED: {ExecutionStatus.PROCESSING, ExecutionStatus.CANCELLED},
    ExecutionStatus.PROCESSING: {
        ExecutionStatus.COMPLETED,
        ExecutionStatus.FAILED,
        ExecutionStatus.INTERRUPTED,
        ExecutionStatus.CANCELLED,
    },
    ExecutionStatus.COMPLETED: set(),
    ExecutionStatus.FAILED: set(),
    ExecutionStatus.INTERRUPTED: set(),
    ExecutionStatus.CANCELLED: set(),
}


class PersistenceStatus(str, Enum):
    NOT_SAVED = "not_saved"
    SAVING = "saving"
    SAVED = "saved"
    SAVE_FAILED = "save_failed"
    DISCARDED = "discarded"
    CLEANUP_PENDING = "cleanup_pending"
    PREVIEW_EXPIRED = "preview_expired"


PersistenceStatus.ALLOWED_TRANSITIONS = {
    PersistenceStatus.NOT_SAVED: {
        PersistenceStatus.SAVING,
        PersistenceStatus.DISCARDED,
        PersistenceStatus.CLEANUP_PENDING,
        PersistenceStatus.PREVIEW_EXPIRED,
    },
    PersistenceStatus.SAVING: {
        PersistenceStatus.SAVED,
        PersistenceStatus.SAVE_FAILED,
        PersistenceStatus.CLEANUP_PENDING,
    },
    PersistenceStatus.SAVED: set(),
    PersistenceStatus.SAVE_FAILED: {
        PersistenceStatus.SAVING,
        PersistenceStatus.DISCARDED,
        PersistenceStatus.CLEANUP_PENDING,
    },
    PersistenceStatus.DISCARDED: set(),
    PersistenceStatus.CLEANUP_PENDING: {PersistenceStatus.DISCARDED},
    PersistenceStatus.PREVIEW_EXPIRED: set(),
}


class JSONType(TypeDecorator):
    """Custom SQLAlchemy type for JSON fields that works with multiple databases."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            return json.dumps(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return json.loads(value)
        return value


class JobModel(Base):
    """SQLAlchemy model for persisting job requests."""

    __tablename__ = "jobs"

    # Primary key
    job_id = Column(String(64), primary_key=True)

    # Job definition
    feature = Column(String(100), nullable=False, index=True)
    inputs = Column(JSONType, nullable=False)
    model_preference = Column(String(100), nullable=True)
    priority = Column(Integer, nullable=False, default=1, index=True)
    timeout_seconds = Column(Integer, nullable=False, default=3600)
    job_metadata = Column(JSONType, nullable=True)
    user_id = Column(String(100), nullable=True, index=True)  # User who submitted the job

    # Status tracking
    status = Column(String(20), nullable=False, default="queued", index=True)
    progress = Column(Float, nullable=False, default=0.0)
    assigned_model = Column(String(100), nullable=True)

    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # Results
    result = Column(JSONType, nullable=True)
    error = Column(Text, nullable=True)

    # Retry tracking
    retry_count = Column(Integer, nullable=False, default=0)
    max_retries = Column(Integer, nullable=False, default=4)
    last_retry_at = Column(DateTime, nullable=True)
    retry_reason = Column(String(500), nullable=True)

    # Add indexes for common queries
    __table_args__ = (
        Index("idx_jobs_status_created", "status", "created_at"),
        Index("idx_jobs_status_priority", "status", "priority", "created_at"),
        Index("idx_jobs_feature_status", "feature", "status"),
        Index("idx_jobs_completed_at", "completed_at"),
        Index("idx_jobs_user_id_created", "user_id", "created_at"),
    )

    def to_dict(self) -> Dict[str, Any]:
        """Convert database model to dictionary."""
        return {
            "job_id": self.job_id,
            "feature": self.feature,
            "inputs": self.inputs,
            "model_preference": self.model_preference,
            "priority": self.priority,
            "timeout_seconds": self.timeout_seconds,
            "metadata": self.job_metadata or {},
            "user_id": self.user_id,
            "status": self.status,
            "progress": self.progress,
            "assigned_model": self.assigned_model,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat()
            if self.started_at is not None
            else None,
            "completed_at": self.completed_at.isoformat()
            if self.completed_at is not None
            else None,
            "result": self.result,
            "error": self.error,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "last_retry_at": self.last_retry_at.isoformat()
            if self.last_retry_at is not None
            else None,
            "retry_reason": self.retry_reason,
        }

    @classmethod
    def from_job_request(cls, job_request) -> "JobModel":
        """Create JobModel from JobRequest instance."""
        return cls(
            job_id=job_request.job_id,
            feature=job_request.feature,
            inputs=job_request.inputs,
            model_preference=job_request.model_preference,
            priority=job_request.priority,
            timeout_seconds=job_request.timeout_seconds,
            job_metadata=job_request.metadata,
            user_id=job_request.user_id,
            status=job_request.status.value,
            progress=job_request.progress,
            assigned_model=job_request.assigned_model,
            created_at=job_request.created_at,
            started_at=job_request.started_at,
            completed_at=job_request.completed_at,
            result=job_request.result,
            error=job_request.error,
            retry_count=job_request.retry_count,
            max_retries=job_request.max_retries,
            last_retry_at=job_request.last_retry_at,
            retry_reason=job_request.retry_reason,
        )

    def update_from_job_request(self, job_request):
        """Update model fields from JobRequest instance."""
        self.feature = job_request.feature
        self.inputs = job_request.inputs
        self.model_preference = job_request.model_preference
        self.priority = job_request.priority
        self.timeout_seconds = job_request.timeout_seconds
        self.job_metadata = job_request.metadata
        self.user_id = job_request.user_id
        self.status = job_request.status.value
        self.progress = job_request.progress
        self.assigned_model = job_request.assigned_model
        self.created_at = job_request.created_at
        self.started_at = job_request.started_at
        self.completed_at = job_request.completed_at
        self.result = job_request.result
        self.error = job_request.error
        self.retry_count = job_request.retry_count
        self.max_retries = job_request.max_retries
        self.last_retry_at = job_request.last_retry_at
        self.retry_reason = job_request.retry_reason


# ==============================================================================
# Workspace-Centric Storage & Identity Models (Docs/TASKS.md §8, §21, §22)
# ==============================================================================

class WorkspaceModel(Base):
    """SQLAlchemy model for workspaces table."""

    __tablename__ = "workspaces"

    workspace_id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    active_mesh_asset_id = Column(String(64), nullable=True)
    source_asset_id = Column(String(64), nullable=True)
    status = Column(String(32), nullable=False, default="active", index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    settings_json = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_workspaces_status_created", "status", "created_at"),
    )

    def to_dict(self) -> Dict[str, Any]:
        settings = {}
        if self.settings_json:
            try:
                settings = json.loads(self.settings_json)
            except Exception:
                settings = {}
        return {
            "workspace_id": self.workspace_id,
            "name": self.name,
            "active_mesh_asset_id": self.active_mesh_asset_id,
            "source_asset_id": self.source_asset_id,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "settings": settings,
        }


class AssetModel(Base):
    """SQLAlchemy model for assets table."""

    __tablename__ = "assets"

    asset_id = Column(String(64), primary_key=True)
    workspace_id = Column(String(64), nullable=False, index=True)
    operation_id = Column(String(64), nullable=True, index=True)
    file_type = Column(String(32), nullable=False)
    relative_path = Column(String(512), nullable=False)
    original_filename = Column(String(256), nullable=False)
    byte_size = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    thumbnail_path = Column(String(512), nullable=True)
    is_retained = Column(Integer, nullable=False, default=1, server_default="1")
    status = Column(String(32), nullable=True, default="available", server_default="available", index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_assets_workspace_created", "workspace_id", "created_at"),
        Index("idx_assets_status_created", "status", "created_at"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "workspace_id": self.workspace_id,
            "operation_id": self.operation_id,
            "file_type": self.file_type,
            "relative_path": self.relative_path,
            "original_filename": self.original_filename,
            "byte_size": self.byte_size,
            "sha256": self.sha256,
            "thumbnail_path": self.thumbnail_path,
            "is_retained": bool(self.is_retained),
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class OperationModel(Base):
    """SQLAlchemy model for operations table."""

    __tablename__ = "operations"

    operation_id = Column(String(64), primary_key=True)
    workspace_id = Column(String(64), nullable=False, index=True)
    input_asset_id = Column(String(64), nullable=True)
    parent_operation_id = Column(String(64), nullable=True)
    operation_type = Column(String(64), nullable=False)
    execution_status = Column(String(32), nullable=False, default="queued", index=True)
    persistence_status = Column(String(32), nullable=False, default="not_saved", index=True)
    progress = Column(Float, nullable=False, default=0.0)
    worker_lease = Column(String(64), nullable=True)
    lease_heartbeat = Column(DateTime, nullable=True)
    settings_snapshot = Column(Text, nullable=True)
    temp_dir = Column(String(512), nullable=True)
    result_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_operations_workspace_created", "workspace_id", "created_at"),
        Index("idx_operations_exec_status", "execution_status"),
        Index("idx_operations_persist_status", "persistence_status"),
    )

    def to_dict(self) -> Dict[str, Any]:
        settings = {}
        if self.settings_snapshot:
            try:
                settings = json.loads(self.settings_snapshot)
            except Exception:
                settings = {}
        result = None
        if self.result_json:
            try:
                result = json.loads(self.result_json)
            except Exception:
                result = None
        error = None
        if self.error_json:
            try:
                error = json.loads(self.error_json)
            except Exception:
                error = None
        return {
            "operation_id": self.operation_id,
            "workspace_id": self.workspace_id,
            "input_asset_id": self.input_asset_id,
            "parent_operation_id": self.parent_operation_id,
            "operation_type": self.operation_type,
            "execution_status": self.execution_status,
            "persistence_status": self.persistence_status,
            "progress": self.progress,
            "worker_lease": self.worker_lease,
            "lease_heartbeat": self.lease_heartbeat.isoformat() if self.lease_heartbeat else None,
            "settings": settings,
            "temp_dir": self.temp_dir,
            "result": result,
            "error": error,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


# ==============================================================================
# ID Format Generators (Docs/TASKS.md §21 & §22)
# ==============================================================================

def generate_workspace_id(name: str, existing_ids: Optional[Set[str]] = None) -> str:
    """Generate collision-safe workspace identifier <name>_<short-hash>."""
    clean = re.sub(r"[^a-zA-Z0-9_-]", "_", name).strip("_").lower()[:32] or "workspace"
    existing = existing_ids or set()
    while True:
        short_hash = hashlib.sha256(f"{clean}:{time.time_ns()}:{uuid.uuid4().hex}".encode()).hexdigest()[:6]
        candidate = f"{clean}_{short_hash}"
        if candidate not in existing:
            return candidate


def generate_asset_id() -> str:
    """Generate canonical asset identifier ast_<12hex>."""
    return f"ast_{uuid.uuid4().hex[:12]}"


def generate_operation_id() -> str:
    """Generate canonical operation identifier op_<12hex>."""
    return f"op_{uuid.uuid4().hex[:12]}"


def compute_dedupe_fingerprint(
    workspace_id: str,
    input_asset_id: Optional[str],
    operation_type: str,
    settings: Optional[Dict[str, Any]] = None,
) -> str:
    """Compute deterministic deduplication fingerprint for in-flight operations."""
    settings_dict = settings or {}
    payload = f"{workspace_id}:{input_asset_id or ''}:{operation_type}:{json.dumps(settings_dict, sort_keys=True)}"
    return hashlib.sha256(payload.encode()).hexdigest()


def classify_operation_error(error: Any) -> Dict[str, Any]:
    """
    Classify error into structured representation (code, message, retryable).
    """
    if isinstance(error, dict):
        code = error.get("code") or error.get("error") or "UNKNOWN_ERROR"
        msg = error.get("message") or str(error)
        retryable = error.get("retryable", False)
        return {"code": code, "error": code, "message": msg, "retryable": retryable}

    err_str = str(error) if error else "Unknown error"
    lower = err_str.lower()

    if "cuda out of memory" in lower or "oom" in lower:
        return {"code": "CUDA_OOM", "error": "CUDA_OOM", "message": err_str, "retryable": True}
    if "insufficient vram" in lower or ("vram" in lower and "requirement" in lower):
        return {"code": "INSUFFICIENT_VRAM", "error": "INSUFFICIENT_VRAM", "message": err_str, "retryable": False}
    if "weights" in lower or "checkpoint" in lower or "model load" in lower:
        return {"code": "MODEL_NOT_READY", "error": "MODEL_NOT_READY", "message": err_str, "retryable": True}
    if "input" in lower and ("not found" in lower or "missing" in lower):
        return {"code": "INPUT_NOT_FOUND", "error": "INPUT_NOT_FOUND", "message": err_str, "retryable": False}
    if "timeout" in lower:
        return {"code": "JOB_TIMEOUT", "error": "JOB_TIMEOUT", "message": err_str, "retryable": True}
    if "cancel" in lower:
        return {"code": "JOB_CANCELLED", "error": "JOB_CANCELLED", "message": err_str, "retryable": False}
    if "queue_full" in lower or "queue is full" in lower:
        return {"code": "QUEUE_FULL", "error": "QUEUE_FULL", "message": err_str, "retryable": True}
    if "worker_crashed" in lower or "stopped unexpectedly" in lower:
        return {"code": "WORKER_CRASHED", "error": "WORKER_CRASHED", "message": err_str, "retryable": True}
    if "validation" in lower:
        return {"code": "VALIDATION_FAILED", "error": "VALIDATION_FAILED", "message": err_str, "retryable": False}

    return {"code": "OPERATION_FAILED", "error": "OPERATION_FAILED", "message": err_str, "retryable": False}


