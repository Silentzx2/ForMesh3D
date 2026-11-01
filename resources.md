# Model Official Repos and Weight Links

Copy-paste ready: each model lists its adapter file, `git clone` command, and weight
download link. Sources verified against each project's official GitHub/HuggingFace page.

Downloading weights is a separate step (`backend/scripts/download_models.sh`).

---

## 1. ARDY — Motion generation

Adapter: `backend/adapters/ardy_adapter.py`

Clone the official repo:
```
git clone https://github.com/nv-tlabs/ardy
```

Weights / checkpoints:
- Repo includes code + checkpoints
- Gated text encoder: https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct
- Models: https://huggingface.co/VAST-AI/UniRig

---

## 2. FastMesh (V1K / V4K) — Mesh retopology

Adapter: `backend/adapters/fastmesh_adapter.py`

Clone the official repo:
```
git clone https://github.com/jhkim0759/FastMesh
```

Weights / checkpoints:
```
https://huggingface.co/WopperSet/FastMesh-V1K
https://huggingface.co/WopperSet/FastMesh-V4K
```

---

## 3. Hi3D v1.0 (SPARC3D) — Geometry refinement

Adapter: `backend/adapters/hi3d_adapter.py`

Clone the official repo:
```
git clone https://github.com/hi3d-official/Hi3Dv1.0
```

Weights / checkpoints:
```
https://huggingface.co/hi3d-official/Hi3Dv1.0
```

---

## 4. Hunyuan3D-Shape-v2-1 — Image-to-raw-mesh

Adapter: `backend/adapters/hunyuan3d_shape_v21.py`

Clone the official repo:
```
git clone https://github.com/tencent-hunyuan/hunyuan3d-2.1
```

Weights / checkpoints:
```
https://huggingface.co/tencent/Hunyuan3D-2.1/tree/main/hunyuan3d-dit-v2-1
```

---

## 5. Hunyuan3D-DiT-v2-mini-Turbo — Image-to-raw-mesh (low VRAM)

Adapter: `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py`

Clone the official repo:
```
git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2
```

Weights / checkpoints:
```
https://huggingface.co/tencent/Hunyuan3D-2mini/tree/main/hunyuan3d-dit-v2-mini-turbo
```

---

## 6. Hunyuan3D-Paint-v2-1 — PBR mesh painting (4K/8K)

Adapter: `backend/adapters/hunyuan3d_paint_v21.py`

Clone the official repo:
```
git clone https://github.com/tencent-hunyuan/hunyuan3d-2.1
```

Weights / checkpoints:
```
https://huggingface.co/tencent/Hunyuan3D-2.1/tree/main/hunyuan3d-paintpbr-v2-1
```

---

## 7. Hunyuan3D 2.1 common base — Shared base class

Adapter: `backend/adapters/hunyuan3d_adapter_v21.py`

Clone the official repo:
```
git clone https://github.com/tencent-hunyuan/hunyuan3d-2.1
```

Weights / checkpoints:
- Same as Shape/Paint above (hunyuan3d-dit-v2-1 and hunyuan3d-paintpbr-v2-1)

---

## 8. Hunyuan3D decoder profile — Helper utility (not a model)

Adapter: `backend/adapters/hunyuan3d_decoder_profile.py`

Official repo: N/A (internal utility)
Weights: N/A

---

## 9. Paint3D — 1K/2K texture painting

Adapter: `backend/adapters/paint3d_adapter.py`

Clone the official repo:
```
git clone https://github.com/OpenTexture/Paint3D
```

Weights / checkpoints:
- ControlNet + SD1.5 checkpoints resolved dynamically by adapter (`_resolve_checkpoints()`)
- Falls back to public HF repo IDs; checks local `pretrained/Paint3D/` first

---

## 10. PartUV — UV unwrapping

Adapter: `backend/adapters/partuv_adapter.py`

Clone the official repo:
```
git clone https://github.com/EricWang12/PartUV
```

Weights / checkpoints:
```
backend/pretrained/PartUV/model_objaverse.ckpt
```

---

## 11. Pixal3D — Image-to-3D (O-Voxel)

Adapter: `backend/adapters/pixal3d_adapter.py`

Clone the official repo:
```
git clone https://github.com/TencentARC/Pixal3D
```

Weights / checkpoints:
- DINOv3 image-conditioner: camenduru/dinov3-vitl16-pretrain-lvd1689m
- Pipeline weights from `model_path` (pretrained/Pixal3D)

---

## 12. TaoFlowForge — Native mesh generation

Adapter: `backend/adapters/taoflowforge_adapter.py`

Clone the official repo:
```
git clone https://github.com/alibaba/Taobao3D
```
(TaoFlowForge lives in the `TaoFlowForge/` subfolder of this repo.)

Weights / checkpoints:
```
stage0.pt, stage1.pt, stage2.pt under backend/pretrained/Taobao3D/TaoFlowForge/
```

---

## 13. TRELLIS — Image-to-raw-mesh

Adapter: `backend/adapters/trellis_adapter.py`

Clone the official repo:
```
git clone https://github.com/microsoft/TRELLIS
```

Weights / checkpoints:
```
https://huggingface.co/microsoft/TRELLIS-image-large
```

---

## 14. TRELLIS.2 — Image-to-raw-mesh (cascade)

Adapter: `backend/adapters/trellis2_adapter.py`

Clone the official repo:
```
git clone https://github.com/microsoft/TRELLIS.2
```

Weights / checkpoints:
```
https://huggingface.co/microsoft/TRELLIS.2-4B
```

---

## 15. TRELLIS.2 painting — Mesh texturing

Adapter: `backend/adapters/trellis2_paint_adapter.py`

Clone the official repo:
```
git clone https://github.com/microsoft/TRELLIS.2
```

Weights / checkpoints:
- Same as TRELLIS.2 above

---

## 16. TripoSG — Image-to-raw-mesh

Adapter: `backend/adapters/triposg_adapter.py`

Clone the official repo:
```
git clone https://github.com/VAST-AI-Research/TripoSG
```

Weights / checkpoints:
```
https://huggingface.co/VAST-AI/TripoSG
```

---

## 17. Unique3D — Image-to-raw-mesh

Adapter: `backend/adapters/unique3d_adapter.py`

Clone the official repo:
```
git clone https://github.com/AiuniAI/Unique3D
```

Weights / checkpoints:
```
https://huggingface.co/spaces/Wuvin/Unique3D/tree/main/ckpt
```

---

## 18. UniRig — Auto-rigging

Adapter: `backend/adapters/unirig_adapter.py`

Clone the official repo:
```
git clone https://github.com/VAST-AI-Research/UniRig
```

Weights / checkpoints:
```
https://huggingface.co/VAST-AI/UniRig
```

---

## Quick reference table

| # | Adapter File | Model | git clone | Weights |
|---|---|---|---|---|
| 1 | `backend/adapters/ardy_adapter.py` | ARDY | `git clone https://github.com/nv-tlabs/ardy` | repo + HF `VAST-AI/UniRig` |
| 2 | `backend/adapters/fastmesh_adapter.py` | FastMesh V1K/V4K | `git clone https://github.com/jhkim0759/FastMesh` | HF `WopperSet/FastMesh-V1K`, `WopperSet/FastMesh-V4K` |
| 3 | `backend/adapters/hi3d_adapter.py` | Hi3D v1.0 | `git clone https://github.com/hi3d-official/Hi3Dv1.0` | HF `hi3d-official/Hi3Dv1.0` |
| 4 | `backend/adapters/hunyuan3d_shape_v21.py` | Hunyuan3D-Shape-v2-1 | `git clone https://github.com/tencent-hunyuan/hunyuan3d-2.1` | HF `tencent/Hunyuan3D-2.1` (hunyuan3d-dit-v2-1) |
| 5 | `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py` | Hunyuan3D-DiT-v2-mini-Turbo | `git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2` | HF `tencent/Hunyuan3D-2mini` (hunyuan3d-dit-v2-mini-turbo) |
| 6 | `backend/adapters/hunyuan3d_paint_v21.py` | Hunyuan3D-Paint-v2-1 | `git clone https://github.com/tencent-hunyuan/hunyuan3d-2.1` | HF `tencent/Hunyuan3D-2.1` (hunyuan3d-paintpbr-v2-1) |
| 7 | `backend/adapters/hunyuan3d_adapter_v21.py` | Hunyuan3D 2.1 base | `git clone https://github.com/tencent-hunyuan/hunyuan3d-2.1` | Same as #4 / #6 |
| 8 | `backend/adapters/hunyuan3d_decoder_profile.py` | Decoder helper | N/A | N/A |
| 9 | `backend/adapters/paint3d_adapter.py` | Paint3D | `git clone https://github.com/OpenTexture/Paint3D` | Dynamic (ControlNet + SD1.5) |
| 10 | `backend/adapters/partuv_adapter.py` | PartUV | `git clone https://github.com/EricWang12/PartUV` | `backend/pretrained/PartUV/model_objaverse.ckpt` |
| 11 | `backend/adapters/pixal3d_adapter.py` | Pixal3D | `git clone https://github.com/TencentARC/Pixal3D` | DINOv3 + model_path weights |
| 12 | `backend/adapters/taoflowforge_adapter.py` | TaoFlowForge | `git clone https://github.com/alibaba/Taobao3D` | `backend/pretrained/Taobao3D/TaoFlowForge/` |
| 13 | `backend/adapters/trellis_adapter.py` | TRELLIS | `git clone https://github.com/microsoft/TRELLIS` | HF `microsoft/TRELLIS-image-large` |
| 14 | `backend/adapters/trellis2_adapter.py` | TRELLIS.2 | `git clone https://github.com/microsoft/TRELLIS.2` | HF `microsoft/TRELLIS.2-4B` |
| 15 | `backend/adapters/trellis2_paint_adapter.py` | TRELLIS.2 painting | `git clone https://github.com/microsoft/TRELLIS.2` | Same as #14 |
| 16 | `backend/adapters/triposg_adapter.py` | TripoSG | `git clone https://github.com/VAST-AI-Research/TripoSG` | HF `VAST-AI/TripoSG` |
| 17 | `backend/adapters/unique3d_adapter.py` | Unique3D | `git clone https://github.com/AiuniAI/Unique3D` | HF `Wuvin/Unique3D` (ckpt/) |
| 18 | `backend/adapters/unirig_adapter.py` | UniRig | `git clone https://github.com/VAST-AI-Research/UniRig` | HF `VAST-AI/UniRig` |

---

## Notes

- **Hunyuan3D-2.1** (`tencent-hunyuan/hunyuan3d-2.1`) hosts both Shape-v2-1 (3.3B DiT) and Paint-v2-1 (2B PBR) under one repo; weights live in separate HF subfolders.
- **FastMesh** weights are published by the author (WopperSet) on HuggingFace as two variants: V1K (~1K vertices) and V4K (~4K vertices).
- **UniRig** weights are hosted at `VAST-AI/UniRig` on HuggingFace; skeleton+skinning trained on Articulation-XL2.0.
- **TRELLIS.2** weights (`microsoft/TRELLIS.2-4B`) are a 4B-parameter model supporting up to 1536³ resolution.
- **Hi3D v1.0** is built on Sparc3D; DINOv2/CLIP encoders load from HF on first use unless cached locally.
- **Unique3D** weights are distributed via the `Wuvin/Unique3D` HuggingFace Space (`ckpt/` folder).
- **Paint3D** resolves ControlNet/SD1.5 checkpoints at runtime via `_resolve_checkpoints()`, checking local `pretrained/Paint3D/` first then public HF repo IDs.
- **PartUV** expects `model_objaverse.ckpt` under `backend/pretrained/PartUV/` per the adapter constructor.

## Disclaimer

Links reflect the state of each project's official repo/HF page at time of research. Model availability, gating, and license terms are controlled by the upstream authors; verify before downloading or using in any deployment.
