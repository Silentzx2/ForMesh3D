# Engineering Implementation Plan: ForMesh3D Studio UI/UX Rebuild

**Status**: IN PROGRESS (Part 1 Core Shell & Navigation Complete — Ready for Generation Hub & Right Panel)  
**Target Branch**: `dev`  
**Current Milestone**: Handover to Agent for Phase 4 (Generation Hub) & Phase 5 (Right Inspector Dock)  
**Core Goal**: Rebuild the ForMesh3D Studio frontend UI/UX into a fluid, unified 3D creation studio matching the 10 reference screenshots in `.brain/` (`generate.png`, `segmentation.png`, `retopology.png`, `smart-uv.png`, `texture.png`, `texture-pbr.png`, `rigging.png`, `animate.png`).

---

## ⚠️ MANDATORY RULES FOR THE NEXT AGENT (Follow Without Exception)

1. **VISUAL INSPECTION FIRST**:
   - Before editing or creating any UI code, you **MUST** inspect the reference images in `ForMesh3D/.brain/` using `read_file`.
   - Never guess layouts or colors. Match the references: `#0D0D10` base canvas background, `#1A1A1E` floating cards (`rounded-2xl`, `border-white/[0.08]`), `#F9CF00` Electric Gold accents.

2. **BRANDING & NAMING PURITY**:
   - The brand is strictly **ForMesh3D Studio**.
   - Under **NO** circumstances use any third-party reference names (such as "Tripo") in code, comments, component names, or UI copy.

3. **PONYTAIL ULTRA MODE (LAZY SENIOR DEV)**:
   - Minimal code diffs. The best code is code never written.
   - Reuse existing utilities, hooks, stores, and patterns already in the codebase.
   - Zero deadweight, zero bloated helper files, zero unrequested abstractions.

4. **LOW-END MACHINE / RUNTIME SAFETY**:
   - **DO NOT** run heavy bundler commands (`bun build`, `bun run build`, `npm run build`).
   - Only verify type safety and unit tests using:
     - `bun x tsc --noEmit`
     - `bun test`

5. **VIEWPORT CANVAS PERSISTENCE (ZERO PAGE DESTRUCTION)**:
   - Switching tools (`model`, `segment`, `remesh`, `uv`, `texture`, `pbr`, `rigging`, `animation`) must **NEVER** unmount, reload, or destroy the 3D WebGL viewport canvas (`MeshViewer.tsx`).
   - Tool navigation is handled purely via `window.history.replaceState` and dynamic left panel switching in `WorkspaceShell.tsx`.

6. **SCOPE BOUNDARIES (USER DIRECTIVE)**:
   - **NO Texture Upscale**: Texture upscale is out of scope. Do not create an upscale tool panel.
   - **NO Texture Editing / Magic Brush**: Texture editing is out of scope. Do not create a texture edit tool panel.
   - Maintain strictly: **Model**, **Segment**, **Retopo**, **Smart UV**, **Texture (3D Generator)**, **PBR Generator**, **Rigging**, and **Animation**.

7. **GLOBAL CSS ONLY**:
   - Use standard Tailwind utility classes and existing variables in `app/globals.css`. Do not add ad-hoc CSS files or external styling libraries.

---

## 1. Verified Design System & Architecture Blueprint

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP HEADER (40px): ForMesh3D Logo | 3D Workspace ▾ | Status Pill | Snapshots, Profile                │
├────┬──────────────────────┬────────────────────────────────────────────────────────────┬────────────────┤
│ N  │                      │                                                            │                │
│ A  │ LEFT CONTEXT PANEL   │                                                            │ RIGHT PANEL    │
│ V  │ (276px, Docked Top/  │                 CENTER 3D VIEWPORT                         │ (250px, Docked │
│    │ Left, rounded-r-22px)│                                                            │ Top, rounded-l)│
│    │                      │                                                            │                │
│ 68 │ Tool Header          │               [3D Orientation Gizmo]                       │ Tabs:          │
│ px │ Visual Comparison    │               [Floating Camera/Wireframe Dock]             │ [Assets]       │
│    │ Model Upload CTA     │                                                            │ [Property]     │
│ d  │ Constraints/Options  │           "Ready For A New 3D Model?"                      │                │
│ o  │                      │        Instantly generate 3D from image or text            │ Upload Dropzone│
│ c  │ Bottom Action Button │                                                            │ Asset Cards    │
│ k  │                      │                                                            │                │
└────┴──────────────────────┴────────────────────────────────────────────────────────────┴────────────────┘
```

- **Left Rail (68px docked)**: Dark `#121214` rail. Active tool highlighted with `#F9CF00` icon, text, and left accent border.
- **Left Floating Tool Panel (340px)**: Floating card with `rounded-2xl`, background `rgba(26,26,30,0.95)`, `backdrop-blur-md`, `border border-white/[0.08]`.
- **Center 3D Viewport**: Permanent Three.js canvas. Centered watermark logo + `"Ready For A New 3D Model?"` subtitle when empty. Floating top-right 3D Gizmo (orientation cube) and floating vertical tool dock (Settings, Snapshot, Wireframe, Help).
- **Right Inspector Dock (280px)**: Floating card. Top segmented switcher: `[ Assets ]` (white pill active) vs `[ Property ]` (zinc text inactive). Secondary bar with 4-dots grid `::`, favorites `★`, filter `Y`, and `Manage` button. Upload 3D model card (`OBJ, FBX, STL, GLB`, `Size ≤ 150MB`).

---

## 2. Completed Work (Part 1 — Phases 1, 2, 3)

### Phase 1: Shell & Navigation Dock ✅
- [x] Rebuilt `features/workspace/Navigation/LeftNavigation.tsx` (-401 lines of bloat):
  - Clean 68px docked rail.
  - Active tool state in `#F9CF00` with left accent bar indicator.
  - Clean tool sequence: Model, Segment, Retopo, Smart UV, Texture, PBR, Rig, Animate, and App settings at bottom.
- [x] Route synchronization in `WorkspaceShell.tsx`:
  - Synchronizes `/workspace/generate`, `/workspace/segmentation`, `/workspace/retopology`, `/workspace/smart-uv`, `/workspace/texture`, `/workspace/texture-pbr`, `/workspace/rigging`, `/workspace/animate` without unmounting the 3D viewport canvas.
  - Safe fallback mapping for legacy route segments.

### Phase 2: Center 3D Viewport & Overlays ✅
- [x] Streamlined `features/workspace/Viewport/MeshViewer.tsx` from 5,636 lines down to ~500 lines:
  - Removed 800-line sculpting engine, 850-line UV painter, 500-line screen recorder, and dead physics hooks.
  - Preserved Three.js WebGL canvas, Draco/Meshopt loaders, bounding-box centering, turntable, wireframe, grid, and camera snaps.
  - Centered watermark empty state matching reference: Logo + `"Ready For A New 3D Model?"` + `"Instantly generate 3D from image or text"`.
- [x] Floating Viewport Controls in `features/workspace/Viewport/ViewportToolOverlay.tsx`:
  - Dynamic responsive positioning: Offsets tool dock by `right: 265px` when Right Panel is open (`isRightPanelOpen`) and `right: 16px` when closed, preventing panel overlap.
  - Floating 3D Orientation Gizmo with Front, Side, Top, and Iso camera snaps.
  - Floating vertical toolbar: Settings Gear (with popup for lighting tones, exposure slider, shading modes), Wireframe toggle, Turntable 360° auto-rotate toggle, Grid toggle, high-res PNG Camera Snapshot, Help `?`.
  - Enabled `preserveDrawingBuffer` in `MeshViewer.tsx` for full-res snapshot capture without frame dropping.

### Phase 3: Unified Studio Tool Template & Secondary Views ✅
- [x] Created `features/workspace/Panels/StudioToolTemplate.tsx` (~240 lines):
  - Reusable template handling: tool header, hero transformation graphic (before ➔ after), instructional upload callout with `#F9CF00` highlight, direct 3D model upload button, tool constraints block, and bottom action button.
- [x] Configured 7 secondary tool views in `WorkspaceShell.tsx`:
  - `Segmentation`: Before/after robot parts graphic, warning cards for quad/rigged models, `"Start Segmenting ⚡ 40"`.
  - `Retopology`: Sculpt-to-quad graphic, quad target budget, `"Start Retopology ⚡ 30"`.
  - `Smart UV`: 3D-to-UV layout graphic, `Tris ≤ 80,000 / Quads ≤ 40,000` limit badge, `"Unwrap UVs ⚡ 20"`.
  - `Texture`: Albedo paint graphic, style & resolution options, `"Generate Textures ⚡ 35"`.
  - `PBR Generator`: PBR material graphic (diffuse ➔ roughness/metallic/normal), `"Generate PBR Maps ⚡ 25"`.
  - `Rigging`: A-pose to skeleton graphic, 4 supported category badges (Humanoid, Quadruped, Aquatic, Serpentine), `"Auto Rig Model ⚡ 40"`.
  - `Animation`: Rig-to-motion graphic, animation clips selector, `"Apply Animation ⚡ 20"`.
- [x] Scope Cleanup:
  - Removed Texture Upscale and Texture Edit (Magic Brush) as directed by user.

---

## 3. Completed Work (Part 2 — Phases 4 & 5) ✅

### Phase 4: Generation Hub Rebuild (`GeneratePanel.tsx`) ✅
*Reference Image*: `.brain/generate.png`
- [x] **Header**: HD Model indicator with `#F9CF00` icon. Removed third-party "Smart Mesh" per personal-use user directive.
- [x] **Seamless Docking & Slender Width**:
  - Docked flush against the left navigation rail (`x=58`) and top navbar (`y=44`) with 0 margin.
  - Reduced width from 360px down to 276px to match `generate.png` slender proportions.
- [x] **Zero-Blink Tool Switching**:
  - Replaced dynamic import with static import for `GeneratePanel`.
  - Removed `mode="wait"` and exit animation lag in `WorkspaceShell.tsx` for immediate 0ms tool swapping.
- [x] **Single Checkered Image Upload Dropzone (Matching generate.png)**:
  - Removed multi-view, text prompt, and mesh tabs per user directive.
  - Translucent checkered dropzone container (`bg-[#121214]/60` with radial dot grid).
  - Cloud upload icon, "Upload" title, "JPG, PNG, WEBP · Size ≤ 20MB", and bottom link "Generate Image for 3D ›".
  - Thumbnail preview with clear remove `(X)` button.
- [x] **General Settings Accordion**:
  - Collapsible drawer with verified production intent presets (`Game Ready` 50k, `Cinematic` 200k, `Mobile` 20k, `Raw Native`).
- [x] **Studio Options (Personal Use)**:
  - Clean `Generate in Parts` toggle.
  - Stripped 8K texture and Public/Private paywall controls as directed by user.
- [x] **AI Model Selector**:
  - Clean dropdown with `ThumbsUpIcon` in `#F9CF00`:
    - `Hunyuan3D-2 Mini Turbo (Best Speed & Geometry)`
    - `TaoFlowForge (Native Flow Topology)`
    - `Pixal3D (Neighborhood Reconstruction)`
- [x] **Bottom Action CTA**:
  - Full-width vibrant gold pill button: `"Generate Model"` (all energy/credit counters and token costs eliminated).
  - Animated spinner and disabled state during generation.

### Phase 5: Right Inspector & Assets Dock ✅
*Reference Images*: `.brain/generate.png` & `.brain/segmentation.png`
- [x] **Slender Docking**:
  - Docked flush against the right edge (`x=1190` at 1440px) and top navbar (`y=44`) with 0 margin.
  - Reduced width from 320px down to 250px to match `generate.png` slender proportions.
- [x] **Header Tabs (`RightWorkspacePanel.tsx`)**:
  - Segmented switcher matching reference:
    - `[ Assets ]`: Active white pill (`bg-white text-black font-bold rounded-lg shadow-sm`).
    - `[ Property ]`: Inactive zinc text (`text-zinc-400 hover:text-white`).
- [x] **Assets Sub-Toolbar (`RightAssetsPanel.tsx`)**:
  - Left: 4-dots grid icon, favorites star, category filter dropdown (`All Assets`, `3D Models`, `PBR Textures`).
  - Right: `Manage` pill button with checkmark icon.
- [x] **Upload 3D Model Dropzone Card**:
  - Dashed card with subtle checkered pattern (`#121214`).
  - Gradient indigo/purple circular button with white upward arrow (`ArrowUp01Icon`).
  - Title: `"Upload 3D Model"`.
  - Subtitle 1: `"OBJ, FBX, STL, GLB"`.
  - Subtitle 2: `"Size ≤ 150MB"`.
- [x] **Asset Cards & Property Inspector**:
  - Format badges, telemetry, and fast export triggers (`GLB`, `OBJ`, `FBX`).

---

## 4. Final Delivery & Verification (Phase 6) ✅
- [x] Run `bun x tsc --noEmit` — verified **0 errors**.
- [x] Run `bun test` — verified all unit tests **PASS**.
- [x] DCC Bridge Complete Eradication:
  - Completely excised all DCC Bridge modals, buttons, types, tests, and references per explicit user directive.
- [x] Production Export Integration:
  - Formats GLB, GLTF, FBX, OBJ, STL, PLY backed by `normalizeModelAsset` canonical job endpoints and `downloadArtifact`.
  - Ponytail cleanup: trimmed unbacked fake controls from `RightPropertyPanel.tsx`.
  - Connected `ExportModal.tsx` LOD cascade selection and Complete Asset ZIP packaging.
- [x] Viewport Spotlight Radial Vignette:
  - Soft dark gray `#606368` in center smoothly fading to deep obsidian dark `#070809` near tool panels.
- [x] Verified zero tool-switching flicker/blinking in browser across `Model`, `Segment`, and `Retopo`.

---

## 5. Next Phase Handoff: Major Remaining Work (Phase 7 - In Progress) 🚧

> **NOTICE FOR PARALLEL AGENTS & BACKGROUND WORKERS**:
> The foundational studio shell, docked panel architecture (zero top/left gaps), `40px` sleek top header, unified left navigation rail, and CSS token theming are now locked and stable on branch `dev`.
> **DO NOT BREAK** these docked panel boundaries, CSS tokens, or native BF16 inference pipelines.

### Major Remaining Work Items:
1. **Model Generation Pipelines & Backend Worker Binding**:
   - Live end-to-end inference verification for Hunyuan3D-2 Mini Turbo, TaoFlowForge, and Pixal3D.
   - Quad Remesh worker integration with real-time topology reduction feedback.
   - PBR Material Generation flow with automatic live texture binding in Three.js viewport.
2. **Interactive 3D Stage & Mesh Manipulation**:
   - Full 3D transform gizmos (Translate / Rotate / Scale) over loaded assets.
   - Sub-mesh part selection and interactive material region segmentation.
3. **Asset Management & Export Enhancements**:
   - Batch asset operations, multi-select, and complete asset bundle packaging.
   - SSE job progression refinements and background task error recovery.
