# ForMesh3D Changelog

## 2026-11-05 — TRELLIS.2 Square Box Resolution: FP32 SDPA Dynamic Range Fix, Bounding Box Artifact Elimination & Pre-Ampere CuMesh Guard

- **Root Cause Resolution for Square Box Mesh**: Investigated user logs showing `max_logit=-75.0331`, top-327 voxel fallback, and `bbox_extents=[0.9994, 0.9987, 0.9994]`. Discovered that on pre-Ampere GPUs (`sm < 80`, e.g. Tesla T4 sm_75), dense attention in `trellis2/modules/attention/full_attn.py` was forcibly downcasting `bfloat16` inputs to `half()` (FP16). In a 30-block 1.3B parameter DiT with CFG scale 7.5, FP16 exponent limit (65,504) caused catastrophic exponent overflow and cancellation, causing Euler flow-matching sampling to diverge and `SparseStructureDecoder` to output all-negative logits.
- **FP32 Pre-Ampere Attention Alignment**: In `trellis2/modules/attention/full_attn.py`, updated both `xformers` and `sdpa` branches on `_is_pre_ampere` devices to cast `bfloat16` inputs to `float()` (FP32), matching the existing pattern in `sparse/attention/full_attn.py` (`# Pre-Ampere GPUs (including T4 / sm_75) use FP32, never a range-losing FP16 cast`). Preserves full $10^{38}$ dynamic range throughout all Euler steps.
- **Domain Bounding Box Artifact Elimination**: In `sample_sparse_structure` (`trellis2_image_to_3d.py`), added a sanity check `if max_logit >= -5.0:` before allowing top-k voxel percentile fallbacks. When `max_logit < -5.0` (indicating divergent noise), the pipeline refuses to fabricate boundary voxels that form a 1.0 x 1.0 x 1.0 hollow box, instead raising a descriptive `RuntimeError`. In `backend/adapters/trellis2_mesh_validation.py`, added automated validation rejection for hollow bounding boxes (`extents >= 0.99` spanning `[-0.5, 0.5]`).
- **CuMesh CUDA Error 209 Guard**: In `trellis2/representations/mesh/base.py`, added `_is_cumesh_available()` checking `device_capability[0] >= 8`. Gracefully skips CuMesh on sm_75 devices where binary sm_75 kernel images are absent, eliminating the verbose `CUDA error: 209 (no kernel image is available for execution on the device)` warning while preserving 100% native CuMesh execution on modern GPUs (`sm >= 80`).
- **Zero Regression on Modern GPUs & Zero Adapter Invasiveness**: Modern GPUs (`sm >= 80`) remain 100% native FlashAttention and BF16. Model adapters (`backend/adapters/*.py`) remain completely untouched; GPU Doctor was not wired in per explicit user constraint.
- **Verification**: `pytest backend/tests/` passed (36/36). Frontend `bun test` passed (60/60 tests across 11 files). `python -m py_compile` passed on all modified files.

---

## 2026-11-05 — GPU Doctor Standalone Implementation (`patcher/doctor.py`) & Hardware Execution Planner

- **GPU Doctor Core Engine (`patcher/doctor.py`)**: Built a unified, lightweight, reusable GPU compatibility and memory management utility. Adheres strictly to Ponytail Ultra Mode (single-file, zero bloat, pure PyTorch + Hugging Face Accelerate). Provides declarative `ModelProfile` registrations for TRELLIS.2, Pixal3D, and TaoFlowForge.
- **Top Priority Rule 1 Enforcement**: On modern GPUs (`sm >= 80`, e.g. A100, RTX 3090/4090, H100), `GPUDoctor` preserves 100% native BF16 precision and native FlashAttention with zero fallbacks, zero overhead, and zero regression.
- **Pre-Ampere Hardware Mitigations (`sm < 80`)**: Configures smart precision policies, CPU offloading, and mathematically exact query-chunked SDPA (`chunked_scaled_dot_product_attention`, difference = 0.0), eliminating 10.06 GiB SDPA Math OOMs.
- **Guarded Error Classification & Bounded Recovery**: Classifies errors into 7 actionable categories (`cuda_oom`, `unsupported_precision`, `dtype_mismatch`, `device_mismatch`, `attention_backend_failure`, `sparse_empty_voxels`, `unknown`) with bounded recovery attempts (`max_retries=2`) and structured telemetry reports.
- **Strict Adapter & Model Isolation**: Core GPU Doctor is implemented standalone. Adapters (`backend/adapters/*.py`) and locked models (Hunyuan3D Shape/Turbo, Unique3D) remain completely untouched and unmodified until explicit user verification.
- **Verification**: `pytest backend/tests/test_gpu_doctor.py` passed (28/28). Total backend test suite `pytest backend/tests/` passed (35/35). Frontend `bun test` passed (60/60 tests across 11 files). `python -m py_compile` passed on all patcher and test files.

---

## 2026-11-05 — TaoFlowForge Query-Chunked Attention (10 GiB OOM Fix), Stage Offload & Pre-Ampere Hardware Parity

- **TaoFlowForge Stage 1 OOM Elimination**: In `taoflowforge/models/attention.py`, resolved the 10.06 GiB CUDA Out of Memory crash in Stage 1 refinement (64->128 lattice, 15,000+ tokens). Added pre-Ampere query chunking (`chunk_size=1024`) and xFormers integration to `_sdpa_dense` and `_sdpa_masked`. When PyTorch's SDPA falls back from unavailable FlashAttention on pre-Ampere GPUs (`sm < 80`), query chunking computes attention in tiles against all key/value tokens, mathematically guaranteeing identical results (diff = 0.0) while reducing peak attention memory from 10.06 GiB down to ~30 MB.
- **Stage-Wise VRAM Offload Enforcement**: In `taoflowforge_adapter.py`, configured `InferenceConfig(..., offload="on")`. Guarantees that completed stage modules (Stage 0, Stage 1, Stage 2) and intermediate tensors are actively offloaded to CPU and `torch.cuda.empty_cache()` is called between stages, preserving VRAM overhead on 16GB GPUs like Tesla T4.
- **TaoFlowForge Patcher & Multi-Worker Safety**: Preserved strict process isolation in `patcher/taoflowforge/` and `taoflowforge_adapter.py`, ensuring pre-Ampere SDPA routing and memory mitigations execute exclusively within worker processes without leaking to other models. Modern GPUs (`sm >= 80`, e.g. A100, RTX 3090/4090, H100) run 100% native FlashAttention with zero performance penalties.
- **Verification**: `pytest backend/tests/test_trellis2_mesh_validation.py` passed (7/7). `bun test` passed (60/60 tests across 11 files). `python -m py_compile` passed on all modified adapter, thirdparty, and patcher files.

