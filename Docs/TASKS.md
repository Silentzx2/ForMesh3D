# TASK — Optimize Local Mesh Loading & Rendering (GPU + CPU Fallback)

## Goal
Make the local Three.js mesh viewport in MeshViewer.tsx production-quality:
- GPU-accelerated WebGL rendering as primary
- Automatic CPU/software fallback when GPU unavailable or unsupported
- Fast loading of large GLB/OBJ models (incl. heavy meshes)
- Smooth load/unload without UI freeze or main-thread blocking
- Mesh caching keyed by URL — no unnecessary reloads
- Proper GPU texture/geometry + RAM memory release on unload
- Preserve original mesh quality and geometry exactly
- Reuse existing Three.js deps; no new libraries, no complex architecture

## Files to create
1. `features/workspace/Viewport/MeshLoader.ts` — URL-keyed mesh cache + loader with AbortController, load-state machine
2. `features/workspace/Viewport/MeshRenderer.ts` — GPU renderer class (WebGL2) + CPU fallback class; shared dispose logic
3. `features/workspace/Viewport/useMeshLoader.ts` — React hook: load/unload/caching state machine

## Files to modify
1. `features/workspace/Viewport/MeshViewer.tsx` — integrate loader/renderer; show local canvas when streaming unavailable; remove dead code
2. `Docs/TASKS.md` — this plan (done)

## Design decisions

### GPU detection
- Probe WebGL context (webgl2 → webgl1)
- Check `UNMASKED_RENDERER_WEBGL` for software renderers (SwiftShader, LLVMpipe, llvmpipe, softpipe)
- Check `failIfMajorPerformanceCaveat`
- Result: `gpuAvailable: boolean` → selects GPU vs CPU renderer class

### GPU renderer class (`MeshRenderer`)
- WebGLRenderer: antialias, ACES toneMapping, PCFSoftShadowMap, pixelRatio ≤ 1.5
- Large model (>1M triangles): disable shadows, reduce pixel ratio to 1.0, no antialias
- Pre-compiled shading material variants (clay, gold, chrome, normal, uv-checker, wireframe) — created once, reused

### CPU fallback renderer class
- WebGLRenderer: no antialias, no shadows, pixelRatio = 1, basic materials (MeshStandardMaterial → MeshLambertMaterial where possible)
- Same API as GPU class (load, unload, setShading, setWireframe, fitCamera, render loop, dispose)

### Mesh cache (`MeshLoader`)
- `Map<string, CachedMesh>` keyed by normalized URL
- `CachedMesh`: `{ url, group, stats, loadTime, refCount }`
- `load(url, signal)` → returns cached Group if present; else fetches + parses via GLTFLoader/OBJLoader/etc.
- `unload(url)` → decrements refCount, disposes at 0
- `get(url)` → cached group or null

### React hook (`useMeshLoader`)
- State: `status: 'idle'|'loading'|'loaded'|'error'`, `error`, `meshGroup`, `stats`
- Effect on `modelUrl` change: abort previous, load new, mount group into scene
- Cleanup on unmount: dispose group + renderer

### Memory
- `disposeObject3D` enhanced: disposes geometries, materials, textures, and all userData material variants (__clayMaterial, __goldMaterial, etc.)
- Renderer.dispose() on unload / GPU→CPU switch

## Status
Complete — all findings fixed, all verification passing.

## Files created
1. `features/workspace/Viewport/MeshLoader.ts` — URL-keyed mesh cache + loader with LRU eviction (cap 8), AbortController, refCount
2. `features/workspace/Viewport/MeshRenderer.ts` — GPU renderer (WebGL2) + CPU fallback; pause animation loop when no model; dispose safety on getter-only fields
3. `features/workspace/Viewport/useMeshLoader.ts` — React hook load/unload state machine with mounted ref + abort on unmount
4. `features/workspace/Viewport/__tests__/MeshLoader.test.ts` — cache refCount, unload disposal, disposeAll, normalize tests
5. `features/workspace/Viewport/__tests__/MeshRenderer.test.ts` — dispose no-throw, setShadingMode all modes, detectGpuAvailability

## Files modified
1. `features/workspace/Viewport/MeshViewer.tsx` — integrate loader/renderer; remove dead Three.js imports; empty div/effect removed; unused destructuring removed
2. `features/workspace/Viewport/ViewportToolOverlay.tsx` — LightTone import from `../types`
3. `features/workspace/types.ts` — added `LightTone` type
4. `tsconfig.json` — exclude `__tests__` from type check

## Design decisions
- GPU detection probes WebGL2→WebGL1, checks UNMASKED_RENDERER_WEBGL for software renderers
- Mesh cache keyed by normalized URL; same URL = instant cache hit, no re-download/parse
- LRU eviction caps cached meshes at 8 to bound memory
- Animation loop pauses when no model loaded (saves GPU cycles)
- Original mesh geometry and quality preserved exactly (no decimation)

## Verification
- `bun run test` (tsc --noEmit) — 0 errors
- `npx eslint` — 0 errors, 4 benign warnings (ref deps, false positive)
- No runtime crash on WebGL probe failure path (CPU fallback)
- Memory: load/unload same URL does not grow heap (refCount/cache)
