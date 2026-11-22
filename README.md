# ForMesh3D

ForMesh3D is a self-hosted 3D asset studio built around a Next.js workspace, a FastAPI backend, model-specific adapters, and mesh-processing tools. This README describes the checked-in `dev` branch state as of 2026-11-22.

> **Important model-status rule:** `backend/config/models.yaml` is the source of truth for model enablement. An entry marked `enabled: true` is configured for discovery; that does not prove that its checkpoint is installed or that inference has been validated on the current machine. Disabled entries are intentionally retained.

## What is implemented

- Image-to-3D generation through the configured model adapters.
- Texture generation/painting through the enabled texture-capable adapters.
- Workspace tools for segmentation, retopology, UV unwrapping, auto-rigging, and motion generation.
- A local Three.js viewport. GLB assets are downloaded and parsed in the browser with `GLTFLoader`; the old server-side WebSocket/WebRTC mesh-streaming engine is not part of the current implementation.
- Workspace and job APIs, file upload/download, system status, logs, and database administration endpoints.
- A model registry backed by `backend/config/models.yaml` and `backend/core/scheduler/model_factory.py`.

Do not infer support for LOD packages, collision exports, FBX conversion, or other delivery features from old screenshots or historical documentation. Use the current API schema and implementation before relying on a feature.

## Model configuration

The following model families are configured as enabled in `backend/config/models.yaml`:

| Tool | Enabled model ID |
|---|---|
| Image-to-raw-mesh | `hunyuan3d_shape_v21_image_to_raw_mesh` |
| Image-to-raw-mesh | `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` |
| Image-to-raw-mesh | `triposg_image_to_raw_mesh` |
| Image-to-3D | `trellis_image_to_3d` |
| Textured mesh | `stable_fast_3d_image_to_textured_mesh` |
| Texture painting | `hunyuan3d_paint_v21_image_mesh_painting` |
| Texture painting | `hunyuan3d_v20_paint_image_mesh_painting` |
| Texture painting | `trellis_image_mesh_painting` |
| Segmentation | `partfield_segmentation` |
| Retopology | `triflow_retopology`, `fastmesh_v1k_retopology` |
| UV unwrapping | `partuv_uv_unwrapping` |
| Auto-rigging | `skintokens_auto_rigging` |
| Motion generation | `ardy_motion_generation` |

The following model families are intentionally disabled and retained in the repository: **Unique3D, Pixal3D, TRELLIS.2, and TaoFlowForge**. Their `enabled` flags must not be changed as part of cleanup. Their adapters, patchers, validation code, and supporting files must not be deleted merely because they are currently disabled.

## Architecture at a glance

- **Frontend:** Next.js 16, React 19, TypeScript, Three.js; Bun 1.4.2 is pinned in `package.json`.
- **Backend:** FastAPI, Python 3.10, Pydantic; API listens on port 7842 in the documented local setup.
- **Model selection:** `backend/config/models.yaml` + `ModelFactory.ADAPTER_REGISTRY`.
- **Runtime inventory:** `backend/adapters/__init__.py::_ADAPTER_MAP`, consumed by `backend/core/runtime_probe.py`.
- **Single-worker mode:** scheduler embedded in the FastAPI process.
- **Multi-worker mode:** API workers use Redis and a separate scheduler service.
- **Workspace identity:** `/workspace/generate/<workspace_id>`.
- **Persistent data:** `backend/storage/`; the SQLite job database is `backend/storage/job_queue.db` in the single-worker workspace flow.
- **Third-party source:** pinned Git submodule at `backend/thirdparty`.

See [Docs/ARCHITECTURE.md](Docs/ARCHITECTURE.md) for ownership and execution flow, [Docs/api-documentation.md](Docs/api-documentation.md) for route groups, and [Docs/MEMORY.md](Docs/MEMORY.md) for the audited current state.

## Setup

Requirements: Linux is the primary target; Python 3.10, Bun 1.4.2, Git, and a compatible NVIDIA/CUDA environment are needed for GPU inference. CPU-only setup is available for frontend, API, and supported CPU processing work.

```bash
git clone --recurse-submodules https://github.com/Silentzx2/ForMesh3D.git
cd ForMesh3D
bun install
bash scripts/setup.sh
```

To skip GPU-specific dependencies:

```bash
bash scripts/setup.sh --cpu
```

Start the local studio:

```bash
bash scripts/start.sh
```

Open `http://localhost:3000`. The backend API is available at `http://localhost:7842`; its generated OpenAPI/Swagger UI is at `http://localhost:7842/docs`.

Download only the model checkpoints you intend to use. A configured model is not necessarily installed locally.

## Verification

The checked-in CI workflows define the reproducible baseline:

```bash
# Frontend
bun install --frozen-lockfile
bun run test       # TypeScript check
bun run lint
bun test
bun run build

# Backend contracts (Python 3.10)
python -m compileall -q backend/adapters backend/api backend/core backend/pipelines backend/scripts backend/tests backend/utils backend/loader.py patcher scripts
python -m pytest -q backend/tests/test_batch1_regressions.py
python -m pytest -q backend/tests/test_batch3_queue_and_lifecycle.py backend/tests/test_workspace_regeneration.py backend/tests/test_batch4_api_integration.py
bash -n backend/scripts/download_models.sh
bash scripts/tests/compute_mode_test.sh
bash scripts/test_env_resolution.sh
```

The Python compile command covers first-party backend, patcher and project scripts; the pinned `backend/thirdparty` submodule is intentionally excluded because it is independently maintained upstream code. These checks do not download model weights or prove GPU inference. GPU/model validation must be reported separately and only after it has actually been run.

## Project rules

Read [AGENTS.md](AGENTS.md) before changing code. Keep changes minimal, trace the full call path, preserve model isolation, and update the relevant docs and tests in the same commit. Never enable or remove a model as part of unrelated cleanup.

## Documentation

- [Architecture](Docs/ARCHITECTURE.md)
- [Product requirements](Docs/PRD.md)
- [System blueprint](Docs/SYSTEM-BLUEPRINT.md)
- [API route guide](Docs/api-documentation.md)
- [Current state and verification](Docs/MEMORY.md)
- [Task and cleanup record](Docs/TASKS.md)
- [Design system](Docs/DESIGN.md)
- [Engineering rules](AGENTS.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](Docs/SECURITY.md)

For the complete request/response schemas, use the live OpenAPI document at `/openapi.json` or Swagger UI at `/docs`; do not treat a prose route guide as a replacement for the generated schema.
