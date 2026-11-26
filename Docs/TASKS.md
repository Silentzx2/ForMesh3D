# Adapter Audit – Implementation Status

**Updated:** 2026-11-25  
**Branch:** `dev`  
**Scope:** The six implementation items selected from this audit. This file records verified code changes, not speculative performance claims.

## Completed fixes

1. **PartUV:** Restored the upstream sequence: mesh preprocessing and PartField hierarchy → `partuv.pipeline_numpy` → `save_results` → optional Blender UV-island packing. The adapter validates exported UV coordinates and reports whether packing actually completed. It does not claim that an un-packed artifact is packed.
2. **Temporary output lifecycle:** Adapters create tracked, app-owned directories. `BaseModel.process` hands successful directories to the scheduler; failures clean their tracked directories immediately. Scheduler cleanup accepts only direct children of the system temp root with approved app-owned prefixes. User-selected output directories are not deleted.
3. **SkinTokens:** The companion `bpy_server` process is terminated and reaped with a timeout/kill fallback. Model-load failures after process startup also stop the child process.
4. **Hunyuan metadata:** Hunyuan3D-2.1 and Mini Turbo record the actual inference parameters passed to the pipeline, not hard-coded defaults.
5. **Stable Fast 3D patch isolation:** The pre-Ampere chunked SDPA workaround now lives under `patcher/stable_fast_3d/` and is installed only inside the SF3D inference context. `sm >= 80` keeps native SDPA unchanged.
6. **TRELLIS text paint:** The misleading text-paint alias is disabled. No text-to-3D or text-conditioned painting capability has been added. Image-conditioned TRELLIS remains unchanged.

## Validation requirements

- Run adapter regression tests and the backend test suite in the project environment.
- Verify PartUV UV coordinates and Blender packing on a machine with its compiled extension and Blender installed.
- Exercise SkinTokens startup failure, unload, and child-process timeout paths.
- Benchmark GPU inference before claiming any generation-speed improvement. These fixes primarily address correctness, temporary disk usage, and process lifecycle; they do not promise faster GPU kernels.

## Guardrails

- Preserve working model inference settings and upstream source.
- Do not alter BF16, FlashAttention, or native attention on `sm >= 80`.
- Keep model-specific patches inside `patcher/<model-name>/`.
- Do not add text-to-3D to ForMesh3D.
- Do not delete user outputs or workspace data.
