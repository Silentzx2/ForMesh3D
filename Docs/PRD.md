# Product Requirements — ForMesh3D

> **Last reviewed:** 2026-11-25 | **Scope:** `dev` branch. Authoritative model list: `backend/config/models.yaml`.

## Product & Workflow
ForMesh3D is a self-hosted 3D asset studio (Next.js + FastAPI) for generating, inspecting, and processing 3D meshes in a single-user local/VPS deployment:
1. Upload an image or mesh in `/workspace/generate/<workspace_id>`.
2. Pick a model from `models.yaml`-backed dropdowns and run generation or specialist tools.
3. Track generation with the viewport's simple progress bar and inspect the resulting GLB in the local Three.js viewport.
4. (Motion) Load a rigged mesh, generate a text→motion clip with ARDY or preview/upload an NPZ clip, then play it back in the viewport animation player and export an animated GLB.

## Active Surfaces & Models
- **Generation:** `hunyuan3d_shape_v21_image_to_raw_mesh`, `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh`, `triposg_image_to_raw_mesh`, `triposr_image_to_raw_mesh`, `trellis_image_to_3d`, `stable_fast_3d_image_to_textured_mesh`.
- **Texture Painting:** `hunyuan3d_paint_v21_image_mesh_painting`, `hunyuan3d_v20_paint_image_mesh_painting`, `trellis_image_mesh_painting`, `trellis_text_mesh_painting`, `triposr_image_mesh_painting` (base color only).
- **Specialist Tools (AI-only):** `triflow_retopology`, `partuv_uv_unwrapping`, `partfield_segmentation`, `skintokens_auto_rigging`, `ardy_motion_generation`.
- **Motion:** `ardy_motion_generation` (text→motion), bundled read-only premade presets in `backend/motion_presets/`, and persistent user-uploaded/generated presets under `backend/storage/presets/<preset_id>/`; clips served through the normalized `MotionClipV1` API.
- **Disabled & Retained:** Pixal3D, TRELLIS.2, TaoFlowForge (must not be enabled or deleted during unrelated work).

## Constraints & Non-Goals
- Preserve immutable asset versions in SQLite/`backend/storage/<workspace_id>/`; keep `/openapi.json` and `/docs` as schema authority.
- Keep `sm >= 80` native behavior and isolate model-specific patches in `patcher/<model-name>/`.
- Out of scope unless re-implemented: server-side mesh streaming, script-engine fallbacks, LOD/physics packaging, arbitrary FBX conversion.
