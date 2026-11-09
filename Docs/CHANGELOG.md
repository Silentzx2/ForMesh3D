# ForMesh3D Changelog

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

## 2026-11-09 — Dedicated Dynamic Tool Inspector Routing, Viewport Planar UV Fallback & Model Page Property Isolation

- **Dedicated Tool Inspectors in Right Property Panel (`RightPropertyPanel.tsx`)**:
  - Isolated default general mesh properties (Object Transform, Geometry & Topology, Viewport Shading, Model Comparison Viewer, Quick Export) exclusively to the `model` page (`/workspace/generate` or `/workspace/model`).
  - Implemented dedicated, full-height inspector panels with custom branded headers and zero default properties leakage for all tool pages:
    - Smart UV (`uv`): `DynamicUVInspector` with real 2D UV wireframe, coverage %, UV faces, and viewport toggles.
    - Segmentation (`segment`): `DynamicSegmentationInspector` with real 3D color-coded submesh preview, part hierarchy, visibility toggles, and ZIP export.
    - Animation (`animation`): `DynamicAnimationInspector` with Three.js mixer scrubber, timeline playback, speed pills, and GLB motion clip export.
    - Rigging (`rigging`): `DynamicRiggingInspector` with real 3D armature, joint hierarchy, Pitch/Yaw/Roll sliders, pose presets, X-Ray mode, and GLB rigged export.
    - Retopology (`remesh`): Dedicated Quad Retopology Inspector displaying FastMesh variant, polygon topology type, alignment, telemetry, and wireframe overrides.
    - PBR Material (`texture`/`pbr`): Dedicated PBR Material Inspector displaying roughness, metallic, normal intensity, cavity/AO strength, and normal format standard toggles.
- **Client-Side Quick Planar UV Fallback (`DynamicUVInspector.tsx`)**:
  - Enhanced `DynamicUVInspector` to support multi-attribute UV resolution (`uv`, `uv_0`, `texcoord_0`, `uv2`).
  - Added instant client-side planar UV projection (`handleQuickPlanarUV`) for meshes without native UV maps (e.g. raw vertex-colored GLBs), generating normalized bounding-box UVs in 1ms directly on the Three.js geometry for immediate wireframe plotting and texture testing.
  - Provided dual-action empty state: 1-click Quick Viewport UVs (client) or Smart UV Unwrap (XAtlas backend pipeline).
- **Tool Navigation State & Model ID Deep Linking (`WorkspaceContext.tsx`, `WorkspaceShell.tsx`)**:
  - Ensured switching tool tabs preserves active model ID in URL path (`/workspace/<tool>/<model_id>`) without dropping the model or causing full page remounts.
  - Maintained Tripo-style center viewport confinement (`md:left-[284px]` and `md:right-[270px]`) and non-collapsible side panels (`left-2 w-[274px]`, `right-2 w-[260px]`).

---
