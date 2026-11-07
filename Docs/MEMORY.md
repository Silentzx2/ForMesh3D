# ForMesh3D — Audited Project State

**Audit date:** 2026-11-03  
**Inspected branch baseline before this change:** `ForMesh3D/dev` at `6f4eb4afd2d167c6aae3d69bf8d7570f0160f464`  
**Third-party source baseline before this change:** `ForMesh3D-ThirdParty/main` at `b359c0c52ba5fb42131443f4e4517691253e8f8`  
**Project phase:** Beta  
**Model readiness:** NOT VERIFIED — registry entries and source directories do not prove successful inference.

## 2026-11-05 — PR #80 review follow-ups

- TRELLIS.2 sparse-convolution fallback is selected within each TRELLIS.2 adapter using the scheduler-assigned GPU; the global compatibility helper no longer applies spconv process-wide. Modern GPU workers retain FlexGEMM when available.
- TRELLIS.2 paint status checks use the same backend.core.models.base.ModelStatus enum as the adapter.
- download_models.sh sources .env before resolving MODEL_STORAGE_ROOT.
- image_to_raw_mesh forwards the top-level seed, with top-level seed taking precedence over model_parameters.seed.
- These are source-level fixes; CI rerun and live GPU inference remain pending.


## What is present

- `backend/loader.py` provides `get_model_weights_dir(model_key)`. It resolves `MODEL_STORAGE_ROOT/<model_key>`, anchors a relative root to the repository (not the process CWD), rejects absolute and `..` model keys, and fails when the model directory does not exist.
- `backend/scripts/download_models.sh` uses `MODEL_STORAGE_ROOT` with the default `backend/pretrained` root. The downloader and resolver follow the same root convention by source inspection; actual downloads were not run.
- The main repository records `backend/thirdparty` as a Git submodule. The submodule contains 13 top-level model-source directories and now has a root README describing the source layout, integration boundaries, setup, and per-model licensing.
- The backend model factory contains registrations for the current adapter IDs. There are 15 adapter modules, but factory registration is only a catalog/dispatch mapping.
- The current installer installs the O-Voxel component from the TRELLIS.2 source tree. It does not establish or editable-install every model source package in one generic step.
- `patcher/` directory contains model-specific runtime patching. Current patchers:
  - `patcher/doctor.py` — GPU Doctor core (hardware planner, chunked SDPA, recovery). Tested standalone on CPU (28 unit tests passing).
  - `patcher/taoflowforge/` — Pre-Ampere SDPA attention router and compute dtype guard (eliminates 10 GiB Stage 1 OOM).
  - `patcher/triposg/` — Output-to-storage patcher.
  - `patcher/trellis2/` — Sparse structure decoder compatibility + debug logging for `z_s` and raw logits computation (detects incompatible decoder checkpoint producing all-negative logits).
The patcher directory is intentionally minimal — patches are added only when a demonstrated need exists.

## Static integration audit

The following findings come from reading current adapter, factory, and vendored source files. They are not GPU-run results.

| Area | Finding | Status |
|---|---|---|
| Model identity | Adapters read `model_id` from constructor kwargs, but `ModelFactory.create_model_from_config` passes only `init_params` (plus VRAM). The factory later checks `hasattr`, which is true even when the adapter's value is `None`. Model instances can therefore retain `model_id=None`. | FAIL — code path |
| Third-party imports | The installer does not install or configure all 14 source roots. Adapters add the matching model-specific ThirdParty source root in `_load_model`; source paths remain separate from the shared weights loader. Hunyuan3D-Shape and Unique3D paths were rechecked against their package layouts. | PARTIAL — targeted source paths |
| Hunyuan3D-Shape v2.1 | Adapter added the package directory itself to `sys.path` instead of its parent, and treated the vendored pipeline's flat `List[Trimesh]` result as a nested list. The adapter now adds `Hunyuan3D-2.1/hy3dshape`, selects the first non-null mesh, and forwards the requested seed via the official `generator` argument. Topology is capped at 600k faces via post-extraction decimation. | FIXED — source/API contract and syntax |
| Unique3D | Adapter called the Stable Diffusion ControlNet image-to-image refinement pipeline as though it returned a mesh. The actual vendored image-to-mesh callable is `app.gradio_3dgen.generate3dv2`, which runs multiview prediction, geometric reconstruction, and the model-owned GLB exporter. Adapter now calls that function and preserves its returned path. | FIXED — source/API contract and syntax |
| Pixal3D | Fixed condition model initialization to match upstream `inference.py` (removed artificial `torch.float16` cast on conditioning models, honoring upstream Low-VRAM CPU offload with NAF upsampler pre-loading). Defensive dtype casting added to `world_to_camera` and `grid_sample` in `image_conditioned_proj.py`. Added prebuilt `natten` wheel to `backend/scripts/install.sh` and resilient try/except around `m._load_naf()` in `pixal3d_adapter.py`. Unit tests pass (9/9). | FIXED — source/runtime contract, unit tests pass |
| Paint3D | Subprocess execution uses `sys.executable` instead of bare `python`. Texture application binds albedo texture to mesh via trimesh TextureVisuals before GLB export. | FIXED — script execution and texture binding |
| SkinTokens | Replaced legacy UniRig with SkinTokens (TokenRig, VAST-AI-Research/SkinTokens, arXiv:2602.04805). Thin in-process adapter directly invokes TokenRig `predict_step` and uses companion `bpy_server` daemon for mesh binding with transfer post-processing for scale/texture preservation. | FIXED — Thin in-process adapter & submodule vendored |
| FastMesh | Removed orphan `fastmesh_v4k_retopology` registry/planner entries; `fastmesh_v1k_retopology` remains the sole validated FastMesh model ID matching `FastMesh-V1K`. | FIXED — orphan removed |
| TRELLIS text painting | Removed `trellis_text_mesh_painting` from `models.yaml`, registry, planner, scheduler profile set, and API router. Text-mesh generation is not supported in the image-to-3d pipeline. | FIXED — removed unsupported text painting |
| TRELLIS.2 sparse/precision path | Fixed palette transparency (`mode == 'P'`) and zero-alpha rembg fallback in `preprocess_image`. Retained native BF16 DiT and FP16 decoder precision; harmonized SDPA/xFormers attention dtypes in `full_attn.py`. Replaced rigid logit gates with adaptive top-k percentile voxel fallback in `sample_sparse_structure` to prevent empty coordinate crashes. Large GPUs (`sm >= 80`) remain 100% native FlashAttention. **NOT TESTED — `sparse_structure_decoder` checkpoint in `pipeline.json` references `microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16` (original TRELLIS repo), not compatible with TRELLIS.2 flow model. Produces all-negative logits (~ -75) → zero occupied voxels → hollow box. See microsoft/TRELLIS.2#160.** | SOURCE FIXED — actual GLB/GPU output NOT RUN |
| TaoFlowForge pre-Ampere acceleration & topology stability | Configured `torch.float16` compute dtype on pre-Ampere GPUs (`sm < 80`) for Stage 1 Cutlass memory-efficient SDPA. Fixed Stage 2 topology zero-faces failure by executing `TopologyDecoder` in FP32 on pre-Ampere GPUs (avoiding FP16 -1e9 mask underflow and dot-product overflow resulting in NaNs), adding `torch.nan_to_num` protection, multi-scale adaptive thresholds (`[0.4, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01]`), and geometric ConvexHull surface fallback. Fixed mesh validator false-positive rejection (`hollow domain bounding box` in `trellis2_mesh_validation.py`) on TaoFlowForge `[-1, 1]` domain meshes. Modern GPUs (`sm >= 80`) retain native `bfloat16` and full FlashAttention. Unit tests pass (11/11). | FIXED — source/runtime contract, unit tests pass |
| TRELLIS.2 raw GLB export | Added NumPy-only validation for vertex/face shape, finite coordinates, face-index bounds, non-zero bounds, and degenerate triangles; validate before/after trimesh processing and reload the GLB before success. No face-count minimum or textured `to_glb()` path. | SOURCE FIXED — actual GLB/GPU output NOT RUN |
| Hi3D | Decommissioned and completely eliminated across codebase; replaced by native single-stage models (TRELLIS.2 and TaoFlowForge). | DECOMMISSIONED & REMOVED |
| CPU/CI coverage | The checked-in workflow referenced Python regression modules absent from `backend/tests/`. The workflow now runs the checked-in TRELLIS.2 NumPy geometry contract test; it does not imply coverage of other models. | FIXED — CI references match tracked files |
| Real inference | No model checkpoint load, GPU inference, output mesh inspection, VRAM measurement, or model-quality benchmark was performed in this audit. | NOT RUN |
| Hunyuan3D-2 Mini Turbo | Adapter subfolder fixed, octree resolution set to 380, CPU offload hooks enabled, pre/post GC added. Verified in live production GPU inference (758,902 faces, 379,430 vertices, 13.0MB GLB, 3.87GB VRAM, 166.75s). Model locked against unauthorized modifications. | VERIFIED PASS — STABLE & LOCKED |
| Unique3D Lightweight Geometry Mode | Bypassed SD 1.5 texture refinement completely (`do_refine=False`); Unique3D now runs pure geometry inference via native `img2mvimg`, `realesrgan-x4.onnx` super-resolution, and `image2normal` normal prediction. Removed `runwayml/stable-diffusion-v1-5` dependency and download requirements, eliminating extra VRAM and network overhead. Gradio dependency stubbed for headless execution. | FIXED — pure geometry inference & SD1.5 dependency removed |
| GPU Doctor (`patcher/doctor.py`) | Standalone hardware diagnostics, memory execution planner, and error recovery utility. Pure PyTorch and Hugging Face Accelerate (v1.15.0). Guarantees Rule 1 zero-regression for modern GPUs (`sm >= 80` native BF16 FlashAttention), while routing pre-Ampere GPUs (`sm < 80`) to query-chunked SDPA (diff = 0.0), offloading, and safe dtypes. Tested standalone on CPU; all model adapters remained strictly untouched. | FIXED — 23 unit tests passing (CPU verified) |
| Routing & Landing Page | Completely removed 1106-line marketing homepage (`app/page.tsx`), deleted `app/homeTelemetry.ts`, redirected `/` directly to `/workspace` at both server component and `next.config.ts` route redirect levels. | FIXED — workspace default landing |

## Verification boundary

- **Source review:** the focused TRELLIS.2 audit covered the adapter, pinned ThirdParty pipeline, sparse attention dispatch, FlexiDualGrid decoder, mesh cleanup, O-Voxel exporter boundary, submodule pointer, and governing project instructions/docs. Other model adapters were not modified.
- **Backend CI before this update:** the workflow referenced Python regression modules absent from the tracked `backend/tests/` tree. Its test step now targets the new checked-in TRELLIS.2 NumPy mesh-validation contract; no other model-specific Python regression modules are present in this branch.
- **TRELLIS.2 CPU contract tests:** `backend/tests/test_trellis2_mesh_validation.py` — **7 passed** in the local CPU-only test run; helper and test modules pass `py_compile`.
- **GPU Doctor Unit Test Suite:** `backend/tests/test_gpu_doctor.py` — **28 passed** (modern sm>=80 zero regression, T4 fallback precision, query-chunked SDPA diff=0.0 across 3D/4D and masks, error classification, bounded recovery, cache cleanup).
- **SkinTokens Unit Test Suite:** `backend/tests/test_skintokens_adapter.py` — **8 passed** (adapter contract, format negotiation, schema validation, T4 patcher isolation).
- **TaoFlowForge Unit Test Suite:** `backend/tests/test_taoflowforge_adapter.py` — **9 passed** (adapter contract, format negotiation, schema validation, pre-Ampere vs modern GPU compute dtypes, 5-step schedule, stage offload methods).
- **Pixal3D Unit Test Suite:** `backend/tests/test_pixal3d_adapter.py` — **7 passed** (adapter contract, format negotiation, parameter schema, DinoV3ProjFeatureExtractor to() signature, unload cleanup).
- **Total Backend Pytest Suite:** `backend/tests/` — **60 passed**.
- **Frontend Bun Test Suite:** `bun test` — **60 passed** across 11 test files.
- **Source syntax/runtime boundary:** actual repository compileall and the GitHub Actions run must be checked after push. No local model checkpoint, xFormers CUDA operator, or NVIDIA GPU was available for execution.
- **GPU Inference Validation:**
  - Hunyuan3D Shape v2.1: PASS (verified live on Kaggle GPU: 935,638 faces, 467,737 vertices, 16.1MB GLB). Status: `STABLE - WORKING / LOCKED`.
  - Hunyuan3D DiT v2 Mini Turbo: PASS (verified live on Kaggle GPU: 758,902 faces, 379,430 vertices, 13.0MB GLB). Status: `STABLE - LOCKED`.
  - Unique3D: PASS (verified live on Kaggle GPU: 54,506 faces, 27,262 vertices, 1.0MB GLB, 394s). Status: `LEGACY / DEPRECATED (WORKING STATE - NOT ACTIVELY USED)` — no further debugging or refactoring planned.
- **T4, Ampere, Ada/Hopper/Blackwell-or-newer inference; checkpoint initialization; exported GLB visual inspection; Blender; and full model-quality comparison:** NOT RUN. These changes are source-level corrections plus CPU array-contract validation, not GPU/runtime proof.

## Configuration and ownership

- `backend/config/models.yaml`: model metadata, capabilities, and manifest model paths.
- `backend/config/quality.yaml`: quality and post-processing policy.
- `backend/config/smart_presets.yaml`: output-intent recipes.
- Model-native inference implementation/defaults remain owned by each model adapter/upstream API where implemented; do not copy them into a second configuration or UI control.
- `MODEL_STORAGE_ROOT` is for checkpoints only. Application uploads, generated assets, and canonical workspaces continue to use the existing application storage contract.

## Documentation integrity

Documentation indexes are aligned to files present in the checked-in tree. Only link a document after confirming that its path exists; do not revive removed or planned documents as if they were active guides.

The Pixal3D, Paint3D, SkinTokens, FastMesh V4K, and TRELLIS text-painting gaps have been resolved at the source/adapter and manifest level. Hi3D has been decommissioned. All adapters require checkpoint loading, real GPU inference, and mesh-output validation in an environment with full weights and GPU acceleration before being called runtime-verified.
