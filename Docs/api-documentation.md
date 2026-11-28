# ForMesh3D API Route Guide

> **Base URL:** `http://localhost:7842`  
> **API prefix:** `/api/v1`  
> **Live schema:** `/openapi.json` and `/docs`  
> **Audited:** 2026-11-26

This guide describes the route groups registered by the current FastAPI entrypoints. The generated OpenAPI schema is authoritative for request fields, response models, status codes and optional parameters. Do not rely on historical example payloads in older documentation.

## Deployment and router mounts

Both `backend/api/main_singleworker.py` and `backend/api/main_multiworker.py` register:
- System router at `/api/v1/system`.
- The same system router at `/api/v1` as direct compatibility aliases.
- Database router at `/api/v1/system/database`.
- Feature routers under `/api/v1`.

The frontend uses `/api/v1/system/...` for canonical system requests. The direct aliases are retained for compatibility and are not duplicate dead routes.

## Health and system

Canonical system routes include:
- `GET /api/v1/system/health`
- `GET /api/v1/system/info`
- `GET /api/v1/system/status`
- `GET /api/v1/system/stats`
- `GET /api/v1/system/models`
- `GET /api/v1/system/models/{model_id}/parameters`
- `GET /api/v1/system/features`
- `GET /api/v1/system/scheduler-status`
- `GET /api/v1/system/jobs/{job_id}`
- `GET /api/v1/system/jobs/history`
- `GET /api/v1/system/jobs/{job_id}/info`
- `GET /api/v1/system/jobs/{job_id}/download`
- `GET /api/v1/system/jobs/{job_id}/thumbnail`
- `GET /api/v1/system/jobs/{job_id}/input`
- `POST /api/v1/system/jobs/{job_id}/cancel`
- `DELETE /api/v1/system/jobs/{job_id}`
- `GET /api/v1/system/workspace/generate/{workspace_id}` (canonical deep-link lookup)
- `GET /api/v1/system/workspace/{workspace_id}` (retained compatibility alias)
- `GET /api/v1/system/workspace/operations/{operation_id}`
- `POST /api/v1/system/workspace/operations/{operation_id}/cancel`
- `DELETE /api/v1/system/workspace/{workspace_id}` (`?permanent=false` moves to `/tmp/formesh3d_trash`; `true` deletes permanently)
- `DELETE /api/v1/system/workspace/{workspace_id}/assets/{asset_id}` (trash/delete a single derived version)
- `GET /api/v1/system/trash`, `POST /api/v1/system/trash/{trash_id}/restore`, `DELETE /api/v1/system/trash/{trash_id}`, `DELETE /api/v1/system/trash`

The system router also exposes operational routes for queue statistics/reordering, storage reporting/cleanup, temporary cache cleanup, logs, result deletion, and candidate download/thumbnail/selection. Inspect `/docs` for their exact current schemas.

Completed job status includes a compact `operation` object when the SQLite operation row is available. Its `input_asset_id` identifies the exact retained mesh consumed by a workspace operation; the ID can be resolved through the job-download route. The workspace operation status endpoint also exposes `input_asset_id` and `parent_operation_id` at the top level. This lineage is used by the viewport before/after comparison after a workspace is reloaded.

### Logs

- `GET /api/v1/system/logs`
- `POST /api/v1/system/logs`
- `GET /api/v1/system/logs/stream` (SSE)
- `GET /api/v1/system/logs/files`
- `GET /api/v1/system/logs/files/{filename}`
- `DELETE /api/v1/system/logs/files/{filename}`
- `GET /api/v1/system/logs/config`
- `PUT /api/v1/system/logs/level`

The current log stream is Server-Sent Events. The removed WebSocket mesh-streaming engine is not an API capability.

## File upload

Router prefix: `/api/v1/file-upload`.

- `POST /image`
- `POST /mesh` — normal upload creates a new workspace; the viewport orientation save supplies both `workspace_id` and `asset_id` to replace that retained GLB in place, preserving the existing asset identity.
- `GET /metadata/{file_id}`
- `DELETE /{file_id}`
- `GET /list`
- `GET /count`
- `GET /thumbnail/{file_id}`
- `GET /download/{file_id}`
- `GET /supported-formats`

The metadata route is covered by the repository contract verification script. It remains available even though the unused frontend wrapper was removed.

## Generation and texture

- `POST /api/v1/generate`
- `POST /api/v1/texture`
- `GET /api/v1/generate/supported-formats`
- `POST /api/v1/generate/cancel/{job_id}`

## Specialist tools

| Tool | Main route | Metadata routes |
|---|---|---|
| Auto-rigging | `POST /api/v1/rig` | `GET /api/v1/rig/supported-formats`, `GET /api/v1/rig/available-models` |
| Segmentation | `POST /api/v1/segment` | `GET /api/v1/segment/readiness`, `GET /api/v1/segment/supported-formats`, `GET /api/v1/segment/available-models` |
| Retopology | `POST /api/v1/retopo` | `GET /api/v1/retopo/supported-formats`, `GET /api/v1/retopo/available-models` |
| UV unwrapping | `POST /api/v1/unwrap` | `GET /api/v1/unwrap/supported-formats`, `GET /api/v1/unwrap/pack-methods`, `GET /api/v1/unwrap/available-models` |
| Motion | `POST /api/v1/motion` | `GET /api/v1/motion/checkpoints`, `GET /api/v1/motion/available-models`, `GET /api/v1/motion/supported-formats` |

Retopology, segmentation and UV are scheduler-backed AI routes. Their request models do not expose a Script-engine discriminator; consult the live OpenAPI schema for exact fields.

`GET /api/v1/segment/readiness` reports whether PartField has a CUDA runtime, a complete Objaverse checkpoint, the vendored inference source, and its required Python modules. The Segmentation panel disables the run action when this probe is unavailable. This is an installation/readiness probe, not a promise that every mesh will fit the GPU or produce a successful inference.

When `save_individual_parts=true`, PartField saves each generated part as an independent workspace mesh asset and writes a ZIP archive. Download the saved parts using the completed combined mesh asset ID: `GET /api/v1/system/jobs/{asset_id}/download?artifact_format=zip`. The combined colored GLB remains the active segmentation result.

## Motion clips (ARDY & user uploads)

Router prefix: /api/v1/motion. Motion clips use normalized MotionClipV1 (schema version 1, quaternion_xyzw rotations, source-supported y_up axis, source_native translation units). Handedness and physical units are not asserted until a real NPZ from the supported checkpoint is verified.

Prompt generation via `POST /api/v1/motion` uses the ARDY motion core on CPU and its local LLM2Vec text encoder on one CUDA GPU with bitsandbytes NF4 4-bit quantization; the scheduler reserves 6144 MiB for the encoder. The encoder checkpoints require the Hugging Face access described in the pinned ARDY README. Missing or failed prompt-encoder initialization fails the job rather than silently generating unconditional motion.

- GET /api/v1/motion/presets — List bundled, read-only premade presets from backend/motion_presets/. Only approved tracked NPZ files are listed.
- GET /api/v1/motion/presets/{id}/thumbnail — Serve a sibling PNG/WEBP thumbnail for a validated premade preset ID; no arbitrary file serving.
- GET /api/v1/motion/clips/{clip_id} — Return normalized MotionClipV1 for a premade ID, user preset ID (upl_ or gen_), or completed ARDY job/asset ID. No filesystem paths are exposed.
- GET /api/v1/motion/clips/{clip_id}/download — Download the raw `.npz` file for a premade, user, or completed ARDY job clip.
- POST /api/v1/motion/clips/preview — Multipart file (.npz). Temporary validation/preview only; never persists to storage or either preset library.
- GET /api/v1/motion/uploads — List user-owned uploaded/generated presets from backend/storage/presets/<preset_id>/; entries include source: uploaded | generated.
- POST /api/v1/motion/uploads — Validate and persist an uploaded NPZ as backend/storage/presets/<upl_id>/motion.npz with one metadata.json in that preset directory.
- POST /api/v1/motion/uploads/from-clip/{clip_id} — Copy a completed ARDY job/asset NPZ into a deterministic gen_<hex12> user preset. Repeated calls for the same immutable source are idempotent.
- DELETE /api/v1/motion/uploads/{clip_id} — Delete only the identified user preset directory. Legacy flat backend/storage/motion_uploads/ files remain readable during migration; new writes never target that directory.

- POST /api/v1/motion/workspaces/{workspace_id}/animations — Multipart GLB plus source_asset_id, motion_clip_id and clip_name. Stores a separate immutable animated_mesh asset and copies the validated source NPZ into the workspace animation version folder.
- GET /api/v1/motion/workspaces/{workspace_id}/animations — List only DB-registered animated assets whose files still resolve inside the workspace.
- GET /api/v1/motion/workspaces/{workspace_id}/animations/{asset_id}/download — Download one verified animated GLB from its owning workspace.

Evidence gate: parser unit tests use synthetic NPZ fixtures. Real checkpoint output has not yet been supplied/verified, so end-to-end retargeting, handedness, and physical translation units remain unverified.


## Database administration

Router prefix: `/api/v1/system/database`.

- `GET /stats`
- `GET /keys`
- `DELETE /jobs`
- `POST /jobs/clear`
- `DELETE /files/clear`
- `GET /jobs/{job_id}/verify`

Destructive routes have confirmation and authorization requirements. Always inspect the live schema and current backend implementation before calling them.

## Contract and compatibility policy

- An endpoint with no frontend caller is not automatically dead; external clients, scripts, docs or API compatibility may depend on it.
- This cleanup removed unused TypeScript client wrappers, not the backend endpoints.
- The system direct aliases at `/api/v1` remain mounted for compatibility.
- No user-management or WebSocket mesh-streaming routes should be assumed from old documentation.
- Use `GET /api/v1/system/models` and `backend/config/models.yaml` to inspect model availability. A configured model is not proof of installed weights or successful inference.
