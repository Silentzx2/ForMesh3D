# ForMesh3D Changelog

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

---

## 2026-11-08 — Studio Workspace Header Thinned, Panel Docking & Curvature Harmonization

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
