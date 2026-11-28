# ForMesh3D UI Design System

> **Reviewed:** 2026-11-26  
> **Source of truth:** `app/globals.css`, current workspace components, and `lib/motion.ts`. This guide documents the implemented UI foundation, not historical mockups or removed components.

## 1. Visual foundation

ForMesh3D uses a dark studio interface with a gold primary accent. Prefer semantic CSS variables and Tailwind token classes over one-off color literals.

| Token | Current value | Intended use |
|---|---|---|
| `--background` | `0 0% 3.1%` | App background |
| `--foreground` | `0 0% 96%` | Main text |
| `--card` | `0 0% 6.7%` | Cards |
| `--popover` | `0 0% 10.2%` | Popovers and floating surfaces |
| `--primary` | `48 100% 50%` | Studio Gold accent |
| `--primary-foreground` | `0 0% 5%` | Text on primary surfaces |
| `--muted` | `0 0% 14.1%` | Muted surfaces |
| `--muted-foreground` | `0 0% 63%` | Secondary text |
| `--destructive` | `0 72% 56%` | Destructive actions and errors |
| `--border` | `0 0% 22%` | Borders |
| `--ring` | `48 100% 50%` | Keyboard focus |
| `--surface-0` … `--surface-4` | 6% … 22% lightness | Viewport, panels, nested and raised surfaces |

Additional `--studio-gray-*`, `--studio-yellow-1`, chart, and semantic tokens are defined in `app/globals.css`. That stylesheet is authoritative when this table and code differ. Avoid adding new global color aliases without a concrete need.

## 2. Layout and component ownership

- App shell and global providers: `app/layout.tsx`, `components/Providers.tsx`.
- Workspace composition: `features/workspace/WorkspaceShell.tsx`.
- Navigation and header: `features/workspace/Navigation/LeftNavigation.tsx`, `features/workspace/Header/TopHeader.tsx`.
- Tool panels: `features/workspace/Panels/` (Generate, Texture, Remesh, UV, Segmentation, Rigging, Animation).
- Asset and property surfaces: `features/workspace/RightPanel/`.
- 3D viewport and before/after comparison: `features/workspace/Viewport/MeshViewer.tsx` with `ViewportToolOverlay.tsx`; the viewport wipe is the only model-comparison UI.
- Shared workspace UI: `features/workspace/components/`.
- Reusable primitives: `components/ui/` and `components/premium/`.

Do not add a parallel workspace shell or duplicate an existing panel/component. Keep tool-specific controls in their owning panel and reusable behavior in the existing shared component layer.

## 3. Icons

Hugeicons is the current icon system. Legacy workspace icon names are wrapped by `components/icons/hugeicons-components.tsx`; new code may use `HugeiconsIcon` and `@hugeicons/core-free-icons` directly.

- Use the existing icon wrapper when matching an established workspace icon.
- Give icon-only controls an accessible name.
- Mark purely decorative icons as hidden from assistive technology.
- Keep icon names and wrappers in the existing Hugeicons component layer; do not add a parallel mapping registry.

## 4. Motion

The only shared presets currently exported by `lib/motion.ts` are:

- `MOTION_FAST`: 150 ms ease-out style transition for micro-interactions.
- `MOTION_SPRING`: spring with stiffness 300 and damping 30 for panel-like motion.

Use only the currently exported shared presets. Prefer local CSS transitions for simple hover/focus states rather than adding another preset.

## 5. Interaction and accessibility

- Provide visible keyboard focus using the existing ring token.
- Use semantic buttons, labels and form controls; icon-only buttons need accessible names.
- Preserve loading, disabled, empty, success and error states when changing async UI.
- Avoid hover-only functionality; touch and keyboard interaction must remain usable.
- Respect reduced-motion preferences for non-essential movement.
- Keep destructive actions visually distinct and require the existing confirmation pattern where one is already used. Delete/Trash dialogs keep keyboard focus contained, close with Escape when idle, and confirm irreversible purge/empty actions; failed server deletes keep the dialog open.
- Reuse existing toast, dialog, tooltip, and progress primitives.

## 6. Workspace and viewport behavior

- The viewport is a local Three.js viewer (`TrackballControls` for full 360° gimbal-lock-free orbiting). It loads GLB/GLTF through `GLTFLoader` and supported OBJ, FBX, STL, and PLY meshes through their Three.js loaders; GLB downloads use the browser-side cache in `features/workspace/lib/glbCache.ts`.
- Derived post-operation meshes (texture, retopology, UV, segmentation, rigging) are excluded from the Assets panel and selected via the viewport **Mesh Version** selector (`workspaceVersions`); switching tools auto-selects the matching workspace version (base mesh on Generate, texture on Texture, rigged mesh on Rigging and Animation).
- The server-side WebSocket/WebRTC mesh-streaming design was removed. Do not implement new UI against the old streaming architecture.
- Workspace panels use the existing constrained layout and `.workspace-tool-body` styles from `app/globals.css`; test narrow and short viewports before changing panel sizing.
- Heavy inspectors should continue to load only when their corresponding tool is selected.

## 7. Before/after comparison

- Texture/PBR comparison is available for a loaded mesh: the before copy uses neutral clay shading while the active after copy retains PBR/textured materials. It loads the same mesh URL twice and does not create an asset.
- Geometry comparison (Retopo, Remesh, UV mesh output, Segmentation) requires a completed output with a verified, distinct source mesh URL. UV atlas/metadata-only outputs are not comparable meshes.
- The source asset ID and resolvable source URL are captured when retopology, texture, UV, segmentation, or rigging is submitted. Completion attaches that exact lineage to the output; later asset selection cannot silently change the "Before" mesh. After reload, the frontend can reconstruct the pair from the completed SQLite operation's `input_asset_id` and the workspace asset record; image inputs are never treated as mesh predecessors.
- The viewport keeps one camera and a draggable, keyboard/touch-accessible vertical split. Both halves share the scene, lighting, renderer and render loop. Comparison renders both states into resize-aware render targets with the existing WebGLRenderer, then composites them through a shader using the same 14-degree diagonal as the draggable divider.
- Closing comparison, changing the active asset, or starting another operation removes the temporary source scene. The active output remains the selected mesh.
- There is no separate right-panel model picker, side-by-side renderer, or QA comparison section. All model before/after comparison uses the viewport wipe.

## 8. Desktop floating controls and overlays

- Header popovers (workspace mode, resource monitor, recent jobs, snapshots and notifications) are mutually exclusive; opening one closes the others.
- Viewport shading modes are controlled from the bottom material dock. Camera, lighting and exposure remain in Viewport Settings; Wireframe Overlay, Auto Rotate and Ground Grid each have one primary viewport toggle.
- Advanced tool settings use `.workspace-advanced-flyout` from `app/globals.css`. Desktop flyouts are height-bounded, internally scrollable and positioned clear of the bottom material dock. Keep each panel width in `--workspace-flyout-width` rather than adding one-off fixed positioning.
- Toggle buttons expose state with `aria-pressed` or `role="switch"` plus `aria-checked`. Tooltip-only help indicators are not inert buttons.

## 9. Route and page ownership

- `/` redirects to `/workspace/generate`.
- `/workspace` redirects to `/workspace/generate`; active workspace deep links use `/workspace/<tool>/<workspace_id>`.
- Canonical tool routes are `/workspace/generate`, `/workspace/retopology`, `/workspace/texture`, `/workspace/texture-edit`, `/workspace/texture-pbr`, `/workspace/smart-uv`, `/workspace/segmentation`, `/workspace/animate`, and `/workspace/rigging`.
- Workspace overlays are Assets (`/workspace/assets`), Jobs (`/workspace/jobs`), and System (opened from the FastAPI status control); there is no Dashboard/Overview page.
- `/admin` opens Models by default. Supported tabs are Models, Runtime, Logs, Jobs, Queue, Health, Storage, Database, and Settings.
- `/dashboard`, `/workspace/dashboard`, `/workspace/fill-parts`, and obsolete workspace route aliases are removed. Do not reintroduce them; add routes only when a current UI owner and navigation entry exist.

## 10. Change discipline

1. Inspect the current component and its callers before adding or replacing a UI pattern.
2. Reuse existing CSS variables and component primitives.
3. Keep design documentation aligned with shipped components; historical proposals belong in an explicitly marked history/ADR, not in the current component reference.
4. Run `bun run test`, `bun run lint`, `bun test`, and `bun run build` for frontend changes.

 
## 11. Asset library and viewer lifecycle

- All renderable-asset selection entry points use the same request, verify, load, then ready/error lifecycle from the actual Three.js loader. A newer selection or workspace change invalidates stale completions; retry starts a new request.
- The Workspace scope toggle is strict: it shows matching workspace assets only and may show an empty state. It never silently displays global assets as a fallback.
- Collection names and asset assignments are persisted in the existing app-state localStorage store. The Collections control filters by an assignment; removing an assignment clears the persisted mapping.
- Duplicates are local aliases to the original file. Removing a duplicate removes only the alias and never deletes its shared source. Backend deletion is attempted only for a validated job/upload identity and the card is removed only after a successful response.
- Thumbnail failures are scoped to the asset ID and exact thumbnail URL, so a changed URL can be retried. Pagination resets on filter/scope changes and clamps when results shrink.
- Upload guidance matches the validator: GLB, GLTF, OBJ, FBX, STL and PLY, up to 200 MiB.
- The Generator context accordion follows persisted desktop inspector state; changing tools may auto-expand it until the user manually overrides it.
- Asset favorites are toggled from each asset's options menu and persisted by stable asset identity in the existing app-state store.
- Viewer statistics are cleared when a new asset selection begins, preventing the still-visible previous mesh from supplying stale metrics to the new selection. The old mesh remains rendered until the replacement load succeeds.
- Geometry health and UV chart counts display unknown when no measured or backend metadata exists; do not substitute assumed manifold status, chart counts or UV-channel labels.
- `glbCache.ts` shares network work while keeping cancellation per consumer; the underlying fetch is aborted only after the final subscriber leaves.

## 12. Task execution and cancellation

- Explicit user cancellation is terminal `cancelled`; `interrupted` is reserved for work interrupted by process/runtime failure.
- Batch submission has a single-run guard and one abort controller; cancellation stops pending submissions and cancels accepted jobs through the dedicated `/cancel` endpoint.
- Batch cancellation resolves local task keys through their backend job identity. Retrying a failed batch item preserves its original input and settings snapshot.
- Adaptive polling runs only while backend jobs are queued/running and ignores responses that arrive after a task has entered a terminal state.

## 13. Animation player & motion clip UI

- The Animation panel (`features/workspace/Panels/AnimationPanel.tsx`) creates ARDY text→motion clips, lists premade presets (`backend/motion_presets/`), user uploads/generated presets (backend/storage/presets/<preset_id>/), with IndexedDB as an optional cache, then binds a validated `MotionClipV1` to the active rigged mesh.
- `ViewportToolOverlay.tsx` mounts `CameraTriad` (fixed interactive SVG/CSS XYZ mesh-orientation controller, independent of viewer camera state) and `AnimationPlayerBar` (play/pause, reset, loop, speed pills, scrubber, time/frame labels, export animated GLB). XYZ clicks rotate only the active mesh group so the selected local axis faces the current view; orbiting, panning and zooming never move or rotate the gizmo. Camera controls remain free 360° `TrackballControls`.
- `ActiveMeshBar.tsx` is the compact downstream mesh selector/uploader (drag/drop, file picker, actual percent/bytes, cancel). `MeshOrientationModal.tsx` adjusts X/Y/Z orientation before upload. The upload-time flow remains unchanged. A separate bottom-left viewport control appears only while a workspace mesh is fully loaded; it opens the same modal using that selected mesh. Saving reuses `POST /api/v1/file-upload/mesh` with `workspace_id` and `asset_id`, atomically replaces the selected GLB in place, and updates the same SQLite asset row (path, size, SHA-256, thumbnail) without creating another asset or version. Saves are rejected while a workspace operation is queued or processing; GLB export retains original mesh units. `QualityBadge.tsx` reports mesh QA tier (Sharp/Clean/Needs Review) from the asset QA report.
- `services/motionClient.ts` is the typed frontend client for `GET /api/v1/motion/presets`, `GET /api/v1/motion/presets/{id}/thumbnail`, `GET /api/v1/motion/clips/{clip_id}`, `POST /api/v1/motion/clips/preview`, `GET/POST /api/v1/motion/uploads; POST /api/v1/motion/uploads/from-clip/{clip_id}; DELETE /api/v1/motion/uploads/{clip_id}`; it validates `MotionClipV1` (schema version 1, quaternion_xyzw, finite values, consistent duration/fps/frame_count) on every response. `services/motionStorage.ts` caches accepted clips in IndexedDB (`preset`, `preview`, `generated` sources); the backend user preset library is the source of truth.
- No raw NPZ parsing happens in the browser. Bundled premade assets live in `backend/motion_presets/`; user imports/generated copies live in `backend/storage/presets/<preset_id>/`; user preset directories are separate from workspace asset directories.


## Telemetry and evidence display

- QualityBadge must show **Not assessed** and **Not reported** when the backend has not supplied QA metrics. Missing values must never be rendered as zero defects or 100% feature retention.
- Queued jobs show queue position when supplied and an indeterminate progress indicator; a determinate percentage is shown only when reported by the backend.
- Multi-GPU VRAM totals are calculated from actual per-GPU readings when aggregate fields are absent; unavailable totals are shown as unavailable, never as zero.
