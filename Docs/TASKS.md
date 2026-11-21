# TASK — Mesh Viewer: Hybrid Local + Server Streaming Solution

## Current State (2026-11-21)

### Problem
- **80-100MB meshes** fail to load locally on slow connections (1 Mbps = hours to download)
- **Local Three.js renderer** works for small meshes but camera/fitCamera issues make mesh invisible
- **WebRTC/WebSocket streaming** fails behind Cloudflare tunnel (port 7842 not forwarded)
- **Complex cache system** (`MeshLoader` + `refCount` + deep-clone) causes cache poisoning & timeouts

### What Works Now
| Component | Status |
|-----------|--------|
| Local `MeshRenderer` + `useMeshLoader` | ✅ Loads small meshes, GPU/CPU fallback |
| `MeshRenderer.fitCamera()` + 🎯 Fit Camera button | ✅ Pushed, logs camera/bbox |
| Backend streaming endpoints (`/api/v1/stream/session/start`, WebSocket) | ✅ Exist, work locally |
| Mesh download endpoint (`/api/v1/system/jobs/{id}/download`) | ✅ Works, but slow for large files |

### What's Broken
| Issue | Root Cause |
|-------|------------|
| Mesh loads but viewport empty | `fitCamera` not positioning camera correctly |
| Large mesh timeout | 45s timeout still too short for 80MB on slow net |
| WebSocket streaming fails | Direct `host:7842` WebSocket blocked by Cloudflare tunnel |
| Complex cache poisoning | Deep-clone + shared cache disposal = broken subsequent loads |

---

## Requirements (User's Mandate)

1. **No local mesh download** for large meshes (>20 MB) — server must render
2. **Smooth 60fps** for small meshes (<20 MB) — local Three.js rendering
3. **Load < 20 seconds** for any mesh size
4. **Works on 1 Mbps** connection
5. **Simple, minimal code** — no complex caching, no refCount, no WebRTC
6. **Single viewport component** — switches strategy by mesh size

---

## Solution: Hybrid Viewer (Size-Based Strategy)

### Strategy Decision
```typescript
// MeshViewer.tsx
const meshSizeMB = currentAsset?.file_size_mb || 0;

if (meshSizeMB > 20) {
  // LARGE MESH → Server-side GPU rendering + video stream
  // Zero download, ~30fps, works on 1 Mbps
  return <StreamingViewer workspaceId={...} />;
} else {
  // SMALL MESH → Local Three.js rendering
  // Buttery smooth 60fps, downloads in seconds
  return <LocalMeshViewer modelUrl={modelUrl} />;
}
```

### Threshold: 20 MB
- **< 20 MB**: Downloads in 2-10s on decent net, smooth forever
- **> 20 MB**: Server streams video frames (~22KB/frame), no download

---

## Implementation Plan (Minimal Code)

### Files to DELETE (remove complex bloat)
| File | Reason |
|------|--------|
| `features/workspace/Viewport/MeshLoader.ts` | URL-keyed cache, refCount, cache poisoning |
| `features/workspace/Viewport/useMeshLoader.ts` | Complex hook with timeout race, deep-clone |
| `features/workspace/Viewport/StreamVideoViewer.tsx` | WebRTC/WS complex viewer |
| `features/workspace/hooks/useWebSocketStream.ts` | Complex WS hook with tunnel issues |
| `features/workspace/Viewport/__tests__/MeshLoader.test.ts` | Tests for deleted cache |

### Files to KEEP (working local renderer)
| File | Purpose |
|------|---------|
| `features/workspace/Viewport/MeshRenderer.ts` | GPU/CPU renderer, `fitCamera`, `resetCamera`, 🎯 button |
| `features/workspace/Viewport/useMeshLoader.ts` | **Simplified** — just fetch → parse → load (no cache) |

### Files to CREATE (simple streaming)
| File | Lines | Purpose |
|------|-------|---------|
| `features/workspace/Viewport/StreamingViewer.tsx` | ~80 | Canvas + WebSocket client (binary frames, input handlers) |

### Files to MODIFY
| File | Change |
|------|--------|
| `features/workspace/Viewport/useMeshLoader.ts` | **Replace** with simple fetch→parse→load (no cache, no refCount, no timeout race) |
| `features/workspace/Viewport/MeshViewer.tsx` | Add `if (size > 20)` branch, remove dead imports |
| `features/workspace/Viewport/MeshRenderer.ts` | Keep (add any missing visibility fixes) |

---

## StreamingViewer.tsx Design (Simple, ~80 lines)

```typescript
// features/workspace/Viewport/StreamingViewer.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface StreamingViewerProps {
  workspaceId: string;
  shadingMode?: string;
  showWireframe?: boolean;
}

export const StreamingViewer: React.FC<StreamingViewerProps> = ({
  workspaceId,
  shadingMode = 'clay',
  showWireframe = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    // 1. Start session via API proxy
    fetch('/api/v1/stream/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, width: 800, height: 600 }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data?.ws_url) throw new Error('No ws_url from server');

        // 2. Connect WebSocket via same-origin proxy (works behind Cloudflare)
        const wsUrl = `${window.location.origin}${data.ws_url}`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setError(null);
          ws.send(JSON.stringify({ action: 'shading', mode: shadingMode }));
          ws.send(JSON.stringify({ action: 'wireframe', enabled: showWireframe }));
        };

        ws.onmessage = async (event) => {
          if (event.data instanceof ArrayBuffer) {
            const blob = new Blob([event.data], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
              }
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(bitmap, 0, 0);
              bitmap.close();
            }
          }
        };

        ws.onerror = () => setError('WebSocket connection failed');
        ws.onclose = () => setConnected(false);
      })
      .catch(e => setError(e.message));

    return () => wsRef.current?.close();
  }, [workspaceId, shadingMode, showWireframe]);

  // Input handlers (rotate/pan/zoom)
  const send = (msg: object) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onPointerDown={e => send({ action: 'rotate', dx: 0, dy: 0 })}
        onPointerMove={e => e.buttons === 1 && send({ action: 'rotate', dx: e.movementX, dy: e.movementY })}
        onWheel={e => { e.preventDefault(); send({ action: 'zoom', delta: e.deltaY }); }}
      />
      {!connected && !error && <div className="absolute inset-0 flex items-center justify-center text-zinc-400">Connecting to stream…</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center text-red-400">{error}</div>}
      {connected && <div className="absolute top-2 right-2 text-xs text-zinc-500 bg-black/50 px-2 py-1 rounded">⚡ Server Stream (~30fps)</div>}
    </div>
  );
};
```

---

## Local useMeshLoader.ts Replacement (Simple)

```typescript
// features/workspace/Viewport/useMeshLoader.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshRenderer, detectGpuAvailability, MeshStats } from './MeshRenderer';

export type MeshLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface UseMeshLoaderResult {
  status: MeshLoadStatus;
  error: string | null;
  stats: MeshStats;
  isGpu: boolean;
  renderer: MeshRenderer | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  initRenderer: (container: HTMLDivElement) => void;
  loadModel: (url: string | null) => Promise<void>;
  unload: () => void;
}

export function useMeshLoader(): UseMeshLoaderResult {
  const [status, setStatus] = useState<MeshLoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MeshStats>({ vertices: 0, triangles: 0 });
  const [isGpu, setIsGpu] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MeshRenderer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loaderRef = useRef<GLTFLoader>(null);

  // Initialize GLTFLoader once
  useEffect(() => {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    loaderRef.current = loader;
  }, []);

  const unload = useCallback(() => {
    abortRef.current?.abort();
    rendererRef.current?.unload();
    setStatus('idle');
    setError(null);
    setStats({ vertices: 0, triangles: 0 });
  }, []);

  const initRenderer = useCallback((container: HTMLDivElement) => {
    containerRef.current = container;
    const gpu = detectGpuAvailability();
    setIsGpu(gpu);
    rendererRef.current = new MeshRenderer(container, gpu);
  }, []);

  const loadModel = useCallback(async (url: string | null) => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    rendererRef.current?.unload();
    setStatus('loading');
    setError(null);

    if (!url || !rendererRef.current || !loaderRef.current) {
      if (!rendererRef.current) setError('Renderer not initialized');
      setStatus('error');
      return;
    }

    try {
      const res = await fetch(url, { signal: abortController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (abortController.signal.aborted) return;

      const gltf = await loaderRef.current.parseAsync(buffer);
      const group = gltf.scene || new THREE.Group().add(gltf);

      // Compute stats
      let vertices = 0, triangles = 0;
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          vertices += child.geometry.attributes.position?.count || 0;
          triangles += child.geometry.index ? child.geometry.index.count / 3 : (child.geometry.attributes.position?.count || 0) / 3;
        }
      });

      rendererRef.current.load(group);
      setStatus('loaded');
      setStats({ vertices, triangles: Math.round(triangles) });
    } catch (e) {
      if (!abortController.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Failed to load mesh');
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    rendererRef.current?.dispose();
  }, []);

  return { status, error, stats, isGpu, renderer: rendererRef.current, containerRef, initRenderer, loadModel, unload };
}
```

---

## MeshViewer.tsx Integration

```tsx
// features/workspace/Viewport/MeshViewer.tsx
// ... imports
import { StreamingViewer } from './StreamingViewer';
import { useMeshLoader } from './useMeshLoader';
import { MeshRenderer, MeshLoadStatus } from './MeshRenderer';

// Inside component:
const meshSizeMB = currentAsset?.file_size_mb || 0;

return (
  <div ref={containerRef} className="relative w-full h-full ...">
    {meshSizeMB > 20 ? (
      <StreamingViewer
        workspaceId={workspaceId}
        shadingMode={shadingMode}
        showWireframe={showWireframe}
      />
    ) : (
      <> {/* Local renderer + UI */} </>
    )}
  </div>
);
```

---

## Verification Checklist

| Test | Expected |
|------|----------|
| Small mesh (<20 MB) | Downloads in <10s, 60fps smooth, 🎯 Fit Camera works |
| Large mesh (>20 MB) | Server stream starts in <3s, ~30fps, no download, works on 1 Mbps |
| Switch between assets | Clean unload, no memory leak, no cache poisoning |
| Cloudflare tunnel | WebSocket via same-origin proxy works |
| `bun tsc --noEmit` | 0 errors |
| `bun test` | All tests pass |

---

## Estimated Effort

| Task | Files | Lines | Time |
|------|-------|-------|------|
| Delete complex files | 5 | - | 5 min |
| Write StreamingViewer.tsx | 1 | ~80 | 30 min |
| Simplify useMeshLoader.ts | 1 | ~100 | 30 min |
| Update MeshViewer.tsx | 1 | ~30 | 15 min |
| Verify + push | - | - | 20 min |
| **Total** | **3 new/modified** | **~210** | **~1.5 hours** |

---

## Notes for Future AI

- **Don't re-add cache/refCount** — it caused poisoning
- **Don't use WebRTC** — Cloudflare tunnel blocks it
- **Keep threshold configurable** — maybe via `NEXT_PUBLIC_STREAM_THRESHOLD_MB`
- **Server renderer** — `backend/streaming/renderer.py` uses moderngl (already exists)
- **WebSocket proxy** — same-origin `/api/v1/stream/.../ws` works everywhere