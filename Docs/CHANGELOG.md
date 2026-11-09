# ForMesh3D Changelog

## 2026-11-09 — 8px Header Clearance, 274px Studio Panel, Natural Parameter Flow & Downward Dropdown

- **8px Floating Header Clearance & 274px Panel Width (`WorkspaceShell.tsx`)**:
  - Increased top clearance gap to 8px (`top-2`) below `TopHeader`, completely eliminating any header overlap or slicing while maintaining smooth floating rounded card styling (`rounded-2xl`).
  - Increased Left Unified Panel width by 10px (`264px -> 274px`), allocating 46px to Left Rail (`w-[46px]`) and 228px to Tool Content (`w-[228px]`).
  - Symmetrically elevated Right Panel with matching 8px top clearance (`top-2`).
  - Solid pure dark `#0c0d12` behind panels guarantees zero 3D canvas/mesh bleed.
- **Natural Parameter Deck Positioning & Downward AI Model Dropdown (`GeneratePanel.tsx`)**:
  - Reverted `mt-auto` anchoring: General Settings (Geometry & Texture), AI Model selector, and Seed & Randomizer flow naturally right below the Studio Input Card (dropzone), leaving Generate CTA pinned cleanly at the bottom.
  - Reconfigured AI Model dropdown to open downwards (`top-full mt-1 left-0 right-0 z-40`).
- **High-Contrast Non-Transparent Icons & Clean Model Nav (`LeftNavigation.tsx`, `GeneratePanel.tsx`)**:
  - Removed notification badge (`badge: '+'`) from above the `Model` icon.
  - Upgraded navigation icons to crisp, bold Lucide strokeWidth 2 icons (`Box`, `Scissors`, `RefreshCw`, `Grid3X3`, `Palette`, `Bone`, `Film`, `Settings2`).
  - Retained native `Settings` tool with gear icon at the bottom of the navigation rail.
- **Verification**: `bun x tsc --noEmit` passed (0 errors); `bun test` passed (8 pass, 0 fail); verified visually in browser via `agent-browser` (clean screenshots confirmed at `/tmp/agent-browser-screenshots/workspace_pristine.png` and `/tmp/agent-browser-screenshots/dropdown_open.png`).

---

## 2026-11-08 — Generate Panel Backend Wiring, Seamless Docking, Shader Spheres & Zero-Load Snapshot

- **Generate Panel Backend Wiring & Execution Progress (`GeneratePanel.tsx`, `buildGenerationParameters.ts`)**:
  - Decoupled texture generation from mesh post-processing decimation: Texture toggle, 2K/4K resolution, and PBR baking are no longer forced to false when post-processing is off.
  - Wired `polycount` slider (up to 600K) and `topology_mode` ('quad' / 'triangle') to backend API generation payload.
  - Added live progress display with spinning indicator, current backend step name (`executionStep`), percentage (`executionProgress`), progress bar track, and working Cancel button calling `cancelExecution()`.
- **Top Header & Panel Seamless Docking (`TopHeader.tsx`, `WorkspaceShell.tsx`)**:
  - Removed artificial rounded cuts and dividing borders between `TopHeader`, `LeftNavigation`, and `GeneratePanel`.
  - Applied solid pure dark backdrop (`#0c0d12` / `#090a0f`) beneath panels to eliminate 3D mesh peeking through margins.
  - Central 3D viewport canvas enhanced with a soft radial studio vignette fading from dark boundaries into lit center.
- **Bottom Material Preview Spheres & Zero-Load Snapshot (`ViewportToolOverlay.tsx`, `MeshViewer.tsx`)**:
  - Added Tripo 3D-style bottom floating dock with 5 material spheres: PBR Textured, Clay Matte, Surface Normals, Wireframe, and MatCap Gold.
  - Caches original model textures and materials on `userData.__originalMaterial` without in-place mutation.
  - Switched snapshot capture from synchronous 3840px buffer reallocation to asynchronous `canvas.toBlob(...)` inside `requestAnimationFrame`, eliminating laptop freezing.
- **Verification**: `bun x tsc --noEmit` passed with 0 errors; `bun test` passed with 8 pass, 0 fail (added 5 new parameter builder unit tests).

---

## 2026-11-08 — Studio Upload Box Design, Layout & Colors Matched to Reference

- **Image Upload Dropzone Alignment (`GeneratePanel.tsx`)**:
  - Rebuilt image upload card with glowing indigo/violet border (`#48457D`), deep dark navy-slate background (`#161626`), and rounded corners (`rounded-2xl`).
  - Added 4-pill segmented mode selector at top (`Image to 3D`, `3D Mesh`, `Multi-View`, `Prompt/Sketch`) with active white pill (`bg-white text-black font-bold`).
  - Implemented classic studio dark checkerboard dropzone (`#12131F` / `#18192A`) with prompt tip lightbulb icon, upload title, format size indicator, and bottom `"Generate Image for 3D ›"` link.
  - Added loaded preview state with top-right circular trash delete button and bottom floating action pills (`Edit` pencil and `"Generate Multi-Views"`).
- **Assets 3D Model Upload Dropzone Alignment (`RightAssetsPanel.tsx`)**:
  - Styled with matching studio dark checkerboard pattern, indigo dashed border (`border-[#48457D]/50 hover:border-[#6366F1]`), and purple/indigo gradient circular upload button.
- **Tool Template Callout Alignment (`StudioToolTemplate.tsx`)**:
  - Highlighted action keywords (`Select`, `upload your own`, `{title}`) in `#F9CF00` with direct `Upload 3D Model` action pill button.
- **Verification**: `bun x tsc --noEmit` passed with 0 errors; `bun test` passed (3/3 unit tests passing).
