# Engineering Implementation Plan: SkinTokens Integration & Complete UniRig Decommissioning

**Status**: ACTIVE / EXECUTION READY  
**Primary Goal**: Completely decommission and eliminate UniRig across all layers of the codebase (adapters, thirdparty, configs, schedulers, API routers, frontend UI, docs) and seamlessly integrate **SkinTokens** (VAST-AI-Research/SkinTokens, arXiv:2602.04805) as the production auto-rigging engine.

---

## 1. Why & What (Executive Technical Brief)

### Why Replace UniRig with SkinTokens?
- **Root Cause Problem with UniRig**:
  UniRig was an early two-phase rigging system with disconnected stages (skeleton prediction via Pointcept / diffusion, followed by skinning weight prediction). This caused severe bleeding artifacts across disconnected mesh components (e.g. wings, hair, clothing, weapons), poor joint placement, and high failure rates on complex non-humanoid meshes.
- **Why SkinTokens (TokenRig)**:
  Published in 2025/2026 by VAST AI Research ([arXiv:2602.04805](https://arxiv.org/abs/2602.04805)), **SkinTokens** is the direct successor to UniRig.
  1. **Unified Autoregressive Formulation**: Combines skeleton structure and skinning weights into a single sequence of discrete tokens using an autoregressive Transformer (Qwen3-0.6B architecture).
  2. **FSQ-CVAE Tokenizer**: Finite Scalar Quantization (FSQ) discrete compression of sparse skinning weights into compact discrete tokens without codebook collapse.
  3. **RL Refinement via GRPO**: Group Relative Policy Optimization with geometric containment, volumetric joint coverage, deformation smoothness, and sparsity rewards.
  4. **Performance Gain**: Delivers **98%–133%** higher skinning accuracy and **17%–22%** better bone prediction accuracy over UniRig baselines, with clean localized weight influence and zero bleeding.
  5. **Licensing**: Permissive **MIT License** (commercial use permitted).

---

## 2. What Gets Cleaned & Removed (UniRig Elimination Inventory)

| Layer | Component to Remove | Replacement / Action |
|---|---|---|
| **Vendored Submodule** | `backend/thirdparty/UniRig/` | **DELETED**; replaced by `backend/thirdparty/SkinTokens/` |
| **Model Adapter** | `backend/adapters/unirig_adapter.py` | **DELETED**; replaced by `backend/adapters/skintokens_adapter.py` |
| **Configuration** | `backend/config/models.yaml` (`unirig_auto_rig`) | Removed `unirig_auto_rig`; declared `skintokens_auto_rigging` |
| **Model Registry** | `backend/core/planner.py` | Mapped `skintokens_auto_rigging` -> `SkinTokensAdapter` (alias preserved for backwards compatibility) |
| **Scheduler** | `backend/core/scheduler/multiprocess_scheduler.py` | Auto-rig pipeline step dispatches `skintokens_auto_rigging` |
| **API Endpoints** | `backend/api/routers/auto_rigging.py` | Default model preference updated to `skintokens_auto_rigging` |
| **System Router** | `backend/api/routers/system.py` | Storage categorizer, download support, and FBX export details updated |
| **Postprocessing** | `backend/postprocess/services/rigging.py` | Entrypoint updated to load `SkinTokensAdapter` |
| **Downloader** | `backend/scripts/download_models.sh` | Removed `download_unirig`; added `download_skintokens` fetching official checkpoints |
| **Frontend Config** | `constants/models.ts` | Removed UniRig model entry; added `skintokens_auto_rigging` ("SkinTokens") |
| **Frontend UI** | `features/workspace/Rigging/RiggingStudio.tsx`, `RiggingLeftPanel.tsx`, `CommandPalette.tsx`, `GeneratePanel.tsx` | All "UniRig" user-facing copy and tooltips migrated to "SkinTokens AI" |
| **Dependencies** | `backend/requirements-models.txt` & `.gitignore` | UniRig-specific packages cleaned; SkinTokens dependencies added |
| **Documentation** | `README.md`, `Docs/PRD.md`, `Docs/ARCHITECTURE.md`, `Docs/SYSTEM-BLUEPRINT.md`, `Docs/DESIGN.md`, `Docs/MEMORY.md`, `Docs/CHANGELOG.md` | All architectural inventories and pipeline diagrams updated |

---

## 3. How: Implementation Phases & Task Checklist

### Phase 1: Thirdparty Submodule & Legal Directory (COMPLETED)
- [x] Delete `backend/thirdparty/UniRig/` from repository tracking.
- [x] Vendor and stage `backend/thirdparty/SkinTokens/`.
- [x] Update `backend/thirdparty/LICENSE` table & detail sections to MIT-licensed SkinTokens.
- [x] Update `backend/thirdparty/README.md` catalog table & open-source advisory.
- [x] Commit and push `backend/thirdparty` to remote `main` branch (commit `9d63874`).
- [x] Update submodule pointer in main repo and push to remote `dev` branch (commit `d638b9a`).

### Phase 2: Model Configuration & Weight Downloader
- [x] Update `backend/config/models.yaml`:
  - Define `skintokens_auto_rigging` under feature `auto_rig` / `mesh_to_rigged_mesh`.
  - Upstream repository: `https://github.com/VAST-AI-Research/SkinTokens`.
  - Model path: `backend/pretrained/SkinTokens`.
  - VRAM requirement: 14336 MB (14 GB).
  - Capabilities: `auto_rig: true`, `character_output: true`, `native_topology: false`.
  - Supported inputs: `["glb", "obj", "fbx"]`, supported outputs: `["glb", "fbx"]`.
- [x] Update `backend/scripts/download_models.sh`:
  - Replace `download_unirig` with `download_skintokens`.
  - Download official checkpoints from `VAST-AI/SkinTokens`:
    - `experiments/skin_vae_2_10_32768/last.ckpt` (SkinTokens FSQ-CVAE)
    - `experiments/articulation_xl_quantization_256_token_4/grpo_1400.ckpt` (TokenRig LLM)
    - `Qwen/Qwen3-0.6B` config into `models/Qwen3-0.6B`.
  - Update `AVAILABLE_MODELS` array and help text.
- [x] Update `backend/requirements-models.txt`:
  - Remove unused UniRig-only dependencies (`blenderproc`, `pytorch-lightning==1.9.5`).
  - Add SkinTokens dependencies (`python-box`, `fast-simplification`, `addict`, `einops`, `bottle`, `tornado`).
- [x] Update `backend/.gitignore`:
  - Replace `!thirdparty/UniRig/...` with `!thirdparty/SkinTokens/...`.

### Phase 3: SkinTokens Model Adapter (`backend/adapters/skintokens_adapter.py`)
- [x] Remove `backend/adapters/unirig_adapter.py`.
- [x] Implement `SkinTokensAdapter` in `backend/adapters/skintokens_adapter.py`:
  - Inherit from `BaseModel`.
  - `MODEL_KEY = "SkinTokens"`, `FEATURE_TYPE = "auto_rig"`.
  - Strict adherence to Priority Rule #1:
    - On modern GPUs (`sm >= 80`): native `flash_attention_2` and `bfloat16`.
    - On pre-Ampere GPUs (`sm < 80`): fall back to `sdpa` attention implementation.
  - Thin in-process model execution calling TokenRig `predict_step` directly with companion `bpy_server.py`.
  - Forward generation parameters: `top_k`, `top_p`, `temperature`, `repetition_penalty`, `num_beams`, `use_transfer`, `use_skeleton`, `use_postprocess`.
  - Validate output GLB / FBX file existence, size, and manifold status.
  - Register schema with parameter descriptions for `seed`, `use_transfer`, `use_skeleton`, `use_postprocess`.

### Phase 4: Backend Planner, Scheduler & Service Integration
- [x] Update `backend/core/planner.py`:
  - Map `"skintokens_auto_rigging": "SkinTokensAdapter"`.
  - Maintain `"unirig_auto_rig": "SkinTokensAdapter"` as legacy alias to prevent breakage on existing jobs.
- [x] Update `backend/core/scheduler/multiprocess_scheduler.py`:
  - Update auto-rig child job submission to `skintokens_auto_rigging`.
  - Update logging and result dictionary metadata provider from `unirig_auto_rig` to `skintokens_auto_rigging`.
- [x] Update `backend/api/routers/auto_rigging.py`:
  - Change `model_preference` default to `"skintokens_auto_rigging"`.
- [x] Update `backend/api/routers/system.py`:
  - Update `_model_supports_download` to include `"skintokens"`.
  - Update FBX export error detail message and storage category filter.
- [x] Update `backend/postprocess/services/rigging.py`:
  - Import `SkinTokensAdapter` instead of `UniRigAdapter`.

### Phase 5: Frontend UI & Command Palette
- [x] Update `constants/models.ts`:
  - Model ID: `skintokens_auto_rigging`.
  - Name: `SkinTokens (Unified Autoregressive Rigging)`.
  - Model path: `backend/pretrained/SkinTokens`.
- [x] Update `features/workspace/Rigging/RiggingStudio.tsx`:
  - Replace UniRig buttons, status text, and toasts with SkinTokens AI Auto-Rigging.
- [x] Update `features/workspace/Rigging/RiggingLeftPanel.tsx`:
  - Update method labels and descriptions.
- [x] Update `features/workspace/Animation/AnimationLeftPanel.tsx`, `CommandPalette.tsx`, `Navigation/LeftNavigation.tsx`, `Panels/GeneratePanel.tsx`.
- [x] Update `features/workspace/lib/artifactDownload.test.mjs` test expectation string.
- [x] Update workspace wiki content in `features/wiki/content/content/32.md`.

### Phase 6: Test Suite & Rigorous Verification
- [x] Create `backend/tests/test_skintokens_adapter.py`:
  - Test adapter lifecycle (`_load_model`, `_unload_model`, input validation, parameter schema).
  - Test format support (`obj`, `glb`, `fbx`).
  - Test error handling when input mesh is missing.
- [x] Verify test suite:
  - Run `pytest backend/tests/test_skintokens_adapter.py`.
  - Run full backend pytest suite `pytest backend/tests/` (43 passed).
  - Run frontend tests `bun test` (60 passed).
  - Run `python3 -m py_compile` across all modified files.

### Phase 7: Ponytail Code Quality Audit & Skill Reviews
- [x] Run `ponytail-review` on all modified files to ensure minimal diff, zero dead code, and standard library reuse.
- [x] Check for any temporary workarounds or shortcuts using `ponytail-debt`.
- [x] Confirm no global monkeypatches leak into other models.

### Phase 8: Continuous Documentation Integrity
- [x] Update `README.md` (architecture diagram, catalog table, feature overview).
- [x] Update `Docs/PRD.md` (functional requirements, model catalog).
- [x] Update `Docs/ARCHITECTURE.md` (submodule tree, model registry, VRAM specs).
- [x] Update `Docs/SYSTEM-BLUEPRINT.md` (adapter map, runtime characteristics).
- [x] Update `Docs/DESIGN.md` (rigging studio UI specification).
- [x] Update `Docs/MEMORY.md` (migration state, locked configurations).
- [x] Update `Docs/DECISIONS.md` (architectural decision record for SkinTokens over UniRig).
- [x] Update `Docs/CHANGELOG.md` (recent entries).
- [x] Update `Docs/api-documentation.md` (endpoints, payload examples).
