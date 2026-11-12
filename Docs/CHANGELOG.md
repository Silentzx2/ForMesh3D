# ForMesh3D Changelog

## 2026-11-12 — Floating Mesh Details HUD with Live Geometry Metrics

- **Viewport UI:** Replaced the existing bottom-left stats pill with a collapsible Mesh Details card styled from the supplied reference and positioned above the shader dock / clear of the XYZ gizmo.
- **Real data:** Faces, Verts, Edges, and Materials come from the loaded Three.js model; Size comes from the uploaded file or actual generated-job file metadata. Unsupported metrics are omitted.
- **Performance:** Geometry stats are captured once on model load. Exact edge enumeration is capped at 250,000 faces; larger scenes omit only Edges.
- **Metadata and tests:** Asset normalization retains real backend material counts and file size; added geometry-stat tests for indexed, non-indexed and instanced meshes.
- **Documentation:** Updated design, architecture, system blueprint, project memory, task tracker, and README.

---

## 2026-11-12 — Reference-Matched Floating XYZ Orientation Gizmo

- **Viewport artwork:** Replaced the old 64×64 circular button cluster with the supplied XYZ sphere artwork at `public/assets/xyz-orientation-gizmo.png`. The image is cropped to the artwork bounds and blends into the dark viewport.
- **Six-axis interaction:** The visible X/Y/Z labels snap to positive X/Y/Z views; reverse-axis hit targets snap to negative X/Y/Z and reveal their labels on hover or keyboard focus.
- **Camera correctness:** Added explicit `back` (−Z) and `bottom` (−Y) cases in `MeshViewer.tsx`; both now snap to their intended cardinal view instead of the isometric fallback.
- **Documentation:** Updated the design, architecture, system blueprint, task tracker, audited memory, and README.

---

## 2026-11-11 — Workspace Routing, Friendly Job URLs & Recent Jobs Chip

- **Routing:** Bare `/workspace` now redirects to `/workspace/generate`; `/workspace/overview` and `/workspace/system` routes removed from the workspace UI (`WorkspaceShell.tsx`, `workspaceRouteContract.ts`, `WorkspaceContext.tsx`). Dashboard/assets/jobs route map simplified; `navigateToMain` points dashboard/workspace to `/workspace/generate`.
- **Friendly URLs:** Mesh/image uploads now reflect in the URL as `/workspace/generate/<name>_<hash>` (`useMeshAssetUpload.ts`, `GeneratePanel.tsx`). Generation tasks use friendly `name-hash` IDs instead of raw UUIDs (`WorkspaceContext.tsx::startTask`). Backend job UUID stored separately as `backendJobId`; URL keeps the friendly local ID.
- **Recent Jobs Chip:** New `RecentJobsChip.tsx` in top header shows live/done/failed counts with a dropdown of up to 6 recent jobs; clicking a job navigates to `/workspace/jobs/{id}` and hydrates the job into the viewport (`TopHeader.tsx`, `JobsTab.tsx` inspect link fixed to path param).
- **XYZ Gizmo fix:** Moved below header overlap (`top-3` → `top-12`) and made axis buttons clickable (`pointer-events-auto`) (`ViewportToolOverlay.tsx`).
- **Generate flow:** Removed unnecessary `resolveSmartIntent` hop; generate submits directly to `/api/v1/mesh-generation/image-to-raw-mesh` (`WorkspaceContext.tsx::generate3DModel`).
- **Upload progress:** Image upload now posts to backend with real `onProgress` bar; mesh upload no longer fakes 50% start (starts at 0%, real progress through upload).
- **AGENTS.md:** Added top project-rule notice; removed user-preferences section and table of contents; Section 3 research/search rules consolidated.
- **Tests:** `npx tsc --noEmit` passed with 0 errors. Runtime server/browser not verified in this environment.
