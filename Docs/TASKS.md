# TASK — Mesh Viewer: Local Three.js Renderer (Streaming Removed)

## Current State (2026-11-21)

### State
- **Mesh viewer** restored to `a7b28a2a` state — local-only `MeshViewer.tsx` using `GLTFLoader` + `glbCache` + `meshStats`
- **Streaming engine removed**: `backend/api/routers/streaming.py`, `backend/streaming/` directory deleted
- **No server-side streaming** — all mesh loading is local (download → parse → render)
- **MeshLoader.ts**, `useMeshLoader.ts`, `StreamVideoViewer.tsx`, `useWebSocketStream.ts` — all deleted (cache system removed)

### What Works
| Component | Status |
|-----------|--------|
| Local `MeshViewer.tsx` with `GLTFLoader` + `glbCache` | ✅ Downloads GLB, parses, renders inline |
| `glbCache.ts` | ✅ URL-keyed fetch cache with L1/L2 tiers |
| `meshStats.ts` | ✅ Mesh statistics collection |
| Mesh download endpoint (`/api/v1/system/jobs/{id}/download`) | ✅ Serves generated GLB files |

### Known Limitation
- Large meshes (80-100MB) must be downloaded to browser before rendering — slow on 1 Mbps connections
- No server-side streaming fallback (removed intentionally per user decision)

---

## Requirements (User's Mandate)

1. **Local mesh download only** — no server-side streaming
2. **Smooth 60fps** for meshes that download successfully
3. **Simple code** — no complex caching, no refCount, no WebRTC, no streaming engine
4. **Single viewport component** — local Three.js rendering only

---

## Current File State (Mesh/Viewport)

### Files Present
| File | Purpose |
|------|---------|
| `features/workspace/Viewport/MeshViewer.tsx` | ✅ Restored to `a7b28a2a` — local GLTFLoader + glbCache rendering |
| `features/workspace/lib/glbCache.ts` | ✅ URL-keyed fetch cache (L1 RAM + L2 CacheStorage) |
| `features/workspace/Viewport/meshStats.ts` | ✅ Mesh vertex/triangle stats |
| `features/workspace/Viewport/meshStats.test.ts` | ✅ meshStats tests |
| `features/workspace/Viewport/ViewportToolOverlay.tsx` | ✅ Tool overlay with LightTone from `../types` |
| `features/workspace/Viewport/ModelComparisonViewer.tsx` | ✅ Model comparison viewer |
| `features/workspace/Viewport/GenerationLoadingPreview.tsx` | ✅ Generation loading preview |

### Files Deleted (Not Present)
| File | Reason |
|------|--------|
| `features/workspace/Viewport/MeshRenderer.ts` | Did not exist at `a7b28a2a` — deleted |
| `features/workspace/Viewport/useMeshLoader.ts` | Did not exist at `a7b28a2a` — deleted |
| `features/workspace/Viewport/MeshLoader.ts` | Cache system removed |
| `features/workspace/Viewport/StreamVideoViewer.tsx` | WebRTC viewer removed |
| `features/workspace/hooks/useWebSocketStream.ts` | WS hook removed |
| `backend/api/routers/streaming.py` | Streaming engine removed |
| `backend/streaming/` | Entire directory removed |

---

## Verification Checklist

| Test | Expected |
|------|----------|
| Small mesh (<20 MB) | Downloads via glbCache, parses with GLTFLoader, renders inline |
| Large mesh (>20 MB) | Downloads (may be slow on 1 Mbps), renders when complete |
| `bun tsc --noEmit` | 0 errors |
| `bun test` | All tests pass |

---

## Notes for Future AI

- **Do not re-add streaming engine** — user decided to remove it
- **Do not re-add MeshRenderer/cache system** — mesh loading is now inline in MeshViewer.tsx
- **MeshViewer.tsx uses `GLTFLoader` directly** with shared loader instances (DRACO + meshopt)
- **`glbCache.ts` handles caching** — L1 RAM + L2 CacheStorage with progress callbacks
- **`lightTone` type** is exported from `MeshViewer.tsx` and imported by `ViewportToolOverlay.tsx`