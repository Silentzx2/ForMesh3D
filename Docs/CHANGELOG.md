# ForMesh3D Changelog

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

---

## 2026-11-08 — DCC Eradication, Studio Viewport Vignette Alignment, and Studio UI Streamlining

- **Complete DCC Eradication**:
  - Permanently removed all DCC Bridge components, modals, button actions, context-menu items, and test suites per user directive.
  - Replaced duplicate backend/frontend generation services with native, battle-tested `WorkspaceContext.tsx` orchestration (`buildGenerationParameters`, `bindBackendJob`).
- **Canvas Gradient Alignment & Panel Dark Harmony**:
  - Configured center-to-edge radial vignette: `#3a3c40` (subtle dark charcoal in mesh viewer center) smoothly fading outward through `#2d2f33` and `#1e1f22` to `#08090a` (deep obsidian dark near tool panels).
  - Left panels (`GeneratePanel.tsx`, `StudioToolTemplate.tsx`) and floating shells unified 100% with the Property Panel's design tokens (`bg-[hsl(var(--surface-1))]`, `bg-[hsl(var(--surface-2))]`, `border-[hsl(var(--border))]`).
  - Balanced natural studio lighting (Ambient 0.75, Key 1.6, Fill 0.9, Rim 1.1, Exposure 1.0) with zero texture bleaching.
- **TopHeader & Panel Polishing**:
  - Fixed panel dimensions: Left rail 58px, Left context panel 276px, Right inspector 250px with rounded-2xl floating glass aesthetic.
  - TopHeader streamlined to 48px height with scaled icons (15px) and micro-interactions; middle page pill navigation removed.
  - Viewport tools repositioned dynamically to guarantee visibility whether right panel is open or closed.
- **Verification**: `bun x tsc --noEmit` passed with 0 errors; `bun test` passed (3/3 unit tests passing).

---

## 2026-11-08 — Studio Lighting & Viewport Vignette Harmonization

- **Studio Viewport Radial Vignette Harmonization**:
  - Applied circular radial spotlight vignette across `MeshViewer.tsx`, `WorkspaceShell.tsx`, `SettingsModal.tsx`, and `WorkspaceContext.tsx`.
- **Balanced Natural Three.js Model Lighting**:
  - Restored natural, crisp, rich shading without texture bleaching or washout.
  - Synchronized `environmentSettings` state directly to Three.js light instances and exposure dynamically.
- **Verification**: `bun x tsc --noEmit` and `bun test` passed with 0 errors.
