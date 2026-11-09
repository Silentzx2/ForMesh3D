# ForMesh3D Changelog

## 2026-11-09 — Context-Aware Viewport Compare & In-Panel PBR Routing

- Added an on-demand Before / After wipe control to the viewport rail. It is enabled only when the selected asset has distinct source and processed model URLs.
- Reuses the persistent MeshViewer scene, camera and WebGL renderer. The source mesh is loaded only while comparison is active; scissored render passes and a DOM-driven divider avoid a second WebGL context and per-pointer React renders.
- Processing tasks retain their original input mesh URL on remesh, texture, segmentation, rigging and edit outputs, so the compare action can resolve genuine lineage rather than inventing a Before model.
- Added Texture / PBR routing inside the existing Texture panel. The hidden PBR route reuses the same panel and its existing map-baking controls, preserving the persistent workspace transition.

## 2026-11-09 — Workspace UI/UX Polish

- Removed internal scrolling from the seven tool panels, contextual property inspectors, and paginated asset view.
- Preserved existing controls, Studio Gold / matte-black styling, upload cards, Generate-panel reference, and permanently docked desktop side panels.
- Added viewport-height-aware upload previews/dropzones, compact tablet inspector sizing, tool-specific empty-state copy, and slightly more readable rail labels.
- No new tools, buttons, dependencies, or panel-collapse controls were introduced.

## 2026-11-09 — Dual-Engine Processing Bridge (AI vs Fast Script), Dynamic Parameter Forwarding, Task Abort Fix & Multi-Part GLB Viewport Presentation

- **Unified Mesh Processing Bridge & Script Registry (`meshProcessingBridge.ts`, `EngineModeSelector.tsx`)**:
  - Implemented single unified execution bridge (`meshProcessingBridge.ts`) providing plug-and-play dispatching across both:
    1. **Neural AI Mode (`ai`)**: High-fidelity GPU model inference scheduled via FastAPI / multiprocess scheduler (`FastMesh Quad Remesher`, `PartUV Deep Island Unwrapper`, `Neural Semantic Part Segmentation`).
    2. **Fast Algorithmic Script Mode (`script`)**: Direct, zero-GPU / CPU streaming via SSE with real-time progress (`Trimesh AutoRetopo & Taubin Smoothing`, `XAtlas Native C++/Python Atlas`, `Blender Smart UV Project`, `Trimesh Geometric Decomposition`).
  - Added shared, compact `EngineModeSelector` component with live hardware sensing (`GPU Neural` vs `GPU Offline` vs `CPU Script`) and sub-algorithm selector (e.g. XAtlas vs Blender for UV).
- **Dynamic Parameter Forwarding & Zero-Scroll Dynamic Model Selector (`RemeshPanel.tsx`, `UVPanel.tsx`, `SegmentationPanel.tsx`)**:
  - Full dynamic parameter passthrough: target polycount budget, quad/triangle topology, adaptive density, feature angles, target parts partition count (2–32), UV atlas resolution (1K/2K/4K), and island margin texels (2–16px).
  - Dynamic Model Selector visibility in `RemeshPanel`: Retopo Engine dropdown is visible in `AI Model` mode, and seamlessly hidden in `Fast Script` mode to preserve a compact, zero-scroll panel height without vertical scrollbars across small screens.
- **AbortController Upstream Cancellation Fix (`route.ts`, `WorkspaceContext.tsx`)**:
  - Fixed Next.js runtime API proxy stream handler to hook incoming client `request.signal` abort directly to an upstream `AbortController`.
  - When a user cancels generation or a client disconnects, `controller.abort()` immediately terminates backend streaming and server-side execution, freeing GPU/CPU resources instantly.
- **Multi-Part Colored GLB Scene Generation & Automatic 3D Viewport Presentation (`segment.py`, `WorkspaceContext.tsx`)**:
  - Enhanced backend Trimesh segmentation (`backend/postprocess/services/segment.py`) to partition input geometry into individual submeshes with distinct palette colors in a composite `trimesh.Scene` exported as base64-encoded GLB.
  - Automatically loads resulting single-mesh and multi-part GLB scenes into `MeshViewer` via `loadModelInViewer` and triggers camera re-framing (`setViewportResetTrigger`) for instant 3D inspection.

---
