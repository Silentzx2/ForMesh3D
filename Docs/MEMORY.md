# ForMesh3D — Project Current State

**Branch**: `dev` → `origin/dev`  
**Phase**: BETA  
**Status**: Model-integration refactor complete. All 17 adapters wired to verified ThirdParty inference APIs.

## Core artifacts

- `backend/loader.py` — shared model-weights resolver `get_model_weights_dir(model_key)` → `<MODEL_STORAGE_ROOT>/<model_key>`, default `backend/pretrained`, CWD-independent, rejects path traversal ("..") and absolute paths, raises `FileNotFoundError` for missing dirs.
- `patcher/README.md` — rewritten with per-model patch instructions; `patcher/` intentionally empty (no speculative patches).
- `backend/scripts/download_models.sh` — reads `MODEL_STORAGE_ROOT` env var, resolved against project root; downloads and inference agree on `<MODEL_STORAGE_ROOT>/<model_key>`.
- `backend/scripts/install.sh` — consistent `$UV_PIP install` usage, wait-notice banners for `requirements.txt`, `requirements-models.txt` (GPU mode), and custom GitHub/wheel dependencies, PyTorch CPU/CUDA test guard compliance.
- `Docs/BUGS.md` — deleted per user request.

## Adapter state (all 17 fully wired)

| Adapter | MODEL_KEY | ThirdParty API | Seed default |
|---|---|---|---|
| trellis_adapter | TRELLIS | TrellisImageTo3DPipeline | 42891 |
| trellis2_adapter | TRELLIS.2 | Trellis2ImageTo3DPipeline.from_pretrained + .run(image, seed) | 42891 |
| trellis2_paint_adapter | TRELLIS | TRELLIS.2 texturing | 42891 |
| hunyuan3d_shape_v21 | HUNYUAN3D_SHAPE_V21 | Hunyuan3DDiTFlowMatchingPipeline | 42891 |
| hunyuan3d_paint_v21 | HUNYUAN3D_PAINT_V21 | Hunyuan3D-Paint | 42891 |
| hunyuan3d_dit_v2_mini_turbo | HUNYUAN3D_DIT_V2_MINI_TURBO | Hunyuan3DDiTFlowMatchingPipeline | 42891 |
| hunyuan3d_adapter_v21 | HUNYUAN3D_ADAPTER_V21 | Hunyuan3DDiTFlowMatchingPipeline (+Hunyuan3DV21ImageMeshPaintingAdapter alias) | 42891 |
| hi3d_adapter | HI3D | Sparc3DPipeline | 42891 |
| triposg_adapter | TRIPO_SG | TripoSGPipeline + run_triposg + RMBG-1.4 | 42891 |
| unique3d_adapter | UNIQUE3D | Unique3D pipeline | 42891 |
| pixal3d_adapter | PIXAL3D | Pixal3D pipeline | 42891 |
| taoflowforge_adapter | TAOFLOWFORGE | TaoFlowForgePipeline.from_config + iter_run | 42891 |
| paint3d_adapter | PAINT3D | Paint3D pipeline | 42891 |
| partuv_adapter | PARTUV | PartUV preprocess + pack | 42891 |
| ardy_adapter | ARDY | ARDY motion generation (CPU-only) | 42891 |
| unirig_adapter | UNIRIG | UniRig run.py | 42891 |
| fastmesh_adapter | FASTMESH | FastMesh inference | 42891 |

## Configuration (single source of truth)

- `backend/config/models.yaml` — 24 model entries. `PartUV model_path` fixed to directory `backend/pretrained/PartUV`. Orphan `fastmesh_v4k_retopology` entry removed.
- `backend/config/quality.yaml` — `seeds.base_seed=42891`; duplicate `shared.feature_edge_angle_deg` block removed (SSOT).
- `backend/config/smart_presets.yaml` — output preset recipes (mobile, game_ready, cinematic, animation, 3d_print, native).
- `backend/config/planner_rules.yaml` — planner execution rules; `shared.feature_edge_angle_deg: 35.0` lives here (not duplicated in quality.yaml).

## Registry & scheduler

- `backend/core/scheduler/model_factory.py` — ADAPTER_REGISTRY with 34 entries; all resolve to BaseModel subclasses. `pixal3d_image_to_3d → Pixal3DImageToRawMeshAdapter` added. `create_model_from_config` calls `cls.validate_config(config)` before instantiation.
- `backend/core/scheduler/multiprocess_scheduler.py` — auto-seed preserves `quality.yaml` base_seed=42891 (no random clobber). Strips `_ADAPTER_OWNED_INFERENCE_INPUTS` + post-process fields; `"paint3d"` and `"paint3d_image_mesh_painting"` in `_ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS`. `import random` removed.

## BaseModel & API contract

- `backend/core/models/base.py` — `model_id`, `model_path` optional with defaults + `**kwargs`. `_process_request` return shape documented `(success, output_mesh_path/mesh_path, generation_info)`.
- `backend/api/routers/mesh_generation.py` — `seed: Optional[int]` added to 4 request models (ImageToRawMeshRequest, TextMeshPaintingRequest, ImageMeshPaintingRequest, MeshPaintingRequest).

## Verification

- `python3 -m compileall -q backend/` → exit 0.
- `bash scripts/tests/compute_mode_test.sh` → 8/8 PASS.
- `bash scripts/test_env_resolution.sh` → PASS.
- 34/34 ModelFactory registry entries resolve to BaseModel subclasses.
- All adapter MODEL_KEYs resolve safely through loader.py; traversal/absolute → ValueError; missing → FileNotFoundError.
- **GPU inference / weight loading**: NOT RUN — no GPU, no torch, no weights installed. CPU CI does not cover checkpoint inference.
- **pytest / tsc / bun**: NOT RUN — sqlalchemy/pytest and node_modules/typescript not installed.

## What was fixed (26 bugs)

Adapter: B1 (taoflowforge tempfile import), B2-B5 (painting adapters `_process_request` overrides), B6 (Pixal3D camera formula), B7 (FastMesh seeded randomness), B8 (TRELLIS.2 `formats` kwarg), B9 (PartUV preprocess signature), B10 (Hi3D coarse_mesh Trimesh).
Config/loader/download: C1 (PartUV model_path dir not file), C2 (TRELLIS painting MODEL_KEYs), C3 (orphan FastMesh-V4K config entry), C4 (duplicate quality.yaml key).
Registry/scheduler: R1 (scheduler auto-seed random clobber), R2 (pixal3d registry entry), R3 (validate_config call), R4 (paint3d stripping set).
Integration/contract: I1 (__init__.py accuracy), I2 (BaseModel constructor), I3 (seed fields in API models), I5 (pipeline.py comment), I7 (Paint3D import loop), I8 (BaseModel docstring).

## Notes

- `RULES.md` does not exist as a separate file — rules live inline in `AGENTS.md`.
- `Docs/MODEL-STATUS.md`, `Docs/EXPERIMENTAL-MODEL-SETTINGS.md`, `Docs/GENERATION-UI-CONTRACT.md`, `Docs/GENERATION-CONTROL-AUDIT.md`, `Docs/ROUTE-MOUNT-AUDIT.md` referenced by older docs do not exist on disk.
- `backend/thirdparty/hunyuan3d_decoder_profile.py` referenced in ARCHITECTURE.md/DECISIONS.md does not exist — reference removed from both docs.
- No credentials, API keys, tokens, or secrets found or preserved in any doc.
