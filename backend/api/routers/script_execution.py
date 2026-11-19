"""Background execution for deterministic workspace Script operations.

Script work is recorded in SQLite before it starts. The canonical API returns
an operation ID immediately; clients poll the operation record and can cancel
it without touching the model scheduler.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from fastapi import BackgroundTasks, HTTPException

from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import ExecutionStatus, generate_operation_id
from core.utils.file_utils import WorkspaceStorageManager

logger = logging.getLogger(__name__)


class ScriptOperationCancelled(Exception):
    """Raised by a pipeline progress checkpoint after a cancel request."""


def _execute_script_operation_task(
    *,
    db: DatabaseManager,
    operation_id: str,
    input_path: str,
    output_path: str,
    pipeline: Callable[..., Dict[str, Any]],
    options: Dict[str, Any],
    output_format: str,
) -> None:
    """Run a pipeline in FastAPI's background-task thread and persist every transition."""
    operation = db.get_operation(operation_id)
    if not operation:
        return
    if operation.execution_status == ExecutionStatus.CANCELLED:
        shutil.rmtree(Path(operation.temp_dir), ignore_errors=True)
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
            shutil.rmtree(Path(current.temp_dir) if current and current.temp_dir else Path(output_path).parent, ignore_errors=True)
            return
        if current.execution_status != ExecutionStatus.PROCESSING:
            return

        preview_path = Path(result.get("output_path") or output_path).resolve()
        if not preview_path.is_file() or preview_path.stat().st_size <= 0:
            raise RuntimeError("Script pipeline completed without producing a valid preview mesh")

        stored_result = {
            "output_path": str(preview_path),
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
        operation = db.get_operation(operation_id)
        if operation and operation.temp_dir:
            shutil.rmtree(operation.temp_dir, ignore_errors=True)
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
        operation = db.get_operation(operation_id)
        if operation and operation.execution_status == ExecutionStatus.FAILED and operation.temp_dir:
            # Keep the operation record but remove incomplete preview data.
            for candidate in Path(operation.temp_dir).glob("preview.*"):
                candidate.unlink(missing_ok=True)


def execute_script_operation(
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
    """Create a durable queued operation and schedule its deterministic pipeline."""
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Script operations require an active workspace")

    fmt = str(output_format or "glb").lower().lstrip(".")
    if fmt not in {"glb", "obj"}:
        raise HTTPException(status_code=400, detail="Script preview format must be GLB or OBJ")

    source = Path(input_path).resolve()
    if not source.is_file():
        raise HTTPException(status_code=404, detail="Input mesh file not found")

    workspace = db.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    operation_id = generate_operation_id()
    temp_dir = storage.create_operation_temp(operation_id)
    input_dir = temp_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    staged_input = input_dir / ("source" + source.suffix.lower())
    output_path = temp_dir / ("preview." + fmt)

    try:
        shutil.copy2(source, staged_input)
        operation, is_new = db.enqueue_operation(
            operation_id=operation_id,
            workspace_id=workspace_id,
            operation_type=operation_type,
            input_asset_id=input_asset_id,
            parent_operation_id=parent_operation_id,
            temp_dir=str(temp_dir),
            settings=settings,
        )
        if not is_new:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise HTTPException(status_code=409, detail="An identical operation is already queued or processing")

        background_tasks.add_task(
            _execute_script_operation_task,
            db=db,
            operation_id=operation.operation_id,
            input_path=str(staged_input),
            output_path=str(output_path),
            pipeline=pipeline,
            options=dict(options),
            output_format=fmt,
        )
    except HTTPException:
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.exception("Could not queue Script operation")
        raise HTTPException(status_code=500, detail=f"Could not queue Script operation: {exc}") from exc

    return {
        "job_id": operation.operation_id,
        "status": ExecutionStatus.QUEUED,
        "message": "Script operation queued",
        "workspace_id": workspace_id,
        "operation_id": operation.operation_id,
        "preview_url": f"/api/v1/system/workspace/operations/{operation.operation_id}/preview",
        "format": fmt,
        "stats": None,
    }
