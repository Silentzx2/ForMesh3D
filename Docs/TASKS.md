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
│ TOP HEADER (56px): ForMesh3D Logo | 3D Workspace ▾ | Nav (Home, Assets) | DCC Bridge, User Profile     │
├────┬──────────────────────┬────────────────────────────────────────────────────────────┬────────────────┤
│ N  │                      │                                                            │                │
│ A  │ LEFT FLOATING PANEL  │                                                            │ RIGHT PANEL    │
│ V  │ (340px rounded card) │                 CENTER 3D VIEWPORT                         │ (280px dock)   │
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
  - Floating 3D Orientation Gizmo with Front, Side, Top, and Iso camera snaps.
  - Floating vertical toolbar: Settings Gear, Canvas Snapshot, Wireframe toggle, Help `?`.

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

## 3. Remaining Work (Part 2 — Phases 4, 5, 6)

### Phase 4: Generation Hub Rebuild (`GeneratePanel.tsx`) ⏳
*Reference Image*: Inspect `/home/david/Documents/dev/ForMesh3D/.brain/generate.png`
- [ ] **Mode Switcher**:
  - Segmented pill: `HD Model` (white pill active) vs `Smart Mesh ⇡`.
- [ ] **4 Input Mode Tabs**:
  - Tab 1: Image (single image upload).
  - Tab 2: Mesh (upload existing 3D model for conversion/refinement).
  - Tab 3: Multi-view (multi-angle image slots).
  - Tab 4: Text Prompt (text prompt textarea for text-to-3D).
- [ ] **Checkered Upload Dropzone**:
  - Checkered subtle background, cloud upload icon, `"Upload"`, `"JPG, PNG, WEBP · Max 20MB"`, and `"Generate Image for 3D ›"`.
- [ ] **General Settings Accordion**:
  - Collapsible row `"Geometry & Texture ›"`.
- [ ] **Studio Settings / Members Only**:
  - Gold badge `✪`.
  - `"Generate in Parts"` with toggle switch.
  - `"8K Texture"` with toggle switch.
  - `"Privacy"` with Public/Private dropdown.
- [ ] **AI Model Selector**:
  - Dropdown with Thumbs-up icon:
    - `Hunyuan3D-2 Mini Turbo (Fast Geometry) · Best Speed`
    - `TaoFlowForge (Progressive Native Flow) · Native Topology`
    - `Pixal3D (Neighborhood Attention Reconstruction) · High Precision`
- [ ] **Bottom Action Button**:
  - Full-width vibrant gold pill button: `"Generate ⚡ 55"`.
  - Animated spinner and disabled state during generation.

### Phase 5: Right Inspector & Assets Dock ⏳
*Reference Images*: Inspect `/home/david/Documents/dev/ForMesh3D/.brain/generate.png` and `/home/david/Documents/dev/ForMesh3D/.brain/segmentation.png`
- [ ] **Header Tabs (`RightWorkspacePanel.tsx`)**:
  - Segmented pill matching reference:
    - `[ Assets ]` tab: Active white pill (`bg-white text-black font-semibold rounded-lg shadow-sm`).
    - `[ Property ]` tab: Inactive zinc text (`text-zinc-400 hover:text-white`).
- [ ] **Assets Sub-Toolbar (`RightAssetsPanel.tsx`)**:
  - Left: 4-dots grid icon `::`, favorites star `★`, category filter funnel `Y`.
  - Right: `Manage` pill button (with checklist icon + `"Manage"`).
- [ ] **Upload 3D Model Dropzone Card**:
  - Dashed card with subtle checkered pattern.
  - Purple/indigo circular button with white upward arrow `↑`.
  - Title: `"Upload 3D Model"`.
  - Subtitle 1: `"OBJ, FBX, STL, GLB"`.
  - Subtitle 2: `"Size ≤ 150MB"`.
- [ ] **Asset Cards List**:
  - Render local asset cards with thumbnail, name, format tag, and active selection state.
- [ ] **Property Inspector (`RightPropertyPanel.tsx`)**:
  - Telemetry summary: Triangles, Quads, Vertices, Dimensions (X, Y, Z).
  - Material and texture map slots (Diffuse, Normal, Roughness, Metallic).
  - Clean export buttons (GLB, OBJ, FBX).

### Phase 6: Verification, Type Safety & Delivery ⏳
- [ ] Run `bun x tsc --noEmit` — must pass with **0 errors**.
- [ ] Run `bun test` — ensure all unit tests pass.
- [ ] Verify zero canvas flickering / re-mounts on tool switches.
- [ ] Verify keyboard shortcuts and smooth transitions.
