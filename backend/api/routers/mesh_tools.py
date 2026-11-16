"""Mesh-processing endpoints: Auto UV, Auto Retopo, Repair, Bake, Segment and FBX Convert.

Provides real script execution for Retopo, Smart UV, and Segment, backed by SQLite
operation lifecycle, temporary preview staging, and SSE streaming.
"""
from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from backend.pipelines.retopo import execute_retopo
from backend.pipelines.segment import execute_segment
from backend.pipelines.smart_uv import execute_smart_uv

try:
    from core.scheduler.database_manager import DatabaseManager, get_workspace_storage_manager
    from core.scheduler.database_models import ExecutionStatus, generate_operation_id
    _HAS_DB = True
except (ImportError, Exception):
    _HAS_DB = False

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mesh-tools", tags=["Mesh Tools"])

_SUPPORTED_FORMATS = {"glb", "gltf", "obj", "ply", "stl"}


def _validate_mesh_format(mesh_file: UploadFile) -> str:
    filename = mesh_file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext and ext not in _SUPPORTED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unsupported mesh format .{ext}")
    return ext or "glb"


async def _rebuilding_event_generator(tool_name: str) -> AsyncGenerator[str, None]:
    yield f"data: {json.dumps({'type': 'progress', 'stage': 'init', 'frac': 0.1, 'message': f'Initializing {tool_name}...'})}\n\n"
    await asyncio.sleep(0.05)
    yield f"data: {json.dumps({'type': 'error', 'detail': f'{tool_name} post-processing service is currently being rebuilt with custom scripts.'})}\n\n"


def _stream_rebuilding(tool_name: str) -> StreamingResponse:
    return StreamingResponse(_rebuilding_event_generator(tool_name), media_type="text/event-stream")


async def _execute_mesh_pipeline_stream(
    operation_type: str,
    pipeline_func: Callable[..., Dict[str, Any]],
    mesh_file: UploadFile,
    options_json: Optional[str],
    format_arg: str,
) -> AsyncGenerator[str, None]:
    """Execute a mesh pipeline in a thread, stream SSE progress, and register in DB/workspace."""
    options_dict: Dict[str, Any] = {}
    if options_json:
        try:
            options_dict = json.loads(options_json)
        except Exception:
            options_dict = {}

    db = None
    ws_storage = None
    if _HAS_DB:
        db = DatabaseManager()
        ws_storage = get_workspace_storage_manager()

    target_ws_id = options_dict.get("workspace_id")
    if not target_ws_id:
        if ws_storage:
            target_ws_id = ws_storage.mint_workspace_id("workspace")
            ws_storage.create_workspace_tree(target_ws_id)
        else:
            target_ws_id = f"ws_{uuid.uuid4().hex[:12]}"
        if db:
            db.create_workspace(workspace_id=target_ws_id, name="Workspace")

    if _HAS_DB:
        operation_id = generate_operation_id()
        temp_dir = ws_storage.create_operation_temp(operation_id)
    else:
        operation_id = f"op_{uuid.uuid4().hex[:12]}"
        temp_dir = Path(tempfile.gettempdir()) / "formesh_operations" / operation_id
        temp_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded input mesh
    in_ext = mesh_file.filename.rsplit(".", 1)[-1].lower() if (mesh_file.filename and "." in mesh_file.filename) else "glb"
    input_mesh_path = temp_dir / f"input.{in_ext}"
    content = await mesh_file.read()
    input_mesh_path.write_bytes(content)

    output_ext = format_arg.lower().lstrip(".") or "glb"
    if output_ext not in _SUPPORTED_FORMATS:
        output_ext = "glb"
    output_mesh_path = temp_dir / f"{operation_id}.{output_ext}"

    # Register in SQLite FIFO queue if DB is available
    if db:
        op_row, _ = db.enqueue_operation(
            operation_id=operation_id,
            workspace_id=target_ws_id,
            operation_type=operation_type,
            settings=options_dict,
            temp_dir=str(temp_dir),
        )
        db.update_operation_execution_status(operation_id, ExecutionStatus.RUNNING, progress=0.1)

    # Event queue for thread -> async generator bridge
    loop = asyncio.get_running_loop()
    event_queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue()

    def progress_callback(msg: str, frac: float):
        loop.call_soon_threadsafe(
            event_queue.put_nowait,
            {"type": "progress", "frac": frac, "message": msg, "stage": operation_type},
        )

    yield f"data: {json.dumps({'type': 'progress', 'stage': 'init', 'frac': 0.15, 'message': f'Initializing {operation_type}...'})}\n\n"

    def run_worker():
        try:
            res = pipeline_func(
                input_path=input_mesh_path,
                output_path=output_mesh_path,
                options={**options_dict, "output_format": output_ext},
                progress_callback=progress_callback,
            )
            loop.call_soon_threadsafe(event_queue.put_nowait, {"_worker_result": res})
        except Exception as exc:
            loop.call_soon_threadsafe(event_queue.put_nowait, {"_worker_error": str(exc)})
        finally:
            loop.call_soon_threadsafe(event_queue.put_nowait, None)

    # Run in background worker thread
    worker_task = asyncio.to_thread(run_worker)
    asyncio.create_task(worker_task)

    worker_result = None
    worker_error = None

    while True:
        item = await event_queue.get()
        if item is None:
            break
        if "_worker_result" in item:
            worker_result = item["_worker_result"]
        elif "_worker_error" in item:
            worker_error = item["_worker_error"]
        else:
            yield f"data: {json.dumps(item)}\n\n"

    if worker_error:
        if db:
            db.update_operation_execution_status(operation_id, ExecutionStatus.FAILED, progress=0.0)
        yield f"data: {json.dumps({'type': 'error', 'detail': worker_error})}\n\n"
        return

    stats = worker_result.get("stats", {}) if worker_result else {}
    if db:
        db.update_operation_execution_status(
            operation_id,
            ExecutionStatus.COMPLETED,
            progress=1.0,
            result=stats,
        )

    download_url = f"/api/v1/workspace/operations/{operation_id}/preview"
    yield f"data: {json.dumps({'type': 'progress', 'stage': 'complete', 'frac': 1.0, 'message': 'Operation completed successfully'})}\n\n"
    done_payload = {
        "type": "done",
        "operation_id": operation_id,
        "workspace_id": target_ws_id,
        "model_url": download_url,
        "preview_url": download_url,
        "format": output_ext,
        "stats": stats,
    }
    yield f"data: {json.dumps(done_payload)}\n\n"


@router.post("/lods")
async def lods(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("LOD Generation")


@router.post("/optimize")
async def optimize(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Mesh Optimization")


@router.post("/auto-uv")
async def auto_uv(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return StreamingResponse(
        _execute_mesh_pipeline_stream("uv", execute_smart_uv, meshFile, options, format),
        media_type="text/event-stream",
    )


@router.post("/auto-retopo")
async def auto_retopo(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return StreamingResponse(
        _execute_mesh_pipeline_stream("retopology", execute_retopo, meshFile, options, format),
        media_type="text/event-stream",
    )


@router.post("/repair")
async def repair(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Mesh Repair")


@router.post("/convert-fbx")
async def convert_fbx(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("FBX Conversion")


@router.post("/inspect")
async def inspect(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Mesh Inspection")


@router.post("/bake")
async def bake(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Texture Baking")


@router.post("/flatten")
async def flatten(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Mesh Flattening")


@router.post("/collision")
async def collision(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Collision Generation")


@router.post("/segment")
async def segment(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return StreamingResponse(
        _execute_mesh_pipeline_stream("segmentation", execute_segment, meshFile, options, format),
        media_type="text/event-stream",
    )
