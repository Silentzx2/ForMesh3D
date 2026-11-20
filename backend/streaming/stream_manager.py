"""Multiplexed WebSocket Streaming Engine for Remote 3D Mesh Inspection.

Manages WebSocket sessions, video frame broadcasting, and bidirectional input.
Graceful, dependency-light alternative to WebRTC — no aiortc/av, no SDP/ICE,
no NAT traversal. Just binary JPEG frames pushed to the client and JSON input
received back over the same socket.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Dict, Optional, Set

from .renderer import HeadlessRenderer

logger = logging.getLogger(__name__)


class StreamSession:
    """Represents an active server-side remote 3D streaming session."""

    def __init__(
        self,
        session_id: str,
        mesh_path: str,
        width: int = 800,
        height: int = 600,
    ):
        self.session_id = session_id
        self.mesh_path = mesh_path
        self.renderer = HeadlessRenderer(mesh_path=mesh_path, width=width, height=height)

        # State: "idle" | "streaming" | "idle_paused" | "terminating"
        self.state = "idle"
        self.created_at = time.time()
        self.last_activity = time.time()

        # WebSocket active connections
        self.ws_clients: Set[Any] = set()

        # Telemetry
        self.frame_count = 0
        self.last_fps_calc = time.time()
        self.current_fps = 0.0

        # Background stream loop task
        self.stream_task: Optional[asyncio.Task] = None

    def touch(self) -> None:
        """Update activity timestamp."""
        self.last_activity = time.time()
        if self.state == "idle_paused":
            self.state = "streaming"

    def handle_input(self, payload: Dict[str, Any]) -> None:
        """Process client interaction commands from WebSocket."""
        self.touch()
        action = payload.get("action")

        if action in ("rotate", "orbit"):
            dx = float(payload.get("dx", 0.0))
            dy = float(payload.get("dy", 0.0))
            self.renderer.orbit(dx, dy)
        elif action == "pan":
            dx = float(payload.get("dx", 0.0))
            dy = float(payload.get("dy", 0.0))
            self.renderer.pan(dx, dy)
        elif action == "zoom":
            delta = float(payload.get("delta", 0.0))
            self.renderer.zoom(delta)
        elif action in ("end_drag", "up", "pointerup"):
            self.renderer.end_drag()
        elif action in ("set_view", "preset"):
            preset = str(payload.get("preset", "iso"))
            self.renderer.set_preset(preset)
        elif action == "shading":
            mode = str(payload.get("mode", "clay"))
            self.renderer.set_shading(mode)
        elif action == "wireframe":
            enabled = bool(payload.get("enabled", True))
            self.renderer.set_wireframe(enabled)
        elif action == "resize":
            w = int(payload.get("width", 800))
            h = int(payload.get("height", 600))
            self.renderer.resize(w, h)
        else:
            logger.debug("Unknown streaming input action: %s", action)

    async def broadcast_frame(self) -> None:
        """Render and dispatch frame to all connected WebSocket clients."""
        if not self.ws_clients:
            return

        jpeg_data = self.renderer.render_jpeg()
        self.frame_count += 1

        now = time.time()
        if now - self.last_fps_calc >= 1.0:
            self.current_fps = round(self.frame_count / (now - self.last_fps_calc), 1)
            self.frame_count = 0
            self.last_fps_calc = now

        disconnected = []
        for ws in self.ws_clients:
            try:
                await ws.send_bytes(jpeg_data)
            except Exception:
                disconnected.append(ws)

        for ws in disconnected:
            self.ws_clients.discard(ws)

    async def start_streaming_loop(self) -> None:
        """Continuously stream frames at target rate with idle power-saving."""
        self.state = "streaming"
        while self.state in ("streaming", "idle_paused"):
            now = time.time()
            is_idle = (now - self.last_activity) > 2.0

            if is_idle:
                self.state = "idle_paused"
                await asyncio.sleep(1.0)
            else:
                self.state = "streaming"
                if self.renderer.dirty:
                    await self.broadcast_frame()
                await asyncio.sleep(0.025)

    async def close(self) -> None:
        """Tear down all streaming channels and release resources."""
        self.state = "terminating"
        if self.stream_task and not self.stream_task.done():
            self.stream_task.cancel()

        for ws in list(self.ws_clients):
            try:
                await ws.close()
            except Exception:
                pass
        self.ws_clients.clear()


class StreamManager:
    """Manages active streaming sessions and resource reclamation."""

    def __init__(self):
        self._sessions: Dict[str, StreamSession] = {}
        self._lock = asyncio.Lock()
        self._sweeper_task: Optional[asyncio.Task] = None

    async def create_session(
        self,
        mesh_path: str,
        width: int = 800,
        height: int = 600,
    ) -> StreamSession:
        """Create and register a new stream session."""
        session_id = f"stream_{uuid.uuid4().hex[:12]}"
        session = StreamSession(
            session_id=session_id,
            mesh_path=mesh_path,
            width=width,
            height=height,
        )

        async with self._lock:
            self._sessions[session_id] = session

        session.stream_task = asyncio.create_task(session.start_streaming_loop())

        if self._sweeper_task is None or self._sweeper_task.done():
            self._sweeper_task = asyncio.create_task(self._sweep_loop())

        logger.info("Created 3D stream session %s for mesh %s", session_id, mesh_path)
        return session

    async def get_session(self, session_id: str) -> Optional[StreamSession]:
        """Look up an active session by ID."""
        async with self._lock:
            return self._sessions.get(session_id)

    async def close_session(self, session_id: str) -> bool:
        """Close and discard a stream session."""
        async with self._lock:
            session = self._sessions.pop(session_id, None)

        if session:
            await session.close()
            logger.info("Closed 3D stream session %s", session_id)
            return True
        return False

    async def _sweep_loop(self) -> None:
        """Periodically clean up abandoned sessions (>5 min inactive)."""
        while True:
            try:
                await asyncio.sleep(60.0)
                now = time.time()
                to_expire = []
                async with self._lock:
                    for sid, s in self._sessions.items():
                        if (now - s.last_activity) > 300.0:
                            to_expire.append(sid)

                for sid in to_expire:
                    logger.info("Expiring inactive stream session: %s", sid)
                    await self.close_session(sid)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Error in stream session sweeper: %s", exc)


# Singleton
_stream_manager: Optional[StreamManager] = None


def get_stream_manager() -> StreamManager:
    """Return the global StreamManager singleton."""
    global _stream_manager
    if _stream_manager is None:
        _stream_manager = StreamManager()
    return _stream_manager
