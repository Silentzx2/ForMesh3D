# TASKS: Backend Audit & Directory Cleanup Plan

## Status: EXECUTED & VERIFIED

---

## 1. Directories & Modules Removed (Complete Removal)

### A. `backend/postprocess/`
- **Action**: Completely Removed.
- **Reason**: 136KB legacy pipeline and 16 complex service files wiped out. Minimal, essential post-processing scripts will be built cleanly from scratch.

### B. `backend/core/auth/`
- **Action**: Completely Removed.
- **Reason**: Server uses direct API Key authentication (`backend/api/dependencies.py`). Legacy user JSON database and hashing wiped out.

### C. `backend/core/quality/` (including `backend/config/quality.yaml`)
- **Action**: Completely Removed.
- **Reason**: Offline theoretical point-cloud sampling (`evaluation.py`), heavy manifold calculations (`metrics.py`), and scorecard grading removed.

### D. `backend/core/animation/`
- **Action**: Completely Removed.
- **Reason**: Orphaned `ardy_converter.py` (0 production callers) wiped out.

### E. `backend/core/scheduler/seed_scorer.py`
- **Action**: Completely Removed.
- **Reason**: Tied to deleted quality module; purged from scheduler candidate selection.

### F. Early Prototype Dummy Wrappers in `backend/core/models/`
- **Action**: Completely Removed (`mesh_models.py`, `mesh_editing_models.py`, `retopo_models.py`, `rig_models.py`, `segment_models.py`, `uv_models.py`).
- **Strictly KEPT**: `backend/core/models/base.py` (`BaseModel`, `ModelStatus`) preserved.

### G. Image Enhancement & Preprocess (`backend/core/preprocess/` & `backend/api/routers/image_enhancement.py`)
- **Action**: Completely Removed.
- **Reason**: AI model backbones handle native background removal and resizing directly.

### H. Mesh Processor & Wrapper (`backend/core/mesh_processor.py` & `backend/core/utils/mesh_utils.py`)
- **Action**: Completely Removed.
- **Reason**: Obsolete postprocess CPU helpers removed.

---

## 2. Scripts Directory (`backend/scripts/`) - Cleaned

### Dead Scripts Removed:
- `backend/scripts/run_mesh_quality_benchmark.py`
- `backend/scripts/run_model_ab_benchmark.py`
- `backend/scripts/create_admin_user.py`
- `backend/scripts/verify_postprocess_runtime.py`

### Core Scripts Strictly KEPT & PROTECTED:
- `backend/scripts/run_server.sh`
- `backend/scripts/scheduler_service.py`
- `backend/scripts/download_models.sh`
- `backend/scripts/install.sh`
- `backend/scripts/python_env.sh`
- `backend/scripts/build_docker.sh`

---

## 3. Storage Directory (`backend/storage/`)

- Untracked runtime directory left intact.

---

## 4. Execution & Verification Checklist

- [x] **Step 1**: Remove dead directories & modules (`postprocess`, `auth`, `quality`, `animation`, `seed_scorer`, `preprocess`, `image_enhancement`, `mesh_processor`, `mesh_utils`, dummy models).
- [x] **Step 2**: Remove dead scripts from `backend/scripts/`.
- [x] **Step 3**: Clean caller imports across `backend/api/` (`mesh_generation.py`, `main_singleworker.py`, `main_multiworker.py`, `system.py`, `auto_rigging.py`, `mesh_tools.py`) and `backend/core/` (`multiprocess_scheduler.py`, `config.py`, `artifact_utils.py`).
- [x] **Step 4**: Decouple asset workspace management helpers into `core.utils.artifact_utils`.
- [x] **Step 5**: Run syntax validation (`python3 -m py_compile`) and test verification across all active files.
