# Stream Viewport Fix — Point Cloud Placeholder + Clean WebSocket Streaming

## Problem
- Mesh loads server-side (523k vertices OK) but stream does not render instantly
- WebRTC handshake crashes (`None is not in list` — aiortc transceiver `_offerDirection` None)
- WebRTC needs `aiortc` + `av` deps, SDP/ICE complexity, crashes on complex meshes
- PIL/ImageDraw face-by-face rendering is slow for large meshes → first frame delayed
- `/input` spam when client connects but no frame returns

## Goal
- Mesh visible in viewport within 10–15s of generation complete
- Client downloads nothing (80MB mesh stays server-side)
- Point cloud placeholder shows real mesh geometry shape during generation/connect
- Real mesh replaces placeholder once stream connects
- Old WebRTC completely removed — WebSocket-only streaming
- Clean code, minimal deps, smart logic

## Scope

### Remove (WebRTC — complete)
- `backend/api/routers/streaming.py` — `/offer`, `/ice`, SDP/ice-candidate endpoints, aiortc imports
- `backend/streaming/stream_manager.py` — REPLACED `webrtc_streamer.py`; StreamSession/StreamManager, WebSocket only, no WebRTC
- `backend/requirements.txt` — remove `aiortc`, remove `av`
- `features/workspace/hooks/useWebSocketStream.ts` — REPLACED `useWebRTCStream.ts`; WebSocket-only hook
- `features/workspace/Viewport/StreamVideoViewer.tsx` — canvas only, no `<video>` WebRTC element
- References to `webrtc_supported`, `RTCPeerConnection`, `AIORTC_AVAILABLE` across frontend

### Keep (WebSocket streaming)
- `backend/api/routers/streaming.py` — `/session/start`, `/session/{id}/ws`, `/session/{id}/input`, `/session/{id}/status`, `/session/{id}/stop`
- `backend/streaming/renderer.py` — HeadlessRenderer (add point cloud mode)
- `backend/streaming/stream_manager.py` — StreamManager, StreamSession (WebSocket only, no WebRTC fields)

### Add
- Point cloud placeholder rendering in `renderer.py` (draw vertices as points, fast)
- Pre-rendered placeholder thumbnail on mesh generate/upload complete
- Frontend: generation-progress placeholder overlay (spinner + point cloud preview)
- Frontend: swap placeholder → real stream canvas when `connectionState === 'streaming'`

## Dependencies (2 deps to remove)
- `aiortc>=1.9.0` — REMOVE from `backend/requirements.txt`
- `av>=13.0.0` — REMOVE from `backend/requirements.txt` (was added for WebRTC video track, no longer needed)

## Verification
- `bun run test` (tsc --noEmit) — 0 errors
- `python3 -m py_compile backend/api/routers/streaming.py backend/streaming/*.py`
- `git status` clean before commit

## Old commits for reference
- `e22cbd6` — feat(streaming): implement server-side remote 3D WebRTC/WebSocket streaming engine
- `29e1345` — refactor(streaming): enforce 100% cloud streaming viewport and remove client-side mesh loaders
- `adb6de0` — fix(stream): skip WebRTC offer when server reports webrtc_supported=false
- `47cd3ae` — fix(stream): harden WebRTC offer handshake and pin av dep (reverting this whole approach)

## Implementation Plan
1. Backend: `stream_manager.py` — WebSocket-only StreamManager + StreamSession (done)
2. Backend: `streaming.py` router — WebSocket-only endpoints (done)
3. Backend: `renderer.py` — add point cloud placeholder mode for instant first frame (done)
4. Backend: `placeholder.py` — standalone point cloud renderer (done)
5. Frontend: `useWebSocketStream.ts` — WebSocket-only hook, replaced `useWebRTCStream.ts` (done)
6. Frontend: `StreamVideoViewer.tsx` — canvas only, placeholder overlay during connect (done)
7. Frontend: `MeshViewer.tsx` — removed unused `loadGLBWithProgress` import (done)
8. Remove `aiortc` + `av` from requirements.txt (done)
9. Verify: tsc + py_compile + git commit + push (pending)
