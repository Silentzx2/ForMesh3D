# Active Task: Script Engine for Existing Mesh Tools

**Status:** Completed and verified.  
**Repository:** Silentzx2/ForMesh3D, dev branch.  
**Project profile:** Personal-use, self-hosted application; flat backend layout, durable workspace persistence.

## 1. Goal & Completed Integration

Connected Script Engine end to end for Retopo, Smart UV, and Segment:
- Flat backend modules: `backend/pipelines/retopo.py`, `smart_uv.py`, `segment.py`, `mesh_utils.py` with density safety capping via `mesh_guard.py`.
- FastAPI endpoints: `/api/v1/mesh-tools/auto-retopo`, `/auto-uv`, and `/segment` stream real SSE progress and register operations in SQLite FIFO queue.
- Workspace Preview Lifecycle: operation temporary staging in `storage/temp/<op_id>/`, served via `/api/v1/workspace/operations/{operation_id}/preview`.
- Operation Action Bar: Keep commits operation output to workspace immutable asset version; Discard purges temp directory and restores viewer baseline.
- Bridge & Context: reconciled parameters across UI panels, bridge (`meshProcessingBridge.ts`), and `WorkspaceContext.tsx`.

## 2. Non-Negotiable Scope

- In scope: Retopo, Smart UV, Segment only. No Model Generation or Texture pipeline; no Rig, Animate, Settings, repair, optimization, LOD, collision, or other operation files.
- Keep the current navigation exactly as-is: Model, Texture, Retopo, Smart UV, Segment, Rig, Animate, Settings. No new, renamed, reordered, or removed navigation items, panels, or workspace areas.
- Flat backend layout: backend/pipelines/retopo.py, smart_uv.py, segment.py, mesh_utils.py. Keep existing backend/pipelines/mesh_guard.py and reuse it; do not duplicate its density guard.
- Reuse features/workspace/services/meshProcessingBridge.ts. No second bridge, engine-specific Python files, nested pipeline folders, manager framework, or extra registry unless repository evidence proves it necessary.
- Do not alter AI inference paths or modern-GPU behavior while integrating CPU Script Engine operations. No new dependency until installed packages, Blender availability, and existing helpers are checked.

## 3. Mandatory Discovery Before Coding

Read AGENTS.md completely and follow it. Review relevant current docs: Docs/ARCHITECTURE.md, DESIGN.md, DECISIONS.md, MEMORY.md, PRD.md, SYSTEM-BLUEPRINT.md, SECURITY.md, plus authoritative storage/database contracts.

Trace the complete call graph and direct callers: LeftNavigation, WorkspaceShell, route mapping; RemeshPanel, UVPanel, SegmentationPanel, EngineModeSelector, right inspectors, upload hook and preview/progress components; WorkspaceContext, meshProcessingBridge, task persistence, route helpers, viewer store, asset normalization, preview snapshot, OperationActionBar and asset browser; mesh_tools.py, both app entrypoints, API proxy, file upload/download, database manager/models, storage manager, artifact utilities, cleanup/recovery and mesh_guard.py.

Inspect tests, requirements, install scripts, Dockerfile, existing pipeline/util modules, and search for TODOs, placeholder responses, stale IDs, dead branches, dropped parameters, partially implemented algorithms and duplicate helpers. Record verified behavior and exact file/line locations before editing. Do not infer that something works from DEFAULT_SCRIPTS or requirements.txt alone.

## 4. Existing Findings to Re-Verify and Resolve

The bridge already supports AI/Script modes and a registry. Current script IDs include trimesh_autoretopo, xatlas_fast, blender_smart_uv and trimesh_decomposition. Reconcile IDs without gratuitous renaming that could break saved settings or callers.

The existing mesh-tools router exposes /auto-retopo, /auto-uv and /segment, but inspected handlers return a progress event followed by a rebuilding-service error. Replace placeholders with real execution while preserving the current endpoint and SSE contract.

The bridge currently reconstructs GLB from mesh_b64. Inspected Script branches in WorkspaceContext create browser object URLs and transient assets with operation_id unset. This bypasses durable operation identity and workspace preview persistence. A browser object URL or in-memory asset is not a storage integration.

Known parameter gaps to audit against latest dev:
- Retopo UI has target polycount, triangle/quad topology, preserve edges, feature angle, adaptive density, watertight healing and output format. Context sends adaptiveDensity/watertightHealing while bridge reads adaptive/watertight; bridge hard-codes GLB.
- Smart UV UI has XAtlas/Blender selection, unwrap strategy, atlas resolution, island margin, save-individual-parts and output format. Script path forwards only a subset; verify each engine's actual support.
- Segment UI has part count, semantic/geometric mode, hierarchy, individual-part output, output format and colorized preview. Context/bridge do not currently carry every setting through Script mode.
- EngineModeSelector disables AI for Segment although the registry contains a neural segmentation entry. Resolve the intended behavior from actual server/model availability, not assumptions.

These are findings to verify, not behavior to preserve blindly.

## 5. Required Backend Files and Responsibilities

Add only the following flat operation modules if the audit confirms they are needed:
- backend/pipelines/retopo.py — retopology execution and algorithm selection.
- backend/pipelines/smart_uv.py — UV unwrapping and atlas generation.
- backend/pipelines/segment.py — only geometric/semantic segmentation genuinely supported by installed algorithms.
- backend/pipelines/mesh_utils.py — cohesive shared helpers for safe input validation/path handling, mesh and Scene loading, format conversion, output writing, statistics, subprocess execution and common error/result handling.

mesh_utils.py can hold substantial shared logic, but must stay operation-agnostic. Reuse existing storage, validation, file utilities, mesh_guard, database and artifact helpers. Keep HTTP/SSE concerns in the existing router unless the architecture proves a better existing owner. Do not create a service framework.

## 6. UI-First Parameter Contract

Before algorithms, inventory every visible control and map it through: UI state/default -> WorkspaceContext customSettings/call -> bridge key/serialization -> FastAPI options validation -> pipeline argument -> actual algorithm effect -> settings snapshot/result statistics.

- Retopo must honor target polycount/target faces, topology, preserve-edges/feature-angle, adaptive density, watertight option and supported format. Target face count is approximate where the algorithm says so; report actual counts.
- Smart UV must honor selected XAtlas/Blender engine, supported unwrap strategy, atlas resolution, island margin/padding and format. Preserve geometry, materials and scene data; do not pretend both engines support identical parameters.
- Segment must honor geometric/semantic mode, part count, hierarchy, individual-part output, colorized preview and format only where the selected algorithm really supports them. Never label geometric decomposition as semantic AI segmentation.
- If a required algorithm option lacks a UI control, add the smallest control inside its existing panel only after proving it is needed and supported. If a control already exists but is dropped, wire it—never add a duplicate. Unsupported controls must be disabled with a clear reason or removed only with a documented product decision.

## 7. Backend Execution and SSE Contract

Use existing /api/v1/mesh-tools/auto-retopo, /auto-uv and /segment unless route audit proves otherwise. Preserve multipart names expected by the bridge (meshFile, options, format), or update both ends atomically with tests.

Validate options, ranges, enums, file extensions, size/complexity limits and output format. Use server-controlled paths; never trust client filesystem paths. Run CPU-heavy work off the FastAPI event loop using the smallest established executor/subprocess pattern; bound runtime and terminate child work on cancellation/disconnect where feasible.

Emit structured progress, stage, log, error and done SSE events; every terminal path must have one unambiguous outcome. Handle chunk boundaries, final unterminated buffers, malformed events, disconnects and cancellation in the bridge. Return operation_id, workspace_id, preview/output URL, format and actual statistics. Prefer storage-backed preview URLs over large base64 meshes. Do not report success until output exists, validates and is registered.

## 8. Workspace Storage and Preview Lifecycle (Critical)

Use the existing authoritative workspace storage system and docs. SQLite is authoritative; metadata.json, where specified, is a projection—not a second source of truth.

Preserve workspace_id and current route. Create a real operation_id/operation row with operation_type, input asset, settings snapshot, parent lineage, execution/persistence statuses and temporary output location. Keep unsaved outputs in the established preview/temp location with documented TTL/cleanup; never overwrite retained assets.

Attach operation_id/workspace_id to preview task and asset so the existing OperationActionBar works. Keep uses the existing Keep endpoint and atomically retains a new immutable asset/version, updates active_mesh_asset_id and exposes it in the asset browser. Discard uses the existing endpoint, removes only the unsaved preview and restores the exact viewer/workspace baseline. Regenerate creates a new operation_id linked by parent_operation_id; never overwrites prior output.

Workspace reload must restore retained script outputs from SQLite and verified files—not object URLs or in-memory state. Respect the established single metadata.json rule, storage hierarchy, version naming, path-containment checks, cleanup/trash rules and DB/file consistency. Do not invent a parallel storage tree or extra metadata files.

## 9. Explicit State-Machine Audit (Mandatory)

Run the exact repository-required prompt before coding: "find all of the implicit state machines in my formesh3d app". Scope it to affected panels, WorkspaceContext, bridge, upload hook, SSE/backend worker, operation persistence, preview action bar, viewer store and direct callers.

For each machine, document owner, states, allowed transitions, triggers, side effects, terminal states, cancellation/error behavior and file/line. Inspect engine/script selection; upload/verification/input selection; each operation; SSE/abort/disconnect; ExecutionStatus and PersistenceStatus; preview/Keep/Discard/Regenerate/expiry/reload; active asset/viewer loading; and worker recovery if script work enters that lifecycle.

Use existing explicit execution and persistence machines as authority. No parallel booleans or duplicate statuses. Guard legal transitions and cover queued/running/completed/failed/interrupted/cancelled plus not_saved/saving/saved/save_failed/discarded/cleanup_pending/preview_expired where applicable. Prevent impossible combinations, orphaned temp files and success-without-output states.

## 10. Modern UI Quality (Existing Surfaces Only)

Make the existing Retopo, Smart UV and Segment panels feel like a modern production-quality 3D studio without changing navigation or adding panels. Follow Studio Gold / Matte Black tokens and existing components; preserve the current workspace/viewport composition.

Use compact responsive layouts, clear labels/units/ranges/defaults, useful help, visible disabled states, readable progress and truthful result statistics. Cover idle, upload, queued/running, completed preview, failed, cancelled and expired states. Maintain keyboard access, focus visibility, semantic labels, contrast and reduced-motion support. Use purposeful subtle transitions; no new palette, gratuitous gradients, oversized cards, floating UI or decorative redesign. Prefer existing CSS tokens over hard-coded colors.

## 11. Upstream Research Findings and Selection Gates

Re-check exact APIs/versions during implementation; research is evidence, not automatic approval:
- Blender Python API provides bpy.ops.object.quadriflow_remesh with target_faces, sharp/boundary preservation and preserve_attributes. It also warns data layers are lost, so test UV/material/attribute preservation. Blender is already installed by Dockerfile/install flow; prefer its bundled QuadriFlow only if headless execution and output fidelity pass. https://docs.blender.org/api/current/bpy.ops.object.html
- Standalone QuadriFlow is MIT and supports Linux/macOS/Windows, but requires native dependencies (Boost, Eigen, optional OpenMP/TBB) and transitive license review. Use only if Blender's bundled operator is insufficient. https://github.com/hjwdzh/QuadriFlow
- Instant Meshes has a permissive BSD-style license, but upstream documents an interactive orientation-field -> position-field -> export workflow, sibling datasets folder and Linux zenity dependency. No reliable unattended server CLI contract was established; do not make it default without proving headless use, packaging, maintenance and output quality. https://github.com/wjakob/instant-meshes
- XAtlas Python bindings are MIT and xatlas is already in requirements. API returns vertex mapping, new indices and UVs; account for vertex duplication and preserve materials/scene attributes. https://github.com/mworchel/xatlas-python ; https://pypi.org/project/xatlas/
- Trimesh is already installed and supports splitting by face connectivity. That is connected-component splitting, not a guarantee of an arbitrary requested part count. https://trimesh.org/trimesh.html
- CoACD is already listed and MIT, but performs approximate convex decomposition for collision geometry—not semantic segmentation. Do not misrepresent it or add collision UI. Use in Segment only if geometric mode is explicitly defined as convex decomposition and output contract is accepted. https://github.com/SarahWeiii/CoACD
- Do not add PyMeshLab or another dependency merely because it is installed. Verify license, filter semantics, format fidelity and necessity before using it inside an in-scope operation.

Select the simplest algorithm that meets actual panel behavior, runs unattended on the target Linux/VPS environment and passes real mesh tests. Do not promise unsupported capabilities.

## 12. Implementation Order

1. Discovery: read docs, map call graph, inventory UI controls, audit implicit state machines, verify branch/tests and record exact gaps.
2. Algorithm decisions: prove APIs/CLI, licensing, packaging, parameter semantics and output fidelity for all three operations.
3. Shared utilities: implement only genuinely shared helpers in mesh_utils.py; reuse mesh_guard.py and existing storage helpers.
4. Operations: implement retopo.py, smart_uv.py and segment.py; validate outputs and truthful statistics.
5. Backend/SSE: replace placeholders, preserve routes/contracts, support cancellation/errors and operation-backed previews.
6. Bridge: reconcile script IDs and schemas, serialize every supported setting and harden SSE/cancellation.
7. Workspace lifecycle: durable IDs, preview URLs, settings snapshots, baseline restoration, Keep/Discard/Regenerate and saved reload.
8. UI: wire all existing controls; add only proven missing controls within the same panels; polish with existing design system.
9. Verification/docs: focused tests, state audit, Python/TypeScript checks, relevant CI and affected documentation.

## 13. Tests and Acceptance Criteria

Test representative triangle/quad, multi-object Scene, disconnected, non-manifold, empty, malformed, high-density and material/UV-bearing meshes. Retopo tests verify target forwarding, actual counts, valid topology and observable supported feature settings. UV tests verify valid non-overlapping UVs, atlas/padding, geometry/material preservation and engine-specific options. Segment tests verify actual parts, stable IDs/names, hierarchy/individual exports only when supported, and truthful part counts.

API tests cover multipart/options validation, SSE progress/done/error, output URL/operation identity, disconnect/cancel and event-loop responsiveness. Frontend tests prove every visible setting reaches the intended backend argument. Lifecycle tests cover DB rows, temp previews, Keep, Discard, Regenerate lineage, expiry cleanup, route stability, reload and no retained-file overwrite/deletion. State tests cover legal transitions and all terminal/abort paths.

Run relevant pytest, frontend tests, TypeScript/lint/build, Python compilation and available CI. Record exact commands/results; never claim an unrun check passed. Acceptance: all three Script operations run from existing panels, display modern responsive progress/preview UI, retain/discard correctly and reload from the same workspace—with no navigation additions, no Model/Texture script, no unrelated refactor, no duplicate storage system and no unnecessary enterprise abstractions.

## 14. Out of Scope

Do not rewrite AI adapters, change generation/texture flows, add a new tool framework or queue, move existing routes, redesign the whole Studio, or create separate UI surfaces. Keep the change focused on completing the existing Script Engine for Retopo, Smart UV and Segment.
