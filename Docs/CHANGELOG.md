# ForMesh3D Changelog

## 2026-11-01 — Documentation, ThirdParty Guide & Backend CI Audit

- Added a detailed ThirdParty root README with source-directory inventory, an intended-architecture Mermaid diagram, recursive-submodule workflow, dependency boundaries, and per-model license guidance.
- Audited current project documentation against the `dev` source tree; removed dead document/license links and corrected unsupported claims about adapter readiness, FastMesh V4K, generated-output rights, and current test coverage.
- Added `backend/tests/test_loader.py` for the shared model-weight path resolver and updated Backend Runtime Contract CI to stop invoking deleted adapter tests.
- Recorded the remaining source/API integration defects and the GPU-validation boundary in `Docs/MEMORY.md`, `Docs/ARCHITECTURE.md`, and `Docs/TASKS.md`.

---

## 2026-11-01 — Installer Script Refactor & Dependency Fix

- Standardized dependency installation through `$UV_PIP install` and removed the dead/redundant helper.
- Added visible wait/progress messages around potentially long dependency installation steps.
- Kept GPU-only model requirements separate from core/CPU-safe dependencies.
- Aligned CPU/CUDA PyTorch index handling and installer guards. The previous changelog records 8/8 compute-mode resolver checks; this documentation pass did not rerun them.

---

## 2026-11-01 — Adapter/Loader Integration Work Landed; Runtime Audit Still Open

- Added or updated 17 adapter modules, registry aliases, the shared weights resolver, and downloader support for `MODEL_STORAGE_ROOT`.
- Static inspection confirms model IDs are registered, but registration is not proof that each adapter imports and calls its upstream inference API correctly.
- The follow-up source audit found unresolved integration blockers in Pixal3D, Paint3D, UniRig, FastMesh V4K, the TRELLIS text-painting registry entry, and model identity propagation.
- `backend/loader.py` resolves `<MODEL_STORAGE_ROOT>/<model_key>` relative to the repository root when configured relatively, rejects absolute/traversal keys, and raises when the directory is missing.
- The downloader reads the same shared storage-root environment variable; path parity was source-inspected, not exercised with real model downloads.
- The original integration commit reported a successful Python compile and 26 fixes; those checks were not re-run in this documentation pass. GPU/checkpoint loading, geometry quality, peak VRAM, and supported-host smoke tests remain NOT RUN.
- The October 30 readiness disclosure remains applicable: model-specific load/inference/quality validation is required before calling any adapter production-ready.
