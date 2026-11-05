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

Run checks relevant to your change:

```bash
# Frontend type-check (same command as `bun run test` and the Frontend CI job)
npx tsc --noEmit

# Frontend unit tests (node:test files under features/workspace/lib/*.test.mjs
# and app/api/v1/[...path]/route.test.mjs)
bun test

# Frontend lint and production build
bun run lint
bun run build

# Backend test suite (35 tests: GPU Doctor hardware diagnostics & TRELLIS.2 validation)
python -m pytest -v backend/tests/

# Verify clean compilation across all Python modules
python3 -m py_compile patcher/doctor.py patcher/__init__.py backend/tests/*.py

# Verify shell script syntax
bash -n manager.sh backend/scripts/*.sh scripts/*.sh
```

The current backend test suite covers Python source compilation, shell syntax, GPU Doctor hardware diagnostics / query-chunked SDPA equality (`backend/tests/test_gpu_doctor.py`), and the checked-in TRELLIS.2 raw-mesh validation contract (`backend/tests/test_trellis2_mesh_validation.py`). Blender-stage validation and GPU/model inference require the full `3daigc-api` environment on an appropriate host.

### Continuous integration

Two GitHub Actions workflows live under `.github/workflows/`:

- **Backend Runtime Contract CI** (`.github/workflows/backend-runtime-ci.yml`): compiles Python sources, checks shell syntax, and runs `backend/tests/test_trellis2_mesh_validation.py` on Python 3.10. This covers raw-mesh array validation only; it does not load checkpoints or prove GPU inference.
- **Frontend CI** (`.github/workflows/frontend-ci.yml`): installs dependencies with Bun, runs the TypeScript type-check (`bun run test`), all Bun contract tests (`bun test`), and the production build (`bun run build`).

The backend workflow runs on pushes and pull requests targeting `main` and `dev`; the frontend workflow runs on pushes to `dev` and on pull requests targeting `dev` or `main`. Local verification should mirror the CI commands before opening a pull request.

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
