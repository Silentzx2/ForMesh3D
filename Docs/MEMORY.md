# ForMesh3D — Audited Project State

**Audit date:** 2026-11-03  
**Inspected branch baseline:** `dev` at `a52ade8c8d1104d78f5adeb26d309174cc3a481b` (before the targeted adapter fixes)  
**Third-party source revision:** `ForMesh3D-ThirdParty` at `b21ada987235b0985ee9dafa2afa6c980eb250d0`  
**Project phase:** Beta  
**Model readiness:** NOT VERIFIED — registry entries and source directories do not prove successful inference.

## What is present

- `backend/loader.py` provides `get_model_weights_dir(model_key)`. It resolves `MODEL_STORAGE_ROOT/<model_key>`, anchors a relative root to the repository (not the process CWD), rejects absolute and `..` model keys, and fails when the model directory does not exist.
- `backend/scripts/download_models.sh` uses `MODEL_STORAGE_ROOT` with the default `backend/pretrained` root. The downloader and resolver follow the same root convention by source inspection; actual downloads were not run.
- The main repository records `backend/thirdparty` as a Git submodule. The submodule contains 14 top-level model-source directories and now has a root README describing the source layout, integration boundaries, setup, and per-model licensing.
- The backend model factory contains registrations for the current adapter IDs. There are 17 adapter modules, but factory registration is only a catalog/dispatch mapping.
- The current installer installs the O-Voxel component from the TRELLIS.2 source tree. It does not establish or editable-install every model source package in one generic step.
- `patcher/README.md` describes model-specific runtime patching; the patcher directory is intentionally empty because no patch should be added without a demonstrated need.

## Static integration audit

The following findings come from reading current adapter, factory, and vendored source files. They are not GPU-run results.

| Area | Finding | Status |
|---|---|---|
| Model identity | Adapters read `model_id` from constructor kwargs, but `ModelFactory.create_model_from_config` passes only `init_params` (plus VRAM). The factory later checks `hasattr`, which is true even when the adapter's value is `None`. Model instances can therefore retain `model_id=None`. | FAIL — code path |
| Third-party imports | The installer does not install or configure all 14 source roots. Adapters add the matching model-specific ThirdParty source root in `_load_model`; source paths remain separate from the shared weights loader. Hunyuan3D-Shape and Unique3D paths were rechecked against their package layouts. | PARTIAL — targeted source paths |
| Hunyuan3D-Shape v2.1 | Adapter added the package directory itself to `sys.path` instead of its parent, and treated the vendored pipeline's flat `List[Trimesh]` result as a nested list. The adapter now adds `Hunyuan3D-2.1/hy3dshape`, selects the first non-null mesh, and forwards the requested seed via the official `generator` argument. | FIXED — source/API contract and syntax |
| Unique3D | Adapter called the Stable Diffusion ControlNet image-to-image refinement pipeline as though it returned a mesh. The actual vendored image-to-mesh callable is `app.gradio_3dgen.generate3dv2`, which runs multiview prediction, geometric reconstruction, and the model-owned GLB exporter. Adapter now calls that function and preserves its returned path. | FIXED — source/API contract and syntax |
| Pixal3D | Fixed condition model initialization in adapter to match upstream `inference.py` (`DinoV3ProjFeatureExtractor` with `camenduru/dinov3-vitl16-pretrain-lvd1689m` config kwargs). | FIXED — source/API contract and syntax |
| Paint3D | Subprocess execution uses `sys.executable` instead of bare `python`. Texture application binds albedo texture to mesh via trimesh TextureVisuals before GLB export. | FIXED — script execution and texture binding |
| UniRig | Subprocess invocation calls official upstream `run.py` two-phase pipeline (skeleton generation -> skinning) instead of nonexistent `system.predict_rig`. | FIXED — CLI pipeline execution |
| FastMesh | Removed orphan `fastmesh_v4k_retopology` registry/planner entries; `fastmesh_v1k_retopology` remains the sole validated FastMesh model ID matching `FastMesh-V1K`. | FIXED — orphan removed |
| TRELLIS text painting | Removed `trellis_text_mesh_painting` from `models.yaml`, registry, planner, scheduler profile set, and API router. Text-mesh generation is not supported in the image-to-3d pipeline. | FIXED — removed unsupported text painting |
| Hi3D | Adapter strictly validates `mesh_path` (requires existing coarse mesh input); returns clear error message when invoked without a valid mesh file. | FIXED — input contract validated |
| CPU/CI coverage | The checked-in backend workflow referenced four regression tests that are absent from the current `backend/tests/` tree. This update replaces those references with a focused loader contract test. | FIXED IN THIS UPDATE — CI scope |
| Real inference | No model checkpoint load, GPU inference, output mesh inspection, VRAM measurement, or model-quality benchmark was performed in this audit. | NOT RUN |
| Hunyuan3D-2 Mini Turbo | Adapter subfolder fixed, octree resolution set to 380, CPU offload hooks enabled, pre/post GC added. Verified in live production GPU inference (758,902 faces, 379,430 vertices, 13.0MB GLB, 3.87GB VRAM, 166.75s). Model locked against unauthorized modifications. | VERIFIED PASS — STABLE & LOCKED |
| Unique3D Lightweight Geometry Mode | Bypassed SD 1.5 texture refinement completely (`do_refine=False`); Unique3D now runs pure geometry inference via native `img2mvimg`, `realesrgan-x4.onnx` super-resolution, and `image2normal` normal prediction. Removed `runwayml/stable-diffusion-v1-5` dependency and download requirements, eliminating extra VRAM and network overhead. Gradio dependency stubbed for headless execution. | FIXED — pure geometry inference & SD1.5 dependency removed |
| Routing & Landing Page | Completely removed 1106-line marketing homepage (`app/page.tsx`), deleted `app/homeTelemetry.ts`, redirected `/` directly to `/workspace` at both server component and `next.config.ts` route redirect levels. | FIXED — workspace default landing |

## Verification boundary

- **Source review:** the current focused review covered both changed adapters and their Hunyuan3D-2.1 / Unique3D upstream call paths, plus the factory, model manifest, task/architecture docs, and existing shared loader contract.
- **Backend CI before this update:** its model-test command pointed at files absent from the current tree; no successful workflow run was available during the audit.
- **New backend contract test:** `backend/tests/test_loader.py` covers nested keys, relative-root handling independent of CWD, unsafe keys, and missing directories. It is committed with the corrected workflow; execution result must be taken from the post-push GitHub Actions run.
- **Changed-file syntax:** `python -m py_compile backend/adapters/hunyuan3d_shape_v21.py backend/adapters/unique3d_adapter.py` — PASS.
- **Frontend tests, TypeScript, full backend CI, GPU inference, checkpoint initialization, Blender, and visual mesh quality:** NOT RUN. The two model fixes are source-level corrections, not runtime validation.

## Configuration and ownership

- `backend/config/models.yaml`: model metadata, capabilities, and manifest model paths.
- `backend/config/quality.yaml`: quality and post-processing policy.
- `backend/config/smart_presets.yaml`: output-intent recipes.
- Model-native inference implementation/defaults remain owned by each model adapter/upstream API where implemented; do not copy them into a second configuration or UI control.
- `MODEL_STORAGE_ROOT` is for checkpoints only. Application uploads, generated assets, and canonical workspaces continue to use the existing application storage contract.

## Documentation integrity

Documentation indexes are aligned to files present in the checked-in tree. Only link a document after confirming that its path exists; do not revive removed or planned documents as if they were active guides.

The Pixal3D, Paint3D, UniRig, FastMesh V4K, and TRELLIS text-painting gaps have been resolved at the source/adapter and manifest level. Hi3D input validation is enforced. All adapters require checkpoint loading, real GPU inference, and mesh-output validation in an environment with full weights and GPU acceleration before being called runtime-verified.
