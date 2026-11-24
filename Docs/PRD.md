# Product Requirements — ForMesh3D

> **Last reviewed:** 2026-11-22  
> **Scope:** Current implementation on the `dev` branch. Model enablement is read from `backend/config/models.yaml`.

## Product

ForMesh3D is a self-hosted 3D asset studio for generating, inspecting, and processing 3D assets through a browser workspace and a local FastAPI backend. It is a personal/single-user oriented project; the design goal is a maintainable, minimal deployment rather than a multi-tenant SaaS platform.

## Core user workflow

1. Upload an image or mesh through the workspace.
2. Select a configured model or workspace tool and submit the operation.
3. Track job/operation state through the API.
4. Load the resulting mesh in the local Three.js viewport.
5. Run additional workspace tools such as texture painting, retopology, UV unwrapping, segmentation, rigging, or motion generation where the selected tool/model is configured.

Workspace identity is stable and deep-linkable through `/workspace/generate/<workspace_id>`.

## Implemented product surfaces

- **Generation:** FastAPI generation router plus model adapters selected through the model factory.
- **Texture:** texture-generation/painting API and enabled texture-capable adapters.
- **Retopology:** AI adapter and deterministic script pipeline exposed by the retopology router.
- **UV unwrapping:** PartUV AI path and script pipeline.
- **Segmentation:** PartField AI path and script pipeline.
- **Rigging:** SkinTokens adapter.
- **Motion:** ARDY adapter and motion API.
- **Viewport:** local GLB download and parsing through Three.js `GLTFLoader` and `glbCache`.
- **Operations and administration:** job status, workspace state, logs, file metadata, storage and database endpoints.

The API documentation is a route guide. Generated OpenAPI at `/openapi.json` and Swagger UI at `/docs` are the schema authority.

## Configured enabled model families

| Feature | Model ID(s) |
|---|---|
| Image-to-raw-mesh | `hunyuan3d_shape_v21_image_to_raw_mesh`, `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh`, `triposg_image_to_raw_mesh` |
| Image-to-3D | `trellis_image_to_3d` |
| Textured mesh | `stable_fast_3d_image_to_textured_mesh` |
| Texture painting | `hunyuan3d_paint_v21_image_mesh_painting`, `hunyuan3d_v20_paint_image_mesh_painting`, `trellis_image_mesh_painting` |
| Segmentation | `partfield_segmentation` |
| Retopology | `triflow_retopology` |
| UV | `partuv_uv_unwrapping` |
| Rigging | `skintokens_auto_rigging` |
| Motion | `ardy_motion_generation` |

These are configuration states, not GPU-validation claims. Checkpoint presence and host compatibility are runtime concerns.

## Intentionally disabled models

Unique3D, Pixal3D, TRELLIS.2, and TaoFlowForge are disabled in configuration and intentionally retained. No cleanup task may enable them or delete their adapter/support trees. A future model-enablement task must be explicit and separate.

## Data and execution constraints

- Preserve source uploads and generated assets; do not overwrite immutable versions.
- Use the existing backend database/storage owners rather than creating parallel metadata stores.
- Keep model-specific patches isolated under `patcher/<model-name>/`.
- Preserve native upstream behavior on modern GPUs (`sm >= 80`); pre-Ampere workarounds remain model-scoped.
- Do not claim successful inference from registry presence, syntax checks, or CPU-only CI.

## Explicit non-goals for this document

Do not treat old README/API prose about LOD bundles, physics/collision packaging, arbitrary FBX conversion, V4K FastMesh, server-side mesh streaming, or multi-view endpoints as current product guarantees unless the implementation and tests are re-verified.
