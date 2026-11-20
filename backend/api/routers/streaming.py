"""FastAPI Router for Server-Side 3D Remote Viewport Streaming.

WebSocket video streaming for 3D meshes. Server renders the mesh offscreen
and pushes JPEG frames to the client over a multiplexed WebSocket channel;
client sends JSON input events back over the same socket.

No WebRTC, no aiortc, no SDP/ICE — dependency-light and works across all
network topographies and proxy environments.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from backend.streaming import get_stream_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["3D Streaming"])


class StartStreamRequest(BaseModel):
    """Request payload to initiate a remote 3D streaming session."""
    workspace_id: Optional[str] = Field(None, description="Workspace ID to stream from")
    mesh_path: Optional[str] = Field(None, description="Direct absolute or relative path to mesh")
    model_url: Optional[str] = Field(None, description="URL or endpoint path of the model")
    width: int = Field(800, ge=128, le=1920)
    height: int = Field(600, ge=128, le=1080)


class InputEventRequest(BaseModel):
    """Client interaction command."""
    action: str
    dx: Optional[float] = None
    dy: Optional[float] = None
    delta: Optional[float] = None
    preset: Optional[str] = None
    mode: Optional[str] = None
    enabled: Optional[bool] = None
    width: Optional[int] = None
    height: Optional[int] = None


def _resolve_mesh_path(req: StartStreamRequest) -> str:
    """Resolve a valid filesystem path to the target 3D model."""
    repo_root = Path(__file__).resolve().parents[3]
    candidates = []

    if req.mesh_path:
        mp = Path(req.mesh_path)
        candidates.append(mp)
        if not mp.is_absolute():
            candidates.extend([repo_root / mp, repo_root / "backend" / mp])

    if req.workspace_id:
        ws_id = req.workspace_id.replace("local_", "")
        storage_roots = [
            repo_root / "backend" / "storage",
            repo_root / "storage",
            Path("/content/ForMesh3D/backend/storage"),
            Path("/content/ForMesh3D/storage"),
        ]
        for s_root in storage_roots:
            candidates.extend([
                s_root / ws_id / "mesh" / "mesh.glb",
                s_root / ws_id / "mesh" / "mesh.obj",
                s_root / ws_id / "mesh.glb",
                s_root / ws_id / "mesh.obj",
            ])
            if s_root.is_dir():
                for match in s_root.glob(f"*{ws_id}*"):
                    if match.is_dir():
                        candidates.extend([
                            match / "mesh" / "mesh.glb",
                            match / "mesh" / "mesh.obj",
                            match / "mesh.glb",
                            match / "mesh.obj",
                        ])

    if req.model_url:
        clean_url = req.model_url.split("?")[0].split("#")[0]
        if "/storage/" in clean_url:
            sub = clean_url.split("/storage/", 1)[1]
            candidates.extend([
                repo_root / "backend" / "storage" / sub,
                repo_root / "storage" / sub,
            ])

    for cand in candidates:
        if cand.is_file():
            return str(cand.resolve())

    return ""


@router.post("/session/start")
async def start_stream_session(req: StartStreamRequest) -> Dict[str, Any]:
    """Initialize a remote 3D streaming session."""
    resolved_path = _resolve_mesh_path(req)
    manager = get_stream_manager()
    session = await manager.create_session(
        mesh_path=resolved_path,
        width=req.width,
        height=req.height,
    )

    return {
        "success": True,
        "session_id": session.session_id,
        "mesh_path": resolved_path,
        "mesh_loaded": bool(resolved_path),
        "ws_url": f"/api/v1/stream/session/{session.session_id}/ws",
        "stats": {
            "vertices": int(len(session.renderer.vertices)),
            "triangles": int(len(session.renderer.faces)),
            "dimensions": {
                "x": round(float(session.renderer.dimensions[0]), 3),
                "y": round(float(session.renderer.dimensions[1]), 3),
                "z": round(float(session.renderer.dimensions[2]), 3),
            },
        },
    }


@router.post("/session/{session_id}/input")
async def handle_direct_input(session_id: str, req: InputEventRequest):
    """Direct WebSocket input event (received via WebSocket message)."""
    manager = get_stream_manager()
    session = await manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.handle_input(req.dict(exclude_none=True))
    return {"success": True}


@router.get("/session/{session_id}/status")
async def get_session_status(session_id: str) -> Dict[str, Any]:
    """Retrieve session telemetry and health stats."""
    manager = get_stream_manager()
    session = await manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.session_id,
        "state": session.state,
        "fps": session.current_fps,
        "mesh_path": session.mesh_path,
        "width": session.renderer.width,
        "height": session.renderer.height,
        "shading_mode": session.renderer.shading_mode,
        "wireframe": session.renderer.show_wireframe,
        "azimuth": session.renderer.azimuth,
        "elevation": session.renderer.elevation,
        "distance": session.renderer.distance,
        "connected_ws_clients": len(session.ws_clients),
    }


@router.post("/session/{session_id}/stop")
async def stop_session(session_id: str):
    """Explicitly tear down streaming session and release memory."""
    manager = get_stream_manager()
    closed = await manager.close_session(session_id)
    return {"success": closed}


@router.websocket("/session/{session_id}/ws")
async def websocket_stream_endpoint(websocket: WebSocket, session_id: str):
    """Multiplexed bidirectional WebSocket streaming channel.

    Streams rendered JPEG frames from server to client as binary messages,
    and receives client interaction commands as JSON text messages.
    """
    await websocket.accept()
    manager = get_stream_manager()
    session = await manager.get_session(session_id)

    if not session:
        await websocket.close(code=4004, reason="Stream session not found")
        return

    session.ws_clients.add(websocket)
    session.touch()
    logger.info("WebSocket client connected to stream session %s", session_id)

    # Immediately send initial frame (point cloud for instant load)
    try:
        initial_frame = session.renderer.render_jpeg()
        await websocket.send_bytes(initial_frame)
        # Switch to full mesh rendering after first point-cloud frame
        session.renderer.use_point_cloud = False
        session.renderer.dirty = True
    except Exception:
        pass

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                session.handle_input(msg)
                frame = session.renderer.render_jpeg()
                await websocket.send_bytes(frame)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected from stream session %s", session_id)
    except Exception as exc:
        logger.debug("WebSocket error in stream session %s: %s", session_id, exc)
    finally:
        session.ws_clients.discard(websocket)
        if len(session.ws_clients) == 0:
            session.state = "idle_paused"
