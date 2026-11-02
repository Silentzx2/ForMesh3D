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
| Pixal3D | The adapter's camera fallback references `width` without defining it. The vendored `Pixal3DImageTo3DPipeline.from_pretrained` deliberately sets four projection condition models to `None`; upstream inference code constructs those condition models separately. The current adapter does not reproduce that initialization contract. | FAIL — source/API mismatch |
| Paint3D | The adapter looks for `pipeline_paint3d_stage1.py` and `pipeline_paint3d_stage2.py` under the weights directory, while those scripts live in the vendored `Paint3D/` source folder. The result path exports the original input mesh and records the generated albedo path; it does not apply the generated texture to the returned mesh. | FAIL — path/output contract |
| UniRig | Vendored `UniRig/src/system/parse.py` requires `__target__` in `get_system(**kwargs)`. The adapter call omits it. The official `run.py` flow uses a Lightning `Trainer.predict` path; the adapter's expected `system.predict_rig` call was not found in that entry point. | FAIL — initialization/API mismatch |
| FastMesh | The current model manifest contains the V1K retopology entry. The registry also has a V4K ID, but both IDs map to one class whose `MODEL_KEY` is hard-coded to `FastMesh-V1K`. V4K is not established by the current manifest/adapter contract. The adapter's source import root also needs correction/verification. | FAIL — V4K unresolved |
| TRELLIS text painting | `trellis_text_mesh_painting` is registered to an adapter whose input path is image-conditioned TRELLIS inference; the adapter does not implement a text-conditioned pipeline contract. | FAIL — feature/adapter mismatch |
| Hi3D | The experimental adapter's refinement path expects a coarse mesh. It should not be described as a standalone image-to-mesh generator without the coarse-mesh stage. | LIMITED — input contract |
| CPU/CI coverage | The checked-in backend workflow referenced four regression tests that are absent from the current `backend/tests/` tree. This update replaces those references with a focused loader contract test. | FIXED IN THIS UPDATE — CI scope |
| Real inference | No model checkpoint load, GPU inference, output mesh inspection, VRAM measurement, or model-quality benchmark was performed in this audit. | NOT RUN |

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

The remaining Pixal3D, Paint3D, UniRig, FastMesh V4K, TRELLIS text-painting, and model-identity gaps remain engineering tasks. Hunyuan3D-Shape and Unique3D have targeted source/API fixes, but still require checkpoint loading, real GPU inference, and mesh-output validation before being called runtime-verified.
