# ForMesh3D — Active Engineering Tasks & Implementation Specifications

**Document Status:** Active Engineering Roadmap & Implementation Plan
**Updated:** 2026-11-11
**Scope:** Active and Planned tasks only. Previously completed items (route hydration, asset deduplication, TripoSG thumbnail generation, VRAM eviction, XYZ gizmo fix, friendly URLs, RecentJobsChip, upload progress bars, image upload removal from Seg/Rig/Anim panels) have been removed after commit `4d5d7301`.

---

## 🟡 Open Tasks — UI Logic Issues

### UI-1: Colorful Request Logs for New Generation Requests — IMPLEMENTED ✅
**Priority:** Medium | **Area:** Frontend UI / Logging

**Description:** When inference starts, backend logs show beautiful colored output. New request submission should show equally colorful logs in the frontend LiveExecutionPanel / job logs.

**Implementation (commit pending):**
- `features/workspace/store/WorkspaceContext.tsx:1780-1789`: Added `setActiveTask` with `level: 'success'` log entry when generation request is accepted by backend (`Generation request accepted — <modelId> queued on backend`)
- `features/workspace/services/meshProcessingBridge.ts:337`: Added `onLog?.(...)` call for AI mode job submission (`AI Job queued on GPU (ID: <shortId>)`)
- Logs render in LiveExecutionPanel with emerald/green color for 'success' level (existing color coding at lines 480-524)

**Files changed:** `features/workspace/store/WorkspaceContext.tsx`, `features/workspace/services/meshProcessingBridge.ts`
**Verification:** `npx tsc --noEmit` passed with 0 errors. Runtime not verified (no GPU/backend server available).

---

## 🟡 Open Tasks — Backend Endpoint Issues

### BE-1: Job Hydration Path Param vs Query Param
**Priority:** High | **Area:** Backend API / Frontend Routing

**Description:** The JobsTab "Inspect in Workspace" link was using `/workspace/jobs?id={job-id}` (query param) which does not trigger workspace hydration. It must use `/workspace/jobs/{job-id}` (path param) so `WorkspaceContext.tsx` line 892+ `useEffect` hydrates the job from URL and loads the mesh into viewport.

**Status:** Fixed in `features/admin/tabs/JobsTab.tsx` (commit `4d5d7301`) but needs verification that hydration loads the correct generated mesh for the job ID.

**Files to touch:** `features/admin/tabs/JobsTab.tsx`, `features/workspace/store/WorkspaceContext.tsx`

### BE-2: `/api/v1/mesh-generation/image-to-raw-mesh` Direct Submission
**Priority:** Medium | **Area:** Backend API

**Description:** The generate flow previously went through `resolveSmartIntent()` before submitting to `/image-to-raw-mesh`. This extra hop was removed (commit `4d5d7301`) so generate submits directly. Need to verify the backend endpoint accepts all fields from `buildGenerationParameters.ts` without the intent pre-resolution step.

**Files to touch:** `backend/api/routers/mesh_generation.py`, `features/workspace/utils/buildGenerationParameters.ts`

### BE-3: Backend Endpoint for Colorful Request Logs — IMPLEMENTED ✅
**Priority:** Medium | **Area:** Backend API / Logging

**Description:** Backend should emit a structured log event when a new generation request is received (similar to inference start logs). Previously only logged errors/warnings.

**Implementation (commit pending):**
- `backend/api/routers/mesh_generation.py:1488-1494`: Added `logger.info(...)` after successful job scheduling in `image_to_raw_mesh`, logging `job_id`, `model_preference`, and `image_file_id`.

**Files changed:** `backend/api/routers/mesh_generation.py`
**Verification:** `npx tsc --noEmit` passed 0 errors; Python `ast.parse` syntax OK. Runtime not verified (no backend server available).

---

## 🟡 Open Tasks — Job Related Bugs

### JOB-1: Job ID Not Remembered After Refresh
**Priority:** High | **Area:** Frontend UX

**Description:** When a user generates a job and refreshes the page, the job ID is lost from UI state (only URL retains it if path param is used). User cannot easily find their running/completed job without remembering the UUID.

**Acceptance Criteria:**
- RecentJobsChip in TopHeader shows last 6 jobs with live/done/failed counts (commit `4d5d7301`)
- Clicking a job in chip navigates to `/workspace/jobs/{id}` and hydrates
- URL uses friendly name-hash format (`/workspace/generate/<name>_<hash>`) for uploads and generation tasks

**Files to touch:** `features/workspace/Header/RecentJobsChip.tsx`, `features/workspace/Header/TopHeader.tsx`

### JOB-2: Job Status Polling After Refresh — IMPLEMENTED ✅
**Priority:** Medium | **Area:** Frontend / Backend

**Description:** After page refresh, active jobs in `jobsById` Zustand store are cleared. The URL hydration `useEffect` (WorkspaceContext.tsx:892) fetches job status from backend, but only if the URL contains a valid UUID. Friendly name-hash IDs need to map to backend job IDs via `backendJobId`.

**Implementation (commit pending):**
- `features/workspace/store/WorkspaceContext.tsx:898-904`: Hydration regex now matches both UUIDs and friendly name-hash IDs (`^[a-z0-9]+-[a-z0-9]+-[a-z0-9]{6}$`)
- `features/workspace/store/WorkspaceContext.tsx:906-912`: Resolves friendly ID to backend UUID via localStorage mapping before fetching
- `features/workspace/store/WorkspaceContext.tsx:911`: Fetch uses `backendJobId` (resolved from localStorage) instead of raw route ID
- `features/workspace/store/WorkspaceContext.tsx:1591-1593`: `bindBackendJob` persists `fm3d:job:<friendlyId>` → backend UUID in localStorage

**Files changed:** `features/workspace/store/WorkspaceContext.tsx`
**Verification:** `npx tsc --noEmit` passed with 0 errors. Runtime not verified (no backend server available).

---

## 🟡 Open Tasks — Pre-Existing Adapter / Integration Issues (NOT RUN on GPU)

### ADAPTER-1: Pixal3D Undefined `width` Reference — ALREADY FIXED ✅
**Priority:** Low | **Area:** Backend Adapter

**Description:** Audit reported undefined `width` in Pixal3D camera fallback. Current code at `pixal3d_adapter.py:229` defines `width = image.size[0]` before use at line 230. No fix needed.

**Status:** Already fixed in current code. No changes needed.

### ADAPTER-2: Paint3D Does Not Apply Albedo to Output Mesh — ALREADY FIXED ✅
**Priority:** Low | **Area:** Backend Adapter

**Description:** Audit reported Paint3D returns input mesh without applying albedo. Current code at `paint3d_adapter.py:163-171` locates albedo texture and applies it via `trimesh.visual.TextureVisuals(image=texture)` before GLB export. No fix needed.

**Status:** Already fixed in current code. No changes needed.

### ADAPTER-3: TRELLIS.2 Sparse Structure Decoder Checkpoint Compatibility — NOT FIXABLE VIA CODE
**Priority:** High | **Area:** Backend Adapter / ThirdParty

**Description:** TRELLIS.2 `pipeline.json` references `microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16` (original TRELLIS repo), not compatible with TRELLIS.2 flow model. Produces all-negative logits (~ -75) → zero occupied voxels → hollow box. This is a checkpoint/compatibility issue, not a code bug. Documented in `models.yaml`. Requires a compatible sparse_structure_decoder checkpoint from Microsoft or TRELLIS.2 project.

**Status:** Not fixable via code changes. Documented in `backend/config/models.yaml` lines 301-310 and 352-361.

### ADAPTER-4: Hunyuan3D-Paint Source Script Resolution — ALREADY ADDRESSED ✅
**Priority:** Low | **Area:** Backend Adapter

**Description:** Audit reported source scripts not in checkpoint directory. Current `hunyuan3d_paint_v21.py:70-72` adds `thirdparty/hunyuan3d-2` to `sys.path` and resolves weights via `get_model_weights_dir`. No fix needed.

**Status:** Already addressed in current code. No changes needed.

### ADAPTER-5: FastMesh V4K Not Advertised — BY DESIGN ✅
**Priority:** Low | **Area:** Backend / Frontend

**Description:** Backend manifest and frontend registry expose V1K only. This is intentional — FastMesh V1K is a checkpoint-fixed ~1K vertex model; V4K is not advertised. Documented in `models.yaml` and `RemeshPanel.tsx`.

**Status:** By design. No changes needed.

---

## 🟡 Open Tasks — GPU Inference Verification (NOT RUN)

### GPU-1: Live GPU Inference Validation
**Priority:** High | **Area:** Backend / GPU

**Description:** No model checkpoint load, GPU inference, output mesh inspection, VRAM measurement, or model-quality benchmark was performed in this environment. All adapter integrations require checkpoint loading, real GPU inference, and mesh-output validation in an environment with full weights and GPU acceleration before being called runtime-verified.

**Models not GPU-verified:** T4, Ampere, Ada/Hopper/Blackwell-or-newer inference; checkpoint initialization; exported GLB visual inspection; Blender; full model-quality comparison.

**Files to touch:** None (requires GPU host)

---

## ✅ Completed (Commit `4d5d7301` — Not Re-Implement)

- XYZ Gizmo position fix (`top-3` → `top-12`) + `pointer-events-auto` on axis buttons
- Removed `resolveSmartIntent` hop from generate flow; direct POST to `/image-to-raw-mesh`
- Bare `/workspace` redirects to `/workspace/generate`
- Removed `/workspace/system` and `/workspace/overview` routes
- Friendly URLs: `/workspace/generate/<name>_<hash>` for uploads and generation tasks
- RecentJobsChip in TopHeader with live/done/failed counts
- JobsTab inspect link: `/workspace/jobs/{id}` path param
- Real upload progress bars for image and mesh (mesh fake 50% start removed)
- AGENTS.md: top project-rule notice, removed user-preferences section and TOC
- CHANGELOG.md updated with 3 latest entries
- Removed image upload from AnimationPanel, RiggingPanel, SegmentationPanel (mesh-only dropzone); all three pass `npx tsc --noEmit` with 0 errors
- Added part hover highlight: `hoveredPartId`/`setHoveredPartId` in WorkspaceContext, `onHoverId` in RealModelPreviewCanvas, gold/emissive highlight in MeshViewer, wired in DynamicSegmentationInspector and DynamicRiggingInspector
