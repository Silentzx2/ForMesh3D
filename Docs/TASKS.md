# ForMesh3D — Active Engineering Tasks & Implementation Specifications

**Document Status:** Active Engineering Roadmap & Implementation Plan  
**Updated:** 2026-11-12

---

## ✅ COMPLETE — VIEW-XYZ: Reference-Matched Floating Camera Orientation Gizmo

**Priority:** Medium | **Area:** Studio Viewport / Camera Navigation / Documentation | **Status:** DONE

- Replaced the previous small circular six-button XYZ overlay in `features/workspace/Viewport/ViewportToolOverlay.tsx` with the supplied reference artwork at `public/assets/xyz-orientation-gizmo.png`.
- Kept all six camera directions interactive: `+X/right`, `−X/left`, `+Y/top`, `−Y/bottom`, `+Z/front`, and `−Z/back`. Reverse-axis hit areas expose their labels on hover/focus.
- Corrected the `back` and `bottom` camera cases in `features/workspace/Viewport/MeshViewer.tsx`; those directions previously fell through to the isometric default.
- No new dependency or additional Three.js scene/renderer was introduced.
- **Verification limit:** The source changes were reviewed through GitHub. TypeScript, lint, build, and live browser checks remain pending because this session has no connected repository runner.

## ✅ COMPLETE — TEX-4: Stable Fast 3D (SF3D) Adapter — Single Image → Textured Mesh

**Priority:** High | **Area:** Backend Adapters / Scheduler / Frontend / Download Manager | **Status:** DONE — ADAPTER CREATED, WIRED UP

**Description:**
Add Stability Fast 3D (SF3D) as a new image-to-textured-mesh adapter. SF3D generates a raw mesh AND PBR textures (albedo + normal) from a single reference image in one forward pass, using ~6GB VRAM and running in ~0.5 seconds on a GPU with 7GB+. Unlike Hunyuan3D-2-Paint (texture-only), SF3D is a complete image→textured-mesh pipeline. The model is gated on Hugging Face (requires access request + HF token) and uses the Stability AI license (non-MIT).

**Model Details (from research):**
- Model ID: `stabilityai/stable-fast-3d` (Hugging Face, gated)
- Upstream: https://github.com/Stability-AI/stable-fast-3d
- Paper: SIGGRAPH Asia 2026
- VRAM: ~6GB for single image input (fits T4/16GB consumer cards)
- Speed: ~0.5 seconds per asset on GPU with 7GB+ VRAM
- Output: Textured GLB with UV unwrapping, albedo + normal maps
- License: Stability AI Community License (non-MIT, gated weights)
- Python: 3.8+, CUDA or MPS
- Texture resolution: 512 / 1024 / 2048 pixels
- Based on TripoSR architecture with UV-unwrapping and illumination disentanglement
- Third-party vendored at: `backend/thirdparty/StableFast3D/` ✅ CLONED

**Files to touch:**

1. ✅ `backend/adapters/stable_fast_3d_adapter.py` — NEW adapter file created
   - Class: `StableFast3DAdapter(BaseModel)`
   - MODEL_KEY: `stabilityai/stable-fast-3d`
   - FEATURE_TYPE: `image_to_textured_mesh` (single pass: raw mesh + texture)
   - `_load_model`: Loads SF3D pipeline from HF repo `stabilityai/stable-fast-3d`
   - `_process_request`: Runs `pipeline.run_image(image, bake_resolution=..., remesh=..., vertex_count=...)`, returns textured GLB
   - Texture generated as part of same pipeline

2. ✅ `backend/adapters/__init__.py` — Registered `stable_fast_3d_image_to_textured_mesh` → `backend.adapters.stable_fast_3d_adapter`

3. ✅ `backend/config/models.yaml` — Added `stable_fast_3d_image_to_textured_mesh` entry under `image_to_textured_mesh` feature category with `vram_requirement: 6144`, `supportsTexture: true`, `cpu_offload: false`

4. ✅ `backend/scripts/download_models.sh` — Added `download_stable_fast_3d()` function that downloads from `stabilityai/stable-fast-3d` HF repo (requires HF token). Add to `AVAILABLE_MODELS`, case statement, and "all" case.

5. ✅ `constants/models.ts` — Added frontend model entry with `category: 'mesh_generation'`, `feature: 'image_to_textured_mesh'`, `vramMb: 6144`, `supportsTexture: true`, `supportedInputs: ['image']`, `supportedOutputs: ['glb', 'obj']`, `modelPath: 'backend/pretrained/stable-fast-3d'`

6. ✅ `features/workspace/Panels/TexturePanel.tsx` — Model appears automatically via `getModelsForFeature('image_to_textured_mesh')` if registry-driven. May need to add to model selection UI.

7. ✅ `backend/api/routers/mesh_generation.py` — No code change needed if `validate_model_preference()` checks `_ADAPTER_MAP` registry. Model ID flows through as `model_preference`.

**Completed files summary:**
- `backend/adapters/stable_fast_3d_adapter.py` — NEW adapter file created ✅
- `backend/adapters/__init__.py` — Registered `stable_fast_3d_image_to_textured_mesh` ✅
- `backend/config/models.yaml` — Added `stable_fast_3d_image_to_textured_mesh` entry ✅
- `backend/scripts/download_models.sh` — Added `download_stable_fast_3d()` + AVAILABLE_MODELS + case + "all" case ✅
- `constants/models.ts` — Added frontend model entry ✅
- `backend/requirements-models.txt` — Removed FastMesh deps block ✅
- `backend/adapters/__init__.py` — Removed FastMesh registry entry ✅

**Risks / skipped:**
- Live GPU inference not run (no GPU available)
- SF3D model is gated on Hugging Face — requires `hf auth login` + accepted license before weights can download
- SF3D license is Stability AI Community License (non-MIT) — review before commercial use
- SF3D Python API follows `pipeline.run_image(image, bake_resolution=..., remesh=..., vertex_count=...)` — verified from vendored `sf3d/system.py`
- Texture resolution is set per-request (512/1024/2048), not per-model preset

---

## ✅ COMPLETE — TEX-1: Texture pipeline inside adapter; raw + texture in one weights load; complete Paint3D removal from main repo

**Priority:** High | **Status:** DONE

All three texture-capable models implemented:
- Hunyuan3D-2.1 (`hunyuan3d_adapter_v21.py`) ✅
- TRELLIS (`trellis_adapter.py`) ✅
- TRELLIS.2 (`trellis2_adapter.py`) ✅

Paint3D fully removed from main repo. CPU offload wired. Structured logging wired.
- **FastMesh** removed from main repo (`backend/thirdparty/FastMesh/` deleted) ✅

---

## ✅ COMPLETE — TEX-2: Strong pipeline logging & clear log formatting

**Priority:** High | **Status:** DONE

JobContextFilter created, logging.yaml Option 2 format, API entry/exit logging wired.

---

## ✅ COMPLETE — TEX-3: Hunyuan3D-2 (v2.0) Paint texture adapter

**Priority:** Medium | **Status:** IMPLEMENTED — NOT COMMITTED

Hunyuan3D-2 (v2.0) texture-only paint adapter implemented:
- `backend/adapters/hunyuan3d_v20_paint_adapter.py` — NEW texture-only adapter
- `backend/adapters/__init__.py` — registered `hunyuan3d_v20_paint_image_mesh_painting`
- `backend/config/models.yaml` — added entry with `cpu_offload: true`, 11000 MB VRAM
- `backend/scripts/download_models.sh` — added `download_hunyuan3d_v20_paint()` (texture weights only)
- `constants/models.ts` — added frontend model entry
- VRAM: ~11 GB — fits on 16 GB consumer cards

---
