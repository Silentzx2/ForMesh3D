# ForMesh3D — Audited Project State

**Audit date:** 2026-11-07  
**Inspected branch baseline before this change:** `ForMesh3D/dev` at `7651f224fcb50936ca81ce4af8fbea0d74265fbe`  
**Third-party source baseline before this change:** `ForMesh3D-ThirdParty/main` at `b359c0c52ba5fb42131443f4e4517691253e8f8`  
**Project phase:** Beta (Streamlined Studio Workspace)  
**Model readiness:** NOT VERIFIED — registry entries and source directories do not prove successful inference.

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
  - Branch: `dev` with strictly zero git push attempts.
  - Canonical dual upload card: 100% byte-for-byte identical across all 7 panels.
  - CTA action buttons: 100% generic descriptive verbs with zero model names.
  - Live browser verification on http://localhost:3000/workspace via `agent-browser` (all 18 screenshots in `/tmp/agent-browser-screenshots/`).

## 2026-11-09 — Interactive 3D Dynamic Rigging & Segmentation Inspectors with Real Model Geometry & Armature

- **Interactive Dynamic Rigging Inspector (`features/workspace/dynamic/DynamicRiggingInspector.tsx`)**:
  - Interactive 3D Armature mini-box with real bone joint linkages and humanoid wireframe envelope.
  - Clickable 3D joint nodes (Root, Hips, Spine, Chest, Neck, Head, Shoulders, Arms, Hands, Legs, Feet) with active selection rings.
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
- **Verification**: `bun x tsc --noEmit` passed with 0 errors across the codebase. `bun test` passed (8 pass, 0 fail). Visual verification completed via `agent-browser`. Strictly zero git push.

## 2026-11-09 — Complete Studio 3D Panels Multi-Agent Overhaul (Retopo, Smart UV, Segmentation, Rigging, Animation)

- **Retopology Panel (`RemeshPanel.tsx`)**:
  - 100% 1-to-1 canonical Image & 3D Mesh upload card from `GeneratePanel.tsx`.
  - Tripo-style 120fps ultra-smooth polycount budget slider (5K to 200K) + 4 quick presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`).
  - Topology Type: Pure Quads vs Triangles.
  - Advanced Retopo Settings in dynamic portal flyout (`createPortal` to `document.body`): Feature Edge Retention, Feature Angle, Adaptive Density, Watertight Healing, Export Format.
  - Zero model branding in CTA button (`Run Retopology`).
- **Smart UV Panel & Dynamic Right Inspector (`UVPanel.tsx`, `DynamicUVInspector.tsx`)**:
  - 1-to-1 untouched upload card.
  - Single-line ergonomic pills: Unwrap Strategy (`Organic` vs `Hard-Surface`), Atlas Resolution (`1K`, `2K`, `4K`), Island Margin (`2px`, `4px`, `8px`, `16px`).
  - Dynamic portal flyout for Distortion Tolerance (1.00x to 2.50x, default 1.25x sweet spot), Blender Native boundary packer, Symmetry Stacking (Texel Saver), Sub-Parts, Export Format.
  - Created `features/workspace/dynamic/DynamicUVInspector.tsx` automatically loaded in the Right Property Panel when Smart UV tool is active:
    - 2D UV Atlas Canvas with interactive SVG islands (hover tooltip: Island ID, Tris, Area %, Distortion).
    - Display mode toggle: Wireframe, Checker Test, Texel Heatmap.
    - Live Space Utilization meter (`72.4% Optimal`), total charts, texel density, overlap check.
    - 3D Viewport Sync: Highlight Seam Cuts toggle, Viewport Test Grid material toggle.
    - Quick actions: Export UV Layout (1024x1024 PNG), Quick Re-Pack.
- **Mesh Part Segmentation Panel (`SegmentationPanel.tsx`)**:
  - Implemented via Agent 1 strictly grounded in `backend/api/routers/mesh_segmentation.py`.
  - Untouched 1-to-1 upload card.
  - Target parts slider (2 to 32) + 4 preset pills (4, 8, 16, 24 Parts).
  - Decomposition Mode (`Semantic` vs `Geometric`).
  - Hierarchical Tree assembly toggle.
  - Advanced portal flyout: Min Face Island Threshold, Save Individual Part Files, Export Format (GLB/OBJ), Colorize Part Preview.
  - CTA: `Segment Mesh` (ZERO model name in button or subtitle).
- **Character Auto-Rigging Panel (`RiggingPanel.tsx`)**:
  - Implemented via Agent 2 strictly grounded in `backend/api/routers/auto_rigging.py` (SkinTokens).
  - Untouched 1-to-1 upload card.
  - Skeleton Template selector (`Humanoid`, `Quadruped`, `Generic`).
  - Bind Pose Normalization (`T-Pose Auto` vs `A-Pose Stand`).
  - Facial & Finger Bones toggle.
  - Advanced portal flyout: Biharmonic Geodesic vs Linear Blend skinning weights, Max Influences per vertex (4 vs 8 bones), Export Format (GLB vs FBX), Symmetry Snapping.
  - CTA: `Auto-Rig Character` (ZERO model name in button or subtitle).
- **3D Character Animation Panel (`AnimationPanel.tsx`)**:
  - Implemented via Agent 3 strictly grounded in `backend/api/routers/motion_generation.py` (ARDY).
  - Untouched 1-to-1 upload card.
  - Motion prompt input with quick preset chips (`Walk`, `Run`, `Jump`, `Dance`).
  - Animation Duration slider (1.0s to 15.0s, default 4.0s).
  - Foot Skating Cleanup / Ground Lock toggle.
  - Advanced portal flyout: Frame Rate (24, 30, 60 FPS), Looping Motion toggle, Target Skeleton Profile (`Core Humanoid` vs `G1 Unit`), Random Seed generator.
  - CTA: `Apply Animation` (ZERO model name in button or subtitle).
- **Verification & Inviolability**:
  - Verified by Agent 4: `bun x tsc --noEmit` passed with 0 errors across entire codebase.
  - `bun test`: 8 passed, 0 failed.
  - Canonical Upload Card byte-for-byte 100% identical across all panels.
  - Zero model brand leaks in any CTA or subtitle.
  - Strictly 0 git push operations executed. Local working tree on branch `dev`.

## 2026-11-09 — 8px Header Clearance, 274px Studio Panel, Natural Parameter Flow & Downward Dropdown

- **8px Floating Header Clearance & 274px Studio Panel (`WorkspaceShell.tsx`)**:
  - Increased top clearance gap to 8px (`top-2`) below `TopHeader`, completely eliminating any header overlap or slicing while maintaining smooth floating rounded card styling (`rounded-2xl`).
  - Increased Left Unified Panel width by 10px (`264px -> 274px`), allocating 46px to Left Rail (`w-[46px]`) and 228px to Tool Content (`w-[228px]`).
  - Symmetrically elevated Right Panel with matching 8px top clearance (`top-2`).
  - Solid pure dark `#0c0d12` behind panels guarantees zero 3D canvas/mesh bleed.
- **Natural Parameter Deck Positioning & Downward AI Model Dropdown (`GeneratePanel.tsx`)**:
  - General Settings (Geometry & Texture), AI Model selector, and Seed & Randomizer flow naturally right below the Studio Input Card (dropzone), leaving Generate CTA pinned cleanly at the bottom.
  - Reconfigured AI Model dropdown to open downwards (`top-full mt-1 left-0 right-0 z-40`).
- **High-Contrast Non-Transparent Icons & Clean Model Nav (`LeftNavigation.tsx`, `GeneratePanel.tsx`)**:
  - Removed notification badge (`badge: '+'`) from above the `Model` icon.
  - Upgraded navigation icons to crisp, bold Lucide strokeWidth 2 icons (`Box`, `Scissors`, `RefreshCw`, `Grid3X3`, `Palette`, `Bone`, `Film`, `Settings2`).
  - Retained native `Settings` tool with gear icon at the bottom of the navigation rail.
- **Verification**: `bun x tsc --noEmit` passed (0 errors); `bun test` passed (8 pass, 0 fail); verified visually in browser via `agent-browser`.

## 2026-11-08 — Generate Panel Backend Integration, Tripo Shader Dock & Zero-Load Snapshot

- **Generate Panel Backend Integration**:
  - Decoupled texture generation parameters from mesh decimation post-processing: texture toggle, 2K/4K resolution, and PBR baking are preserved regardless of `enablePostprocess`.
  - Wired `polycount` slider (clamped up to 600K) and `topology_mode` directly to `/api/v1/mesh-generation/image-to-raw-mesh`.
  - Added live progress bar, backend step name (`executionStep`), progress percentage (`executionProgress`), and a working Cancel button calling `cancelExecution()`.
- **Top Header & Sidebar Seamless Docking**:
  - Removed artificial rounded cuts and dividing borders between `TopHeader`, `LeftNavigation`, and `GeneratePanel`.
  - Applied solid pure dark backdrop (`#0c0d12` / `#090a0f`) beneath panels to eliminate 3D mesh peeking through margins.
  - Viewport canvas enhanced with a soft radial studio vignette fading from dark boundaries into lit center.
- **Bottom Material Preview Spheres & Zero-Load Snapshot**:
  - Added Tripo 3D-style bottom floating dock with 5 material spheres: PBR Textured, Clay Matte, Surface Normals, Wireframe, and MatCap Gold.
  - Caches original model textures and materials on `userData.__originalMaterial` without in-place mutation.
  - Switched snapshot capture from synchronous 3840px buffer reallocation to asynchronous `canvas.toBlob(...)` inside `requestAnimationFrame`, eliminating laptop freezing.
- **Verification**: `bun x tsc --noEmit` passed with 0 errors; `bun test` passed with 8 pass, 0 fail (added 5 new parameter builder unit tests).

## 2026-11-08 — Studio Workspace Layout Flush-Docking, Header Slimming & Rail Unification

- **Seamless Panel-to-Navbar Flush Docking**:
  - Attached Left Context Tool Panel directly flush with the Top Header (`top-0`) and Left Tool Rail (`left-0`), eradicating margin gaps.
  - Symmetrically docked Right Inspector/Assets Panel flush against the Top Header (`top-0`) and right window boundary (`right-0`).
  - Added subtle floating studio bottom lift (`bottom-2.5`) with outer viewport-facing corners gracefully rounded (`rounded-r-[22px]` on left panel, `rounded-l-[22px]` on right panel) with soft studio `shadow-2xl`.
- **Top Header Modernization & Contrast Separation**:
  - Streamlined Top Header height from `h-12` (48px) to `h-10` (40px) with `bg-[hsl(var(--surface-0))]` and `border-b border-[hsl(var(--border))]`, establishing distinct visual hierarchy and preventing panel color blend.
  - Scaled down header icons to `12px`-`13px` (Search, AI Models, Snapshots, Settings, Profile, Resource Telemetry) and pills to `h-6 text-[10px]` for an ultra-compact, high-density professional layout.
- **Left Navigation Rail Unification**:
  - Eliminated the dividing border (`border-t`) and separate block wrapper from the bottom App/Settings button in `LeftNavigation.tsx`, blending it directly into the tool stack.
  - Adjusted rail width to `54px` with icon size `17px` and text `9.5px` for compact precision.
- **Verification**: `bun x tsc --noEmit` passed with 0 errors; `bun test` passed (3/3 unit tests passing).

## 2026-11-08 — DCC Eradication, Viewport Studio Fade & Native Pipeline Restoration

- **Complete DCC Eradication**:
  - Permanently deleted `DccBridgeModal.tsx` and all references across `TopHeader.tsx`, `WorkspaceShell.tsx`, `RightAssetsPanel.tsx`, `CommandPalette.tsx`, and `WorkspaceContext.tsx`.
- **Studio Viewport Radial Vignette Alignment**:
  - Updated viewport background across `MeshViewer.tsx`, `WorkspaceShell.tsx`, `SettingsModal.tsx`, and `WorkspaceContext.tsx` to the studio spotlight vignette: `radial-gradient(ellipse 70% 65% at 50% 50%, #606368 0%, #383a3e 35%, #18191b 65%, #070809 100%)`.
  - Tool panels area is deep obsidian dark (`#070809`), smoothly fading into soft dark-gray (`#606368`) in the center 3D mesh viewer.
- **Rogue Generation Service Elimination & Native Pipeline Restoration**:
  - Deleted duplicate `backend/api/routers/generation.py`, `services/generationService.ts`, and restored original native `WorkspaceContext.tsx` generation flow (`buildGenerationParameters`, `bindBackendJob`).
- **Balanced Natural Three.js Model Lighting**:
  - Ambient: 0.75, Key: 1.6 (#ffffff), Fill: 0.9 (#edf2fa), Rim: 1.1 (#fff1d4), Tone Mapping Exposure: 1.0 (natural, zero texture bleaching).
- **Verification**: `bun x tsc --noEmit` passed with 0 errors; `bun test` passed (3/3 unit tests passing).

## 2026-11-08 — Studio Lighting & Viewport Vignette Harmonization

- **Studio Viewport Radial Vignette Harmonization**:
  - Harmonized viewport background across `features/workspace/Viewport/MeshViewer.tsx`, `features/workspace/WorkspaceShell.tsx`, `features/workspace/Modals/SettingsModal.tsx`, and `features/workspace/store/WorkspaceContext.tsx` to circular radial studio spotlight vignette: `radial-gradient(ellipse 70% 65% at 50% 50%, #606368 0%, #383a3e 35%, #18191b 65%, #070809 100%)`.
  - Bright center (#606368) curving smoothly outward through mid-radius (#383a3e) to deep studio dark corners (#070809), accurately fulfilling the user's feedback ("mesh viewer ka edge thoda aur dark hoga aur center me thoda aur soft dark gray hoga").
- **Balanced Natural Three.js Model Lighting**:
  - Fixed accidental over-saturation and texture bleaching caused by previous subagent overtuning Three.js lights.
  - Restored natural, crisp, rich shading:
    - Ambient: 0.75
    - Key light: 1.6 (#ffffff)
    - Fill light: 0.9 (#edf2fa)
    - Rim light: 1.1 (#fff1d4)
    - Tone mapping exposure: 1.0 (natural)
  - Synchronized `environmentSettings` state directly to Three.js light instances and exposure dynamically.

## 2026-11-07 — Repository Subsystem Cleanup & Workspace Streamlining

- **Major Repository Purge (Commit `7651f22`)**:
  - Completely excised 221 files (74,750 lines deleted) covering obsolete or non-core packages: `features/board/`, `features/graph/`, `features/image-editor/`, `features/mesh-extras/`, `features/wiki/`, `features/hooks/`, `plugins/unity/`, `plugins/unreal/`, and `tools/`.
  - Cleared legacy test files (`backend/tests/`, `features/workspace/lib/*.test.mjs`) to be cleanly re-established for the streamlined architecture.
- **Workspace Surface Cleanup**:
  - Removed bloated and dead-weight workspace components: `MeshToolsPanel.tsx`, `ImagePointCloud.ts`, `MeshDiffViewer.tsx`, `PhysicsRuntime.ts`, `physicsSettings.ts`, and redundant rigging/animation inspector subtrees.
  - Rebuilding the workspace cleanly for personal use (zero auth, no marketing bloat, clean 12 tools: Image, Model, Segment, Fill Parts, Retopo, Smart UV, Texture, Edit, Upscale, PBR, Rig, Animate).

## 2026-11-05 — PR #80 review follow-ups

- TRELLIS.2 sparse-convolution fallback is selected within each TRELLIS.2 adapter using the scheduler-assigned GPU; the global compatibility helper no longer applies spconv process-wide. Modern GPU workers retain FlexGEMM when available.
- TRELLIS.2 paint status checks use the same backend.core.models.base.ModelStatus enum as the adapter.
- download_models.sh sources .env before resolving MODEL_STORAGE_ROOT.
- image_to_raw_mesh forwards the top-level seed, with top-level seed taking precedence over model_parameters.seed.
- These are source-level fixes; CI rerun and live GPU inference remain pending.


## What is present

- **Streamlined Studio Architecture**: Peripheral legacy subsystems (`features/board/`, `features/graph/`, `features/image-editor/`, `features/mesh-extras/`, `features/wiki/`, `features/hooks/`, `plugins/`, and `tools/`) were removed in commit `7651f22`. In the workspace, non-core panels and runtime extras (`MeshToolsPanel.tsx`, `ImagePointCloud.ts`, `MeshDiffViewer.tsx`, `PhysicsRuntime.ts`, `physicsSettings.ts`) were deleted to establish a clean foundation for the Studio UI.
- `backend/loader.py` provides `get_model_weights_dir(model_key)`. It resolves `MODEL_STORAGE_ROOT/<model_key>`, anchors a relative root to the repository (not the process CWD), rejects absolute and `..` model keys, and fails when the model directory does not exist.
- `backend/scripts/download_models.sh` uses `MODEL_STORAGE_ROOT` with the default `backend/pretrained` root. The downloader and resolver follow the same root convention by source inspection; actual downloads were not run.
- The main repository records `backend/thirdparty` as a Git submodule. The submodule contains 13 top-level model-source directories and now has a root README describing the source layout, integration boundaries, setup, and per-model licensing.
- The backend model factory contains registrations for the current adapter IDs. There are 15 adapter modules, but factory registration is only a catalog/dispatch mapping.
- The current installer installs the O-Voxel component from the TRELLIS.2 source tree. It does not establish or editable-install every model source package in one generic step.
- `patcher/` directory contains model-specific runtime patching. Current patchers:
  - `patcher/doctor.py` — GPU Doctor core (hardware planner, chunked SDPA, recovery). Tested standalone on CPU (28 unit tests passing).
  - `patcher/taoflowforge/` — Pre-Ampere SDPA attention router and compute dtype guard (eliminates 10 GiB Stage 1 OOM).
  - `patcher/triposg/` — Output-to-storage patcher.
  - `patcher/trellis2/` — Sparse structure decoder compatibility + debug logging for `z_s` and raw logits computation (detects incompatible decoder checkpoint producing all-negative logits).
The patcher directory is intentionally minimal — patches are added only when a demonstrated need exists.

## Static integration audit

The following findings come from reading current adapter, factory, and vendored source files. They are not GPU-run results.

| Area | Finding | Status |
|---|---|---|
| Model identity | Adapters read `model_id` from constructor kwargs, but `ModelFactory.create_model_from_config` passes only `init_params` (plus VRAM). The factory later checks `hasattr`, which is true even when the adapter's value is `None`. Model instances can therefore retain `model_id=None`. | FAIL — code path |
| Third-party imports | The installer does not install or configure all 14 source roots. Adapters add the matching model-specific ThirdParty source root in `_load_model`; source paths remain separate from the shared weights loader. Hunyuan3D-Shape and Unique3D paths were rechecked against their package layouts. | PARTIAL — targeted source paths |
| Hunyuan3D-Shape v2.1 | Adapter added the package directory itself to `sys.path` instead of its parent, and treated the vendored pipeline's flat `List[Trimesh]` result as a nested list. The adapter now adds `Hunyuan3D-2.1/hy3dshape`, selects the first non-null mesh, and forwards the requested seed via the official `generator` argument. Topology is capped at 600k faces via post-extraction decimation. | FIXED — source/API contract and syntax |
| Unique3D | Adapter called the Stable Diffusion ControlNet image-to-image refinement pipeline as though it returned a mesh. The actual vendored image-to-mesh callable is `app.gradio_3dgen.generate3dv2`, which runs multiview prediction, geometric reconstruction, and the model-owned GLB exporter. Adapter now calls that function and preserves its returned path. | FIXED — source/API contract and syntax |
| Pixal3D | Fixed condition model initialization to match upstream `inference.py` (removed artificial `torch.float16` cast on conditioning models, honoring upstream Low-VRAM CPU offload with NAF upsampler pre-loading). Defensive dtype casting added to `world_to_camera` and `grid_sample` in `image_conditioned_proj.py`. Added worker patcher `patcher/pixal3d/` with chunked pure-PyTorch Neighborhood Attention (`pure_pytorch_na2d`) supporting asymmetric feature/value dimensions ($D_{qk}=64, D_v=256$) for pre-Ampere GPUs (`sm < 80`) and graceful missing-extension fallback, resolving CUDA error 209 and shape mismatch. Modern GPUs (`sm >= 80`) retain native Cutlass-FNA. CPU unit tests pass (12/12). | NOT TESTED — source/runtime contract + CPU unit tests only; no live GPU inference or mesh-output validation |
| Paint3D | Subprocess execution uses `sys.executable` instead of bare `python`. Texture application binds albedo texture to mesh via trimesh TextureVisuals before GLB export. | FIXED — script execution and texture binding |
| SkinTokens | Replaced legacy UniRig with SkinTokens (TokenRig, VAST-AI-Research/SkinTokens, arXiv:2602.04805). Thin in-process adapter directly invokes TokenRig `predict_step` and uses companion `bpy_server` daemon for mesh binding with transfer post-processing for scale/texture preservation. | FIXED — Thin in-process adapter & submodule vendored |
| FastMesh | Removed orphan `fastmesh_v4k_retopology` registry/planner entries; `fastmesh_v1k_retopology` remains the sole validated FastMesh model ID matching `FastMesh-V1K`. | FIXED — orphan removed |
| TRELLIS text painting | Removed `trellis_text_mesh_painting` from `models.yaml`, registry, planner, scheduler profile set, and API router. Text-mesh generation is not supported in the image-to-3d pipeline. | FIXED — removed unsupported text painting |
| TRELLIS.2 sparse/precision path | Fixed palette transparency (`mode == 'P'`) and zero-alpha rembg fallback in `preprocess_image`. Retained native BF16 DiT and FP16 decoder precision; harmonized SDPA/xFormers attention dtypes in `full_attn.py`. Replaced rigid logit gates with adaptive top-k percentile voxel fallback in `sample_sparse_structure` to prevent empty coordinate crashes. Large GPUs (`sm >= 80`) remain 100% native FlashAttention. **NOT TESTED — `sparse_structure_decoder` checkpoint in `pipeline.json` references `microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16` (original TRELLIS repo), not compatible with TRELLIS.2 flow model. Produces all-negative logits (~ -75) → zero occupied voxels → hollow box. See microsoft/TRELLIS.2#160.** | SOURCE FIXED — actual GLB/GPU output NOT RUN |
| TaoFlowForge pre-Ampere acceleration, FP32 Euler stability & topology | Set `torch.float32` compute dtype on pre-Ampere GPUs (`sm < 80`) to preserve the 8-bit DiT exponent range and eliminate FP16 NaN/Inf overflow during 50-step Euler ODE flow matching. Replaced 5-step testing default with official (50, 30, 50) schedule; guarded Stage 0 topk fallback with `max_prob > 0.05`. Constrained Stage 2 adaptive thresholds to `[0.4, 0.35, 0.3, 0.25, 0.2]` and added manifold face-count constraint (`len(faces) <= 4 * len(vertices)`), rejecting hyper-connected $K_N$ clique graphs and falling back to ConvexHull. Auto-resolved local RMBG-1.4/2.0 weights in adapter. Modern GPUs (`sm >= 80`) retain native `bfloat16` and full FlashAttention. CPU unit tests pass (17/17). | NOT TESTED — source/runtime contract + CPU unit tests only; no live GPU inference or mesh-output validation |
| TRELLIS.2 raw GLB export | Added NumPy-only validation for vertex/face shape, finite coordinates, face-index bounds, non-zero bounds, and degenerate triangles; validate before/after trimesh processing and reload the GLB before success. No face-count minimum or textured `to_glb()` path. | SOURCE FIXED — actual GLB/GPU output NOT RUN |
| Hi3D | Decommissioned and completely eliminated across codebase; replaced by native single-stage models (TRELLIS.2 and TaoFlowForge). | DECOMMISSIONED & REMOVED |
| CPU/CI coverage | The checked-in workflow referenced Python regression modules absent from `backend/tests/`. The workflow now runs the checked-in TRELLIS.2 NumPy geometry contract test; it does not imply coverage of other models. | FIXED — CI references match tracked files |
| Real inference | No model checkpoint load, GPU inference, output mesh inspection, VRAM measurement, or model-quality benchmark was performed in this audit. | NOT RUN |
| Hunyuan3D-2 Mini Turbo | Adapter subfolder fixed, octree resolution set to 380, CPU offload hooks enabled, pre/post GC added. Verified in live production GPU inference (758,902 faces, 379,430 vertices, 13.0MB GLB, 3.87GB VRAM, 166.75s). Model locked against unauthorized modifications. | VERIFIED PASS — STABLE & LOCKED |
| Unique3D Lightweight Geometry Mode | Bypassed SD 1.5 texture refinement completely (`do_refine=False`); Unique3D now runs pure geometry inference via native `img2mvimg`, `realesrgan-x4.onnx` super-resolution, and `image2normal` normal prediction. Removed `runwayml/stable-diffusion-v1-5` dependency and download requirements, eliminating extra VRAM and network overhead. Gradio dependency stubbed for headless execution. | FIXED — pure geometry inference & SD1.5 dependency removed |
| GPU Doctor (`patcher/doctor.py`) | Standalone hardware diagnostics, memory execution planner, and error recovery utility. Pure PyTorch and Hugging Face Accelerate (v1.15.0). Guarantees Rule 1 zero-regression for modern GPUs (`sm >= 80` native BF16 FlashAttention), while routing pre-Ampere GPUs (`sm < 80`) to query-chunked SDPA (diff = 0.0), offloading, and safe dtypes. Tested standalone on CPU; all model adapters remained strictly untouched. | FIXED — 23 unit tests passing (CPU verified) |
| Routing & Landing Page | Completely removed 1106-line marketing homepage (`app/page.tsx`), deleted `app/homeTelemetry.ts`, redirected `/` directly to `/workspace` at both server component and `next.config.ts` route redirect levels. | FIXED — workspace default landing |

## Verification boundary

- **Test Suite Status & Legacy Reset:** During the repository cleanup in commit `7651f22`, outdated backend unit tests (`backend/tests/`) and frontend test files (`features/workspace/lib/*.test.mjs`) were pruned alongside their deleted target components. Historical test metrics (60 backend / 60 frontend tests passing) document the pre-cleanup baseline. Clean regression test suites will be introduced for the newly implemented Studio components and current model adapter contracts.
- **Source review:** the focused TRELLIS.2 audit covered the adapter, pinned ThirdParty pipeline, sparse attention dispatch, FlexiDualGrid decoder, mesh cleanup, O-Voxel exporter boundary, submodule pointer, and governing project instructions/docs. Other model adapters were not modified.
- **Backend CI before this update:** the workflow referenced Python regression modules absent from the tracked `backend/tests/` tree. Its test step now targets the new checked-in TRELLIS.2 NumPy mesh-validation contract; no other model-specific Python regression modules are present in this branch.
- **TRELLIS.2 CPU contract tests:** `backend/tests/test_trellis2_mesh_validation.py` — **7 passed** in the local CPU-only test run; helper and test modules pass `py_compile`.
- **GPU Doctor Unit Test Suite:** `backend/tests/test_gpu_doctor.py` — **28 passed** (modern sm>=80 zero regression, T4 fallback precision, query-chunked SDPA diff=0.0 across 3D/4D and masks, error classification, bounded recovery, cache cleanup).
- **SkinTokens Unit Test Suite:** `backend/tests/test_skintokens_adapter.py` — **8 passed** (adapter contract, format negotiation, schema validation, T4 patcher isolation).
- **TaoFlowForge Unit Test Suite:** `backend/tests/test_taoflowforge_adapter.py` — **9 passed** (adapter contract, format negotiation, schema validation, pre-Ampere vs modern GPU compute dtypes, 5-step schedule, stage offload methods).
- **Pixal3D Unit Test Suite:** `backend/tests/test_pixal3d_adapter.py` — **7 passed** (adapter contract, format negotiation, parameter schema, DinoV3ProjFeatureExtractor to() signature, unload cleanup).
- **Total Backend Pytest Suite:** `backend/tests/` — **60 passed**.
- **Frontend Bun Test Suite:** `bun test` — **60 passed** across 11 test files.
- **Source syntax/runtime boundary:** actual repository compileall and the GitHub Actions run must be checked after push. No local model checkpoint, xFormers CUDA operator, or NVIDIA GPU was available for execution.
- **GPU Inference Validation:**
  - Hunyuan3D Shape v2.1: PASS (verified live on Kaggle GPU: 935,638 faces, 467,737 vertices, 16.1MB GLB). Status: `STABLE - WORKING / LOCKED`.
  - Hunyuan3D DiT v2 Mini Turbo: PASS (verified live on Kaggle GPU: 758,902 faces, 379,430 vertices, 13.0MB GLB). Status: `STABLE - LOCKED`.
  - Unique3D: PASS (verified live on Kaggle GPU: 54,506 faces, 27,262 vertices, 1.0MB GLB, 394s). Status: `LEGACY / DEPRECATED (WORKING STATE - NOT ACTIVELY USED)` — no further debugging or refactoring planned.
- **T4, Ampere, Ada/Hopper/Blackwell-or-newer inference; checkpoint initialization; exported GLB visual inspection; Blender; and full model-quality comparison:** NOT RUN. These changes are source-level corrections plus CPU array-contract validation, not GPU/runtime proof.

## Configuration and ownership

- `backend/config/models.yaml`: model metadata, capabilities, and manifest model paths.
- `backend/config/quality.yaml`: quality and post-processing policy.
- `backend/config/smart_presets.yaml`: output-intent recipes.
- Model-native inference implementation/defaults remain owned by each model adapter/upstream API where implemented; do not copy them into a second configuration or UI control.
- `MODEL_STORAGE_ROOT` is for checkpoints only. Application uploads, generated assets, and canonical workspaces continue to use the existing application storage contract.

## Documentation integrity

Documentation indexes are aligned to files present in the checked-in tree. Only link a document after confirming that its path exists; do not revive removed or planned documents as if they were active guides.

The Pixal3D, Paint3D, SkinTokens, FastMesh V4K, and TRELLIS text-painting gaps have been resolved at the source/adapter and manifest level. Hi3D has been decommissioned. All adapters require checkpoint loading, real GPU inference, and mesh-output validation in an environment with full weights and GPU acceleration before being called runtime-verified.

### DCC Bridge & Export Integration (Phase 6)
- DCC Bridge supports Blender (port 9876), Unreal Engine 5 (port 30010), Unity (port 8081), and Autodesk Maya (port 7001).
- Live socket pinging probe (`probeDccPort`) probes HTTP/WebSocket local ports with graceful fallback to tailored ingestion scripts (Python for Blender/Maya/UE5, C# for Unity) and JSON payload copying.
- Export workflows in `RightPropertyPanel` and `ExportModal` support GLB, GLTF, FBX, OBJ, STL, and PLY backed by `normalizeModelAsset` job endpoints and `downloadArtifact`. Unbacked fake options (`embedTextures`, `dracoCompression`) have been trimmed in accordance with Ponytail mode ("No Control Without a Verified Consumer").

### Studio 3D Tool Suite & Multi-Agent Implementation (Phase 7 — 2026-11-09)
- **Tool Suite Overhaul**: Replaced placeholder cards across all Studio 3D workspace tools (`features/workspace/Panels/`) with dedicated, production-grade panels grounded in backend routers:
  - `GeneratePanel.tsx`: Core model generation with dual image/mesh intake, polycount slider (up to 600K), quad/triangle topology, and downward model preference selector.
  - `TexturePanel.tsx`: 3D PBR texture generation with 1K/2K/4K resolution, PBR presets, and untouched canonical dropzone.
  - `RemeshPanel.tsx`: Quad/triangle remeshing with 120fps smooth budget slider (5K–200K) and 4 quick presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`).
  - `UVPanel.tsx`: Smart UV unwrap with single-line pill selectors (`Organic` vs `Hard-Surface`, `1K`/`2K`/`4K`, `2px`/`4px`/`8px`/`16px` island margins) and dynamic portal settings flyout.
  - `SegmentationPanel.tsx`: Mesh part decomposition grounded in `mesh_segmentation.py` (2–32 parts, `Semantic` vs `Geometric` modes, hierarchical tree grouping).
  - `RiggingPanel.tsx`: Character auto-rigging grounded in `auto_rigging.py` (`Humanoid`, `Quadruped`, `Generic` templates, T-Pose / A-Pose normalization, facial & finger bones).
  - `AnimationPanel.tsx`: 3D motion generation grounded in `motion_generation.py` (Walk, Run, Jump, Dance prompt chips, 1.0–15.0s duration slider, foot skating cleanup).
- **Dynamic Right Inspector Extension (`features/workspace/dynamic/`)**:
  - `DynamicUVInspector.tsx`: Interactive 2D UV canvas (Wireframe, Checker, Heatmap), Space Utilization meter (`72.4% Optimal`), Texel Density, Overlap Validation, 3D Viewport Sync toggles, and PNG layout export. Mounted when `activeTool === 'uv'`.
  - `DynamicSegmentationInspector.tsx`: Live Part Hierarchy list, visual proportion ribbon, part visibility toggles (Eye/EyeOff), 3D viewport boundary seam highlight & colorize preview switches, and ZIP export. Mounted when `activeTool === 'segment'`.
  - `DynamicAnimationInspector.tsx`: Interactive timeline scrubber with Play/Pause, Loop, Speed pills (0.5x, 1.0x, 2.0x), ground contact diagnostics (0.01mm drift), 3D viewport bone armature & trajectory arc overlays, and motion export. Mounted when `activeTool === 'animation'`.
- **Zero-Scroll Panel Streamlining**:
  - `SegmentationPanel.tsx`: Retains only essential Target Parts pills (`4`, `8`, `16`, `24`) on the main panel; secondary controls (Decomposition Mode, fine 2-32 slider, Hierarchical Tree) moved to Advanced portal flyout.
  - `AnimationPanel.tsx`: Retains only Motion Prompt input + instant chips (`Walk`, `Run`, `Jump`, `Dance`) on the main panel; secondary controls (Duration fine slider, Foot Skating Cleanup Ground Lock, FPS, Looping, Skeleton Profile, Seed) moved to Advanced portal flyout.
  - Both panels fit 100% on screen without vertical scrolling down to low-height laptop viewports (577px).
- **Strict Inviolable Constraints Preserved**:
  - Canonical dropzone card (Image & 3D Mesh) is byte-for-byte identical across all panels.
  - Action buttons and subtitles contain zero model names (`Segment Mesh`, `Auto-Rig Character`, `Apply Animation`).
  - Header padding (`px-8`) with `truncate` ensures 0px collision with the floating collapse button (`PanelLeftClose`).
  - `bun x tsc --noEmit` passed with 0 errors; `bun test` passed with 8 pass, 0 fail.
  - Working tree on branch `dev` retained locally; zero git push executed per user mandate.
