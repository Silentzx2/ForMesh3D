# ForMesh3D Architecture

> Audited against the `dev` branch after the cleanup commit on 2026-11-22. This document describes checked-in wiring, not proof of successful model inference on a particular GPU.

## 1. System boundaries

| Layer | Primary owner | Responsibility |
|---|---|---|
| Studio routes and shell | `app/` | Next.js pages and route mounting |
| Workspace UI | `features/workspace/` | Generate, texture, remesh/retopo, UV, segmentation, rigging, animation, viewport |
| HTTP client | `services/apiClient.ts` | Frontend requests to the FastAPI API |
| API entrypoints | `backend/api/main_singleworker.py`, `backend/api/main_multiworker.py` | Middleware, lifecycle, router registration, deployment mode |
| API contracts | `backend/api/routers/` | Upload, generation, specialist tools, system and database endpoints |
| Model configuration | `backend/config/models.yaml` | Canonical model IDs, enablement, capabilities and resource declarations |
| Model construction | `backend/core/scheduler/model_factory.py` | Model ID to adapter class resolution |
| Runtime adapter inventory | `backend/adapters/__init__.py` | Module map read by `runtime_probe.py` |
| Inference | `backend/adapters/` | Model-specific loading and inference |
| Mesh operations | `backend/pipelines/` and specialist routers | Script-mode mesh processing and AI tool dispatch |
| Persistent workspace data | `backend/storage/` | Job database, uploaded files, workspaces and generated assets |
| Upstream model source | `backend/thirdparty/` | Pinned Git submodule; preserve upstream source and licenses |

## 2. Request and execution flow

1. The Next.js workspace collects the image/mesh and user-selected settings.
2. The request builder serializes the supported fields; `services/apiClient.ts` sends the request.
3. FastAPI validates the request in the owning router.
4. The scheduler/queue resolves the configured model and invokes the matching adapter or script pipeline.
5. The result and workspace metadata are persisted by the backend storage/database owners.
6. The frontend polls job/operation state and loads the resulting asset into the local viewport.

The model adapter owns its upstream API and model-specific runtime behavior. Do not move model-specific monkeypatches into shared global startup code.

## 3. Deployment modes

- **Single-worker:** `main_singleworker.py` embeds the scheduler in the API process. The workspace/job flow uses the local SQLite-backed job database.
- **Multi-worker:** `main_multiworker.py` connects API workers to Redis and a separate scheduler service. This is a separate deployment topology; do not describe it as the default single-worker queue.
- Both entrypoints register the system router under `/api/v1/system` and also mount direct `/api/v1` aliases. The direct aliases are retained for compatibility; the frontend's canonical system paths use `/api/v1/system`.

## 4. Model configuration and enablement

`backend/config/models.yaml` is authoritative for whether a model is enabled. The factory registry and runtime inventory are separate wiring layers and must both contain the appropriate adapter mapping.

Configured enabled model families:

| Feature | Model ID |
|---|---|
| Image-to-raw-mesh | `hunyuan3d_shape_v21_image_to_raw_mesh` |
| Image-to-raw-mesh | `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` |
| Image-to-raw-mesh | `triposg_image_to_raw_mesh` |
| Image-to-3D | `trellis_image_to_3d` |
| Textured mesh | `stable_fast_3d_image_to_textured_mesh` |
| Texture painting | `hunyuan3d_paint_v21_image_mesh_painting`, `hunyuan3d_v20_paint_image_mesh_painting`, `trellis_image_mesh_painting` |
| Segmentation | `partfield_segmentation` |
| Retopology | `triflow_retopology`, `fastmesh_v1k_retopology` |
| UV unwrapping | `partuv_uv_unwrapping` |
| Auto-rigging | `skintokens_auto_rigging` |
| Motion generation | `ardy_motion_generation` |

Intentionally disabled and retained: **Unique3D, Pixal3D, TRELLIS.2, TaoFlowForge** (including their configured aliases/painting entries). Cleanup must not toggle their enablement or remove their adapters, patchers, validators, configuration, or model-specific support code.

Enablement means the config exposes a model for selection. It does not guarantee installed weights, dependency readiness, or GPU validation.

## 5. Workspace and viewport

- Workspace deep links use `/workspace/generate/<workspace_id>`.
- Workspace/asset state is persisted by backend storage and database code; `metadata.json` is not a substitute for the authoritative database state.
- The current viewport uses local `GLTFLoader` parsing and `glbCache` in the browser.
- The old WebSocket/WebRTC server-side mesh streaming implementation was removed. Do not reintroduce its routers, hooks, or viewer.
- `meshStats.ts` is used by the current viewer. `meshTelemetry.ts` was a separate unreferenced utility and is not part of the active render path.

## 6. API router ownership

| Route family | Router |
|---|---|
| System, jobs, workspace state, logs, storage | `backend/api/routers/system.py` |
| Database administration | `backend/api/routers/database.py` |
| File upload and metadata | `backend/api/routers/file_upload.py` |
| Generation and texture | `backend/api/routers/mesh_generation.py` |
| Retopology | `backend/api/routers/mesh_retopology.py` |
| Segmentation | `backend/api/routers/mesh_segmentation.py` |
| UV unwrapping | `backend/api/routers/mesh_uv_unwrapping.py` |
| Auto-rigging | `backend/api/routers/auto_rigging.py` |
| Motion | `backend/api/routers/motion_generation.py` |

`script_execution.py` contains shared helpers imported by specialist routers; it is not an unused standalone router. Several API endpoints have no current frontend caller but remain externally addressable API contracts, so lack of a UI caller alone is not a safe deletion reason.

## 7. Runtime inventory invariant

`backend/core/runtime_probe.py` reads `_ADAPTER_MAP` to report installed adapters. `ModelFactory.ADAPTER_REGISTRY` resolves model IDs to adapter classes. The runtime map must include the active specialist IDs `triflow_retopology`, `fastmesh_v1k_retopology`, and `partfield_segmentation`; a regression test protects this mapping.

## 8. Third-party and compatibility code

The `backend/thirdparty` submodule is pinned and contains upstream model source. Compatibility modules used by that source must not be removed based only on the absence of imports in the first-party tree. The audit therefore preserves the Hunyuan paint compatibility utilities, `torchvision_fix.py`, `dinov3_vit.py`, and disabled TRELLIS.2 support/validation files.

## 9. Verification

Use the commands in [CONTRIBUTING.md](../CONTRIBUTING.md). CI compiles first-party Python packages/scripts (excluding the pinned third-party submodule), runs selected backend contracts, and runs frontend type-check, lint, tests and production build. The pinned TRELLIS source currently has a separate upstream syntax error; it is not included in the first-party syntax gate. These checks do not execute full model inference or certify GPU performance.
