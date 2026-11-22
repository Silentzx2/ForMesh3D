# Contributing to ForMesh3D

Thank you for contributing to ForMesh3D.

ForMesh3D is an active beta phase project combining a Next.js 16 frontend, FastAPI backend, GPU model adapters, and production-oriented 3D post-processing. Contributions should preserve the existing architecture and keep changes focused.

## Before changing code

1. Read [AGENTS.md](AGENTS.md) first.
2. Read the relevant document in [Docs/](Docs/) before changing architecture, APIs, UI conventions, or runtime behavior.
3. Trace the existing flow and identify the root cause before adding a workaround.
4. Prefer existing helpers, services, dependencies, and contracts.
5. Keep the smallest correct diff.
6. Update relevant documentation in the same change.

## Development baseline

- Linux
- NVIDIA GPU with a CUDA 12.4-compatible driver for model inference
- Python 3.10
- Conda environment: `3daigc-api`
- PyTorch 2.6.0 + CUDA 12.4
- Bun
- Git

## Setup

```bash
git clone --recurse-submodules https://github.com/Silentzx2/ForMesh3D.git
cd ForMesh3D
bash scripts/setup.sh
```

### CPU-only setup (no NVIDIA GPU)

If you do not have an NVIDIA GPU, run setup in CPU mode. Model/CUDA dependencies are skipped; the studio, API, and post-processing tools remain available.

```bash
git clone --recurse-submodules https://github.com/Silentzx2/ForMesh3D.git
cd ForMesh3D
bash scripts/setup.sh --cpu
```

Use `--cpu` to force CPU mode even if a GPU is present, or `--gpu` to force CUDA mode. Use `--with-thirdparty` to initialize third-party model sources.

Third-party model sources are pinned as the `backend/thirdparty` Git submodule. You do not need to clone that repository separately; use `--recurse-submodules` on first clone, or let `scripts/setup.sh` initialize it with `git submodule update --init --recursive`. See [the ThirdParty source guide](backend/thirdparty/README.md).

The maintained Wheels release is used for compatible prebuilt Python wheels; the installer falls back to source/index installation when a compatible wheel is unavailable.

## Backend development

- Model adapters belong in `backend/adapters/`.
- API routes belong in `backend/api/routers/`.
- Scheduler code belongs in `backend/core/scheduler/`.
- Model patchers and GPU compatibility belong in `patcher/` (`patcher/doctor.py` for GPU Doctor; `patcher/<model-name>/` for model-specific patchers).
- Configuration belongs in `backend/config/`.
- Backend scripts belong in `backend/scripts/`.
- Keep adapter imports lazy.
- Preserve upstream source, license notices, and attribution.
- Reuse canonical model configuration and registry contracts rather than adding parallel registration paths.

## Frontend development

- Routes live under `app/`.
- Workspace features live under `features/workspace/`.
- API calls use `services/apiClient.ts`.
- Global client state uses Zustand.
- Server state uses TanStack Query.
- Heavy workspace panels should use `next/dynamic` where appropriate.
- Use the HSL design tokens defined by `app/globals.css`; do not introduce isolated color literals.

## Verification

Run the checks used by the checked-in CI workflows when changing the corresponding area.

### Frontend

```bash
bun install --frozen-lockfile
bun run test       # TypeScript: tsc --noEmit
bun run lint
bun test
bun run build
```

### Backend

```bash
python -m compileall -q backend/adapters backend/api backend/core backend/pipelines backend/scripts backend/tests backend/utils backend/loader.py patcher scripts
python -m pytest -q backend/tests/test_batch1_regressions.py
python -m pytest -q backend/tests/test_batch3_queue_and_lifecycle.py backend/tests/test_workspace_regeneration.py backend/tests/test_batch4_api_integration.py
bash -n backend/scripts/download_models.sh
bash scripts/tests/compute_mode_test.sh
bash scripts/test_env_resolution.sh
```

The backend compile check covers first-party Python packages and scripts. It deliberately excludes the pinned `backend/thirdparty` submodule; upstream syntax defects there are tracked separately and must not block validation of this repository's own Python sources. The backend CI suite is a selected contract suite, not a full GPU inference test. The frontend CI suite runs type-check, lint, tests and a production build. GPU/model validation requires the appropriate host, installed checkpoints and a separate recorded run. Do not report a model as verified from registry presence or CPU-only tests.

## Pull requests

Keep pull requests focused. Include:

- What changed and why.
- Root cause for bug fixes.
- Verification performed.
- GPU/runtime validation performed, if available.
- Breaking changes or known limitations.
- Screenshots for UI changes when useful.

Never commit credentials, model checkpoints, private URLs, or generated secrets.

## Security

Do not disclose security vulnerabilities in public issues. Follow [Docs/SECURITY.md](Docs/SECURITY.md).

## Documentation

When behavior, configuration, architecture, API contracts, installation, or UI conventions change, update the relevant documentation before the change is considered complete.

## 2026-10-08 Implementation Note

Changes in the high-fidelity generation path must preserve all existing model adapters, keep master assets immutable, and route multi-GPU loading only through declared supported strategies. Resource and quality changes should include non-hardware tests and update the relevant `Docs/` documentation in the same commit.
