# ForMesh3D — Active Engineering Tasks & Implementation Specifications

**Document Status:** Active Engineering Roadmap & Implementation Plan  
**Updated:** 2026-11-10  
**Scope:** Active and Planned tasks only. All previously completed work (route hydration, asset deduplication, TripoSG thumbnail generation, and VRAM eviction) has been verified and removed from this document to prevent redundant re-implementation by agents.

---

## Task 1: Non-Intrusive Viewport Overlays (Interactive XYZ Gizmo & Compact Stats Chip) — COMPLETED ✅

> [!IMPORTANT]
> **Zero Layout Displacement / No Separate Sections:**
> The XYZ Gizmo and Mesh Details HUD must **NEVER** push the 3D canvas, add side panels, or create separate UI sections. They are **pure floating, non-intrusive transparent overlays** directly on the WebGL canvas.

### 1.1 Spatial Placement (Inside Canvas Only)

```text
┌──────────────────────── 3D WebGL Canvas ────────────────────────┐
│                                                                  │
│                                                [Top-Right]       │
│                                                ┌──────────────┐  │
│                                                │  XYZ Gizmo   │  │
│                                                │  (64x64px)   │  │
│                                                └──────────────┘  │
│                                                                  │
│                        3D MESH                                   │
│                                                                  │
│                                                                  │
│  [Bottom-Left]                                                   │
│  ┌─────────────────────────────────┐                             │
│  │ 1.18M Tris · 590K Verts · GLB   │ (Ultra-compact floating pill)│
│  └─────────────────────────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Two-Way Interactive XYZ Gizmo (Touch & Drag Synchronized)
1. **Touch/Drag Mesh -> Gizmo Follows:**
   Rotating/touching the 3D mesh smoothly synchronizes the XYZ gizmo in real time.
2. **Touch/Drag Gizmo -> Mesh Rotates:**
   Dragging directly on the gizmo disc smoothly orbits the mesh and camera in the viewport.
3. **Axis Tap -> Smooth Snap:**
   Tapping an axis ball smoothly animates the camera to canonical views:
   - `+Z`: Front View | `-Z`: Back View
   - `+Y`: Top View | `-Y`: Bottom View
   - `+X`: Right View | `-X`: Left View
4. **Footprint & Aesthetic:**
   - Ultra-compact: `64px × 64px` floating glass disc (`bg-black/30 backdrop-blur-sm border border-white/10 rounded-full`).
   - Standard axis colors: Red (`+X`), Green (`+Y`), Blue (`+Z`).

### 1.3 Ultra-Compact Mesh Details Chip
- **Position:** Bottom-Left of canvas (`bottom-3 left-3`).
- **Footprint:** Single-line floating pill (~24px height), zero model obstruction.
- **Format:** `[ ▲ 1,179,418 Tris ] · [ ● 589,689 Verts ] · [ ⬡ Triangle ]`.
- **Source:** Extracted live from loaded Three.js `BufferGeometry`, falling back to `currentAsset` metadata.

---

## Task 2: Script Execution Engine — Unified Progress Streaming & Real-Time Logger across ALL Scripts — COMPLETED ✅

> [!NOTE]
> Script-based processing (Auto-Retopo, Smart UV, Segmentation, Decimation, Bake, Repair, LODs, Collision) must stream **granular stage-by-stage progress percentages** and **live log entries** over Server-Sent Events (SSE) into the frontend `LiveExecutionPanel` and progress bar.

**Logging added to all 10 postprocess service scripts** (`auto_retopo.py`, `segment.py`, `simplify.py`, `collision.py`, `convert_fbx.py`, `hole_repair.py`, `inspect.py`, `mesh_thumbnail.py`, `gate.py`, `repair.py`) with `logging.getLogger(__name__)` and `logger.info()` calls at function entry and key milestones. Progress milestones emit at TASKS.md §2.1 frac values via existing `progress` callback → `stream_payload()` SSE → frontend `LiveExecutionPanel`.

### 2.1 Backend Granular Stage Architecture (Per Script)

Each script in `backend/postprocess/services/` must yield progress and log events via `emit(stage: str, frac: float, message: str, log: str | None = None)`:

| Script / Service | Pipeline Stages & Progress Milestones |
|------------------|---------------------------------------|
| **Auto-Retopo** (`services/auto_retopo.py`) | • `0.10`: Analyzing curvature & feature edges<br>• `0.30`: Building guide field & surface parameterization<br>• `0.65`: Extracting clean quad/tri topology<br>• `0.85`: Projecting vertices & snapping sharp creases (`snap_to_features`)<br>• `1.00`: Retopology complete |
| **Smart UV** (`services/auto_uv.py`) | • `0.15`: Preparing mesh geometry & normal maps<br>• `0.40`: Computing seams & chart boundaries (XAtlas / Blender)<br>• `0.75`: Parameterizing UV charts<br>• `0.90`: Brute-force packing & margin padding<br>• `1.00`: UV atlas generated |
| **Segmentation** (`services/segment.py`) | • `0.20`: Computing geometric decomposition & face adjacency<br>• `0.55`: Partitioning geometry into $N$ target components<br>• `0.85`: Applying boundary majority-vote label smoothing<br>• `1.00`: Multi-part colored GLB exported |
| **Decimation / Simplify** (`services/simplify.py`) | • `0.20`: Initializing PyMeshLab QEM quadric decimation<br>• `0.60`: Performing planar-quadric simplification to target face budget<br>• `0.85`: Verifying manifold boundaries & face normals<br>• `1.00`: Decimated mesh ready |
| **Ray-Cast Bake** (`services/bake.py`) | • `0.20`: Generating scale-aware cage & ray directions (2% bbox)<br>• `0.50`: Inward ray-casting (`sample_high_normals`) & barycentric interpolation<br>• `0.85`: Rasterizing tangent-space normal map with half-pixel alignment<br>• `1.00`: Normal & PBR maps baked |
| **Hole Repair** (`services/hole_repair.py`) | • `0.20`: Detecting boundary loops & calculating perimeter fractions<br>• `0.60`: Planar triangulator + 3D Newell-normal ear clipping fallback<br>• `0.85`: Checking manifold edge incidence & winding orientation<br>• `1.00`: Watertight mesh ready |
| **Collision & LODs** (`services/collision.py`, `simplify.py`) | • `0.25`: Computing convex decomposition / hull<br>• `0.50`: Generating LOD1 (50%), LOD2 (25%), LOD3 (10%)<br>• `0.80`: Packaging asset bundle<br>• `1.00`: Collision & LODs complete |

### 2.2 Streaming Protocol & Frontend Hookup
1. **Backend Event Envelope (`backend/postprocess/streaming.py`):**
   ```json
   {
     "type": "progress",
     "stage": "remesh",
     "frac": 0.65,
     "message": "Building clean quad topology...",
     "log": "[AutoRetopo] Generating 5000 quad patches across 12 feature regions"
   }
   ```
2. **Bridge Hookup (`features/workspace/services/meshProcessingBridge.ts`):**
   - Consume both `progress` and `log` event payloads from the SSE stream.
   - Dispatch `onProgress(message, percentage)` and `onLog(logMessage)` callbacks.
3. **Workspace Context Hookup (`features/workspace/store/WorkspaceContext.tsx`):**
   - Pass `onProgress` and `onLog` when invoking `executeMeshOperation` for `remesh`, `uv`, `segment`, and tool actions.
   - Update `setExecutionStep(step)`, `setExecutionProgress(percent)`, and append live entries to `activeTask.logs` so the user sees real-time progress and logs in the UI.

---

## Task 3: TokenRig / SkinTokens LLM Weight Download Fix already done dont touch it 

- **Problem:** `backend/scripts/download_models.sh` fails when downloading `Qwen3-0.6B` due to deprecated wildcard exclude options and HuggingFace Hub 404 URL resolution.
- **Solution:** Update `download_models.sh` to download the canonical TokenRig / SkinTokens configuration and checkpoints without broken wildcard patterns.
- **Acceptance Criteria:** Running `/content/ForMesh3D/backend/scripts/download_models.sh skintokens` succeeds without errors.

---

## Task 4: Backend Endpoints — Verified Dead Duplicate Cleanup — COMPLETED ✅

> [!CAUTION]
> **VITAL CONTRACTS (MUST NEVER DELETE):**
> - `/jobs/{job_id}/thumbnail` (Core thumbnail endpoint used by all workspace cards)
> - `DELETE /file-upload/{file_id}` (Core asset deletion endpoint in `WorkspaceContext.tsx`)
> - `/jobs/{job_id}/candidates/*` (Multi-candidate preview flow)
> - `/mesh-tools/*` (Auto-retopo, Auto-UV, Segment, LODs, Collision, Bake)

### Verified Dead Legacy Duplicates (Safe to Delete)
These 6 endpoints are verified early prototype duplicates with zero callers across frontend, CLI, or backend scheduler:

| Router | Endpoint | Method | Action |
|--------|----------|--------|--------|
| `mesh_generation` | `/generate-mesh-from-image` | POST | Delete (Duplicate of `/image-to-raw-mesh`) |
| `mesh_generation` | `/generate-mesh-from-image/batch` | POST | Delete (Dead batch prototype) |
| `mesh_generation` | `/batch/generate-mesh-from-image` | POST | Delete (Dead batch prototype) |
| `mesh_generation` | `/batch-generate-mesh-from-image` | POST | Delete (Dead batch prototype) |
| `system` | `/logs/test` | POST | Delete (Dead test utility) |
| `system` | `/auth-status` | GET | Delete (Hardcoded mock `{ authenticated: true }`) |
