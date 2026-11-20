# Comprehensive Architecture & Implementation Plan: Server-Side Remote 3D Streaming (WebRTC)

## 1. Governance & Strict Scope Boundaries
- **Zero Regression on Existing Pipelines**: Image-to-3D, Retopology, UV Unwrapping, Auto-Rigging, and Segmentation logic remain 100% UNTOUCHED.
- **Large GPU Parity (`sm >= 80`)**: Hardware video encoding and EGL headless rendering run natively on modern GPUs (A100, RTX 3090/4090, H100) with zero CUDA degradation.
- **Dual-Mode Viewport**: WebRTC Streaming is the default for instant (<1s) inspection of heavy meshes (80–150MB+); local Three.js WebGL rendering and direct `.glb` download remain available via toggle/export.
- **Context Budget Rule**: This document strictly adheres to the <= 150 lines limit.

## 2. Core Problem & Streaming Architecture
- **Problem**: Large 80MB–100MB GLB files take 15–30 minutes to download over slow client internet before Three.js can render.
- **Solution (WebRTC Pixel Streaming)**:
  - Server GPU renders the 3D mesh offscreen into a framebuffer.
  - Video frames are encoded (H.264/VP8) and streamed to the client via WebRTC.
  - Client sends orbit/zoom/pan mouse inputs over WebRTC DataChannel (<30ms round-trip latency).
  - Network footprint drops from a 100MB upfront download to a lightweight 1–2 Mbps video stream, achieving instant loading.

## 3. Explicit State Machines
- **Stream Session State Machine**:
  - `IDLE`: No active stream. Viewport displays placeholder or awaiting model URL.
  - `SIGNALING`: Client exchanges SDP offer/answer and ICE candidates with `/api/v1/stream/session`.
  - `CONNECTING`: WebRTC peer connection and DataChannel handshake in progress.
  - `STREAMING`: Video frames rendering and streaming at 30–60 FPS during user interaction.
  - `IDLE_PAUSED`: Zero-input power-save mode (drops to 1 FPS / keyframe hold after 2s of inactivity).
  - `TERMINATING`: Client disconnects or tab closes; offscreen renderer resources freed immediately.
- **Viewport Dual-Mode State Machine**:
  - `STREAM_MODE (Default)`: HTML5 `<video>` element with interactive touch/mouse event interceptor.
  - `LOCAL_MODE (Fallback)`: Traditional Three.js WebGL canvas loading cached GLB buffer.

## 4. Phase 1: Backend Headless Rendering Engine
- [ ] **EGL Offscreen Render Worker (`backend/streaming/renderer.py`)**:
  - Initialize headless OpenGL/EGL context bound to server GPU (no X11 / virtual display required).
  - Load target workspace mesh (`storage/<workspace_id>/mesh/mesh.glb` or active derived asset).
  - Implement dynamic camera controller (orbit, pan, zoom, field-of-view, wireframe, and shading modes).
  - Render offscreen color buffers (RGB numpy arrays / PyTorch tensors) at 720p/1080p target resolution.
- [ ] **Adaptive FPS & Power-Save Mechanism**:
  - Active user interaction: Render at 30–60 FPS for fluid manipulation.
  - Idle state (>2s without input): Pause rendering loop, hold last frame to consume 0% GPU compute.

## 5. Phase 2: WebRTC Video Pipeline & Signaling Server
- [ ] **WebRTC Media Streamer (`backend/streaming/webrtc_streamer.py`)**:
  - Integrate `aiortc` (Python asynchronous WebRTC engine) with PyAV/H.264 hardware/software encoder.
  - Implement custom `VideoStreamTrack` that pulls rendered frames from the offscreen renderer.
  - Handle adaptive bitrate, dynamic frame dropping, and packet-loss recovery.
- [ ] **FastAPI Signaling Endpoints (`backend/api/routers/streaming.py`)**:
  - `POST /api/v1/stream/session/start`: Initialize stream session for target model/workspace, return session ID.
  - `POST /api/v1/stream/session/{session_id}/offer`: Accept client SDP offer, return server SDP answer.
  - `POST /api/v1/stream/session/{session_id}/ice`: Handle trickle ICE candidate exchange.
  - `POST /api/v1/stream/session/{session_id}/stop`: Explicit teardown and GPU memory reclamation.

## 6. Phase 3: Bi-Directional Input & Control Channel
- [ ] **DataChannel Input Protocol**:
  - Define binary/JSON input payload schema:
    - Orbit/Rotate: `{ action: "rotate", dx: float, dy: float }`
    - Zoom/Dolly: `{ action: "zoom", delta: float }`
    - Pan: `{ action: "pan", dx: float, dy: float }`
    - View Presets: `{ action: "set_view", preset: "front" | "top" | "side" | "iso" }`
    - Shading Toggle: `{ action: "shading", mode: "textured" | "clay" | "wireframe" }`
    - Resize: `{ action: "resize", width: int, height: int }`
  - Server input handler consumes events and updates camera matrices with sub-frame latency.

## 7. Phase 4: Frontend Streaming Viewport Integration
- [ ] **WebRTC Stream Hook (`features/workspace/hooks/useWebRTCStream.ts`)**:
  - Manage `RTCPeerConnection`, DataChannel setup, SDP exchange, and auto-reconnection.
  - Capture mouse drag, scroll wheel, and touch gestures from the canvas/video overlay and dispatch to DataChannel.
  - Monitor stream health, latency stats (RTT, dropped frames), and connection state.
- [ ] **Stream Video Viewport (`features/workspace/Viewport/StreamVideoViewer.tsx`)**:
  - Embed low-latency `<video playsinline autoPlay muted>` receiving remote WebRTC media stream.
  - Add transparent interaction overlay for seamless orbit controls matching Three.js OrbitControls feel.
  - Display non-intrusive stream telemetry badge (FPS, Ping, Bitrate).
- [ ] **Viewport Dual-Mode Switcher (`features/workspace/Viewport/ViewportToolOverlay.tsx`)**:
  - Add "Stream Mode (Cloud GPU)" vs "Local Mode (Download)" segmented toggle.
  - Seamless fallback to local Three.js loader if WebRTC connection fails or user explicitly downloads model.

## 8. Phase 5: Resource Management & Multi-Tenant Concurrency
- [ ] **Session Lifecycle & Cleanup**:
  - Heartbeat monitor: terminate sessions inactive for >5 minutes to release GPU render buffers.
  - Process isolation: Offscreen render sessions run in dedicated worker threads/subprocesses.
  - Multi-user port allocation and STUN/TURN fallback configuration.

## 9. Verification & Quality Gates
- **Bandwidth Benchmark**: Verify client data consumption remains <200 KB/s during streaming (vs 80–100MB download).
- **Latency Target**: Input-to-photon latency <= 60ms over standard broadband / 4G connections.
- **Resource Recovery**: Closing browser tab immediately drops server GPU VRAM usage for that session to 0 MB.
