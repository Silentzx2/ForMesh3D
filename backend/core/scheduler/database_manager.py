"""
Database manager for job queue persistence using SQLAlchemy.
Handles connection management, transactions, and CRUD operations.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import and_, asc, create_engine, desc, event, func, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.utils.file_utils import get_workspace_storage_manager
from .database_models import (
    Base,
    JobModel,
    JobStatus,
    ExecutionStatus,
    PersistenceStatus,
    WorkspaceModel,
    AssetModel,
    OperationModel,
    generate_workspace_id,
    generate_asset_id,
    generate_operation_id,
    compute_dedupe_fingerprint,
    classify_operation_error,
)

logger = logging.getLogger(__name__)


class ProcessFileLock:
    """Cross-process file lock using fcntl.flock for atomic operation claiming."""

    def __init__(self, lock_path: Optional[Path] = None):
        if lock_path is None:
            data_dir = os.environ.get(
                "DATA_DIR",
                str(Path(__file__).resolve().parents[2] / "storage"),
            )
            lock_path = Path(data_dir) / ".worker_claim.lock"
        self.lock_path = Path(lock_path)
        self.lock_file = None

    def __enter__(self):
        try:
            self.lock_path.parent.mkdir(parents=True, exist_ok=True)
            self.lock_file = open(self.lock_path, "w+")
            import fcntl
            fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX)
        except Exception as e:
            logger.debug("ProcessFileLock lock note: %s", e)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.lock_file:
            try:
                import fcntl
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_UN)
                self.lock_file.close()
            except Exception:
                pass


class DatabaseManager:
    """
    Manages database connections and operations for job queue persistence.
    Provides thread-safe operations with proper transaction handling.
    """

    def __init__(
        self,
        database_url: Optional[str] = None,
        echo: bool = False,
        pool_size: int = 10,
        max_overflow: int = 20,
        pool_pre_ping: bool = True,
    ):
        """
        Initialize database manager.

        Args:
            database_url: Database connection URL. If None, uses SQLite with file storage.
            echo: Whether to echo SQL statements (for debugging)
            pool_size: Number of connections to maintain in the pool
            max_overflow: Maximum number of connections to create beyond pool_size
            pool_pre_ping: Whether to validate connections before use
        """
        self.database_url = database_url or self._get_default_database_url()
        self.echo = echo
        self.pool_size = pool_size
        self.max_overflow = max_overflow
        self.pool_pre_ping = pool_pre_ping

        # Initialize engine and session factory
        self.engine = None
        self.SessionLocal = None
        self._initialized = False

        # Initialize the database
        self._initialize_database()

    def _get_default_database_url(self) -> str:
        """Get default database URL for SQLite."""
        # Create data directory if it doesn't exist
        data_dir = os.environ.get(
            "DATA_DIR",
            str(Path(__file__).resolve().parents[2] / "storage"),
        )
        os.makedirs(data_dir, exist_ok=True)

        # Keep the default SQLite location independent of the process working directory.
        db_path = os.path.join(data_dir, "job_queue.db")
        return f"sqlite:///{db_path}"

    def _initialize_database(self):
        """Initialize database engine and create tables if necessary."""
        try:
            # Create engine based on database type
            if self.database_url.startswith("sqlite"):
                # SQLite specific configuration
                self.engine = create_engine(
                    self.database_url,
                    echo=self.echo,
                    poolclass=StaticPool,
                    connect_args={
                        "check_same_thread": False,
                        "timeout": 30,
                    },
                )

                # API, scheduler and worker processes all write this file.
                # WAL keeps readers unblocked during writes and survives restarts.
                @event.listens_for(self.engine, "connect")
                def _sqlite_pragmas(dbapi_conn, _rec):  # pragma: no cover - driver hook
                    cursor = dbapi_conn.cursor()
                    try:
                        cursor.execute("PRAGMA journal_mode=WAL")
                        cursor.execute("PRAGMA busy_timeout=30000")
                        cursor.execute("PRAGMA synchronous=NORMAL")
                    finally:
                        cursor.close()

            else:
                # PostgreSQL/MySQL configuration
                self.engine = create_engine(
                    self.database_url,
                    echo=self.echo,
                    pool_size=self.pool_size,
                    max_overflow=self.max_overflow,
                    pool_pre_ping=self.pool_pre_ping,
                    pool_recycle=3600,  # Recycle connections after 1 hour
                )

            # Create session factory
            self.SessionLocal = sessionmaker(
                bind=self.engine,
                autocommit=False,
                autoflush=False,
            )

            # Idempotent migration with automated hot backup
            self._init_db()

            self._initialized = True
            logger.info(f"Database initialized successfully: {self.database_url}")

        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise

    def _backup_database_if_exists(self):
        """Create an automated hot backup before schema alteration (Docs/TASKS.md §8.5)."""
        if not self.database_url or not self.database_url.startswith("sqlite:///"):
            return
        db_path_str = self.database_url.replace("sqlite:///", "")
        db_path = Path(db_path_str)
        if db_path.is_file() and db_path.stat().st_size > 0:
            backup_path = db_path.with_name(f"{db_path.name}.bak")
            try:
                src = sqlite3.connect(str(db_path))
                dst = sqlite3.connect(str(backup_path))
                with dst:
                    src.backup(dst)
                dst.close()
                src.close()
                logger.info(f"Automated SQLite hot backup created at {backup_path}")
            except Exception as e:
                try:
                    shutil.copy2(str(db_path), str(backup_path))
                    logger.info(f"Automated hot backup created via copy at {backup_path}")
                except Exception as copy_err:
                    logger.warning(f"Failed to create hot backup for {db_path}: {copy_err}")

    def _init_db(self):
        """
        Idempotent schema migration:
        Automated hot backup, table creation, and index verification.
        """
        self._backup_database_if_exists()
        Base.metadata.create_all(bind=self.engine)

    @contextmanager
    def get_session(self):
        """
        Context manager for database sessions with automatic cleanup.

        Usage:
            with db_manager.get_session() as session:
                # Use session for database operations
                pass
        """
        if not self._initialized:
            raise RuntimeError("Database not initialized")

        session = self.SessionLocal()
        try:
            yield session
        except Exception as e:
            session.rollback()
            logger.error(f"Database session error: {e}")
            raise
        finally:
            session.close()

    def save_job(self, job_request: "JobRequest") -> bool:
        """
        Save or update a job in the database.

        Args:
            job_request: JobRequest instance to save

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.get_session() as session:
                # Check if job already exists
                existing_job = (
                    session.query(JobModel).filter_by(job_id=job_request.job_id).first()
                )

                if existing_job:
                    # Update existing job
                    existing_job.update_from_job_request(job_request)
                    logger.debug(f"Updated job {job_request.job_id} in database")
                else:
                    # Create new job
                    new_job = JobModel.from_job_request(job_request)
                    session.add(new_job)
                    logger.debug(f"Created new job {job_request.job_id} in database")

                session.commit()
                return True

        except SQLAlchemyError as e:
            logger.error(f"Database error saving job {job_request.job_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error saving job {job_request.job_id}: {e}")
            return False

    def find_job_by_source(
        self,
        feature: str,
        image_file_id: str,
        model_preference: Optional[str] = None,
    ) -> Optional[JobModel]:
        """
        Find the most recent job for a given source (image + feature + model).

        Used for idempotent job-id reuse: a failed/interrupted generation for the
        same image+model should resume under its existing job id, while a
        previously completed generation gets a fresh id. image_file_id lives
        inside the inputs JSON column, so candidates are matched in Python for
        DB portability.

        Returns the most recent failed/cancelled job if one exists, else None.
        QUEUED/PROCESSING (in-flight) and COMPLETED jobs are not reused.
        """
        if not image_file_id:
            return None
        try:
            with self.get_session() as session:
                rows = (
                    session.query(JobModel)
                    .filter_by(feature=feature)
                    .order_by(JobModel.created_at.desc())
                    .all()
                )
                for row in rows:
                    inputs = row.inputs
                    if isinstance(inputs, str):
                        try:
                            inputs = json.loads(inputs or "{}")
                        except Exception:
                            inputs = {}
                    if not isinstance(inputs, dict) or inputs.get("image_file_id") != image_file_id:
                        continue
                    if model_preference is not None and row.model_preference != model_preference:
                        continue
                    # Only reuse terminal failure/cancellation states so a retry
                    # after failure resumes the same id; never reuse in-flight or
                    # completed jobs.
                    if row.status not in (JobStatus.FAILED.value, JobStatus.CANCELLED.value):
                        continue
                    return row
                return None
        except SQLAlchemyError as e:
            logger.warning(f"find_job_by_source failed for feature={feature}: {e}")
            return None

    def get_job(self, job_id: str) -> Optional[JobModel]:
        """
        Get a job from the database by ID.

        Args:
            job_id: Job ID to retrieve

        Returns:
            JobModel instance or None if not found
        """
        try:
            with self.get_session() as session:
                job = session.query(JobModel).filter_by(job_id=job_id).first()
                if job:
                    # Detach from session to avoid lazy loading issues
                    session.expunge(job)
                return job

        except SQLAlchemyError as e:
            logger.error(f"Database error getting job {job_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting job {job_id}: {e}")
            return None

    def get_jobs_by_status(self, status: JobStatus) -> List[JobModel]:
        """
        Get all jobs with a specific status.

        Args:
            status: Job status to filter by

        Returns:
            List of JobModel instances
        """
        try:
            with self.get_session() as session:
                jobs = session.query(JobModel).filter_by(status=status.value).all()
                # Detach from session
                for job in jobs:
                    session.expunge(job)
                return jobs

        except SQLAlchemyError as e:
            logger.error(f"Database error getting jobs by status {status}: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error getting jobs by status {status}: {e}")
            return []

    def get_queued_jobs_ordered(self) -> List[JobModel]:
        """
        Get all queued jobs ordered by priority and creation time (FIFO).

        Returns:
            List of JobModel instances ordered for FIFO processing
        """
        try:
            with self.get_session() as session:
                jobs = (
                    session.query(JobModel)
                    .filter_by(status=JobStatus.QUEUED.value)
                    .order_by(desc(JobModel.priority), asc(JobModel.created_at))
                    .all()
                )
                # Detach from session
                for job in jobs:
                    session.expunge(job)
                return jobs

        except SQLAlchemyError as e:
            logger.error(f"Database error getting queued jobs: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error getting queued jobs: {e}")
            return []

    def get_jobs_page(
        self,
        *,
        status: Optional[str] = None,
        feature: Optional[str] = None,
        user_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[List[JobModel], int]:
        """Fetch filtered history directly from storage."""
        with self.get_session() as session:
            query = session.query(JobModel)
            if status:
                query = query.filter(JobModel.status == status)
            if feature:
                query = query.filter(JobModel.feature == feature)
            if user_id:
                query = query.filter(JobModel.user_id == user_id)
            if start_date:
                query = query.filter(JobModel.created_at >= start_date)
            if end_date:
                query = query.filter(JobModel.created_at <= end_date)
            total = query.with_entities(func.count(JobModel.job_id)).scalar() or 0
            jobs = query.order_by(desc(JobModel.created_at)).offset(offset).limit(limit).all()
            for job in jobs:
                session.expunge(job)
            return jobs, total

    def delete_job(self, job_id: str) -> bool:
        """
        Delete a job from the database.

        Args:
            job_id: Job ID to delete

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.get_session() as session:
                job = session.query(JobModel).filter_by(job_id=job_id).first()
                if job:
                    session.delete(job)
                    session.commit()
                    logger.debug(f"Deleted job {job_id} from database")
                    return True
                return False

        except SQLAlchemyError as e:
            logger.error(f"Database error deleting job {job_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error deleting job {job_id}: {e}")
            return False

    def mark_jobs_failed(self, job_ids: List[str], error_message: str) -> int:
        """Mark transient (queued/processing) jobs as failed in one transaction.

        Used at scheduler startup to reconcile rows orphaned by a restart or
        by deletion from the live Redis queue.
        """
        if not job_ids:
            return 0
        try:
            with self.get_session() as session:
                jobs = (
                    session.query(JobModel)
                    .filter(JobModel.job_id.in_(job_ids))
                    .filter(JobModel.status.in_(["queued", "processing"]))
                    .all()
                )
                for job in jobs:
                    job.status = "failed"
                    job.error = error_message
                    job.completed_at = datetime.utcnow()
                session.commit()
                if jobs:
                    logger.info(
                        f"Marked {len(jobs)} orphaned transient jobs as failed"
                    )
                return len(jobs)
        except SQLAlchemyError as e:
            logger.error(f"Database error marking jobs failed: {e}")
            return 0
        except Exception as e:
            logger.error(f"Unexpected error marking jobs failed: {e}")
            return 0

    def cleanup_old_jobs(self, max_completed_jobs: int = 1000) -> int:
        """
        Clean up old completed jobs to prevent database bloat.

        Args:
            max_completed_jobs: Maximum number of completed jobs to keep

        Returns:
            Number of jobs cleaned up
        """
        try:
            with self.get_session() as session:
                # Get count of completed jobs
                completed_statuses = [
                    JobStatus.COMPLETED.value,
                    JobStatus.FAILED.value,
                    JobStatus.CANCELLED.value,
                ]

                total_completed = (
                    session.query(func.count(JobModel.job_id))
                    .filter(JobModel.status.in_(completed_statuses))
                    .scalar()
                )

                if total_completed <= max_completed_jobs:
                    return 0  # No cleanup needed

                # Get IDs of jobs to delete (keep most recent)
                jobs_to_delete = (
                    session.query(JobModel.job_id)
                    .filter(JobModel.status.in_(completed_statuses))
                    .order_by(desc(JobModel.completed_at))
                    .offset(max_completed_jobs)
                    .all()
                )

                job_ids_to_delete = [job.job_id for job in jobs_to_delete]

                # Delete old jobs
                if job_ids_to_delete:
                    deleted_count = (
                        session.query(JobModel)
                        .filter(JobModel.job_id.in_(job_ids_to_delete))
                        .delete(synchronize_session=False)
                    )
                    session.commit()
                    logger.info(f"Cleaned up {deleted_count} old completed jobs")
                    return deleted_count

                return 0

        except SQLAlchemyError as e:
            logger.error(f"Database error cleaning up old jobs: {e}")
            return 0
        except Exception as e:
            logger.error(f"Unexpected error cleaning up old jobs: {e}")
            return 0

    def delete_all_jobs(self) -> int:
        """
        Delete every job row. Used by the database admin clear-all endpoint.

        Returns:
            Number of job rows deleted
        """
        try:
            with self.get_session() as session:
                deleted_count = (
                    session.query(JobModel).delete(synchronize_session=False)
                )
                session.commit()
                if deleted_count:
                    logger.info(f"Deleted all {deleted_count} jobs from the database")
                return deleted_count

        except SQLAlchemyError as e:
            logger.error(f"Database error deleting all jobs: {e}")
            return 0
        except Exception as e:
            logger.error(f"Unexpected error deleting all jobs: {e}")
            return 0

    def get_database_size_bytes(self) -> int:
        """Size of the SQLite database file including WAL sidecars (0 if unknown)."""
        url = getattr(self, "database_url", "") or ""
        if not url.startswith("sqlite:///"):
            return 0
        db_path = Path(url[len("sqlite:///"):])
        total = 0
        for candidate in (db_path, Path(f"{db_path}-wal"), Path(f"{db_path}-shm")):
            try:
                total += candidate.stat().st_size
            except OSError:
                continue
        return total

    def get_queue_statistics(self) -> Dict[str, Any]:
        """
        Get queue statistics from the database.

        Returns:
            Dictionary containing queue statistics
        """
        try:
            with self.get_session() as session:
                # Count jobs by status
                status_counts = {}
                for status in JobStatus:
                    count = (
                        session.query(func.count(JobModel.job_id))
                        .filter_by(status=status.value)
                        .scalar()
                    )
                    status_counts[status.value] = count or 0

                # Get oldest queued job
                oldest_queued = (
                    session.query(JobModel.created_at)
                    .filter_by(status=JobStatus.QUEUED.value)
                    .order_by(asc(JobModel.created_at))
                    .first()
                )

                oldest_queued_time = oldest_queued[0] if oldest_queued else None

                # Calculate queue wait time
                max_wait_time = 0
                if oldest_queued_time:
                    max_wait_time = (
                        datetime.utcnow() - oldest_queued_time
                    ).total_seconds()

                return {
                    "queued_jobs": status_counts.get("queued", 0),
                    "processing_jobs": status_counts.get("processing", 0),
                    "completed_jobs": status_counts.get("completed", 0),
                    "failed_jobs": status_counts.get("failed", 0),
                    "cancelled_jobs": status_counts.get("cancelled", 0),
                    "total_jobs": sum(status_counts.values()),
                    "max_wait_time_seconds": max_wait_time,
                    "oldest_queued_time": oldest_queued_time.isoformat()
                    if oldest_queued_time
                    else None,
                }

        except SQLAlchemyError as e:
            logger.error(f"Database error getting queue statistics: {e}")
            return {}
        except Exception as e:
            logger.error(f"Unexpected error getting queue statistics: {e}")
            return {}

    def get_expired_jobs(self) -> List[JobModel]:
        """
        Get jobs that have exceeded their timeout while processing.

        Returns:
            List of expired JobModel instances
        """
        try:
            with self.get_session() as session:
                current_time = datetime.utcnow()

                # Find processing jobs that have exceeded their timeout
                expired_jobs = (
                    session.query(JobModel)
                    .filter(
                        and_(
                            JobModel.status == JobStatus.PROCESSING.value,
                            JobModel.started_at.isnot(None),
                            func.julianday(current_time)
                            - func.julianday(JobModel.started_at)
                            > JobModel.timeout_seconds
                            / 86400.0,  # Convert seconds to days
                        )
                    )
                    .all()
                )

                # Detach from session
                for job in expired_jobs:
                    session.expunge(job)

                return expired_jobs

        except SQLAlchemyError as e:
            logger.error(f"Database error getting expired jobs: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error getting expired jobs: {e}")
            return []

    def bulk_save_jobs(self, job_requests: List["JobRequest"]) -> bool:
        """
        Save multiple jobs in a single transaction.

        Args:
            job_requests: List of JobRequest instances to save

        Returns:
            True if all jobs saved successfully, False otherwise
        """
        if not job_requests:
            return True

        try:
            with self.get_session() as session:
                job_models = []
                for job_request in job_requests:
                    # Check if job already exists
                    existing_job = (
                        session.query(JobModel)
                        .filter_by(job_id=job_request.job_id)
                        .first()
                    )

                    if existing_job:
                        existing_job.update_from_job_request(job_request)
                    else:
                        new_job = JobModel.from_job_request(job_request)
                        session.add(new_job)

                session.commit()
                logger.debug(f"Bulk saved {len(job_requests)} jobs to database")
                return True

        except SQLAlchemyError as e:
            logger.error(f"Database error bulk saving jobs: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error bulk saving jobs: {e}")
            return False

    def health_check(self) -> bool:
        """
        Check if database connection is healthy.

        Returns:
            True if database is accessible, False otherwise
        """
        try:
            with self.get_session() as session:
                # Simple query to test connection
                session.execute(text("SELECT 1"))
                return True

        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return False

    def close(self):
        """Close database connections and cleanup resources."""
        try:
            if self.engine:
                self.engine.dispose()
                logger.info("Database connections closed")
        except Exception as e:
            logger.error(f"Error closing database: {e}")

    # ==========================================================================
    # Workspace & Asset Helper Methods (Milestone 2: B2-T1)
    # ==========================================================================

    def create_workspace(
        self,
        workspace_id: str,
        name: str,
        active_mesh_asset_id: Optional[str] = None,
        source_asset_id: Optional[str] = None,
        settings_json: Optional[str] = None,
    ) -> WorkspaceModel:
        """Create or update a workspace record idempotently."""
        with self.get_session() as session:
            ws = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first()
            now = datetime.utcnow()
            if ws:
                ws.name = name
                if active_mesh_asset_id is not None:
                    ws.active_mesh_asset_id = active_mesh_asset_id
                if source_asset_id is not None:
                    ws.source_asset_id = source_asset_id
                if settings_json is not None:
                    ws.settings_json = settings_json
                ws.updated_at = now
            else:
                ws = WorkspaceModel(
                    workspace_id=workspace_id,
                    name=name,
                    active_mesh_asset_id=active_mesh_asset_id,
                    source_asset_id=source_asset_id,
                    status="active",
                    settings_json=settings_json,
                    created_at=now,
                    updated_at=now,
                )
                session.add(ws)
            session.commit()
            session.refresh(ws)
            session.expunge(ws)
            return ws

    def get_workspace(self, workspace_id: str) -> Optional[WorkspaceModel]:
        """Fetch a workspace record by workspace_id."""
        with self.get_session() as session:
            ws = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first()
            if ws:
                session.expunge(ws)
            return ws

    def update_workspace_active_mesh(self, workspace_id: str, active_mesh_asset_id: str) -> bool:
        """Update active_mesh_asset_id for a workspace."""
        with self.get_session() as session:
            ws = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first()
            if not ws:
                return False
            ws.active_mesh_asset_id = active_mesh_asset_id
            ws.updated_at = datetime.utcnow()
            session.commit()
            return True

    def add_asset(
        self,
        asset_id: str,
        workspace_id: str,
        file_type: str,
        relative_path: str,
        original_filename: str,
        byte_size: int,
        sha256: str,
        thumbnail_path: Optional[str] = None,
        operation_id: Optional[str] = None,
        is_retained: bool = True,
        status: str = "available",
    ) -> AssetModel:
        """Add or update an asset record."""
        with self.get_session() as session:
            asset = session.query(AssetModel).filter_by(asset_id=asset_id).first()
            now = datetime.utcnow()
            if asset:
                asset.workspace_id = workspace_id
                asset.operation_id = operation_id
                asset.file_type = file_type
                asset.relative_path = relative_path
                asset.original_filename = original_filename
                asset.byte_size = byte_size
                asset.sha256 = sha256
                if thumbnail_path is not None:
                    asset.thumbnail_path = thumbnail_path
                asset.is_retained = 1 if is_retained else 0
                asset.status = status
            else:
                asset = AssetModel(
                    asset_id=asset_id,
                    workspace_id=workspace_id,
                    operation_id=operation_id,
                    file_type=file_type,
                    relative_path=relative_path,
                    original_filename=original_filename,
                    byte_size=byte_size,
                    sha256=sha256,
                    thumbnail_path=thumbnail_path,
                    is_retained=1 if is_retained else 0,
                    status=status,
                    created_at=now,
                )
                session.add(asset)
            session.commit()
            session.refresh(asset)
            session.expunge(asset)
            return asset

    def get_asset(self, asset_id: str) -> Optional[AssetModel]:
        """Fetch an asset record by asset_id."""
        with self.get_session() as session:
            asset = session.query(AssetModel).filter_by(asset_id=asset_id).first()
            if asset:
                session.expunge(asset)
            return asset

    def list_workspace_assets(self, workspace_id: str, file_type: Optional[str] = None) -> List[AssetModel]:
        """List all assets belonging to a workspace, optionally filtered by file_type."""
        with self.get_session() as session:
            query = session.query(AssetModel).filter_by(workspace_id=workspace_id)
            if file_type:
                query = query.filter_by(file_type=file_type)
            assets = query.order_by(asc(AssetModel.created_at)).all()
            for a in assets:
                session.expunge(a)
            return assets

    # ==========================================================================
    # Operation Lifecycle & Dual State Machine Methods (Milestone 3: Batch 3)
    # ==========================================================================

    def count_queued_operations(self) -> int:
        """Count active operations in queued status."""
        with self.get_session() as session:
            return (
                session.query(OperationModel)
                .filter_by(execution_status=ExecutionStatus.QUEUED)
                .count()
            )

    def find_active_operation(
        self,
        workspace_id: str,
        input_asset_id: Optional[str],
        operation_type: str,
        settings: Optional[Dict[str, Any]] = None,
    ) -> Optional[OperationModel]:
        """Find an in-flight operation (queued or processing) matching deduplication fingerprint."""
        target_fp = compute_dedupe_fingerprint(workspace_id, input_asset_id, operation_type, settings)
        with self.get_session() as session:
            candidates = (
                session.query(OperationModel)
                .filter(
                    OperationModel.workspace_id == workspace_id,
                    OperationModel.operation_type == operation_type,
                    OperationModel.execution_status.in_(
                        [ExecutionStatus.QUEUED, ExecutionStatus.PROCESSING]
                    ),
                )
                .all()
            )
            for op in candidates:
                op_input = op.input_asset_id or None
                target_input = input_asset_id or None
                if op_input != target_input:
                    continue
                op_settings = {}
                if op.settings_snapshot:
                    try:
                        op_settings = json.loads(op.settings_snapshot)
                    except Exception:
                        op_settings = {}
                op_fp = compute_dedupe_fingerprint(op.workspace_id, op.input_asset_id, op.operation_type, op_settings)
                if op_fp == target_fp:
                    session.expunge(op)
                    return op
        return None

    def enqueue_operation(
        self,
        operation_id: str,
        workspace_id: str,
        operation_type: str,
        input_asset_id: Optional[str] = None,
        parent_operation_id: Optional[str] = None,
        settings: Optional[Dict[str, Any]] = None,
        temp_dir: Optional[str] = None,
        queue_cap: int = 10,
        regenerate: bool = False,
    ) -> Tuple[OperationModel, bool]:
        """
        Enqueue an operation into SQLite FIFO queue:
        - Deduplication: returns existing in-flight operation if identical and not regenerating.
        - Queue cap: rejects with RuntimeError("QUEUE_FULL") if queued count >= queue_cap.
        - Immutable snapshot: settings_snapshot frozen at queue time.
        Returns: (OperationModel, is_new: bool)
        """
        if not regenerate and not parent_operation_id:
            active_op = self.find_active_operation(workspace_id, input_asset_id, operation_type, settings)
            if active_op:
                logger.info(
                    "Deduplication matched existing active operation %s for workspace %s",
                    active_op.operation_id,
                    workspace_id,
                )
                return active_op, False

        with ProcessFileLock():
            queued_count = self.count_queued_operations()
            if queued_count >= queue_cap:
                raise RuntimeError(f"QUEUE_FULL: Queue capacity limit ({queue_cap}) reached")

            settings_json = json.dumps(settings or {})
            now = datetime.utcnow()
            op = OperationModel(
                operation_id=operation_id,
                workspace_id=workspace_id,
                input_asset_id=input_asset_id,
                parent_operation_id=parent_operation_id,
                operation_type=operation_type,
                execution_status=ExecutionStatus.QUEUED,
                persistence_status=PersistenceStatus.NOT_SAVED,
                progress=0.0,
                worker_lease=None,
                lease_heartbeat=None,
                settings_snapshot=settings_json,
                temp_dir=temp_dir,
                result_json=None,
                error_json=None,
                created_at=now,
                completed_at=None,
            )
            with self.get_session() as session:
                session.add(op)
                session.commit()
                session.refresh(op)
                session.expunge(op)
                logger.info(
                    "Enqueued operation %s for workspace %s (%s)",
                    operation_id,
                    workspace_id,
                    operation_type,
                )
                return op, True

    def get_operation(self, operation_id: str) -> Optional[OperationModel]:
        """Fetch an operation by operation_id."""
        with self.get_session() as session:
            op = session.query(OperationModel).filter_by(operation_id=operation_id).first()
            if op:
                session.expunge(op)
            return op

    def list_workspace_operations(self, workspace_id: str) -> List[OperationModel]:
        """List all operations for a given workspace ordered by creation time."""
        with self.get_session() as session:
            ops = (
                session.query(OperationModel)
                .filter_by(workspace_id=workspace_id)
                .order_by(asc(OperationModel.created_at))
                .all()
            )
            for op in ops:
                session.expunge(op)
            return ops

    def claim_next_operation(self, worker_lease: str) -> Optional[OperationModel]:
        """
        Atomically claim the oldest queued operation using process lock and conditional update.
        """
        with ProcessFileLock():
            with self.get_session() as session:
                op = (
                    session.query(OperationModel)
                    .filter_by(execution_status=ExecutionStatus.QUEUED)
                    .order_by(asc(OperationModel.created_at))
                    .first()
                )
                if not op:
                    return None
                now = datetime.utcnow()
                rows_updated = (
                    session.query(OperationModel)
                    .filter_by(
                        operation_id=op.operation_id,
                        execution_status=ExecutionStatus.QUEUED,
                    )
                    .update(
                        {
                            "execution_status": ExecutionStatus.PROCESSING,
                            "worker_lease": worker_lease,
                            "lease_heartbeat": now,
                        }
                    )
                )
                session.commit()
                if rows_updated == 1:
                    session.refresh(op)
                    session.expunge(op)
                    logger.info("Worker %s claimed operation %s", worker_lease, op.operation_id)
                    return op
                return None

    def update_operation_execution_status(
        self,
        operation_id: str,
        new_status: str,
        worker_lease: Optional[str] = None,
        progress: Optional[float] = None,
        result: Optional[Any] = None,
        error: Optional[Any] = None,
    ) -> bool:
        """
        Update execution status with strict state machine validation and terminal immutability.
        """
        with self.get_session() as session:
            op = session.query(OperationModel).filter_by(operation_id=operation_id).first()
            if not op:
                return False

            current = op.execution_status
            if new_status != current:
                allowed = ExecutionStatus.ALLOWED_TRANSITIONS.get(current, set())
                if new_status not in allowed:
                    raise ValueError(
                        f"Illegal execution state transition: {current} -> {new_status}"
                    )
                op.execution_status = new_status

            now = datetime.utcnow()
            if worker_lease is not None:
                op.worker_lease = worker_lease
                op.lease_heartbeat = now
            elif new_status == ExecutionStatus.PROCESSING:
                op.lease_heartbeat = now

            if progress is not None:
                op.progress = float(progress)

            if new_status == ExecutionStatus.COMPLETED:
                op.progress = 1.0
                op.completed_at = now
                if result is not None:
                    op.result_json = json.dumps(result)
            elif new_status in (
                ExecutionStatus.FAILED,
                ExecutionStatus.INTERRUPTED,
                ExecutionStatus.CANCELLED,
            ):
                op.completed_at = now
                if error is not None:
                    structured = classify_operation_error(error)
                    op.error_json = json.dumps(structured)

            session.commit()
            return True

    def update_operation_persistence_status(
        self,
        operation_id: str,
        new_status: str,
    ) -> bool:
        """
        Update persistence status with strict state machine validation and terminal immutability.
        """
        with self.get_session() as session:
            op = session.query(OperationModel).filter_by(operation_id=operation_id).first()
            if not op:
                return False

            current = op.persistence_status
            if new_status != current:
                allowed = PersistenceStatus.ALLOWED_TRANSITIONS.get(current, set())
                if new_status not in allowed:
                    raise ValueError(
                        f"Illegal persistence state transition: {current} -> {new_status}"
                    )
                op.persistence_status = new_status

            session.commit()
            return True

    def keep_operation_in_workspace(
        self,
        operation_id: str,
        storage_manager: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Keep in Workspace lifecycle transition:
        - Transitions persistence_status from not_saved -> saving -> saved.
        - Stages and publishes temp output files to permanent tool folder.
        - Registers asset in SQLite assets table (is_retained = 1).
        - Updates active mesh asset in workspace.
        - Re-projects metadata.json atomically.
        """
        mgr = storage_manager or get_workspace_storage_manager()
        op = self.get_operation(operation_id)
        if not op:
            raise ValueError(f"Operation {operation_id} not found")
        if op.execution_status != ExecutionStatus.COMPLETED:
            raise ValueError(
                f"Cannot keep uncompleted operation (current status: {op.execution_status})"
            )

        self.update_operation_persistence_status(operation_id, PersistenceStatus.SAVING)

        try:
            ws_dir = mgr.get_workspace_dir(op.workspace_id)
            temp_dir = Path(op.temp_dir) if op.temp_dir else mgr.get_temp_dir() / operation_id
            if not temp_dir.exists():
                raise FileNotFoundError(f"Operation temp directory {temp_dir} does not exist")

            mesh_candidates = list(temp_dir.glob("*.glb")) + list(temp_dir.glob("*.obj"))
            if not mesh_candidates:
                raise FileNotFoundError(f"No mesh output found in {temp_dir}")
            temp_mesh_path = mesh_candidates[0]
            temp_thumb_path = temp_dir / "thumbnail.png"
            if not temp_thumb_path.exists():
                temp_thumb_path = None

            pub_res = mgr.publish_derived_mesh(
                workspace_id=op.workspace_id,
                operation_type=op.operation_type,
                temp_mesh_path=temp_mesh_path,
                temp_thumbnail_path=temp_thumb_path,
            )

            new_asset_id = generate_asset_id()
            mesh_file = pub_res["mesh_path"]
            mesh_bytes = mesh_file.read_bytes()
            sha = hashlib.sha256(mesh_bytes).hexdigest()

            asset = self.add_asset(
                asset_id=new_asset_id,
                workspace_id=op.workspace_id,
                file_type="mesh",
                relative_path=pub_res["relative_mesh_path"],
                original_filename=mesh_file.name,
                byte_size=len(mesh_bytes),
                sha256=sha,
                thumbnail_path=pub_res["relative_thumbnail_path"],
                operation_id=operation_id,
                is_retained=True,
                status="available",
            )

            self.update_workspace_active_mesh(op.workspace_id, new_asset_id)
            mgr.build_manifest_projection(op.workspace_id, self)
            self.update_operation_persistence_status(operation_id, PersistenceStatus.SAVED)

            return {
                "operation_id": operation_id,
                "asset_id": new_asset_id,
                "relative_mesh_path": pub_res["relative_mesh_path"],
                "relative_thumbnail_path": pub_res["relative_thumbnail_path"],
                "mesh_path": str(pub_res["mesh_path"]),
            }
        except Exception as e:
            logger.error("Failed to keep operation %s in workspace: %s", operation_id, e)
            try:
                self.update_operation_persistence_status(
                    operation_id, PersistenceStatus.SAVE_FAILED
                )
            except Exception:
                pass
            raise

    def discard_operation_preview(
        self,
        operation_id: str,
        storage_manager: Optional[Any] = None,
    ) -> bool:
        """
        Discard preview:
        - Validates transition to discarded.
        - Purges storage/temp/<operation_id>/ without touching saved assets.
        - Sets persistence_status = discarded.
        """
        op = self.get_operation(operation_id)
        if not op:
            return False

        self.update_operation_persistence_status(operation_id, PersistenceStatus.DISCARDED)

        temp_dir_path = None
        if op.temp_dir:
            temp_dir_path = Path(op.temp_dir)
        else:
            mgr = storage_manager or get_workspace_storage_manager()
            temp_dir_path = mgr.get_temp_dir() / operation_id

        if temp_dir_path and temp_dir_path.exists():
            try:
                resolved = temp_dir_path.resolve()
                if "temp" in resolved.parts:
                    shutil.rmtree(resolved)
            except Exception as e:
                logger.warning("Error purging discarded temp dir %s: %s", temp_dir_path, e)

        return True

    def recover_orphaned_operations(
        self,
        is_pid_alive_fn: Optional[Any] = None,
    ) -> int:
        """
        Startup recovery: check active worker lease before marking operations interrupted.
        If worker lease PID is alive, leaves it in processing.
        If dead or missing, marks INTERRUPTED with structured WORKER_CRASHED error.
        """
        def _default_pid_alive(lease: Optional[str]) -> bool:
            if not lease:
                return False
            pid_digits = re.sub(r"[^\d]", "", lease)
            if not pid_digits:
                return False
            try:
                pid = int(pid_digits)
                os.kill(pid, 0)
                return True
            except ProcessLookupError:
                return False
            except PermissionError:
                return True
            except OSError:
                return False

        check_fn = is_pid_alive_fn or _default_pid_alive
        interrupted_count = 0

        with self.get_session() as session:
            processing_ops = (
                session.query(OperationModel)
                .filter_by(execution_status=ExecutionStatus.PROCESSING)
                .all()
            )
            for op in processing_ops:
                if not op.worker_lease or not check_fn(op.worker_lease):
                    op.execution_status = ExecutionStatus.INTERRUPTED
                    op.completed_at = datetime.utcnow()
                    op.error_json = json.dumps(
                        classify_operation_error(
                            "WORKER_CRASHED: Worker process stopped unexpectedly"
                        )
                    )
                    interrupted_count += 1
                    logger.warning(
                        "Orphaned operation %s (lease: %s) marked INTERRUPTED on startup recovery",
                        op.operation_id,
                        op.worker_lease,
                    )
            session.commit()
        return interrupted_count

    def cleanup_expired_previews(self, ttl_hours: int = 24) -> int:
        """
        Purge temporary preview directories older than TTL for unretained operations.
        Never touches saved assets. Transitions persistence_status to preview_expired.
        """
        cutoff = datetime.utcnow() - timedelta(hours=ttl_hours)
        expired_count = 0

        with self.get_session() as session:
            expired_ops = (
                session.query(OperationModel)
                .filter(
                    OperationModel.persistence_status == PersistenceStatus.NOT_SAVED,
                    OperationModel.created_at < cutoff,
                )
                .all()
            )
            for op in expired_ops:
                if op.temp_dir and Path(op.temp_dir).exists():
                    try:
                        resolved = Path(op.temp_dir).resolve()
                        if "temp" in resolved.parts:
                            shutil.rmtree(resolved)
                    except Exception as e:
                        logger.warning("Failed to remove expired temp %s: %s", op.temp_dir, e)
                op.persistence_status = PersistenceStatus.PREVIEW_EXPIRED
                expired_count += 1
            session.commit()
        return expired_count


