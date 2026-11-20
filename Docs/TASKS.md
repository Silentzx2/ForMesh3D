# Comprehensive Architecture & Implementation Plan: 100% Server-Side Remote 3D Streaming

## 1. Governance & Strict Scope Boundaries
- **Zero Regression on Existing Pipelines**: Image-to-3D, Retopology, UV Unwrapping, Auto-Rigging, and Segmentation logic remain 100% UNTOUCHED.
- **Large GPU Parity (`sm >= 80`)**: Hardware video encoding and EGL headless rendering run natively on modern GPUs (A100, RTX 3090/4090, H100) with zero CUDA degradation.
- **100% Pure Cloud Viewport**: No heavy meshes (80–150MB+) are EVER downloaded by the client browser for inspection. All rendering runs server-side on GPU/headless workers.
- **Context Budget Rule**: This document strictly adheres to the <= 150 lines limit.

## 2. Core Problem & Streaming Architecture
- **Problem**: Large 80MB–100MB GLB files take 15–30 minutes to download over slow client internet before Three.js can render, choking user bandwidth.
- **Solution (WebRTC & WebSocket Pixel Streaming)**:
  - Server GPU renders the 3D mesh offscreen into an interactive framebuffer.
  - Video frames are streamed to client via WebRTC (or high-speed multiplexed WebSocket fallback).
  - Client sends orbit/zoom/pan mouse inputs over low-latency channel (<30ms round-trip latency).
  - Network footprint drops from a 100MB upfront download to a lightweight stream (<200 KB/s), achieving instant (<1s) inspection.
  - Mesh metadata (vertices, triangles, dimensions) is computed on the server and sent as lightweight JSON, completely eliminating client-side GLB parsing.

## 3. Explicit State Machines
- **Stream Session State Machine**:
  - `IDLE`: No active stream. Viewport displays placeholder awaiting model URL/workspace.
  - `CONNECTING`: WebRTC peer connection or WebSocket handshake in progress.
  - `STREAMING`: Video frames rendering and streaming at 30–60 FPS during user interaction.
  - `IDLE_PAUSED`: Zero-input power-save mode (drops to 1 FPS / keyframe hold after 2s of inactivity).
  - `TERMINATING`: Client disconnects or tab closes; offscreen renderer resources freed immediately.

## 4. Phase 1: Backend Headless Rendering Engine & Server-Side Stats
- [x] **Headless Offscreen Render Engine (`backend/streaming/renderer.py`)**:
  - Initialize offscreen rendering bound to server GPU / software fallback.
  - Load target workspace mesh (`storage/<workspace_id>/mesh/mesh.glb` or active derived asset).
  - Compute mesh metadata (vertex count, face count, dimensions, bounds) directly on server.
  - Implement dynamic camera controller (orbit, pan, zoom, presets, wireframe, shading modes).
  - Render offscreen color buffers at target resolution with adaptive FPS & power-save hold.

## 5. Phase 2: WebRTC Video Pipeline & Signaling Server
- [x] **WebRTC & WebSocket Media Streamer (`backend/streaming/webrtc_streamer.py`)**:
  - WebRTC `VideoStreamTrack` & `RTCDataChannel` support for low-latency video streaming.
  - Built-in multiplexed WebSocket fallback channel (binary frame push + JSON input) for universal compatibility.
- [x] **FastAPI Signaling Endpoints (`backend/api/routers/streaming.py`)**:
  - `POST /api/v1/stream/session/start`: Init stream session, return session ID, server-side mesh stats, and stream URLs.
  - `POST /api/v1/stream/session/{session_id}/offer` & `/ice`: WebRTC SDP/ICE negotiation.
  - `WEBSOCKET /api/v1/stream/session/{session_id}/ws`: Ultra-fast multiplexed binary frame + input stream.
  - `POST /api/v1/stream/session/{session_id}/stop`: Explicit teardown and GPU memory reclamation.

## 6. Phase 3: Bi-Directional Input & Control Channel
- [x] **DataChannel / WebSocket Input Protocol**:
  - Define binary/JSON input payload schema:
    - Orbit/Rotate: `{ action: "rotate", dx: float, dy: float }`
    - Zoom/Dolly: `{ action: "zoom", delta: float }`
    - Pan: `{ action: "pan", dx: float, dy: float }`
    - View Presets: `{ action: "set_view", preset: "front" | "top" | "side" | "iso" }`
    - Shading Toggle: `{ action: "shading", mode: "textured" | "clay" | "wireframe" }`
    - Resize: `{ action: "resize", width: int, height: int }`
  - Server input handler consumes events and updates camera matrices with sub-frame latency.

## 7. Phase 4: Pure Cloud Frontend Viewport (Local Loaders Removed)
- [x] **WebRTC Stream Hook (`features/workspace/hooks/useWebRTCStream.ts`)**:
  - Multiplexed connection management (WebRTC primary, WebSocket universal fallback).
  - Accurate backend WebSocket host resolution (supports custom backend ports and proxies).
  - Dispatches pointer orbit, pan, zoom gestures directly to stream.
- [x] **Stream Video Viewport (`features/workspace/Viewport/StreamVideoViewer.tsx`)**:
  - Pure cloud streaming viewport rendering interactive video/canvas.
  - Displays non-intrusive stream telemetry badge (FPS, Ping, Bitrate).
- [x] **Removal of Local Viewport Loaders (`features/workspace/Viewport/MeshViewer.tsx`)**:
  - Eliminate background `loadGLBWithProgress` and `sharedGLTFLoader.parse` from viewport.
  - Remove dual-mode toggle from `ViewportToolOverlay.tsx`; viewport is 100% Cloud Stream.
  - Populate Inspector statistics from server-side metadata returned by `/session/start`.

## 8. Phase 5: Resource Management & Multi-Tenant Concurrency
- [x] **Session Lifecycle & Cleanup**:
  - Heartbeat monitor: terminate sessions inactive for >5 minutes to release GPU render buffers.
  - Process isolation: Offscreen render sessions run in dedicated worker threads/subprocesses.
  - Multi-user port allocation and STUN/TURN fallback configuration.

## 9. Verification & Quality Gates
- **Bandwidth Benchmark**: Client data consumption <200 KB/s during streaming (vs 80–100MB download).
- **Zero Local Download**: No heavy mesh files downloaded by client during viewport preview.
- **Resource Recovery**: Closing browser tab drops server GPU VRAM for that session immediately.
