"""FastAPI Router for Server-Side 3D Remote Viewport Streaming.

Provides WebRTC signaling (SDP offer/answer, ICE) and high-speed
WebSocket video streaming for 3D meshes.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from backend.streaming import get_stream_manager
from backend.streaming.webrtc_streamer import AIORTC_AVAILABLE

if AIORTC_AVAILABLE:
    from aiortc import (
        RTCIceCandidate,
        RTCPeerConnection,
        RTCSessionDescription,
    )
    from backend.streaming.webrtc_streamer import RTCStreamVideoTrack

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["3D Streaming"])


class StartStreamRequest(BaseModel):
    """Request payload to initiate a remote 3D streaming session."""
    workspace_id: Optional[str] = Field(None, description="Workspace ID to stream from")
    mesh_path: Optional[str] = Field(None, description="Direct absolute or relative path to mesh")
    model_url: Optional[str] = Field(None, description="URL or endpoint path of the model")
    width: int = Field(800, ge=128, le=1920)
    height: int = Field(600, ge=128, le=1080)


class SDPOfferRequest(BaseModel):
    """Client WebRTC SDP offer."""
    sdp: str
    type: str = "offer"


class ICECandidateRequest(BaseModel):
    """Client trickle ICE candidate."""
    candidate: str
    sdpMid: Optional[str] = None
    sdpMLineIndex: Optional[int] = None


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
            candidates.append(repo_root / mp)
            candidates.append(repo_root / "backend" / mp)

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
            # Check wildcard subdirectories for workspace_id
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
        # Extract relative path from URL (e.g. /api/v1/storage/...)
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

    # Return empty placeholder path if mesh is pending or not yet generated
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
        "webrtc_supported": AIORTC_AVAILABLE,
        "ws_url": f"/api/v1/stream/session/{session.session_id}/ws",
    }


@router.post("/session/{session_id}/offer")
async def handle_sdp_offer(session_id: str, req: SDPOfferRequest) -> Dict[str, Any]:
    """Accept WebRTC SDP offer and return SDP answer."""
    if not AIORTC_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="WebRTC (aiortc) is not installed on this server. Connect via the WebSocket channel at /api/v1/stream/session/{session_id}/ws",
        )

    manager = get_stream_manager()
    session = await manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.state = "signaling"
    session.touch()

    pc = RTCPeerConnection()
    session.pc = pc

    # Add video track
    video_track = RTCStreamVideoTrack(session)
    session.video_track = video_track
    pc.addTrack(video_track)

    # Listen for DataChannel
    @pc.on("datachannel")
    def on_datachannel(channel):
        session.data_channel = channel

        @channel.on("message")
        def on_message(message):
            try:
                data = json.loads(message) if isinstance(message, str) else json.loads(message.decode())
                session.handle_input(data)
            except Exception as exc:
                logger.debug("DataChannel message decode error: %s", exc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        if pc.connectionState in ("failed", "closed"):
            await session.close()

    offer = RTCSessionDescription(sdp=req.sdp, type=req.type)
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    session.state = "connecting"
    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    }


@router.post("/session/{session_id}/ice")
async def handle_ice_candidate(session_id: str, req: ICECandidateRequest) -> Dict[str, Any]:
    """Receive client ICE candidate."""
    if not AIORTC_AVAILABLE:
        return {"success": False, "detail": "aiortc not available"}

    manager = get_stream_manager()
    session = await manager.get_session(session_id)
    if not session or not session.pc:
        raise HTTPException(status_code=404, detail="Active WebRTC peer connection not found")

    candidate_str = req.candidate.strip()
    if candidate_str:
        try:
            from aiortc.sdp import candidate_from_sdp
            cand = candidate_from_sdp(candidate_str)
            cand.sdpMid = req.sdpMid
            cand.sdpMLineIndex = req.sdpMLineIndex
            await session.pc.addIceCandidate(cand)
        except Exception as exc:
            logger.debug("Failed to add ICE candidate: %s", exc)

    return {"success": True}


@router.post("/session/{session_id}/input")
async def handle_direct_input(session_id: str, req: InputEventRequest) -> Dict[str, Any]:
    """Direct HTTP input event fallback."""
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
        "webrtc_connected": bool(session.pc and session.pc.connectionState == "connected"),
    }


@router.post("/session/{session_id}/stop")
async def stop_session(session_id: str) -> Dict[str, Any]:
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

    # Immediately send initial frame
    try:
        initial_frame = session.renderer.render_jpeg()
        await websocket.send_bytes(initial_frame)
    except Exception:
        pass

    try:
        while True:
            # Receive client input events
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                session.handle_input(msg)
                # Immediately push rendered response frame for low input latency
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
        if len(session.ws_clients) == 0 and not session.pc:
            session.state = "idle_paused"
