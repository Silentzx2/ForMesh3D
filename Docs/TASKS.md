# Engineering Implementation Plan: Tripo3D Studio UI/UX Migration

**Status**: PLANNING — Deep crawl complete (all 10 pages analyzed)
**Primary Goal**: Make ForMesh3D frontend UI/UX match Tripo3D Studio (https://studio.tripo3d.ai) — smooth page switching, same layout structure, same button functions, same navigation flow, same upload/download flows, same hover/active states.
**Reference**: All 10 Tripo studio pages crawled with full DOM inventory saved at `/home/david/Documents/dev/ForMesh3D/.brain/` (10 screenshots).

---

## 1. Observed Tripo3D Studio UI/UX Patterns (Source of Truth)

### 1.1 Global Layout (identical on all 10 pages)

| Element | Selector / Class | Behavior |
|---------|-----------------|----------|
| Logo / Brand | `A[href="/"]` text "3D Workspace" | Top-left, links to home |
| Active tool highlight | `c-[#F9CF00]` on active sidebar link | Gold/yellow color |
| Inactive tool | `c-[#f2f2f2]` on inactive sidebar link | Light gray |
| Sidebar tool links | `group flex flex-shrink-0 flex-col gap-1 transition-all items-center justify-center` | 12 tools, `transition-all` for smooth switch |
| Top nav links | `text-3 c-[#f2f2f2] lh-4 font-500 px-3 rounded-full flex h-7.5` | Home, Assets |
| Hidden file upload | `INPUT type=file opacity-0 cursor-pointer inset-0 absolute z-2` | Behind visible upload UI |
| Primary action button | `animate-button group text-3.5 font-500 rounded-25 cursor-pointer box-border relative` | "Generate Image", "Start Segmenting 40", "Generate 55" |
| Assets tab | `BUTTON role=tab` text "Assets" | Tab |
| Property tab | `BUTTON role=tab` text "Property" | Tab |
| Mine/Collected icon tabs | `BUTTON role=tab` icon-only | Two sub-tabs |
| Switch toggle | `BUTTON role=switch border border-white-10 rounded-full flex h-4.5 w-8.5 cursor-pointer` | On/Off toggle |
| Aspect ratio buttons | `flex transition items-center box-border justify-center border border-white-10` | 1:1, 16:9, 9:16, 4:3, 3:4 |
| Count buttons | `flex transition items-center box-border justify-center px-3.75 py-1.75` | 1, 2, 3, 4 |


### 1.2 Page-by-Page Inventory

#### `/workspace/generate` (Model — ACTIVE on crawl)
- Sidebar: Model link has `router-link-active router-link-exact-active` + `c-[#F9CF00]`
- 4 icon buttons (c-black / c-gray-100, `rounded-32`, `w-1/2`, cursor-pointer)
- Hidden file upload input
- 2 switch toggles (`role=switch`)
- Primary button: `Generate\n55` (generate with count)
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/generate-image` (Image)
- Sidebar: Image link active (`c-[#F9CF00]`)
- Textarea: `Create images from text or images, or use templates for 3D-r` (prompt input)
- Hidden file upload input
- Aspect ratio buttons: 1:1, 16:9, 9:16, 4:3, 3:4
- Count buttons: 1, 2, 3, 4
- Switch toggle (`role=switch`)
- Primary button: `Generate Image`
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/segmentation` (Segment)
- Sidebar: Segment link active
- Hidden file upload input
- Primary button: `Start Segmenting\n40`
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/retopology` (Retopo)
- Sidebar: Retopo link active
- Hidden file upload input
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/fill-parts` (Fill Parts)
- Sidebar: Fill Parts link
- (Page structure follows same pattern as above)

#### `/workspace/smart-uv` (Smart UV)
- Sidebar: Smart UV link active
- Hidden file upload input
- Icon buttons: `p-2 rounded-4 size-8 data-[state=open]:text-purple-1 hover:bg-white-5`, `p-2 rounded-25 hover:bg-white-5`, `flex transition items-center box-border justify-center hover:bg-white-5`
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/texture` (Texture)
- Sidebar: Texture link active
- Hidden file upload input
- Same icon buttons as Smart UV
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/texture-edit` (Edit)
- Sidebar: Edit link active
- Hidden file upload input
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/texture-upscale` (Upscale)
- Sidebar: Upscale link active
- Hidden file upload input
- Same icon buttons as Smart UV
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/texture-pbr` (PBR)
- Sidebar: PBR link active
- Hidden file upload input
- Same icon buttons as Smart UV
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/rigging` (Rig)
- Sidebar: Rig link active
- Hidden file upload input
- Tabs: Assets, Property + 2 icon tabs

#### `/workspace/animate` (Animate)
- Sidebar: Animate link active
- Hidden file upload input
- Same icon buttons as Smart UV
- Tabs: Assets, Property + 2 icon tabs

### 1.3 Smoothness / Transition Patterns Observed
- `transition-all` on every sidebar link — smooth color/scale switch between tools
- `animate-button` class on primary action buttons — animated press state
- `hover:bg-white-5` on secondary buttons — subtle hover
- `data-[state=active]:c-b` / `data-[state=active]:c-black` on tabs — active tab indicator
- `focus-visible:outline-none` on tabs — clean focus
- Router-driven page switch (`/workspace/generate` ↔ `/workspace/generate-image` etc.) — no full reload
- Active sidebar link highlighted with gold color `c-[#F9CF00]`

---

## 2. Current ForMesh3D Frontend State (What to Keep / Remove)

### 2.1 Files that exist (from `features/workspace/`)
```
Rigging/RiggingStudio.tsx (1166 lines)
Rigging/RiggingLeftPanel.tsx (10361 lines)
Rigging/RiggingRightInspector.tsx (13685 lines)
Panels/GeneratePanel.tsx (138940 lines)
Panels/TexturePanel.tsx (83658 lines)
Panels/MeshSegmentPanel.tsx (29695 lines)
Panels/MeshEditPanel.tsx (50312 lines)
Panels/MeshToolsPanel.tsx (29163 lines)
Panels/RemeshPanel.tsx
Panels/UVUnwrapPanel.tsx
Panels/MeshUploadStatus.tsx (2408 lines)
Navigation/LeftNavigation.tsx (17180 lines)
Header/TopHeader.tsx
Viewport/MeshViewer
store/WorkspaceContext.tsx (102846 lines)
store/useRiggingStore
store/useAnimationStore
store/useUIStore
lib/motion.ts (MOTION_FAST, MOTION_SPRING)
constants/models.ts (524 lines, CANONICAL_MODELS)
```

### 2.2 What to Remove (bloat / unused / redundant)
- Duplicate rigging panels (RiggingLeftPanel + RiggingRightInspector + RiggingStudio = 3 files for one tool) → consolidate into 1 panel per Tripo pattern
- Oversized panels: `GeneratePanel.tsx` (138KB), `TexturePanel.tsx` (83KB), `MeshEditPanel.tsx` (50KB) — need trimming to match Tripo's focused per-page UI
- `store/WorkspaceContext.tsx` (102KB) — god store, needs splitting
- Any dead components not referenced by routes
- Unused imports, dead exports, commented code

### 2.3 What to Keep
- `MeshViewer` (Three.js viewport) — keep, style to match Tripo viewport
- `LeftNavigation.tsx` — restructure to match Tripo sidebar (12 tools, transition-all, active gold)
- `TopHeader.tsx` — restructure to match Tripo header (logo, nav only)
- `constants/models.ts` — keep model registry, add UI labels matching Tripo
- `lib/motion.ts` — keep, extend with Tripo-style transitions

---

## 3. Implementation Phases & Task Checklist

### Phase 1: Layout Shell (Sidebar + Header + Page Switch)
- [ ] Rewrite `LeftNavigation.tsx` — 12 tool links matching Tripo exactly (Image, Model, Segment, Fill Parts, Retopo, Smart UV, Texture, Edit, Upscale, PBR, Rig, Animate), each with `transition-all`, `flex-shrink-0 flex-col gap-1 items-center justify-center`, active state `c-[#F9CF00]`, inactive `c-[#f2f2f2]`
- [ ] Rewrite `TopHeader.tsx` — logo, Home/Assets nav
- [ ] Update `WorkspaceShell.tsx` — wire sidebar link clicks to Next.js router push (`/workspace/generate`, `/workspace/generate-image`, etc.), preserve `motion`/`AnimatePresence` for page transitions
- [ ] Add `transition-all` page-switch animation between workspace tools
- [ ] Verify: clicking any sidebar link switches page without full reload, active tool highlighted gold

### Phase 2: Per-Page Panels (Match Tripo DOM structure)
- [ ] `GeneratePanel.tsx` — trim to Tripo generate page: hidden file upload, switch toggles, Assets/Property tabs, primary "Generate" button with count
- [ ] `GenerateImagePanel.tsx` (new or trimmed from GeneratePanel) — prompt textarea, aspect ratio buttons (1:1, 16:9, 9:16, 4:3, 3:4), count buttons (1-4), "Generate Image" button
- [ ] `MeshSegmentPanel.tsx` — hidden file upload, "Start Segmenting" button with count, Assets/Property tabs
- [ ] `RemeshPanel.tsx` (Retopo) — hidden file upload, Assets/Property tabs
- [ ] `UVUnwrapPanel.tsx` (Smart UV) — hidden file upload, icon buttons (purple active state), Assets/Property tabs
- [ ] `TexturePanel.tsx` — trim to Tripo texture page: hidden file upload, icon buttons, Assets/Property tabs
- [ ] Texture Edit / Upscale / PBR panels — same Tripo pattern each
- [ ] Rigging panel — hidden file upload, Assets/Property tabs (consolidate RiggingStudio + LeftPanel + RightInspector into one focused panel)
- [ ] Animation panel — hidden file upload, icon buttons, Assets/Property tabs
- [ ] Verify: each page shows only Tripo-relevant controls, no extra bloat

### Phase 3: Button Functions & Click Logic
- [ ] File upload click → open hidden `<input type=file>` → onChange handler
- [ ] Primary action button → API call (generate/segment/upscale/etc.) with loading state
- [ ] Tab switch (Assets/Property) → toggle panel content
- [ ] Switch toggle → on/off state persistence
- [ ] Aspect ratio / count buttons → selection state
- [ ] Sidebar navigation → router push + active state
- [ ] Verify: every clickable element from Tripo DOM has a working handler

### Phase 4: Smoothness & Transitions
- [ ] Add `transition-all` to all interactive elements (buttons, tabs, toggles, sidebar links)
- [ ] Add `hover:bg-white-5` to secondary buttons
- [ ] Add `animate-button` class to primary action buttons
- [ ] Add `data-[state=active]` styling to tabs
- [ ] Add page-switch motion (AnimatePresence + MOTION_SPRING from lib/motion.ts)
- [ ] Verify: page switches feel smooth, hover states visible, active states clear

### Phase 5: Upload / Download Flows
- [ ] Upload: hidden file input → drag-drop zone (optional) → progress state → success/error toast
- [ ] Download/Export: export button per page → format selection (glb, fbx, obj) → download trigger
- [ ] Verify: upload works, download works, errors handled

### Phase 6: Code Cleanup (Remove Redundant)
- [ ] Delete unused panel files not mapped to Tripo tools
- [ ] Split `WorkspaceContext.tsx` god store into per-feature stores
- [ ] Trim `GeneratePanel.tsx`, `TexturePanel.tsx`, `MeshEditPanel.tsx` to focused size
- [ ] Remove dead imports/exports
- [ ] Verify: `bun run lint` passes, `bun run test` passes, `bun run build` passes

### Phase 7: Documentation Update
- [ ] Update `Docs/DESIGN.md` with new UI specification
- [ ] Update `Docs/ARCHITECTURE.md` with new frontend layout
- [ ] Update `README.md` if needed
- [ ] Update `Docs/CHANGELOG.md`

---

## 4. File → Action Map

| File | Action |
|------|--------|
| `features/workspace/Navigation/LeftNavigation.tsx` | REWRITE — Tripo 12-tool sidebar |
| `features/workspace/Header/TopHeader.tsx` | REWRITE — Tripo header (logo + nav only) |
| `features/workspace/WorkspaceShell.tsx` | UPDATE — wire router + transitions |
| `features/workspace/Panels/GeneratePanel.tsx` | TRIM — Tripo generate page controls |
| `features/workspace/Panels/MeshSegmentPanel.tsx` | TRIM — Tripo segmentation controls |
| `features/workspace/Panels/RemeshPanel.tsx` | TRIM — Tripo retopo controls |
| `features/workspace/Panels/UVUnwrapPanel.tsx` | TRIM — Tripo smart-uv controls |
| `features/workspace/Panels/TexturePanel.tsx` | TRIM — Tripo texture controls |
| `features/workspace/Rigging/RiggingStudio.tsx` | CONSOLIDATE — merge 3 rig files into 1 Tripo-style panel |
| `features/workspace/Rigging/RiggingLeftPanel.tsx` | DELETE — merge into RiggingStudio |
| `features/workspace/Rigging/RiggingRightInspector.tsx` | DELETE — merge into RiggingStudio |
| `features/workspace/store/WorkspaceContext.tsx` | SPLIT — god store into feature stores |
| `features/workspace/lib/motion.ts` | EXTEND — add Tripo transitions |
| `constants/models.ts` | UPDATE — add UI labels matching Tripo |

---

## 5. Verification Criteria (Definition of Done)
- [ ] All 10 Tripo workspace pages have matching ForMesh3D pages
- [ ] Sidebar has exactly 12 tools with Tripo styling (transition-all, active gold)
- [ ] Header matches Tripo (logo, nav only)
- [ ] Every button/tab/toggle from Tripo DOM has a working handler
- [ ] Upload flow works on all pages (hidden file input → handler)
- [ ] Page switches are smooth (no full reload, motion transition)
- [ ] `bun run lint` passes
- [ ] `bun run test` (tsc --noEmit) passes
- [ ] `bun run build` passes
- [ ] No dead code, no unused imports

---

## 6. Risks
- Tripo's actual click handlers call backend APIs we may not have — UI will match but backend integration is separate work
- Some Tripo elements (popovers, templates) need content we don't have yet — mark as TODO with placeholder
- Hidden file upload inputs need visible trigger UI to be usable — design the trigger button

**Skipped**: Backend API integration (out of scope for UI plan), Tripo source code access (not available — compiled React app, only DOM crawl possible), event/home/fill-parts screenshots (user said skip/delete).

---

## 7. Personal Notes (Not for Implementation)

Yeh section sirf mere notes ke liye hai, implementation ka hissa nahi:

- Project personal use ke liye hai — koi auth/login, koi help center, koi DCC bridge, koi app download, koi manage popover, koi public/private toggle nahi chahiye.
- Sirf 12 Tripo workspace tools (Image, Model, Segment, Fill Parts, Retopo, Smart UV, Texture, Edit, Upscale, PBR, Rig, Animate) ka clean UI chahiye jo personal 3D workflow ke liye sufficient ho.
- Har page par sirf: hidden file upload → primary action button → Assets/Property tabs. Bas itna.
- Backend API alag se handle karenge — ye plan sirf frontend UI/UX migration ke liye hai.
- Sabhi screenshots `/home/david/Documents/dev/ForMesh3D/.brain/` mein save hain reference ke liye.

