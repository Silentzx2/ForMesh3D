# Model Source and Weight Reference

This file is a navigation index for the model source and checkpoint layout currently represented in the ForMesh3D `dev` tree. It is not a runtime-readiness certificate. A registry entry, source folder, or checkpoint directory does not prove that an adapter imports, loads, or generates a valid result.

## Source repository

All model source snapshots are tracked in the `backend/thirdparty` Git submodule:

- Repository: [ForMesh3D-ThirdParty](https://github.com/Silentzx2/ForMesh3D-ThirdParty)
- Guide: [backend/thirdparty/README.md](https://github.com/Silentzx2/ForMesh3D-ThirdParty/blob/main/README.md)
- Main project pins an exact submodule commit; update that gitlink when the third-party repository advances.
- Each source directory retains its own upstream README, license, and dependency instructions. There is no shared model license or universal dependency set.

## Current adapter and source map

| Adapter module | Source directory | Purpose | Configured weights path (under `backend/pretrained`) | Audit note |
|---|---|---|---|---|
| `ardy_adapter.py` | `ardy/` | Text-to-motion generation | `ardy/` | CPU-only path in the manifest; checkpoint and inference not tested |
| `fastmesh_adapter.py` | `FastMesh/` | Mesh retopology | `FastMesh-V1K/` | Manifest currently declares V1K only; V4K registry key is not backed by a distinct current adapter configuration |
| `hi3d_adapter.py` | `Hi3D/` | Experimental geometry refinement | `Hi3D/` | Adapter expects a coarse mesh input; not a standalone raw image-to-mesh path |
| `hunyuan3d_shape_v21.py` | `Hunyuan3D-2.1/` | Hunyuan3D 2.1 shape generation | `tencent/Hunyuan3D-2.1/` | Source/API and GPU loading require runtime validation |
| `hunyuan3d_paint_v21.py` | `Hunyuan3D-2.1/` | Hunyuan3D 2.1 PBR painting | `tencent/Hunyuan3D-2.1/` | Shares the upstream source/checkpoint family with Shape |
| `hunyuan3d_dit_v2_mini_turbo.py` | `hunyuan3d-2/` | Lower-parameter Hunyuan3D mini generation | `tencent/Hunyuan3D-2mini/` | Source import and runtime need validation |
| `hunyuan3d_adapter_v21.py` | Hunyuan3D legacy source family | Legacy Hunyuan3D 2.1 compatibility adapter | Check the active manifest entry | Legacy module; do not assume it is an independently enabled model |
| `paint3d_adapter.py` | `Paint3D/` | Mesh texture generation | `Paint3D/` | Current adapter has a source-script path/output-texture integration defect; see `Docs/MEMORY.md` |
| `partuv_adapter.py` | `PartUV/` | UV unwrapping | `PartUV/` | Source extension and model runtime need validation |
| `pixal3d_adapter.py` | `Pixal3D/` | Image-to-3D with O-Voxel export | `Pixal3D/` | Current adapter has camera/condition-model initialization defects; see `Docs/MEMORY.md` |
| `taoflowforge_adapter.py` | `Taobao3D/` (TaoFlowForge subdirectory) | Progressive native mesh generation | `Taobao3D/TaoFlowForge/` | Verify source package root and checkpoints before inference |
| `trellis_adapter.py` | `TRELLIS/` | TRELLIS image-to-3D | `TRELLIS/` | Image-to-3D path; no verified text-painting behavior implied |
| `trellis2_adapter.py` | `TRELLIS.2/` | TRELLIS.2 image-to-3D | `TRELLIS.2/` | Source-level sparse/precision/GLB validation fixes applied; checkpoint load and T4/Ampere/newer-GPU inference still NOT RUN |
| `trellis2_paint_adapter.py` | `TRELLIS.2/` | TRELLIS.2 mesh painting | `TRELLIS.2/` | Separate adapter over the same source directory |
| `triposg_adapter.py` | `TripoSG/` | Image-to-3D generation | `TripoSG/` | Model source and weight load need validation |
| `unique3d_adapter.py` | `Unique3D/` | Image-to-3D generation/refinement | `Unique3D/` | Checkpoint layout and source import need validation |
| `unirig_adapter.py` | `UniRig/` | Character rigging | `UniRig/` | Current adapter's initialization/API does not match the inspected upstream contract; see `Docs/MEMORY.md` |

The 17 modules above share 14 source directories because Shape/Paint share Hunyuan3D 2.1, the two TRELLIS.2 adapters share TRELLIS.2, and TaoFlowForge is part of the Taobao3D source tree.

## Download and storage rules

- Default shared checkpoint root: `backend/pretrained`.
- Override the root with `MODEL_STORAGE_ROOT`; relative values resolve from the ForMesh3D repository root, not the process working directory.
- The shared resolver is `backend/loader.py:get_model_weights_dir(model_key)`.
- The downloader is `backend/scripts/download_models.sh`; use its built-in help/model selectors rather than manually inventing a path.
- The ThirdParty submodule stores source, not large checkpoints. Do not commit weights, generated assets, user uploads, tokens, or local environment files.
- Application uploads and generated assets use the existing application storage configuration; `MODEL_STORAGE_ROOT` is weights-only.

## Upstream source links

| Model source | Upstream project |
|---|---|
| ARDY | [nv-tlabs/ardy](https://github.com/nv-tlabs/ardy) |
| Hunyuan3D 2.1 | [Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) |
| Hunyuan3D 2 | [Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) |
| Hi3D | [hi3d-official/Hi3Dv1.0](https://github.com/hi3d-official/Hi3Dv1.0) |
| Paint3D | [OpenTexture/Paint3D](https://github.com/OpenTexture/Paint3D) |
| PartUV | [EricWang12/PartUV](https://github.com/EricWang12/PartUV) |
| Pixal3D | [TencentARC/Pixal3D](https://github.com/TencentARC/Pixal3D) |
| TaoFlowForge / Taobao3D | [alibaba/Taobao3D](https://github.com/alibaba/Taobao3D) |
| TRELLIS | [microsoft/TRELLIS](https://github.com/microsoft/TRELLIS) |
| TRELLIS.2 | [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) |
| TripoSG | [VAST-AI-Research/TripoSG](https://github.com/VAST-AI-Research/TripoSG) |
| UniRig | [VAST-AI-Research/UniRig](https://github.com/VAST-AI-Research/UniRig) |
| Unique3D | [AiuniAI/Unique3D](https://github.com/AiuniAI/Unique3D) |
| FastMesh | See the checked-in `FastMesh/README.md` and attribution files for the exact upstream provenance of this snapshot |

## Runtime and licensing caveats

No checkpoint downloads, model construction, GPU inference, or mesh-quality validation were performed during the November 1, 2026 repository audit. Pixal3D, Paint3D, UniRig, FastMesh V4K, and TRELLIS text-painting have specific code-level gaps documented in `Docs/MEMORY.md`; do not present them as verified working features.

Read the LICENSE/NOTICE files inside each exact model directory before use, redistribution, or commercial deployment. Source-code rights, checkpoint rights, dataset terms, and rights to generated outputs can differ.
