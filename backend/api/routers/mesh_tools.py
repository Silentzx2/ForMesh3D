"""Mesh-processing endpoints: Auto UV, Auto Retopo, Repair, Bake, Segment and FBX Convert.

Lightweight router without legacy postprocess pipeline dependency.
Validates mesh formats and returns structured SSE events so UI gracefully handles requests.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/mesh-tools", tags=["Mesh Tools"])

_SUPPORTED_FORMATS = {"glb", "gltf", "obj", "ply", "stl"}


def _validate_mesh_format(mesh_file: UploadFile) -> None:
    filename = mesh_file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext and ext not in _SUPPORTED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unsupported mesh format .{ext}")


async def _rebuilding_event_generator(tool_name: str) -> AsyncGenerator[str, None]:
    yield f"data: {json.dumps({'type': 'progress', 'stage': 'init', 'frac': 0.1, 'message': f'Initializing {tool_name}...'})}\n\n"
    await asyncio.sleep(0.05)
    yield f"data: {json.dumps({'type': 'error', 'detail': f'{tool_name} post-processing service is currently being rebuilt with custom scripts.'})}\n\n"


def _stream_rebuilding(tool_name: str) -> StreamingResponse:
    return StreamingResponse(_rebuilding_event_generator(tool_name), media_type="text/event-stream")


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
    return _stream_rebuilding("Auto UV")


@router.post("/auto-retopo")
async def auto_retopo(
    meshFile: UploadFile = File(...),
    options: str | None = Form(None),
    format: str = Form("glb"),
) -> StreamingResponse:
    _validate_mesh_format(meshFile)
    return _stream_rebuilding("Auto Retopo")


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
    return _stream_rebuilding("Mesh Segmentation")
