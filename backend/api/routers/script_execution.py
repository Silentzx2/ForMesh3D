"""Background execution for deterministic workspace Script operations.

Script work is recorded in SQLite before it starts. The canonical API returns
an operation ID immediately; clients poll the operation record and can cancel
it without touching the model scheduler.
"""
from __future__ import annotations

import hashlib
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from fastapi import BackgroundTasks, HTTPException

from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import ExecutionStatus, PersistenceStatus, generate_operation_id
from core.utils.file_utils import WorkspaceStorageManager

logger = logging.getLogger(__name__)


class ScriptOperationCancelled(Exception):
    """Raised by a pipeline progress checkpoint after a cancel request."""


def _execute_script_operation_task(
    *,
    db: DatabaseManager,
    storage: WorkspaceStorageManager,
    operation_id: str,
    input_path: str,
    output_path: str,
    pipeline: Callable[..., Dict[str, Any]],
    options: Dict[str, Any],
    output_format: str,
) -> None:
    """Run a pipeline in FastAPI's background-task thread and persist directly to workspace."""
    operation = db.get_operation(operation_id)
    if not operation:
        return
    if operation.execution_status == ExecutionStatus.CANCELLED:
        Path(output_path).unlink(missing_ok=True)
        return
    if operation.execution_status != ExecutionStatus.QUEUED:
        return

    try:
        db.update_operation_execution_status(
            operation_id, ExecutionStatus.PROCESSING, progress=0.01
        )

        def report_progress(message: str, progress: float) -> None:
            current = db.get_operation(operation_id)
            if not current or current.execution_status == ExecutionStatus.CANCELLED:
                raise ScriptOperationCancelled("Operation cancelled by user")
            if current.execution_status != ExecutionStatus.PROCESSING:
                raise ScriptOperationCancelled("Operation is no longer processing")
            db.update_operation_execution_status(
                operation_id,
                ExecutionStatus.PROCESSING,
                progress=max(0.01, min(0.95, float(progress))),
            )
            logger.debug("Script operation %s: %s", operation_id, message)

        result = pipeline(
            Path(input_path),
            Path(output_path),
            options,
            report_progress,
        )

        current = db.get_operation(operation_id)
        if not current or current.execution_status == ExecutionStatus.CANCELLED:
            Path(output_path).unlink(missing_ok=True)
            return
        if current.execution_status != ExecutionStatus.PROCESSING:
            return

        raw_path = Path(result.get("output_path") or output_path).resolve()
        if not raw_path.is_file() or raw_path.stat().st_size <= 0:
            raise RuntimeError("Script pipeline completed without producing a valid mesh file")

        # Directly publish into the workspace directory using Section 21/22 layout
        pub = storage.publish_derived_mesh(
            workspace_id=operation.workspace_id,
            operation_type=operation.operation_type,
            temp_mesh_path=raw_path,
        )
        final_mesh_path = Path(pub["mesh_path"])
        relative_mesh_path = pub["relative_mesh_path"]

        digest = hashlib.sha256()
        with final_mesh_path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)

        asset = db.add_asset(
            asset_id=f"ast_{uuid.uuid4().hex[:12]}",
            workspace_id=operation.workspace_id,
            file_type="mesh",
            relative_path=relative_mesh_path,
            original_filename=final_mesh_path.name,
            byte_size=final_mesh_path.stat().st_size,
            sha256=digest.hexdigest(),
            operation_id=operation_id,
            is_retained=1,
        )
        db.update_workspace_active_mesh(operation.workspace_id, asset.asset_id)
        db.update_operation_persistence_status(operation_id, PersistenceStatus.SAVED)

        if raw_path != final_mesh_path:
            raw_path.unlink(missing_ok=True)

        stored_result = {
            "output_path": str(final_mesh_path),
            "relative_mesh_path": relative_mesh_path,
            "asset_id": asset.asset_id,
            "format": str(result.get("format") or output_format).lower(),
            "stats": result.get("stats") or {},
            "algorithm": (result.get("stats") or {}).get("algorithm"),
        }
        db.update_operation_execution_status(
            operation_id,
            ExecutionStatus.COMPLETED,
            progress=1.0,
            result=stored_result,
        )
    except ScriptOperationCancelled:
        logger.info("Script operation %s cancelled", operation_id)
        current = db.get_operation(operation_id)
        if current and current.execution_status != ExecutionStatus.CANCELLED:
            try:
                db.update_operation_execution_status(
                    operation_id,
                    ExecutionStatus.CANCELLED,
                    error="Cancelled by user",
                )
            except ValueError:
                pass
        Path(output_path).unlink(missing_ok=True)
    except Exception as exc:
        logger.exception("Script operation %s failed", operation_id)
        current = db.get_operation(operation_id)
        if current and current.execution_status in {
            ExecutionStatus.QUEUED,
            ExecutionStatus.PROCESSING,
        }:
            try:
                db.update_operation_execution_status(
                    operation_id,
                    ExecutionStatus.FAILED,
                    error=str(exc),
                )
            except ValueError:
                logger.warning("Could not transition operation %s to failed", operation_id)
        Path(output_path).unlink(missing_ok=True)


async def execute_script_operation(
    *,
    db: DatabaseManager,
    storage: WorkspaceStorageManager,
    background_tasks: BackgroundTasks,
    workspace_id: Optional[str],
    input_asset_id: Optional[str],
    operation_type: str,
    input_path: str,
    settings: Dict[str, Any],
    pipeline: Callable[..., Dict[str, Any]],
    options: Dict[str, Any],
    output_format: str,
    parent_operation_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a durable queued operation and schedule its direct-save pipeline."""
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Script operations require an active workspace")

    fmt = str(output_format or "glb").lower().lstrip(".")
    if fmt not in {"glb", "obj"}:
        raise HTTPException(status_code=400, detail="Script mesh format must be GLB or OBJ")

    source = Path(input_path).resolve()
    if not source.is_file():
        raise HTTPException(status_code=404, detail="Input mesh file not found")

    workspace = db.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    operation_id = generate_operation_id()
    ws_dir = storage.get_workspace_dir(workspace_id)
    dest_dir = (ws_dir / operation_type).resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    staged_output = dest_dir / f".staging_{operation_id}.{fmt}"

    try:
        operation, is_new = db.enqueue_operation(
            operation_id=operation_id,
            workspace_id=workspace_id,
            operation_type=operation_type,
            input_asset_id=input_asset_id,
            parent_operation_id=parent_operation_id,
            temp_dir=str(dest_dir),
            settings=settings,
        )
        if not is_new:
            staged_output.unlink(missing_ok=True)
            raise HTTPException(status_code=409, detail="An identical operation is already queued or processing")

        background_tasks.add_task(
            _execute_script_operation_task,
            db=db,
            storage=storage,
            operation_id=operation.operation_id,
            input_path=str(source),
            output_path=str(staged_output),
            pipeline=pipeline,
            options=dict(options),
            output_format=fmt,
        )
    except HTTPException:
        raise
    except Exception as exc:
        staged_output.unlink(missing_ok=True)
        logger.exception("Could not queue Script operation")
        raise HTTPException(status_code=500, detail=f"Could not queue Script operation: {exc}") from exc

    return {
        "job_id": operation.operation_id,
        "status": ExecutionStatus.QUEUED,
        "message": "Script operation queued",
        "workspace_id": workspace_id,
        "operation_id": operation.operation_id,
        "format": fmt,
        "stats": None,
    }
