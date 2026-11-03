# ForMesh3D Changelog

## 2026-11-03 — Hunyuan3D-2 Mini Turbo Production Success & Adapter Governance Headers

- Hunyuan3D DiT v2 Mini Turbo: verified working in production live GPU inference (758,902 faces, 379,430 vertices, 13.0MB GLB, 3.87GB VRAM, 166.75s). Marked status as `STABLE - LOCKED` in `backend/config/models.yaml` and `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py`. Added strict agent protection rules barring any modification without explicit user order.
- Standardized Model Adapter Governance: added standardized ASCII specification and governance header boxes across all 17 backend adapters with Model ID, Name, Target, Status, Upstream details, VRAM, and Agent modification rules.
- Unique3D & Hunyuan3D CPU Offload: enabled `enable_model_cpu_offload()` and attention slicing across Unique3D (`mvimg_prediction`, `normal_prediction`, `unifield_processor`) and all Hunyuan3D adapters to prevent CUDA OOM on 16GB GPUs; removed TensorRT provider fallback error in Unique3D `load_onnx.py`.
- Verification: `bun test` passed (60/60), `compute_mode_test.sh` passed (8/8).

---

## 2026-11-03 — Hunyuan3D-Shape and Unique3D adapter corrections

- Hunyuan3D-Shape: use the parent of the vendored `hy3dshape` package as the import root; consume the actual flat `List[Trimesh]` pipeline output, skip `None` extraction failures, and forward the supplied seed through `generator=`.
- Unique3D: call the vendored `app.gradio_3dgen.generate3dv2` callable instead of treating its Stable Diffusion ControlNet refinement sub-pipeline as a mesh generator. This follows the upstream multiview prediction, geometric reconstruction, and GLB export path.
- Unique3D model-zoo and predictor initialization now occurs while the model weights directory is the working directory; inference temporarily restores that CWD contract for upstream `./ckpt/` and `/tmp/gradio` paths.
- Python syntax compilation for the two changed adapters: PASS. Model checkpoint initialization, GPU inference, and mesh-quality validation: NOT RUN.

---

## 2026-11-02 — Adapter import, weight-download, and inference fixes

- TRELLIS adapter: downloads full `microsoft/TRELLIS.2-4B` weights from HuggingFace Hub when local `pipeline.json` is absent; moves pipeline to CUDA (`pipeline.to(device, dtype)`); fixed mesh export — `MeshExtractResult` has no `.export()`, now converts torch tensors to `trimesh.Trimesh` before export.
- TRELLIS.2 adapter: checks nested `TRELLIS.2-4B/` subfolder for weights; adds `snapshot_download` fallback when `pipeline.json` missing; moves pipeline to CUDA; fixed mesh export — `MeshWithVoxel` has no `.export()`, now uses `o_voxel.postprocess.to_glb()`.
- TRELLIS.2 Paint adapter: moves pipeline to CUDA; fixed `pipeline(...)` call — `Trellis2TexturingPipeline` has no `__call__`, now uses `pipeline.run(mesh=mesh, image=image, seed=seed)`.
- Hi3D adapter: moves pipeline to CUDA (`pipeline.to(device, dtype)`).
- PartUV adapter: adds `backend/thirdparty/PartUV` to `sys.path` in `_load_model`; calls `preprocess(mesh_path)` without unsupported kwargs; unpacks 4-tuple return (`mesh = result[0]`) before export.
- Pixal3D adapter: defines `width = image.size[0]` before use (was undefined `NameError`); moves pipeline to CUDA; attempts to load `image_cond_model_*` (DinoV3ProjFeatureExtractor) from HF with graceful fallback.
- ARDY adapter: adds `backend/thirdparty/ardy` to `sys.path`; passes `text_encoder=False` to avoid HF download; passes required `motion_mask`/`observed_motion` tensors and concrete `num_denoising_steps=50` to `model()`.
- UniRig adapter: adds `backend/thirdparty/UniRig` root (not weights dir) to `sys.path`; passes required `__target__="ar"` to `get_system()`.
- FastMesh adapter: adds `backend/thirdparty/FastMesh` root to `sys.path` (not `weights_dir.parent`); uses `MODELS["MeshGen"]` (not nonexistent `"fastmesh"` key); loads from `weights_dir` instead of HF repo ID; moves model to GPU.
- Hunyuan3D Shape v2.1 / Mini-Turbo / v2.1 Legacy: add `backend/thirdparty/Hunyuan3D-2.1` or `hunyuan3d-2` to `sys.path`; add `snapshot_download` fallback for missing weights; derive device from `gpu_id` (not hardcoded `'cpu'`); pass seeded `torch.Generator` as `generator=`; fixed double-subscript bug — `outputs` is `List[Trimesh]`, single-subscript `outputs[0]`.
- Hunyuan3D v2.1 Legacy paint subclass: overrides `_load_model` to use `Hunyuan3DPaintPipeline` (texgen) instead of shape pipeline (which has no `mesh=` parameter).
- Hunyuan3D Paint v2.1: adds `snapshot_download` fallback for missing `hunyuan3d-delight-v2-0/` and `hunyuan3d-paint-v2-0-turbo/` subfolders; wraps `from_pretrained` in try/except with clear CUDA-required error.
- Paint3D adapter: resolves pipeline scripts and configs from `thirdparty/Paint3D` source root (not weights_dir); sets subprocess `cwd` to thirdparty root; applies produced albedo texture to mesh before export.
- TaoFlowForge adapter: derives device from `gpu_id` (not hardcoded `'cpu'`).
- `Docs/MEMORY.md` integration-audit table: Third-party imports row marked FIXED.
- `Docs/TASKS.md` implementation-audit note: model-source import setup marked resolved.
- GPU inference, checkpoint download, and mesh-quality validation remain NOT RUN (no GPU/weights in this review environment).
