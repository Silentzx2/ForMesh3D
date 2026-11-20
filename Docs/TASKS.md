# Implementation Plan: NVIDIA PartField Neural Mesh Segmentation Integration

## 1. Governance & Scope Boundaries
- **Large GPU Parity (`sm >= 80`)**: Upstream FlashAttention, FP16/BF16, and CUDA flows remain native; pre-Ampere isolated.
- **Model Adapter Direct Patching**: All PartField neural segmentation logic contained in `backend/adapters/partfield_adapter.py`; zero global monkeypatches.
- **No Heavy Install Rule**: Wrote all dependencies into requirements/install/download scripts without running heavy installs during task.
- **Context Budget Rule**: Keep this document <= 150 lines strictly adhering to `AGENTS.md`.
- **Skills Activated**: `ponytail` (minimal clean change), `verification-loop` (build, types, logic verification), `agent-self-evaluation`.

## 2. Phase 1: Docs Setup, Dependency Audit & Weights Configuration
- [x] Understand PartField architecture (PointNet++/PVCNN feature field extractor + Agglomerative clustering).
- [x] Dependency Audit & Script Registration:
  - Recorded PartField dependencies (`yacs`, `potpourri3d`, `open3d`, `plyfile`) in `backend/requirements-models.txt` and `backend/scripts/install.sh`.
- [x] Weights Configuration (`backend/scripts/download_models.sh`, `manager.sh`):
  - Configured `download_partfield()` to fetch `model_objaverse.ckpt` from `mikaelaangel/partfield-ckpt` into `backend/pretrained/PartField/`.
  - Added Option `[20] PartField (NVIDIA 3D Mesh Part Segmentation)` to `manager.sh`.

## 3. Phase 2: Eliminate Segmentation Page Device & UI Lag
- [x] Root Cause Fix in `RealModelPreviewCanvas.tsx`:
  - Stopped disposing and re-instantiating WebGLRenderer on every state change and hover event.
  - Cached `EdgesGeometry` in WeakMap to prevent synchronous main-thread geometry recomputation on high-poly meshes.
  - Mutated Three.js materials and visibility in-place without cloning the active model on every render.
- [x] Optimization in `DynamicSegmentationInspector.tsx`:
  - Memoized `onHoverId` and `onSelectId` callbacks with `useCallback` to prevent render loops.
- [x] Viewport Hover Fix in `MeshViewer.tsx`:
  - Fixed radix bug `parseInt(match[1], 1)` to `parseInt(match[1], 10)` in part highlighting.

## 4. Phase 3: Backend Architecture & PartField Adapter Implementation
- [x] **Model Adapter (`backend/adapters/partfield_adapter.py`)**:
  - Subclassed `BaseModel` (`backend/core/models/base.py`) with Model ID `partfield_segmentation`.
  - Input parameters: `num_parts` (2 to 32), `method` (`semantic`/`geometric`), `hierarchical` (bool), `min_face_island_threshold`, `save_individual_parts`, `output_format` (`glb` or `obj`).
  - Feature extraction pipeline + Agglomerative face clustering with robust pure-NumPy fallback for CPU/missing weights.
- [x] **Model Registry & Scheduling (`backend/config/models.yaml`, `backend/core/scheduler/model_factory.py`)**:
  - Registered `partfield_segmentation` under `mesh_segmentation` (8GB VRAM allocation).
  - Added factory constructor mapping in `model_factory.py`.
- [x] **API Endpoint & Pipeline Integration (`backend/api/routers/mesh_segmentation.py`)**:
  - Routed default `model_preference = "partfield_segmentation"` when `engine == "ai"`.
  - Forwarded all parameters through `JobRequest`.

## 5. Phase 4: Frontend UI Unlock & Deep Verification
- [x] **Unlock AI Mode in `SegmentationPanel.tsx` & `EngineModeSelector.tsx`**:
  - Removed `aiDisabled={true}` and enabled PartField AI engine selection (`GPU (PartField)`) alongside Fast Script.
  - Wired target parts, decomposition mode, hierarchical assembly toggle, and export format.
- [x] **Bridge & Context Verification (`meshProcessingBridge.ts`, `WorkspaceContext.tsx`)**:
  - Ensured `runSegmentation` passes all parameters to `/api/v1/segment`.
- [x] **Deep Verification & Docs Sync**:
  - Python static compile check (`python3 -m py_compile`) passed.
  - Adapter unit tests (`backend/tests/test_partfield_adapter.py`): 6/6 passed.
  - Frontend TypeScript verification (`npx tsc --noEmit`): 0 errors.
  - Updated `Docs/CHANGELOG.md`, `Docs/DECISIONS.md` (ADR-109), and `Docs/MEMORY.md`.
