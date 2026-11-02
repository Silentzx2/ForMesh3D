# ForMesh3D Changelog

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

---

- Added a detailed ThirdParty root README with source-directory inventory, an intended-architecture Mermaid diagram, recursive-submodule workflow, dependency boundaries, and per-model license guidance.
- Audited current project documentation against the `dev` source tree; removed dead document/license links and corrected unsupported claims about adapter readiness, FastMesh V4K, generated-output rights, and current test coverage.
- Added `backend/tests/test_loader.py` for the shared model-weight path resolver and updated Backend Runtime Contract CI to stop invoking deleted adapter tests.
- Recorded the remaining source/API integration defects and the GPU-validation boundary in `Docs/MEMORY.md`, `Docs/ARCHITECTURE.md`, and `Docs/TASKS.md`.

---

## 2026-11-01 — Installer Script Refactor & Dependency Fix

- Standardized dependency installation through `$UV_PIP install` and removed the dead/redundant helper.
- Added visible wait/progress messages around potentially long dependency installation steps.
- Kept GPU-only model requirements separate from core/CPU-safe dependencies.
- Aligned CPU/CUDA PyTorch index handling and installer guards. The previous changelog records 8/8 compute-mode resolver checks; this documentation pass did not rerun them.

---

## 2026-11-01 — Adapter/Loader Integration Work Landed; Runtime Audit Still Open

- Added or updated 17 adapter modules, registry aliases, the shared weights resolver, and downloader support for `MODEL_STORAGE_ROOT`.
- Static inspection confirms model IDs are registered, but registration is not proof that each adapter imports and calls its upstream inference API correctly.
- The follow-up source audit found unresolved integration blockers in Pixal3D, Paint3D, UniRig, FastMesh V4K, the TRELLIS text-painting registry entry, and model identity propagation.
- `backend/loader.py` resolves `<MODEL_STORAGE_ROOT>/<model_key>` relative to the repository root when configured relatively, rejects absolute/traversal keys, and raises when the directory is missing.
- The downloader reads the same shared storage-root environment variable; path parity was source-inspected, not exercised with real model downloads.
- The original integration commit reported a successful Python compile and 26 fixes; those checks were not re-run in this documentation pass. GPU/checkpoint loading, geometry quality, peak VRAM, and supported-host smoke tests remain NOT RUN.
- The October 30 readiness disclosure remains applicable: model-specific load/inference/quality validation is required before calling any adapter production-ready.
