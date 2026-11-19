"""Synchronous Script-engine execution on the canonical specialist routes.

Script operations share the workspace SQLite lifecycle with AI operations, but
execute the existing deterministic pipelines directly and never acquire a
model scheduler.
"""
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import ExecutionStatus, generate_operation_id
from core.utils.file_utils import WorkspaceStorageManager


async def execute_script_operation(
    *,
    db: DatabaseManager,
    storage: WorkspaceStorageManager,
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
    """Run a deterministic pipeline and stage its preview under storage/temp."""
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Script execution requires a workspace_id")
    if output_format not in {"glb", "obj"}:
        raise HTTPException(status_code=400, detail="Script previews support GLB or OBJ output")

    workspace = db.get_workspace(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    storage.create_workspace_tree(workspace_id)
    operation_id = generate_operation_id()
    temp_dir = storage.temp_root / operation_id

    try:
        operation, is_new = db.enqueue_operation(
            operation_id=operation_id,
            workspace_id=workspace_id,
            operation_type=operation_type,
            input_asset_id=input_asset_id,
            parent_operation_id=parent_operation_id,
            settings=settings,
            temp_dir=str(temp_dir),
        )
    except RuntimeError as exc:
        if "QUEUE_FULL" in str(exc):
            raise HTTPException(status_code=409, detail="queue full") from exc
        raise

    if not is_new:
        raise HTTPException(
            status_code=409,
            detail=f"An identical operation is already active: {operation.operation_id}",
        )

    try:
        op_dir = storage.create_operation_temp(operation.operation_id)
        output_path = op_dir / f"preview.{output_format}"
        db.update_operation_execution_status(
            operation.operation_id, ExecutionStatus.PROCESSING, progress=0.01
        )

        def report_progress(message: str, fraction: float) -> None:
            progress = max(0.01, min(0.99, float(fraction)))
            db.update_operation_execution_status(
                operation.operation_id,
                ExecutionStatus.PROCESSING,
                progress=progress,
            )

        result = await run_in_threadpool(
            pipeline,
            input_path,
            output_path,
            options,
            report_progress,
        )
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError("Script pipeline completed without producing a preview mesh")

        result_payload = {
            "output_path": str(output_path),
            "format": output_format,
            "stats": result.get("stats", {}),
        }
        db.update_operation_execution_status(
            operation.operation_id,
            ExecutionStatus.COMPLETED,
            progress=1.0,
            result=result_payload,
        )
        return {
            "job_id": operation.operation_id,
            "status": "completed",
            "message": "Script operation completed successfully",
            "workspace_id": workspace_id,
            "operation_id": operation.operation_id,
            "preview_url": f"/api/v1/system/operations/{operation.operation_id}/preview",
            "format": output_format,
            "stats": result.get("stats", {}),
        }
    except Exception as exc:
        try:
            db.update_operation_execution_status(
                operation.operation_id,
                ExecutionStatus.FAILED,
                error=str(exc),
            )
        except Exception:
            pass
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Script execution failed: {exc}") from exc
