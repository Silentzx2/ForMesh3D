# Completed Sprint: Unified Workspace Endpoints

## Goal
Consolidate the workspace API around seven canonical POST routes, reuse the existing request validation and scheduler handlers, remove retired route names rather than maintaining aliases, and keep workspace/database operation contracts intact.

## 1. Canonical API
| Method | Route | Existing handler responsibility |
|---|---|---|
| POST | `/api/v1/generate` | Image-to-mesh generation; selected model registration decides raw vs textured-only feature |
| POST | `/api/v1/texture` | Image-reference or text-prompt painting of an existing mesh |
| POST | `/api/v1/retopo` | Existing FastMesh retopology handler |
| POST | `/api/v1/unwrap` | Existing UV-unwrapping handler |
| POST | `/api/v1/rig` | Existing SkinTokens auto-rigging handler |
| POST | `/api/v1/motion` | Existing ARDY motion handler |
| POST | `/api/v1/segment` | Existing mesh-segmentation handler |

Utility endpoints such as model lists, format metadata, ARDY checkpoints, job status, downloads, cancellation, and `/api/v1/mesh-tools/*` remain on their existing resource paths.

## 2. Backend Integration
- The existing image-to-raw handler is mounted directly at `/generate`; there is no second generation handler for textured-only geometry.
- Model feature resolution sends textured-only registered models to `image_to_textured_mesh`; raw-capable models remain on `image_to_raw_mesh`, including when their optional texture stage is enabled.
- The SQLite operation type matches the selected generation feature: `generate_raw_mesh` or `generate_textured_mesh`. Workspace identity, operation IDs, regeneration lineage, queue metadata, and response envelopes remain unchanged.
- Existing text/image mesh-painting handlers are internal helpers called by the single `/texture` route. Image input selects image-guided painting; a prompt without an image selects text-guided painting.
- Existing specialist handlers are mounted at the canonical route roots. Their request models, JobRequest feature names, operation types, and scheduler behavior are preserved.
- Both single-worker and multi-worker app entrypoints mount the same canonical routes.
- The obsolete `mesh_editing.py` router and its mount/import are removed. No legacy route aliases or redirect handlers are mounted.

## 3. Frontend Integration
- `buildGenerationParameters.ts` emits only `/api/v1/generate`; the backend resolves the model's feature.
- `buildTextureGenerationParameters.ts` emits only `/api/v1/texture` and supports both image-guided and prompt-only painting.
- Workspace retopo, UV, segmentation, rigging, and motion callers use `/retopo`, `/unwrap`, `/segment`, `/rig`, and `/motion`.
- The dead text/image mesh-editing execution callback and context contract are removed.
- The generic Next.js API proxy remains path-transparent and forwards canonical paths without buffering or route aliases.

## 4. Verification
- Regression coverage in `backend/tests/test_batch4_api_integration.py` checks raw/textured-only feature dispatch, durable operation type and workspace response, specialist operation wiring, and absence of old route mounts.
- Frontend contract tests cover the canonical generation endpoint, unified texture serialization (image and prompt-only), and path-transparent proxy forwarding.
- TypeScript, Bun, pytest, Python compilation, and shell checks are the branch-CI verification gate for this remote change. GPU inference is not part of this endpoint-only migration.
