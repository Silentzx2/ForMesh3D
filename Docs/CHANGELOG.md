# ForMesh3D Changelog

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

## 2026-11-09 — Total 26 Placeholder Eradication, Canonical Runners, Dynamic 3D Mini-Viewports & Center Viewport Confinement

- **Canonical Workspace Runners & Viewport Auto-Load (`WorkspaceContext.tsx`)**:
  - Implemented `runAutoRigging` and `runMotionGeneration` in `WorkspaceContext.tsx` with centralized job polling loop (`bindBackendJob`). Upon completion, models automatically load into `MeshViewer` via `loadModelInViewer`.
  - Added dual-path fallback in `runSegmentation` to `POST /api/v1/mesh-tools/segment` (Trimesh hierarchical decomposition) whenever backend model scheduler returns HTTP 400.
  - Added automatic blob mesh upload to `POST /api/v1/file-upload/mesh` in `resolveMeshReference`.
  - Updated `workspaceRouteContract.ts` to accept `^[a-zA-Z0-9_\-\.]{3,128}$` (eliminating deep-link/refresh 404s) and constructed human-friendly mesh slugs `${cleanName}_${shortHash}`.
- **Canonical Dual Upload Card Harmonization & Live Upload Progress Bar (`Panels/*.tsx`)**:
  - Unified the canonical dual Image & 3D Mesh upload card across ALL 7 panels (`GeneratePanel`, `RemeshPanel`, `UVPanel`, `SegmentationPanel`, `RiggingPanel`, `AnimationPanel`, `TexturePanel`) to be 100% byte-for-byte identical (9,547 characters / 9,552 UTF-8 bytes).
  - Integrated live upload progress bar directly beneath the card across all panels: shows file name, percentage, animated progress gradient, bytes transferred/total (`14.2 MB / 32.0 MB`), and estimated time remaining (`~Xs left`).
- **Dynamic 3D Mini-Viewports (`RealModelPreviewCanvas.tsx`, `Dynamic*.tsx`)**:
  - Created shared ~200-line `RealModelPreviewCanvas.tsx` binding directly to `useViewerStore((s) => s.activeModelObject)` with OrbitControls, raycasting, and geometry buffer sharing without vertex duplication.
  - `DynamicRiggingInspector`: Eradicated fake SVG doll silhouette with real 3D mini-viewport, clickable joint nodes, live bone rotation sliders (Pitch/Yaw/Roll), pose presets (`T-Pose`, `A-Pose`, `Combat`, `Sitting`), X-Ray toggle, and real `.glb` export.
  - `DynamicSegmentationInspector`: Eradicated fake SVG doll silhouette with real 3D partitioned mesh, part visibility toggling (Eye/EyeOff) that mutates `mesh.visible` in live scene, and real `.zip` export via `buildSimpleZip`.
  - `DynamicAnimationInspector`: Connected timeline scrubber, Play/Pause/Reset, speed pills (`0.5x`, `1.0x`, `2.0x`), and looping directly to `THREE.AnimationMixer` via `useAnimationStore`. Eradicated fake 900ms timeout with real `.glb` motion clip export.
  - `DynamicUVInspector`: Connected procedural 256x256 checkerboard texture (`viewportChecker`) and red seam cuts (`highlightSeams`) to active model material. Added real 1024x1024 PNG layout export.
- **Live Two-Way Viewport Bridge & Client Exporters (`RightPropertyPanel.tsx`, `clientExporters.ts`)**:
  - Bound Object Transforms (Position X/Y/Z, Rotation X/Y/Z, Scale X/Y/Z) and Material Channels (Roughness, Metallic, Normal Strength) directly to `modelGroupRef.current` and live Three.js uniforms with dedicated Identity Reset button.
  - Created `features/workspace/utils/clientExporters.ts` (`GLTFExporter`, `OBJExporter`, `STLExporter`, `PLYExporter`) enabling instant local downloads when backend artifacts are unbaked.
  - Fixed `ModelComparisonViewer.tsx` line 396 placeholder with real model URL resolution.
  - Fixed `ExportModal.tsx` premature LOD abort with on-demand `SimplifyModifier` decimation.
- **Tripo-Style Center Viewport Confinement & Non-Collapsible Panels (`WorkspaceShell.tsx`)**:
  - Center 3D stage (`#center-viewport-stage`) is strictly confined between left panel (`w-[274px]`, `left-2`) and right panel (`w-[260px]`, `right-2`) with `md:left-[284px]` and `md:right-[270px]`.
  - Background behind panels is solid pitch black (`#090a0f` / `#0c0d12`), preventing any 3D canvas or mesh geometry from bleeding or rendering behind panels.
  - Removed all panel collapse buttons and toggles; panels remain permanently open and non-collapsible.
- **Verification & Inviolable Safeguards**:
  - `bun x tsc --noEmit`: 0 errors.
  - `bun test`: 8 passed, 0 failed.
  - `setup.sh`: 100% untouched.
  - Canonical dual upload card: 100% byte-for-byte identical across all 7 panels.
  - CTA action buttons: 100% generic descriptive verbs with zero model names.

---

## 2026-11-09 — Interactive 3D Dynamic Rigging & Segmentation Inspectors with Real Model Geometry & Armature

- **Interactive Dynamic Rigging Inspector (`DynamicRiggingInspector.tsx`)**:
  - Implemented interactive 3D Armature mini-box with real bone joint linkages and humanoid wireframe envelope.
  - Added clickable 3D joint nodes (Root, Hips, Spine, Chest, Neck, Head, Shoulders, Arms, Hands, Legs, Feet) with active selection rings.
  - Interactive bone rotation sliders: Pitch (X-Axis), Yaw (Y-Axis), Roll (Z-Axis) ranging from -180° to +180° with live degree readouts.
  - Instant pose presets (`T-Pose`, `A-Pose`, `Combat`, `Sitting`) with 0ms response and automatic symmetric mirroring.
  - Dual toggles for Symmetry Mirroring and X-Ray Bone Vision (transparent mesh rendering).
  - Wired into `RightPropertyPanel.tsx` to automatically mount whenever `activeTool === 'rigging'`.
- **Real Model Data Binding (`DynamicUVInspector.tsx`, `DynamicSegmentationInspector.tsx`, `DynamicRiggingInspector.tsx`)**:
  - Bound dynamic inspectors to `useViewerStore.getState().activeModelObject`:
    - `DynamicUVInspector`: Extracts real UV coordinates (`geometry.attributes.uv`) from active model, computing true UV surface area, bounding boxes, packing density, and texel utilization, displaying a dynamic `Real UV` badge.
    - `DynamicSegmentationInspector`: Extracts real mesh sub-objects and geometric vertex partitions from loaded models with interactive 3D click-to-select parts, live volume metrics, and `Real Mesh` badge.
    - `DynamicRiggingInspector`: Detects real `THREE.Bone`/`SkinnedMesh` armature or adapts canonical humanoid joints to actual model bounding box dimensions with `Real Bones` badge.
- **Eliminated Vertical Scrollbars on Left Tool Panels (`SegmentationPanel.tsx`, `AnimationPanel.tsx`)**:
  - Streamlined primary controls to keep zero-scroll presentation across all viewport heights down to 577px.
  - Secondary parameters (decomposition modes, duration fine-slider, hierarchical tree, ground lock) cleanly encapsulated inside dynamic portal flyouts.
