# ForMesh3D Changelog

## 2026-11-03 — TRELLIS.2 Raw Mesh Production Profile, Unique3D Deprecation & TaoFlowForge T4 Compat

- TRELLIS.2: disabled texture generation (`generate_texture=False`) for `trellis2_image_to_raw_mesh`, skipping texture SLat flow and decoder to save VRAM and latency; restored full production `pipeline_type="1024_cascade"` with `max_num_tokens=49152`; added bfloat16->float16 conversion in xformers sparse attention for pre-Ampere T4 compatibility; guarded CuMesh hole-filling and added direct trimesh export with unreferenced vertex removal to eliminate floating grid vertices.
- Unique3D: verified end-to-end live GPU inference on Kaggle (394s, 54,506 faces, 27,262 vertices, 1.0MB GLB). Switched nvdiffrast rasterization to `RasterizeCudaContext` with PyTorch3D fallback for headless environments; restored production step parameters. Marked status as `LEGACY / DEPRECATED (WORKING STATE - NOT ACTIVELY USED)` in `backend/config/models.yaml` and `backend/adapters/unique3d_adapter.py`.
- TaoFlowForge: enabled PyTorch SDPA `[FLASH_ATTENTION, EFFICIENT_ATTENTION, MATH]` fallbacks on Pre-Ampere GPUs; added sequential stage load/unload in pipeline to reduce peak host RAM from 26GB to 18GB; restored 1024 resolution.
- Verification: `bun test` passed (60/60).

---

## 2026-11-03 — Hunyuan3D-2 Mini Turbo & Shape v2.1 Live GPU Verification & Locks

- Hunyuan3D Shape v2.1: verified working in production live GPU inference (935,638 faces, 467,737 vertices, 16.1MB GLB, 563s). Marked status as `STABLE - WORKING / LOCKED` in `backend/adapters/hunyuan3d_shape_v21.py`.
- Hunyuan3D DiT v2 Mini Turbo: verified working in production live GPU inference (758,902 faces, 379,430 vertices, 13.0MB GLB, 3.87GB VRAM, 166.75s). Marked status as `STABLE - LOCKED` in `backend/config/models.yaml` and `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py`.
- Standardized Model Adapter Governance: added standardized ASCII specification and governance header boxes across all 17 backend adapters with Model ID, Name, Target, Status, Upstream details, VRAM, and Agent modification rules.

---

## 2026-11-03 — Hunyuan3D-Shape and Unique3D adapter corrections

- Hunyuan3D-Shape: use the parent of the vendored `hy3dshape` package as the import root; consume the actual flat `List[Trimesh]` pipeline output, skip `None` extraction failures, and forward the supplied seed through `generator=`.
- Unique3D: call the vendored `app.gradio_3dgen.generate3dv2` callable instead of treating its Stable Diffusion ControlNet refinement sub-pipeline as a mesh generator. This follows the upstream multiview prediction, geometric reconstruction, and GLB export path.
- Unique3D model-zoo and predictor initialization now occurs while the model weights directory is the working directory; inference temporarily restores that CWD contract for upstream `./ckpt/` and `/tmp/gradio` paths.
- Python syntax compilation for the two changed adapters: PASS. Model checkpoint initialization, GPU inference, and mesh-quality validation: NOT RUN.
