# ForMesh3D Changelog

## 2026-11-04 — TaoFlowForge & TRELLIS.2 Pre-Ampere GPU Acceleration and OOM Fixes

- TaoFlowForge: resolved 10-minute (696s) startup lag and 8GB VRAM spike caused by software BF16 emulation on pre-Ampere GPUs (sm < 80, e.g. Tesla T4). Added robust `_is_pre_ampere()` check and `get_compute_dtype()` across `attention.py`, `dino.py`, `ss_flow.py`, `stage0.py`, `stage1.py`, and `stage2.py`, dynamically routing execution to FP16 with native Tensor Cores.
- TaoFlowForge: fixed 10.06 GiB SDPA OOM by enabling Cutlass memory-efficient attention in FP16 on sm < 80, preventing fallback to dense $N \times N$ `SDPBackend.MATH`. Cached `load_pretrained_dino_state_dict` to avoid re-parsing multi-gigabyte DINO checkpoints across stages.
- TRELLIS.2: resolved sparse-structure zero-logit failure on sm < 80 by defaulting `ATTN_BACKEND` to `sdpa` instead of unsupported `flash_attn`, with FP16 casting around Cutlass SDPA and restoring top-1% occupancy rescue fallback.
- Main repo: added `PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"` in `taoflowforge_adapter.py` and pre-Ampere SDPA backend configuration in `trellis2_adapter.py`.
- Verification: `bun test` passed (60/60 tests across 11 files). Python syntax check passed across all modified backend files (`py_compile`).

---

## 2026-11-03 — TRELLIS.2 Raw Mesh Integrity, Unique3D Deprecation & TaoFlowForge T4 Compat

- TRELLIS.2: retained raw-only `1024_cascade` (`max_num_tokens=49152`, `generate_texture=False`); removed the top-1% sparse-occupancy fallback; added sparse-logit, shape-SLat, decoder-feature, array, bounds, face-index, and GLB round-trip validation. Replaced the unconditional BF16→FP16 xFormers cast with BF16 on supported SM80+ operators and FP32 compatibility/fallback dispatch; cleanup failures now log warnings while preserving the last valid mesh. The token cap is not a triangle minimum.
- Unique3D: verified end-to-end live GPU inference on Kaggle (394s, 54,506 faces, 27,262 vertices, 1.0MB GLB). Switched nvdiffrast rasterization to `RasterizeCudaContext` with PyTorch3D fallback for headless environments; restored production step parameters. Marked status as `LEGACY / DEPRECATED (WORKING STATE - NOT ACTIVELY USED)` in `backend/config/models.yaml` and `backend/adapters/unique3d_adapter.py`.
- TaoFlowForge: enabled PyTorch SDPA `[FLASH_ATTENTION, EFFICIENT_ATTENTION, MATH]` fallbacks on Pre-Ampere GPUs; added sequential stage load/unload in pipeline to reduce peak host RAM from 26GB to 18GB; restored 1024 resolution.
- Verification: `bun test` passed (60/60).

---

## 2026-11-03 — Hunyuan3D-2 Mini Turbo & Shape v2.1 Live GPU Verification & Locks

- Hunyuan3D Shape v2.1: verified working in production live GPU inference (935,638 faces, 467,737 vertices, 16.1MB GLB, 563s). Marked status as `STABLE - WORKING / LOCKED` in `backend/adapters/hunyuan3d_shape_v21.py`.
- Hunyuan3D DiT v2 Mini Turbo: verified working in production live GPU inference (758,902 faces, 379,430 vertices, 13.0MB GLB, 3.87GB VRAM, 166.75s). Marked status as `STABLE - LOCKED` in `backend/config/models.yaml` and `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py`.
- Standardized Model Adapter Governance: added standardized ASCII specification and governance header boxes across all 17 backend adapters with Model ID, Name, Target, Status, Upstream details, VRAM, and Agent modification rules.
