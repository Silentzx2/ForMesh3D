# ForMesh3D UI Design System

> **Reviewed:** 2026-11-22  
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
- 3D viewport: `features/workspace/Viewport/MeshViewer.tsx`; comparison view: `ModelComparisonViewer.tsx`.
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
- Keep destructive actions visually distinct and require the existing confirmation pattern where one is already used.
- Reuse existing toast, dialog, tooltip, and progress primitives.

## 6. Workspace and viewport behavior

- The viewport is a local Three.js viewer. It loads GLB/GLTF through `GLTFLoader` and supported OBJ, FBX, STL, and PLY meshes through their Three.js loaders; GLB downloads use the browser-side cache in `features/workspace/lib/glbCache.ts`.
- The server-side WebSocket/WebRTC mesh-streaming design was removed. Do not implement new UI against the old streaming architecture.
- Workspace panels use the existing constrained layout and `.workspace-tool-body` styles from `app/globals.css`; test narrow and short viewports before changing panel sizing.
- Heavy inspectors should continue to load only when their corresponding tool is selected.

## 7. Before/after comparison

- The viewport wipe is offered only when the active mesh is a completed output with a distinct source mesh and no workspace operation is currently executing.
- The source asset ID and resolvable source URL are captured when retopology, texture, UV, segmentation, or rigging is submitted. Completion attaches that exact lineage to the output; later asset selection cannot silently change the "Before" mesh. After reload, the frontend can reconstruct the pair from the completed SQLite operation's `input_asset_id` and the workspace asset record; image inputs are never treated as mesh predecessors.
- The viewport keeps one camera and a straight vertical split. Drag the centered handle horizontally, or use the arrow keys; Home and End move to either edge. The split position stays aligned with the rendered scissor boundary when comparison is reopened.
- Closing comparison, changing the active asset, or starting another operation removes the temporary source scene. The active output remains the selected mesh.
- The property-panel `ModelComparisonViewer` remains the separate side-by-side asset/QA comparison workflow; it is not replaced by the viewport wipe.

## 8. Change discipline

1. Inspect the current component and its callers before adding or replacing a UI pattern.
2. Reuse existing CSS variables and component primitives.
3. Keep design documentation aligned with shipped components; historical proposals belong in an explicitly marked history/ADR, not in the current component reference.
4. Run `bun run test`, `bun run lint`, `bun test`, and `bun run build` for frontend changes.
