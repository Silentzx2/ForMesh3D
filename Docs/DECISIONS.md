# Architecture Decisions — ForMesh 3D

> **Version**: 0.1.0
> **Last Updated**: November 9, 2026

---

## ADR-101: Studio 3D Unified Tool Panel Architecture & Dynamic Right Panel Extension (2026-11-09)

**Context:** The Studio 3D workspace previously used placeholder cards (`StudioToolTemplate`) for specialized processing workflows (Smart UV, Segmentation, Auto-Rigging, Animation), while right inspector panels were static and did not offer contextual tool inspections (e.g. UV atlas layout visualization or texel density inspection). In addition, disparate panel widths and multiline wrapping degraded usability on smaller laptop displays.

**Decision:**
1. **Canonical Tool Panels**: Implement dedicated, production-grade panels for all 7 left-rail studio tools:
   - `GeneratePanel.tsx`: 3D generation studio with image intake, model preference, polycount budget, and topology.
   - `TexturePanel.tsx`: 3D PBR texturing with resolution (1K/2K/4K) and lighting presets.
   - `RemeshPanel.tsx`: Quad/triangle remeshing with 120fps smooth budget slider (5K–200K) and quick presets.
   - `UVPanel.tsx`: Smart UV unwrap with single-line pill selectors (Organic vs Hard-Surface, 1K–4K, Island Margins).
   - `SegmentationPanel.tsx`: Mesh part decomposition (2–32 parts, Semantic vs Geometric, hierarchical tree toggle).
   - `RiggingPanel.tsx`: Character auto-rigging (Humanoid, Quadruped, Generic templates, T/A bind poses, facial/finger bones).
   - `AnimationPanel.tsx`: 3D motion generation (duration slider 1.0–15.0s, prompt chips, ground lock cleanup).
2. **Untouched Input Dropzone Card**: Standardize the top Image & 3D Mesh dropzone card across all panels to be 100% byte-for-byte identical, guaranteeing zero workflow disruption when switching tools.
3. **No Model Branding in CTAs**: Action buttons and subtitles use purely action-oriented terminology (`Generate Model`, `Run Retopology`, `Run Smart UV`, `Segment Mesh`, `Auto-Rig Character`, `Apply Animation`) without leaking internal model names.
4. **Dynamic Right Panel Extension**: Create `features/workspace/dynamic/` as a modular extension point. When `activeTool === 'uv'`, `RightPropertyPanel.tsx` dynamically mounts `DynamicUVInspector.tsx`; when `activeTool === 'segment'`, it mounts `DynamicSegmentationInspector.tsx`; when `activeTool === 'animation'`, it mounts `DynamicAnimationInspector.tsx`. Essential controls are preserved on the left panel with zero vertical scroll down to 577px viewport heights, and fine-tuning knobs are placed in dynamic portal flyouts.
5. **Ergonomic Sizing & Clearance**: Ensure 8px top clearance (`top-2`), 228px inner panel width with `px-8` header padding so centered tool headers never collide with the floating panel collapse button.

**Consequences:** Users have immediate, full control over all 7 primary 3D studio workflows with consistent, responsive single-line controls and zero horizontal overflow. Dedicated tool inspectors can be added to `features/workspace/dynamic/` in the future without modifying core property inspector logic.

---

## ADR-100: Logs — SSE-Only, Tail-First Start (2026-10-26)

**Context:** The Admin Logs page replayed the full, non-rotating `master.log` from byte zero on each fresh open, attempted a WebSocket transport that could not upgrade through the Next.js catch-all route, raced SSE against a polling overwrite, allowed the DOM to grow without bound, and did not retry after an `EventSource.CLOSED` failure.

**Decision:**
1. Fresh SSE connections seek backward to the configured last N lines; `tail=0` starts at EOF. A strict `file` basename allowlist prevents paths from escaping the repository `logs/` directory.
2. Preserve `identity:offset` event IDs, `Last-Event-ID` resume, UTF-8-safe chunks and `reset` events. One SSE transport replaces the dead WebSocket attempt and the redundant poll/overwrite path.
3. Adapt idle polling using stream settings in `backend/config/system.yaml`; retain the configured heartbeat and avoid new dependencies or startup changes.
4. Bound terminal history, reconnect closed streams with capped backoff, and keep the existing Clear operation on the canonical log.

**Consequences:** History before the initial tail is not auto-replayed when the Logs tab opens; the query `tail` can request a larger configured window, and the existing log-file endpoint remains available for recent parsed entries. `master.log` still has no automatic rotation: multiple Uvicorn workers append to the same file and Clear truncates it in place. If disk growth becomes a concern, upgrade to external `copytruncate` rotation or a multi-process-safe handler.

## ADR-099: Raw Mesh Fidelity Preservation and Worker Load Timeout Extension (2026-10-26)

**Context:** Raw 3D meshes exported by AI model adapters exhibited melted/soft surfaces, lost high-frequency features (faces, hard surfaces, weapons), and suffered from 600s worker timeouts during large checkpoint initialization on cloud/Kaggle environments. Furthermore, TRELLIS 1 raw meshes exhibited jagged needle spikes and boundary holes.

**Decision:**
1. In `MeshProcessor.save_mesh`, make `crease_angle_deg=None` default so raw geometric normals are preserved without forced angle-weighted normal clustering.
2. In Hunyuan3D-2.1 adapters (`backend/adapters/hunyuan3d_shape_v21.py`, `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py`, `backend/adapters/hunyuan3d_adapter_v21.py`), the official `Hunyuan3DDiTFlowMatchingPipeline` is loaded via `from_pretrained` with the adapter-owned locked inference schedule (octree resolution, steps, guidance, chunks); the scheduler strips request-side inference overrides before dispatch.
3. In Unique3D `simple_clean_mesh`, disable Laplacian smoothing and Loop subdivision for raw geometry generation.
4. In Pixal3D adapter, set `remesh=False` in `to_glb`.
5. In TRELLIS.2 adapter, enforce `max_num_tokens=524288` to prevent automatic cascade resolution degradation.
6. In TRELLIS 1 adapter, apply topological hole filling (`fill_holes`, winding, normal repairs) and gentle volume-preserving Taubin smoothing (`filter_taubin(lamb=0.3, nu=-0.34, iterations=2)`).
7. In `multiprocess_scheduler.py`, extend default `max_load_timeout` for heavy models from 600s to 1800s.

**Superseding correction — 2026-11-03:** Decision item 5 is withdrawn. The checked-in TRELLIS.2 adapter uses `max_num_tokens=49152`; that setting controls shape-cascade token/resolution selection and is not a triangle-count target or guarantee. Do not introduce a guessed `524288` setting or a fixed face-count gate.

---

## ADR-098: CPU Mode Skips Model Dependency Installation by Design (2026-10-23)

**Context:** `scripts/setup.sh` and `backend/scripts/install.sh` unconditionally installed CUDA toolkit components, model adapters (TRELLIS, Hunyuan3D, TripoSG, Unique3D), and their heavy ML dependencies. On hosts without an NVIDIA GPU this wasted time, disk, and network, and could fail the whole setup when CUDA wheels or third-party model source were unavailable.

**Decision:**
1. A shared resolver `scripts/lib/compute_mode.sh` computes `FORMASH3D_COMPUTE` ∈ {auto|cpu|cuda} from `nvidia-smi` presence plus `FORCE_CPU`/`FORCE_CUDA`/`CUDA_FORCE_PRESENT`/`REQUIRE_GPU`/`FORMASH3D_COMPUTE` environment.
2. CPU mode skips: CUDA toolkit setup, `ensure_release_wheels`, model dependency installation (`requirements-models.txt`), and Blender runtime. PyTorch is installed from the CPU wheel index (`https://download.pytorch.org/whl/cpu`).
3. CPU mode keeps: frontend + backend API, post-processing tools, quality pipeline, ARDY (optional via `--cpu-extras --with-thirdparty`), tests.
4. `--cpu` / `--gpu` flags force the mode; `--with-thirdparty` initializes third-party submodules even in CPU mode; `--update-thirdparty` enables `--remote --merge` (opt-in only).
5. `REQUIRE_GPU=1` combined with CPU-mode resolution aborts setup with a non-zero exit.
6. Backend `requirements.txt` is the CPU-safe core (installed in CPU mode) and `requirements-models.txt` adds GPU-only ML packages in CUDA mode.
7. In CUDA mode, `install.sh` checks for an NVIDIA GPU before installing `requirements-models.txt`. If no GPU is found, the user is prompted to continue core-only or abort.
8. Model and compiled-extension dependencies are installed only through the dependency paths present in `backend/requirements.txt`, `backend/requirements-models.txt`, `backend/scripts/install.sh`, or the relevant upstream model instructions. There is no separate missing-dependency catalogue; inspect the installer and the individual source directory before assuming a dependency is installed.

**Consequences:**
- Setup completes on headless/CPU-only hosts without CUDA wheels or model source.
- CUDA/GPU inference still works on hosts with NVIDIA GPUs when run with `--gpu` or auto-detected CUDA.
- Model adapters are importable at runtime only when their heavy ML dependencies were installed; a GPU-mode adapter used in CPU mode degrades gracefully at inference time rather than breaking setup.
- Do not assume every custom extension is installed by the generic requirements files. The current installer contains model-specific steps; verify each model's dependency and build path before using that adapter.
- Verification: `scripts/tests/script_test.sh` resolver tests + static grep test run in Backend Runtime Contract CI; `bash -n` passes on all edited scripts.


## ADR-101: Separate Model Registration from Runtime and Output Readiness (2026-10-30)

**Context:** The model manifest and `GET /system/models` expose enabled/registered model IDs, but deployments can still encounter missing or incompatible runtime dependencies, incomplete checkpoints, GPU/resource incompatibility, pipeline initialization failures, or invalid generated geometry.

**Decision:**
1. Treat catalog registration, checkpoint availability, pipeline initialization, successful inference, and mesh-quality validation as separate lifecycle states.
2. Do not describe every enabled model as production-ready unless a supported-host load/inference smoke test and output-quality review are recorded for that model.
3. Preserve initialization tracebacks in backend logs and expose actionable job/API error states; do not translate load failures into successful/empty mesh results.
**Consequences:** The available-model catalog remains a capability/manifest listing. Production readiness requires model-specific runtime and geometry evidence; CPU-only CI is not sufficient.


## ADR-102: TRELLIS.2 Fail-Closed Sparse Geometry and GPU-Aware Attention (2026-11-03)

**Context:** The TRELLIS.2 source used a top-1% logit fallback when zero-threshold sparse occupancy was empty and unconditionally converted BF16 Q/K/V to FP16 in the xFormers branch. The raw adapter exported `trimesh` geometry without validating the arrays or the serialized GLB. Those behaviors could hide an upstream sampling/numerical failure or report invalid geometry as successful. The original failing GLB and GPU intermediates were not available, so the historical runtime cause is not proven.

**Decision:**
1. Remove fabricated top-1% sparse coordinates. Empty occupancy and empty cascade coordinates are explicit generation failures.
2. Reject non-finite sparse logits, normalized shape SLat values, and inference FlexiDualGrid decoder features at the earliest checked stage.
3. Preserve native BF16 attention on CUDA compute capability 8.0+ when the installed xFormers operator supports the actual input. Use FP32 for BF16 attention on pre-Ampere GPUs, and retry FP32 on newer GPUs only when xFormers raises `NotImplementedError` for the BF16 operator. Never silently cast BF16 to FP16. If the safe operator is unavailable, fail with a clear error.
4. Log optional CuMesh cleanup failures while preserving the last valid mesh; keep the existing tensor fallback for face removal.
5. Validate raw mesh arrays before/after `trimesh` processing and validate a GLB reload before reporting success. Accept small valid meshes; do not set an unmeasured face-count or file-size minimum.
6. Keep the fix isolated to TRELLIS.2 source and adapter code. Do not call the complete textured O-Voxel exporter, alter the viewer without a valid-GLB browser reproduction, or change other model adapters.
7. Record source/CPU verification separately from GPU inference. T4, Ampere, and newer-GPU support remains unverified until actual checkpoint runs use the deployed PyTorch/CUDA/xFormers versions.

**Consequences:** Invalid intermediate states now fail with a stage-specific error rather than continuing to export a potentially invisible mesh. The FP32 compatibility path can be slower and its availability depends on the installed xFormers build; unsupported configurations fail explicitly. The 49152 cascade token cap remains unchanged and is not a geometry density promise.

---

## ADR-103: GPU Doctor Architecture & Standalone Compatibility Framework (2026-11-05)

**Context:** Heterogeneous execution environments (pre-Ampere GPUs such as Tesla T4 `sm_75` vs modern cloud GPUs `sm >= 80` such as A100/H100) triggered disparate failure modes across heavy 3D generative models: SDPA Math OOM (10.06 GiB on 15,000+ tokens in TaoFlowForge), DiT NaN overflow under FP16 autocast, and empty voxel coordinate collapses under extreme negative logits in TRELLIS.2. Previous workarounds risked global monkeypatching and cross-contamination across worker processes.

**Decision:**
1. Implement `GPUDoctor` as a compact, standalone, fully typed module in `patcher/doctor.py` (exposed via `patcher/__init__.py`). Strictly follow Ponytail Ultra principles (shortest working diff, zero unrequested abstractions).
2. Rule 1 Preservation: Modern GPUs (`sm >= 80`) run in 100% native upstream mode (native BF16 precision and native FlashAttention) without any degradation, fallbacks, or performance penalties.
3. Pre-Ampere Mitigations: Pre-Ampere GPUs (`sm < 80`) use mathematically exact query-chunked SDPA (`chunked_scaled_dot_product_attention`, difference = 0.0), reducing peak attention memory from 10.06 GiB to ~30 MB across both 3D and 4D tensor shapes.
4. Memory Execution Planner: Builds deterministic plans (`resident`, `cpu_offload`, `accelerate_dispatch`) using native PyTorch and Hugging Face Accelerate (v1.15.0).
5. Error Taxonomy & Guarded Recovery: Classifies exceptions into 7 actionable categories (`cuda_oom`, `unsupported_precision`, `dtype_mismatch`, `device_mismatch`, `attention_backend_failure`, `sparse_empty_voxels`, `unknown`) with bounded recovery attempts (`max_retries=2`).
6. Deferred Adapter Integration: Keep all adapters (`backend/adapters/*.py`) and locked models (Hunyuan3D Shape/Turbo, Unique3D) strictly untouched until explicit model-by-model verification.

**Consequences:** The GPU Doctor engine is completely testable on CPU via unit tests (28 passed in `backend/tests/test_gpu_doctor.py`). Sibling pipelines and locked models remain completely isolated with zero risk of cross-contamination. Adapter integration requires only 2-3 lines at the worker lifecycle boundary when invoked.

---

## ADR-014: Decommission UniRig in Favor of SkinTokens (Unified Autoregressive Rigging)

- **Status:** Accepted / Implemented
- **Date:** 2026-11-06
- **Context:**
  UniRig was an early two-stage rigging system that predicted a skeleton and then computed skinning weights in separate passes. This architecture produced severe bleeding artifacts across disconnected mesh components (e.g., hair, accessories, weapons, clothing), low skinning accuracy on non-humanoid or complex assets, and relied on legacy dependencies (`blenderproc`, `pyrender`, `pytorch-lightning==1.9.5`).
  SkinTokens (VAST-AI-Research/SkinTokens, arXiv:2602.04805) unifies both skeleton hierarchy prediction and dense per-vertex skinning weights into a single autoregressive sequence via learned discrete skin tokens (FSQ-CVAE + Qwen3-0.6B + GRPO RL refinement). It improves skinning accuracy by 98%–133% and bone prediction accuracy by 17%–22% over UniRig baselines while cleanly preserving mesh scale and materials via transfer post-processing.
- **Decision:**
  1. Completely remove `UniRig` from `backend/thirdparty` and vendor `SkinTokens` under MIT license.
  2. Implement `SkinTokensAdapter` (`backend/adapters/skintokens_adapter.py`) as a thin, direct in-process adapter conforming to `BaseModel` and `_LOCKED_INFERENCE_PROFILE`.
  3. Maintain `unirig_auto_rig` as a backward-compatible alias in planner and scheduler routing to `SkinTokensAdapter`.
  4. Preserve sm >= 80 native FlashAttention 2 and native BF16 execution without regression.
  5. Clean out UniRig dependencies and update model downloader, configuration manifests, and frontend UI.
- **Consequences:**
  - Modern GPUs run official upstream TokenRig at native FlashAttention speeds.
  - Zero cross-model contamination; model code in `backend/thirdparty/SkinTokens` remains unedited and pristine.
  - Rigging artifacts benefit from higher fidelity, coherent influence maps, and zero cross-component bleeding.

---

## ADR-104: Native Polycount Targeting and Post-Processing YAML Opt-In (2026-11-12)

**Context:** The `target_polycount` field was zeroed out whenever post-processing was disabled (the default), so a user-requested polycount (e.g. 50K/20K) never reached the model's native extraction path. Post-processing was also not governed by a global kill-switch — `enable_postprocess` defaults were inconsistent across API endpoints and could be overridden per-request.

**Decision:**
1. **Native polycount target always reaches the adapter:** `buildGenerationParameters.ts` sends `native_target_polycount` when `enablePostprocess` is `false` (clamped 500–600K). Backend `mesh_generation.py` preserves it in job inputs instead of zeroing. Adapters read and log it; TripoSG maps it to its native `faces` parameter. No decimation is applied when post-processing is disabled, preserving the model-native mesh as the final output.
2. **YAML opt-in for post-processing:** `postprocessing.enabled` in `backend/config/system.yaml` defaults to `false`. The scheduler forces `postprocess_mode = "none"` and `enable_postprocess = False` when disabled, regardless of request flags. API defaults normalized to `False`. UI controls are hidden (not disabled) when post-processing is off.
3. **Not user-toggleable in UI:** YAML is the sole opt-in mechanism; no frontend toggle is exposed for post-processing.

**Consequences:**
- Users setting 50K/20K polycount get that value passed to the model's native extraction even in default (no-postprocess) mode.
- Models without a native face-count control (most) log the target and return unmodified native output.
- TripoSG natively honors the requested face count via its `faces` parameter.
- No new implicit state machine created — `native_target_polycount` is a plain data pass-through.

---

## ADR-015: Decommissioning of Hi3D Geometry Refinement

- **Status:** Accepted / Implemented
- **Date:** 2026-11-06
- **Context:**
  Hi3D (Sparc3D v1.0) was vendored as an experimental second-stage geometry refinement model (`/refine-mesh`). It required a pre-existing coarse mesh and reference image to refine surface details via progressive sparse flow and FlexiCubes. In practice, modern generative foundation models deployed in ForMesh3D (TRELLIS.2, TaoFlowForge, Hunyuan3D-2.1) generate native high-resolution, watertight geometry (up to 4K resolution and 1M+ triangles) directly in a single pass. A second-stage coarse-to-fine refiner added ~8GB of checkpoint download overhead, 14.3GB VRAM requirements, custom CUDA ops (`sparc3d`, `FlexiCubes`, `Pointcept`), and proprietary license terms (`LicenseRef-Hi3D-1.0`) without measurable production utility.
- **Decision:**
  1. Completely remove `backend/thirdparty/Hi3D/` (9,660+ lines of redundant code) and delete `backend/adapters/hi3d_adapter.py`.
  2. Remove `/refine-mesh` endpoint and `RefineMeshRequest` from `backend/api/routers/mesh_generation.py`.
  3. Remove `download_hi3d()` from `backend/scripts/download_models.sh` to save ~8GB disk space and download bandwidth.
  4. Purge Hi3D references from manifests (`backend/config/models.yaml`), scheduler registries, and frontend controls (`ViewerToolbar.tsx`, `WorkspaceContext.tsx`, `GeneratePanel.tsx`, `constants/models.ts`).
- **Consequences:**
  - Eliminates 9,660+ lines of unmaintained third-party code and complex CUDA dependencies.
  - Saves 8GB disk space on full setup and eliminates 14GB VRAM consumption during refinement.
  - Single-stage generative workflows remain standard with zero breaking changes to existing production generation pipelines.
