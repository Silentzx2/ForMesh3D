## 2026-11-01 — Installer Script Refactor & Dependencies Fix

- Fixed dependency installation in `backend/scripts/install.sh`: replaced inconsistent `uv_install` with `$UV_PIP install` and removed dead/redundant helper, ensuring consistent `$UV_PIP install` usage throughout.
- Added visual wait-notice banners and step progress messaging (`echo "========================================"`, "The installation may take a while, please wait...", `[INFO] Installing <dep>...`) across `requirements.txt`, `requirements-models.txt`, and custom GitHub/wheel dependencies.
- Added explicit support for installing model-specific dependencies from `requirements-models.txt` under GPU/CUDA compute mode.
- Aligned PyTorch CPU/CUDA index separation and CUDA guards with `scripts/tests/compute_mode_test.sh` (8/8 PASS) and `scripts/test_env_resolution.sh`.

---

## 2026-11-01 — Model-Integration Refactor Complete (All 17 Adapters Wired)

- Wired all 17 model adapters to their verified ThirdParty inference APIs (TRELLIS, TRELLIS.2, TRELLIS.2 painting, Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, Hunyuan3D-DiT-v2-mini-Turbo, Hunyuan3D legacy v21, Hi3D/SPARC3D, TripoSG, Unique3D, Pixal3D, TaoFlowForge, Paint3D, PartUV, ARDY, UniRig, FastMesh).
- Created `backend/loader.py`: shared model-weights resolver `get_model_weights_dir(model_key)` → `<MODEL_STORAGE_ROOT>/<model_key>`, default `backend/pretrained`, CWD-independent, rejects path traversal ("..") and absolute paths, raises `FileNotFoundError` for missing dirs.
- Patched `backend/scripts/download_models.sh` to read `MODEL_STORAGE_ROOT` env var (default `backend/pretrained`), resolved against project root not CWD — downloads and inference now agree on weights directory.
- Aligned all adapter seed defaults to `DEFAULT_SEED=42891` from `quality.yaml` `seeds.base_seed`; adapter pattern `seed = int(inputs.get("seed", DEFAULT_SEED))`.
- Fixed all 26 bugs across adapters, registry/scheduler, config/loader/download, and integration/contract layers.
- Rewrote `patcher/README.md` with per-model patch instructions; `patcher/` remains intentionally empty (no speculative patches).
- Verification: `python3 -m compileall -q backend/` → exit 0; all 34 ModelFactory registry entries resolve to BaseModel subclasses; adapter MODEL_KEYs resolve safely through loader.py; GPU/checkpoint inference NOT RUN (no torch/weights/GPU).

---

## 2026-10-30 — Model readiness disclosure

- Documented that manifest registration and checkpoint presence do not guarantee successful pipeline loading or valid mesh output.
- Recorded reported pipeline initialization/loading failures and broken-mesh outputs as unresolved, not yet attributed to specific model IDs.
- Added model-by-model GPU validation, mesh-quality, and triage requirements.
- GPU inference, checkpoint-load coverage, peak VRAM, and visual quality remain unverified unless explicitly recorded on supported hardware.
