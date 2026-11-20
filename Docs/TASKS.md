# Implementation Plan: TriFlow Neural Retopology Integration

## 1. Governance & Strict Scope Boundaries
- **Large GPU Parity (`sm >= 80`)**: Upstream FlashAttention, FP16/BF16, and CUDA flows remain native; pre-Ampere isolated.
- **Model Adapter Direct Patching**: All TriFlow logic contained in `backend/adapters/triflow_adapter.py`; zero global monkeypatches.
- **Context Budget Rule**: Keep this document <= 150 lines strictly adhering to `AGENTS.md`.
- **No Git Commit / Push**: Verification only, changes kept local as requested.
- **Skills Activated**: `ponytail` (simplest working implementation), `verification-loop` (build, types, logic verification), `agent-self-evaluation`.

## 2. Phase 1: Project Docs, Architecture Understanding & Dependency Audit
- [x] Understand existing adapter lifecycle (`BaseModel`, worker execution, `models.yaml`, `model_factory.py`).
- [x] Audit TriFlow dependencies against `backend/requirements-models.txt` and `backend/scripts/install.sh`:
  - Identified unique required packages (`meshlib`, `pyfqmr_triflow`, `meshiki`, `PyMCubes`, `fbxloader`, `hydra-core`).
  - Deduplicated against already-installed packages in environment to prevent conflicts.

## 3. Phase 2: Backend Architecture & Adapter Implementation
- [x] **Weights & Manager Script (`backend/scripts/download_models.sh`, `manager.sh`)**:
  - Added `download_triflow()` to fetch `flow_model.safetensors`, `sdf_vae.safetensors`, `nvv_vae.safetensors` from `lihcxr/TriFlow` into `backend/pretrained/TriFlow/`.
  - Added Option `[19] TriFlow (Neural Retopology)` to `manager.sh` model menu.
- [x] **Model Adapter (`backend/adapters/triflow_adapter.py`)**:
  - Subclassed `BaseModel` (`backend/core/models/base.py`) with Model ID `triflow_retopology`.
  - Input parameters: `target_face_count` (5k-200k), `quad_ratio` (0.0-1.0), `qem_threshold` (12.0), `watertight` (bool).
  - Pipeline: Mesh load -> SDF voxelization (`mrmesh`/sparse voxel) -> FlowEulerSampler -> QEM decimation (`pyfqmr_triflow`) -> GLB/OBJ export.
- [x] **Model Registry & Scheduling (`backend/config/models.yaml`, `backend/core/scheduler/model_factory.py`)**:
  - Registered `triflow_retopology` under category `mesh_retopology` with 10GB VRAM allocation.
  - Added factory constructor mapping for `triflow_retopology`.
- [x] **API Endpoint & Pipeline Integration (`backend/api/routers/mesh_retopology.py`, `backend/pipelines/retopo.py`)**:
  - Set default preference to `triflow_retopology` in `/api/v1/retopo`.
  - Forwarded `target_polycount`, `quad_ratio`, `preserve_features`, and `watertight` in job request schema.

## 4. Phase 3: Frontend UI/UX Integration (`RemeshPanel.tsx`)
- [x] **Unlock AI Target Face Budget**:
  - Removed fixed ~1K limitation for AI mode.
  - Enabled Target Face Budget slider (5,000 to 200,000) and presets (`5K Mob`, `20K Low`, `50K Game`, `100K Cine`) in AI mode.
- [x] **Topology Flow & Edge Controls**:
  - Wired `polyType` (`quad` sets `quad_ratio=0.95`, `tri` sets `quad_ratio=0.0`).
  - Wired Advanced Flyout controls: `preserveEdges` (`qem_threshold`), `watertightHealing` (SDF hole fill), `adaptiveDensity`, and `outputFormat`.
- [x] **Workspace & Service Bridge (`meshProcessingBridge.ts`, `WorkspaceContext.tsx`)**:
  - Passed all remesh parameters to backend API and handled response asset publication.

## 5. Phase 4: Deep End-to-End Testing, Bug Fixing & Verification
- [x] **Backend Static & Unit Verification**:
  - Ran `python3 -m py_compile` across all modified Python files (0 errors).
  - Created `backend/tests/test_triflow_adapter.py` (5/5 unit tests passed).
- [x] **Frontend Type & Build Verification**:
  - Ran `npx tsc --noEmit` to ensure zero TypeScript errors in `RemeshPanel.tsx` and bridge (Exit code 0).
- [x] **Cross-Layer Logic Audit**:
  - Fixed abstract method implementations (`get_parameter_schema`, `get_supported_formats`).
  - Fixed fallback decimation path when checkpoints are pending.
- [x] **Documentation Update**:
  - Updated `Docs/CHANGELOG.md`, `Docs/DECISIONS.md` (ADR-108), `Docs/MEMORY.md`, and `Docs/TASKS.md` within strict line budgets.
  - Zero git commit or push as instructed.
