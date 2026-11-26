# TASKS — PART 1: UI/UX & FRONTEND IMPLEMENTATION

> Owner: Frontend / UI-UX coding agent  
> Product: ForMesh 3D — personal, self-hosted 3D studio  
> Target: Desktop-first workstation UI; not a mobile-first product  
> Companion: Read all of Docs/TASKS-PART-2-BACKEND.md before coding.

---

## 0. Product Vision — Read This First

I want ForMesh 3D to feel like a **crisp, calm, high-quality creative 3D studio in the spirit of Tripo's visual clarity**, not like a dense game-engine profiler, admin dashboard, or generic AI SaaS page.

The 3D mesh must remain the hero. The surrounding UI should be quiet, purposeful, compact, and predictable. Panels should have clear hierarchy, consistent spacing, readable labels, restrained borders, and a small number of deliberate accents. Every control must correspond to a real ForMesh3D capability and have a meaningful state.

**What I want**
- A polished desktop workspace designed for real work on laptop/desktop screens, primarily 1280×720 through 4K.
- Crisp neutral graphite surfaces, restrained selection color, and Studio Gold used selectively for primary actions.
- Clean tool panels with useful controls visible without unnecessary upload cards, nested cards, oversized empty areas, or popover clutter.
- A large, uncluttered viewport with useful camera controls, accurate model information, and the existing simple generation progress line.
- Professional typography and consistent spacing. Prefer readable 12–13px labels; use monospace only for numeric/technical values.
- Keep all existing personal-operator capabilities: FastAPI status, GPU/VRAM/CPU/RAM monitor, Jobs, AI Models, Snapshots, Notifications, Search, Settings, Admin, and local/self-hosted control.
- Real functionality only. No fake controls, fake progress, invented capabilities, placeholder demo data, or effects pretending to be model computation.

**Why**
ForMesh3D is my personal self-hosted 3D studio. I want Tripo-like crispness and clarity, not Tripo branding or a SaaS clone. The design must make existing generation, texturing, retopology, UV, segmentation, rigging, and animation workflows easier while preserving the local GPU/model-management tools that make the project useful.

**Desktop scope**
- Do not design a mobile-first experience.
- Do not spend this project on mobile drawers, mobile-specific navigation, touch-first layout variants, or phone-sized feature parity.
- Do not break basic responsive safety: narrow windows must not make the app unusable or hide essential actions. A simple fallback is enough; desktop remains the design target.

**Brand and product identity**
- Keep ForMesh 3D branding.
- Tripo is a visual-quality reference only. Do not add Tripo logos, names, copy, assets, or branded product concepts.
- Do not add credits, upgrade/promo banners, Creator Hub, DCC Bridge, cloud accounts, or SaaS-only surfaces.

This vision is the decision rule whenever a minor implementation choice is not spelled out below.

---

## 1. Mandatory Read Order and Two-Agent Contract

**Both agents must read both task files completely before editing any code:**
1. Docs/TASKS-PART-1-UI-UX.md
2. Docs/TASKS-PART-2-BACKEND.md
3. AGENTS.md
4. Docs/PRD.md
5. Docs/DESIGN.md
6. Docs/ARCHITECTURE.md
7. Docs/MEMORY.md
8. Docs/SECURITY.md
9. Docs/api-documentation.md
10. Relevant components, stores, types, API client, backend schemas, model capability metadata, and tests.

**Assignment**
- The UI agent owns Part 1 only.
- The backend agent owns Part 2 only and must be a different coding agent.
- The backend agent may inspect frontend code and Part 1 to understand the contract. It must not redesign or rewrite frontend UI.
- The UI agent may inspect backend code, OpenAPI, API docs, and model capability metadata read-only. It must not edit backend code.
- Never let both agents edit the same worktree or branch simultaneously. Use separate worktrees/branches and integrate through commits.
- Freeze the endpoint contract before backend implementation. A contract change must be written down and agreed by both agents; do not silently rename fields or endpoints.
- Part 2's final wiring means implementing the server routes, response schemas, route registration, and job result fields that the frontend client calls. It does not authorize the backend agent to restyle components or modify frontend stores.
- If a frontend-side change is genuinely needed, hand it back to the UI agent as a precise integration request.

**Hard ownership boundary — UI agent**
- Allowed to edit: frontend React/Next.js components, CSS, frontend hooks/stores/types, frontend tests, and frontend documentation directly affected by UI work.
- Allowed to inspect backend: yes, read-only, for current endpoint behaviour, supported parameters, response schemas, job lifecycle, and model capabilities.
- Forbidden to edit: anything under backend/, patcher/, Python model code, backend scripts, backend requirements, backend model registry/configuration, backend database/scheduler code, or backend tests.
- Do not implement API endpoints in Next.js as a workaround. Use the existing API client/proxy pattern and the contract in this document.
- Do not change an API payload or expose a new UI control just because it looks useful. It must be backed by a verified existing contract or the Part 2 contract.

**No guessing rule**
Before editing a component, trace its actual state, callers, stores, API requests, and loading/error flows. Reuse existing helpers first. If an essential contract is unknown, record the blocker and ask rather than inventing a fallback.

---

## 2. Mandatory Deep Visual Reference Audit — .brain/

This is a hard implementation gate, not an optional inspiration step. The repository may receive more reference images later. Do not assume the three currently named images are the complete set.

Before coding:
- [ ] Recursively inventory every file under .brain/, including nested folders and newly added folders.
- [ ] Identify every image/reference format, including PNG, JPG/JPEG, WEBP, GIF, BMP, AVIF, SVG, and any other visual file format present.
- [ ] Open and inspect every image individually at readable/full resolution. Do not rely only on filenames, contact sheets, tiny thumbnails, or a text description.
- [ ] For SVG, inspect both the rendered visual and source dimensions; for animated images, inspect relevant frames rather than only the first frame.
- [ ] Record the file path, actual subject, layout, hierarchy, colors, spacing, typography, component shapes, and interaction clues.
- [ ] Separate visual requirements from decorative details that do not fit the ForMesh3D vision. Do not blindly copy every detail in a reference.
- [ ] Create a reference-to-implementation map: image path → observed design rules → target component(s).
- [ ] If an image is corrupt, unreadable, unsupported, or ambiguous, report the exact path. Do not silently skip it or fabricate its contents.
- [ ] Re-run the inventory before final completion so images added while work is in progress are not missed.

Known named references:
- .brain/WORKSPACE_REF/RIGGING_PRESETS.png — Rigging panel composition.
- .brain/WORKSPACE_REF/ANIMETION.png — Animation panel composition. Preserve the filename spelling as it exists.
- .brain/WORKSPACE_REF/xyz_and_tool_rail.png — Viewport XYZ triad and tool rail.

There may be more files. **The recursive inventory is authoritative, not this short list.**

Do not copy protected logos, unrelated branding, or visual assets into the app. Translate useful visual rules into ForMesh 3D's own design system.

---

## 3. Frontend Baseline and Current Architecture

The existing stack is Next.js 16, React 19, Three.js, Zustand, and the existing UI primitives/dependencies. Confirm exact code before implementation.

Relevant ownership:
- Workspace composition: features/workspace/WorkspaceShell.tsx.
- Header: features/workspace/Header/TopHeader.tsx.
- Left navigation: features/workspace/Navigation/LeftNavigation.tsx.
- Tool panels: features/workspace/Panels/.
- Asset/property surfaces: features/workspace/RightPanel/.
- Viewport: features/workspace/Viewport/MeshViewer.tsx and ViewportToolOverlay.tsx.
- Animation store: stores/useAnimationStore.ts.
- Viewer store: stores/useViewerStore.ts.
- Workspace state and job lifecycle: features/workspace/store/WorkspaceContext.tsx.
- Existing motion player/inspector: features/workspace/dynamic/DynamicAnimationInspector.tsx.
- Existing API client/proxy: inspect services/apiClient.ts, app/api/v1/[...path]/route.ts, and current callers before adding anything.

**Existing functionality to preserve and reuse**
- The viewport already loads GLB/GLTF and supported mesh formats through Three.js loaders.
- The viewport already uses a Three.js animation mixer for GLB clips.
- useAnimationStore already contains playback time, speed, looping, a tick function, timeline state, and retarget-mapping concepts.
- DynamicAnimationInspector already owns a requestAnimationFrame-driven playback clock.
- Workspace already has job polling and completed-job normalization.
- Do not create duplicate animation stores, duplicate RAF clocks, duplicate asset-selection state, another model cache, or a second viewport renderer.

Static inspection confirmed that current completed-motion handling recognizes a motion artifact but returns after refreshing assets; it does not currently transform the ARDY NPZ artifact into a playable Three.js clip. The frontend work must consume the Part 2 normalized clip contract rather than assume NPZ array names or shapes.

---

## 4. Non-Negotiable Visual System

### 4.1 Surface, selection, and CTA direction

Use semantic tokens in app/globals.css and existing Tailwind conventions. Final values must be checked against current CSS before replacing them.

Suggested target palette:
- Canvas / viewport: neutral graphite close to #111113.
- Main panels: close to #18181B.
- Nested controls/cards: close to #222226.
- Raised / hover surface: close to #2C2C32.
- Selection: restrained indigo close to #5E5CE6.
- Primary CTA / active left rail: Studio Gold close to #F5C542.
- Borders: subtle neutral hairlines, approximately 8% white opacity.
- Status: restrained semantic green/amber/red. No neon text glows.

The exact token declarations must be checked against existing aliases, @theme requirements, and Tailwind compatibility. Do not blindly paste a palette if it conflicts with the current theme.

**Token corrections**
- Never create a self-referential CSS custom property. In particular, never define --font-mono: var(--font-mono).
- Use the actual installed font variable or a valid fallback stack.
- Avoid duplicating --accent and --primary when doing so makes Gold appear on every accent control. Gold is reserved for the primary action and active navigation state.
- Keep existing semantic tokens where they already work. Do not create aliases for aesthetic preference alone.

### 4.2 Typography

- Prefer 12–13px readable labels and sentence/title case.
- Numeric telemetry, face counts, duration, FPS, VRAM, seeds, and other technical values may use 11px monospace.
- Remove unnecessary 7–10px all-caps micro-labels where practical.
- Do not globally increase text size in a way that makes dense controls overflow. Check actual panel height and available width.
- Keep hierarchy clear: page/tool title, section heading, control label, helper text, numeric metadata.

### 4.3 Surfaces and effects

- Prefer solid or high-opacity surfaces around the WebGL canvas.
- Avoid large/stacked backdrop blur. Use none or a very small blur only when the current implementation proves it is cheap.
- Borders should separate meaningful surfaces, not every nested wrapper.
- Avoid gratuitous gradients, glows, specular sweeps, idle shimmer, bobbing, floating, and pulsing effects.
- Respect prefers-reduced-motion.

---

## 5. Global NOT-TO-DO — Anti-AI-Slop Rules

Explicit prohibitions:
- No fake holograms, fake point clouds, fake scan/radar effects, fake model wireframes, fake computation visualizations, or decorative particles.
- No second “thinking”/generation card, duplicate generation status card, or extra progress card.
- Preserve the existing **simple horizontal generation progress line** and its real execution percentage/state. Do not replace it with a decorative progress experience.
- No fake data, fabricated percentages, mock presets presented as real, or fake success states.
- No non-functional buttons, dead tabs, inert icons, visual-only sliders, or settings that the backend ignores.
- No arbitrary 3D shader effects to imitate a reference image.
- No second WebGL canvas/renderer for a small HUD or gizmo.
- No heavy dependencies for functionality already provided by installed libraries or native browser features.
- No whole-workspace rewrite to achieve local styling changes.
- No duplicate shared components, hooks, stores, API helpers, animation clocks, or state machines.
- Do not remove personal operator tools or hide them behind unnecessary navigation.
- No mobile-first rebuild.
- No backend code edits under this task.
- No removal of user data, workspace assets, snapshots, jobs, database rows, or user files.

---

## 6. Frontend TODO and Phase Plan

Every phase is gated. Do not skip ahead to polish a dependent feature before its state/API contract is clear.

### Phase 0 — Read-only audit and design freeze

- [ ] Read both task files and mandatory project docs.
- [ ] Complete the recursive .brain visual audit in Section 2.
- [ ] Inspect existing shell dimensions, panel state, active tool state, asset selection, right panel modes, and viewport overlays.
- [ ] Inspect every affected component and trace props, stores, events, and callbacks before editing.
- [ ] Inspect API requests and backend/OpenAPI capability metadata read-only. Record only verified supported parameters.
- [ ] Record baseline frontend checks and existing known failures.
- [ ] Produce a short UI audit map: current issue → source file/line → intended change → test.

### Phase 1 — Design tokens and CSS cleanup

Primary file: app/globals.css.

- [ ] Consolidate existing neutral surface, border, selection, primary, muted, and focus tokens.
- [ ] Remove duplicate .glass-panel definitions only after checking all references.
- [ ] Remove unused visual-effect utilities only after proving they have no consumers.
- [ ] Reduce heavy blur/glow rules on fixed overlays and WebGL-adjacent surfaces.
- [ ] Make workspace tool bodies vertically scrollable without clipping controls or sticky actions.
- [ ] Fix font token references; do not create cyclic CSS custom properties.
- [ ] Replace raw component hex literals with semantic tokens where they are UI colors. Preserve legitimate Three.js shader/material constants when required.
- [ ] Respect reduced-motion settings.
- [ ] Verify contrast, focus visibility, and disabled states.

### Phase 2 — Workspace shell, header, navigation, and live profiler

- [ ] Refine the desktop shell into a calm three-column workspace.
- [ ] Left panel target: approximately 316px total (48px rail + 268px tool body), but verify actual screen width and current resizable-panel state before hardcoding.
- [ ] Ensure center viewport offsets are consistent with panel width and intended gaps. One authoritative value only; do not leave 326px and 328px variants.
- [ ] Wire the real isRightPanelOpen state to both the right panel and viewport overlay. Do not pass hardcoded false.
- [ ] Keep the right panel around 260px where space permits and preserve existing open/close behaviour.
- [ ] Make the left tool body scroll vertically; ensure sticky Execute controls remain reachable at 1280×720.
- [ ] Refine TopHeader.tsx to a compact desktop header.
- [ ] Convert clickable non-semantic header elements into real buttons/links with keyboard behaviour.
- [ ] Keep ForMesh 3D identity and all personal operator controls: FastAPI status, ResourceMonitor, Jobs, AI Models, Snapshots, Notifications, Search, Settings, Admin.
- [ ] Calm ResourceMonitor presentation without removing actual telemetry or changing polling semantics.
- [ ] Refine the 48px left navigation rail, labels, selected state, focus, and tool switching.
- [ ] Keep tool switching immediate. Do not add artificial loading skeletons for local state changes.

### Phase 3 — Viewport HUD, XYZ triad, docks, and simple progress

- [ ] Replace boxed model telemetry with a clean borderless HUD containing verified topology, faces, and vertices.
- [ ] Add the interactive SVG/CSS XYZ triad using camera orientation data from the existing Three.js camera.
- [ ] Use one event contract for camera rotation and one for camera preset requests. Preserve or migrate old event consumers deliberately.
- [ ] Clicking axis poles must be keyboard accessible and trigger a real camera preset.
- [ ] OrbitControls must update the triad without causing a new renderer or excessive React renders.
- [ ] Split the right viewport dock into a small grouped tool pill and detached help/reset controls, following the inspected reference.
- [ ] Help must open a real keyboard/orbit shortcuts popover.
- [ ] Keep the bottom bar flat and functional: Reset View, Shading, Compare/Wipe, Export, using the existing rendering and comparison system.
- [ ] Keep camera, lighting, exposure, grid, wireframe, and snapshot controls connected to real existing actions.
- [ ] **Keep the existing simple horizontal generation progress line.** It must show real execution progress and must not be duplicated by another card or fake visualization.
- [ ] Do not reintroduce ThinkingGenerationCard, fake point clouds, or decorative hologram groups.
- [ ] Do not claim a per-frame CPU cost or 60 FPS result without profiling.

### Phase 4 — Single upload authority and tool-panel hierarchy

- [ ] Keep the full upload card only in Generate and the Assets Library.
- [ ] Replace repeated downstream 195px upload cards with a compact Active-Mesh bar when a mesh exists.
- [ ] When no mesh is selected, show a compact Select from Assets / Upload prompt.
- [ ] Show correct asset name, format, faces/triangles where available, and current selection.
- [ ] Switching the active mesh must update the active tool without silently changing workspace identity or route.
- [ ] Do not duplicate asset selection state; use the authoritative workspace selection.
- [ ] Uploading state must show actual filename/percentage/bytes if supplied by the existing upload lifecycle, with a real cancel action.
- [ ] Refactor Texture, Remesh, UV, Segmentation, Rigging, and Animation panels using the same visual hierarchy.
- [ ] Preserve all existing working tool parameters and API parameter builders.
- [ ] Replace oversized yellow-bordered portal flyouts with scrollable inline sections or small, bounded popovers.
- [ ] Keep primary Execute buttons sticky/reachable and show existing real job progress/cancel states.
- [ ] Preserve empty, uploading, running, completed, failed, and cancelled states.

### Phase 5 — Rigging panel and inspector UI

- [ ] Restyle Rigging panel to match the inspected reference.
- [ ] Use the compact Active-Mesh bar.
- [ ] Show only a truthful Humanoid Rig choice if that is the only verified SkinTokens mode.
- [ ] Remove UI controls for quadruped/generic skeleton types if the actual API/model does not support them.
- [ ] Remove the unbacked bind-pose submission control. T-pose/A-pose may appear as guidance only if accurate.
- [ ] Keep GLB/FBX selector only if current API supports both.
- [ ] Keep real SkinTokens parameters: use_skeleton, use_transfer, use_postprocess, temperature, top_k, num_beams, after checking current schema/ranges.
- [ ] Do not show invented Biharmonic Geodesic, max-influence, symmetry-snapping, or facial-bone options unless a verified API capability backs them.
- [ ] Keep full right-side rig inspector: bone hierarchy, XYZ rotation controls, symmetry, X-Ray Skeleton, supported pose presets, and export.
- [ ] Do not claim a humanoid rig is generated until backend job and artifact are complete.

### Phase 6 — Animation UI and normalized clip client

The UI must be built around a verified clip contract, not assumed raw NPZ array names.

- [ ] Refine Animation panel to match the inspected reference: clear Create Motion area, multiline prompt, duration control, primary Generate action, and compact Preset/Saved library.
- [ ] Preserve existing ARDY text-to-motion workflow.
- [ ] Keep only generation controls verified by current backend request and loaded checkpoint. Current repository inspection shows the adapter reports FPS from its loaded motion representation and loads the Core 20FPS checkpoint; do not expose selectable 24/30/60 FPS or Core/G1 options unless Part 2 proves the corresponding model/checkpoint is actually loaded and applied.
- [ ] Duration must respect the existing API validation range (currently 0.5–30 seconds) unless Part 2 deliberately changes the schema.
- [ ] Expose prompt and seed only when actually forwarded to the current request.
- [ ] Do not expose Foot Skating Cleanup or Target Skeleton as functioning toggles unless the real request/adapter pipeline applies them.
- [ ] Build a typed frontend client around the Part 2 API contract below. Use the existing API client/proxy pattern. Do not add a mock backend, fake results, or a Next.js-only endpoint that bypasses FastAPI.
- [ ] Preset cards must load real names, duration, FPS, and thumbnail metadata from the API. Empty, loading, error, malformed, and unavailable states must be explicit.
- [ ] User-uploaded NPZ preview must use the Part 2 preview endpoint. Do not parse arbitrary untrusted ZIP/NPY data in the browser as an improvised shortcut.
- [ ] Saved local clips must use IndexedDB (or an existing durable browser-storage helper) for actual clip data. Metadata-only localStorage entries must not be described as saved clips if clip data is gone after reload.
- [ ] Keep user/premade presets outside backend/storage/. This UI must not write preset files to backend storage.
- [ ] The viewport player must use the existing useAnimationStore, existing playback clock, and existing THREE.AnimationMixer lifecycle. Do not add a second requestAnimationFrame loop.
- [ ] Switching active mesh must stop the old action, unbind/clear the old clip, and prevent animation bleed onto the new mesh.
- [ ] Malformed/incompatible clip errors must preserve the current mesh and return the player to a safe idle/error state.

### Phase 7 — Accessibility, interaction semantics, and orphan cleanup

- [ ] Refactor SimpleTooltip using the existing Radix tooltip implementation and provider.
- [ ] Ensure help and icon controls are actual buttons/links, not inert spans or clickable divs.
- [ ] Migrate SettingsModal and ExportModal to the existing Dialog primitive if current focus/escape behaviour is incomplete.
- [ ] Preserve accessible names, keyboard navigation, focus-visible indicators, dialog focus trapping/restoration, and escape dismissal.
- [ ] Verify pointer, keyboard, and touch compatibility for essential controls without designing a mobile-first layout.
- [ ] Delete an alleged orphan only after checking repository-wide references, dynamic imports, tests, asset URLs, and docs.
- [ ] Do not remove any image in .brain/.

### Phase 8 — Documentation and final UI verification

- [ ] Update Docs/DESIGN.md only for design rules actually implemented.
- [ ] Update Docs/CHANGELOG.md with a concise verified change entry.
- [ ] Do not claim backend endpoints are complete until Part 2 implements and validates them.
- [ ] Run frontend checks listed in Section 11.
- [ ] Inspect finished workspace at 1280×720, 1440×900, 1920×1080, and 4K or nearest available viewport.
- [ ] Check 1024px width for basic safe behaviour; this is not a request to build mobile layouts.
- [ ] Inspect real states: no mesh, mesh loaded, upload, queued, running, completed, failed, cancelled, right panel closed/open, selected/unselected assets, animation idle/loading/playing/paused/error/exporting.
- [ ] Re-run .brain image inventory and final reference map.
- [ ] Report every incomplete requirement, known failure, and deviation from the reference.

---

## 7. UI-Owned API Contract — Freeze Before Backend Work

This is an interface contract, not backend implementation permission. The UI agent may build a typed API client and UI states for these requests. It must not implement Python endpoints or fake server responses.

Part 2 must implement this contract or submit a documented contract-change request before changing it.

### 7.1 Preset listing

GET /api/v1/motion/presets

Expected successful response:

    {
      "schema_version": 1,
      "presets": [
        {
          "id": "opaque-server-issued-id",
          "name": "Walk Forward",
          "duration": 4.0,
          "fps": 20.0,
          "frame_count": 80,
          "thumbnail_url": "/api/v1/motion/presets/{id}/thumbnail",
          "clip_url": "/api/v1/motion/clips/{id}"
        }
      ]
    }

Rules:
- IDs are opaque server-issued identifiers. Never build filesystem paths from a client-supplied filename.
- Metadata may be null when unavailable; never invent a fallback FPS/duration for display.
- Server-provided URLs are authoritative. The UI must not reconstruct download URLs from filenames.
- A missing thumbnail is a normal state; show a neutral static icon, not a fake animation preview.

### 7.2 Normalized motion clip

GET /api/v1/motion/clips/{clip_id}

The response is a normalized MotionClipV1 independent of raw ARDY NPZ internal keys:

    {
      "schema_version": 1,
      "id": "opaque-clip-id",
      "name": "Walk Forward",
      "fps": 20.0,
      "frame_count": 80,
      "duration": 4.0,
      "skeleton_profile": "server-verified-profile",
      "coordinate_system": "server-declared-coordinate-system",
      "translation_units": "server-declared-units",
      "rotation_format": "quaternion_xyzw",
      "joint_names": ["joint_0", "joint_1"],
      "frames": [
        {
          "rotations": [[0.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, 1.0]],
          "root_translation": [0.0, 0.0, 0.0]
        }
      ]
    }

Contract requirements:
- Each frame has exactly one quaternion per joint name.
- Quaternion ordering is XYZW and explicit.
- Coordinate-system and translation-unit values must be derived from the source contract, not guessed.
- Frame count, FPS, and duration must be internally consistent.
- No assumption that arbitrary array shape identifies Euler, axis-angle, positions, or 6D rotation.
- The UI validates schema version, array lengths, finite numbers, and required metadata before binding.
- If actual ARDY representation cannot be mapped safely to this version, Part 2 must stop and propose a new explicit schema. Part 1 must not guess.

### 7.3 Preset thumbnail

GET /api/v1/motion/presets/{id}/thumbnail

Returns a verified PNG/WEBP image or a normal not-found response. The UI must not render filesystem paths or trust filename fragments.

### 7.4 User-supplied NPZ preview (no preset persistence)

POST /api/v1/motion/clips/preview

- Multipart upload field: file.
- Returns the same normalized MotionClipV1 response.
- Preview/inspection only. It must not save the upload into backend/storage/ or silently add it to the server preset library.
- The UI must show actual validation/resource-limit errors.
- Backend owns archive validation and bounded parsing; the UI must not implement a second unsafe NPZ parser.

### 7.5 Completed ARDY job

The completed job must expose a stable server-issued motion_clip_id (or documented equivalent) in its normalized result. The UI uses that ID with the same MotionClipV1 endpoint. Do not use raw server filesystem paths in browser code.

If the current job/artifact contract already exposes a stable ID and safe resolve mechanism, reuse it. Part 2 must audit this first and avoid creating a duplicate endpoint without need.

### 7.6 Standard error behaviour

The UI handles:
- 400/422: invalid or unsupported file/clip/parameters.
- 404: preset or clip no longer exists.
- 413: upload too large.
- 415: unsupported media/format.
- 429: rate/queue limit if applicable.
- 5xx/network failure: service unavailable; preserve current mesh and allow retry.

Use the project's existing API error parser/toast convention.

---

## 8. Panel and Viewport Specification

### 8.1 Left navigation

- Model, Texture, Retopo, Smart UV, Segment, Rig, Animate.
- Bottom-pinned Settings.
- Target rail around 48px.
- Clear active state, title-case labels, 18px icons where supported.
- Gold only for active rail icon/indicator; selection indigo is separate from primary action color.

### 8.2 Active-Mesh strip

For downstream tools:
- Existing valid mesh: compact surface with mesh icon/thumbnail, name, face/triangle count if known, Switch action, and Upload action.
- No mesh: compact one-row prompt with Select from Assets and Upload.
- Uploading: filename, actual percentage/bytes if available, and Cancel wired to existing upload lifecycle.
- Never treat an image asset as a mesh.
- Never confuse workspace_id with asset_id or use asset ID as workspace route identity.

### 8.3 Generate panel

- Keep the full Image / 3D Mesh upload experience here.
- Dynamic model selector must continue to use the backend model registry through existing endpoint.
- Keep actual generation settings and seed controls.
- Primary Generate Model CTA uses the existing submit path.
- No fake model presets or hardcoded model registry.

### 8.4 Texture, Remesh, UV, Segmentation

- Remove repeated large upload cards and use Active-Mesh strip.
- Preserve all working controls and API parameter builders.
- Keep advanced settings bounded and internally scrollable where required.
- Preserve existing job status, cancellation, errors, and result lineage.
- Keep viewport comparison/wipe rules already documented in DESIGN.md.

### 8.5 Rigging

- Match inspected rigging reference hierarchy, not unsupported functionality.
- Humanoid Rig card only where supported.
- T/A-pose guidance may be informational only.
- GLB/FBX selector only if current API confirms both.
- Supported SkinTokens controls only: use_skeleton, use_transfer, use_postprocess, temperature, top_k, num_beams.
- Use current model schema/ranges; do not duplicate hardcoded defaults if registry already supplies them.
- Keep full right-side bone inspector and actual export path.

### 8.6 Animation panel and floating player

- Create Motion card with multiline prompt, duration, seed, and Generate.
- Do not show selectable FPS or skeleton variants unless the backend really loads/applies them.
- Preset and Saved tabs must have honest loading, empty, error, and ready states.
- Preset cards show actual metadata and optional thumbnails.
- Saved means data is persisted in IndexedDB (or existing durable browser storage), not just a localStorage label.
- Player appears only when a valid compatible clip is attached to the active rigged model.
- The player reuses existing store clock and Mixer lifecycle.
- Reset, play/pause, loop, speed, scrub, frame/time labels, and export must work on the real clip.
- Switching models clears or remaps the clip safely; never leave the old character animation active.

### 8.7 Viewport layout

- Top-right: borderless topology/faces/vertices and interactive XYZ triad.
- Right side: compact grouped viewport settings, snapshot, grid/wireframe, help, and reset controls.
- Bottom: flat action bar for reset, shading, wipe/compare, and export.
- Animation player may dock immediately above the bottom action bar when a valid animation is active.
- Avoid overlay collisions with right panel, bottom dock, sticky Execute controls, and short desktop heights.
- XYZ triad projects camera-relative axes from the live camera quaternion. Use accessible buttons and a single existing renderer.

---

## 9. Frontend State and Lifecycle Requirements

### 9.1 Tool panel state

States must make invalid combinations impossible or harmless:
- downstream_empty
- downstream_uploading
- downstream_ready
- tool_executing
- tool_completed
- tool_failed
- tool_cancelled

A failed/cancelled job must not leave the UI permanently busy. A missing mesh must disable execution without throwing. Switching an asset must update active-mesh strip and viewer consistently.

### 9.2 Animation clip state

States:
- idle
- loading_clip
- validating_clip
- binding_clip
- ready
- playing
- paused
- exporting
- clip_error

Transitions:
- Preset click / upload preview / completed ARDY job → loading.
- Response parsed and validated → validating.
- Valid rigged target and compatible clip → binding → ready.
- Play → playing; pause/scrub → paused.
- Export → exporting → paused on success or failure.
- Asset change → stop current action and return to idle unless a supported retarget operation is performed.
- Parse/schema/binding failure → clip_error, preserve loaded mesh and allow dismissal/retry.

### 9.3 One animation clock

- Reuse current useAnimationStore.tickPlayback and existing RAF owner.
- There must be one authoritative clock for floating player and current animation inspector.
- MeshViewer's Mixer advances from that authoritative time or from one intentionally owned mixer delta. Choose one design and document it; do not create two independent clocks that drift.
- Dispose mixer actions, event listeners, stale clips, and object references when active model is replaced/unmounted.
- Keep GLB animation playback working.

### 9.4 Event contracts

Reuse existing event conventions where possible. If changing an event:
- Document event name and typed payload in one place.
- Keep old consumers compatible during migration or update every consumer atomically.
- Remove listeners during cleanup.
- Do not dispatch per-frame state through a React global event if a direct store subscription is more appropriate.
- Do not add a second source of truth for camera rotation or workspace selection.

---

## 10. UI TODO / NOT-TO-DO Checklist

### TODO
- [ ] Audit every reference image and map it to UI requirements.
- [ ] Audit existing frontend state and reuse current components/stores.
- [ ] Implement graphite/indigo/gold semantic design system.
- [ ] Clean workspace shell, header, navigation, and panel sizing.
- [ ] Simplify viewport controls and implement real camera triad.
- [ ] Preserve simple progress line and existing scan reveal only if it remains useful and accurate.
- [ ] Consolidate upload authority and active-mesh selection.
- [ ] Refactor panels without removing working API controls.
- [ ] Implement rigging/animation visual hierarchy.
- [ ] Implement typed client for Part 2 normalized motion contract.
- [ ] Use one animation store/clock/Mixer lifecycle.
- [ ] Implement accessibility, error, empty, loading, and success states.
- [ ] Verify responsive safety at desktop breakpoints and short laptop height.
- [ ] Update affected frontend docs and tests.

### NOT-TO-DO
- [ ] No backend code edits or backend tests changed by this agent.
- [ ] No fake AI generation or simulated completion.
- [ ] No ThinkingGenerationCard or second progress card.
- [ ] No point-cloud/hologram/particle decoration.
- [ ] No unsupported model/settings controls.
- [ ] No mobile-first rebuild.
- [ ] No new renderer, duplicate animation clock, duplicate store, or duplicate asset state.
- [ ] No persistence of user presets in backend/storage.
- [ ] No invented NPZ schema or joint ordering.
- [ ] No broad refactor unrelated to the specified UI.

---

## 11. Frontend Testing and Acceptance Criteria

Run all relevant commands supported by current package scripts. At minimum:

- [ ] bun run test — TypeScript must pass.
- [ ] bun run lint — ESLint must pass.
- [ ] bun test — all existing tests plus new focused UI/store/API-client tests must pass.
- [ ] bun run build — clean production build.
- [ ] Token audit across UI components; preserve legitimate shader/material constants.
- [ ] Test API client loading, empty, HTTP error, timeout/network failure, and malformed normalized clip responses.
- [ ] Test no-active-mesh, active mesh, asset switch, and stale async response cases.
- [ ] Test one-clock animation playback, play/pause, scrub, looping, speed, end-of-clip, and teardown.
- [ ] Test animation export with a real attached clip and verify exported GLB contains the expected animation.
- [ ] Test keyboard operation, focus visibility, tooltip/dialog accessibility, and reduced motion.
- [ ] Confirm no frontend change touched files under backend/ or patcher/.

Visual acceptance:
- [ ] 1280×720: no clipped tool controls or inaccessible sticky CTA.
- [ ] 1440×900: intended three-column desktop hierarchy.
- [ ] 1920×1080 and 4K: viewport remains visually dominant; panels do not grow into excessive whitespace.
- [ ] 1024px: safe fallback; no overlap or lost essential action.
- [ ] No console errors, React key warnings, hydration warnings, unhandled rejections, or stale event listeners.

A passing build does not prove visual quality. The final report must include screenshots or a reproducible browser inspection record for key states.

---

## 12. Frontend Delivery and Handoff

The UI agent must provide:
1. Commit SHA and changed-file list.
2. Completed phases and unchecked/incomplete tasks.
3. Final .brain inventory and image-to-component map.
4. Endpoint contract version used and exact client route/response assumptions.
5. Frontend tests/build/lint results, including pre-existing failures.
6. Screenshot/visual inspection summary at required desktop sizes.
7. Any backend dependency that remains unimplemented by Part 2.

Do not mark the whole project complete while Part 2 endpoints are missing. The UI may be visually complete with a clearly reported backend integration blocker.

**End of Part 1.** Read Part 2 before implementation and treat it as the companion backend contract, not permission to cross ownership boundary.
