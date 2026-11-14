# TASKS: Fully YAML-Driven Model UI/UX Architecture, Smart Presets Removal & Postprocess Subsystem Reset

## Status: IN PROGRESS (Batches 1–5 Completed & Verified)

---

## Architecture Objective
1. [x] Completely remove the legacy **Smart Presets / Smart Generation** subsystem across backend, frontend, API routers, and configuration files, transitioning the app to a direct, predictable, model-driven generation architecture with zero hidden overrides or latency.
2. [x] Clean, format, and standardize **`backend/config/models.yaml`** with a uniform, predictable schema across all models, eliminating scattered comments and legacy clutter, and adding explicit `model_type` classification (`mesh`, `texture`, `rigging`, `retopology`, `uv`, `motion`).
3. [x] Eliminate all client-side hardcoded model dictionaries, label mappings, and capability flags across `GeneratePanel.tsx`, `TexturePanel.tsx`, and frontend utilities, establishing `backend/config/models.yaml` as the authoritative single source of truth for both runtime pipelines and UI presentation/controls.
4. [ ] **Backend Postprocess Subsystem Reset**: Clear legacy/bloated backend postprocess files (`backend/postprocess/*`), leaving frontend UI pages intact while backend components are staged for a fresh, clean rebuild from scratch per user direction.

---

## Phase 1: Complete Removal of Smart Presets / Smart Generation Subsystem (Rule H)

### 1.1 Dead Files Deletion
- [x] Deleted `backend/config/smart_presets.yaml` (legacy intent preset recipes).
- [x] Deleted `backend/core/smart_presets.py` (legacy intent resolution engine).
- [x] Deleted `backend/api/routers/smart_generation.py` (legacy `/api/v1/smart-generation` endpoints).
- [x] Deleted `constants/smartPresets.ts` (dead frontend fallback export).
- [x] Deleted `constants/smartPresetFallback.json` (dead offline fallback table).

### 1.2 Backend Server & Router Registrations
- [x] Cleaned `backend/api/main_singleworker.py`: Removed `import smart_generation` and router mounting.
- [x] Cleaned `backend/api/main_multiworker.py`: Removed `import smart_generation` and router mounting.
- [x] Cleaned `backend/api/routers/mesh_generation.py`:
  - Removed `from core.smart_presets import CANONICAL_INTENTS, NATIVE_PRESET, resolve_intent`.
  - Removed `intent` field definitions and `@field_validator("intent")` from `ImageToRawMeshRequest` and `ImageToTexturedMeshRequest`.
  - Removed `resolve_intent` execution block from `_build_job_request` so user parameters pass directly without background preset overrides.

### 1.3 Frontend Store & Client Cleanup
- [x] Cleaned `services/apiClient.ts`: Removed `getSmartPresets()` and `resolveSmartIntent()`.
- [x] Cleaned `features/workspace/store/WorkspaceContext.tsx`:
  - Removed pre-flight `resolveSmartIntent` network call in `handleGenerate` (lines ~1866).
  - Removed pre-flight `resolveSmartIntent` network call in batch generation (lines ~2842).
- [x] Cleaned `features/workspace/Panels/GeneratePanel.tsx`:
  - Removed `const [intent, setIntent] = useState<GenerationIntent>('game_ready')`.
  - Removed unused `handleIntentSelect` function and `GenerationIntent` type definition.
- [x] Cleaned `features/workspace/utils/buildGenerationParameters.ts`:
  - Removed `intent: enablePostprocess ? settings.intent : undefined` payload assignment.
- [x] Cleaned TypeScript definitions:
  - Removed `intent?: ...` from `types/api.ts`, `types/index.ts`, `features/workspace/types.ts`, and `stores/useAppStore.ts`.

---

## Phase 2: Complete Cleanup, Reformatting & Standardization of `models.yaml`

### 2.1 Uniform Model Schema Template
- [x] Added `model_type` classification (`mesh`, `texture`, `rigging`, `retopology`, `uv`, `motion`) across all catalog entries.
- [x] Standardized 3-part clean section structure:
  1. *Identity & UI Presentation*: `model_name`, `model_type`, `ui_label`, `ui_tag`, `ui_note`, `ui_badge`, `enabled`.
  2. *Hardware & Runtime Manifest*: `vram_requirement`, `max_workers`, `supported_inputs`, `supported_outputs`, `model_path`, `upstream_repository`.
  3. *Capabilities & Interactive Controls*: `supports_quad_topology`, `min_polycount`, `max_polycount`, `default_polycount`, `polycount_step`, `supported_texture_resolutions`, `default_texture_resolution`, `inference_steps`, `guidance_scale`.

### 2.2 Cleanup & Reorganization Tasks
- [x] **Stripped Clutter & Dead Comments**: Removed outdated historical snapshots across the catalog.
- [x] **Clean Disabled / Deprecated Models**: Marked `enabled: false` explicitly for `unique3d`, `pixal3d`, `taoflowforge`, and `trellis2` mesh generators, eliminating the need for frontend filename/prefix blacklisting.
- [x] **Standardized Active Mesh Generation Models**:
  - `hunyuan3d_shape_v21_image_to_raw_mesh` (50 steps, 512 octree, 600K max polycount, triangle-only).
  - `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` (Fast geometry, locked official schedule).
  - `triposg_image_to_raw_mesh` (1024 resolution, hierarchical geometry).
  - `trellis_image_to_raw_mesh` (Raw mesh production pipeline).
- [x] **Standardized Active Textured Mesh & Painting Models**:
  - `stable_fast_3d_image_to_textured_mesh` (Resolutions: 512, 1K, 2K; native Quad topology support; fast texture generation).
  - `hunyuan3d_paint_v21_image_mesh_painting` (Resolutions: 1K, 2K, 4K; multi-view PBR).
  - `hunyuan3d_v20_paint_image_mesh_painting` (Resolutions: 1K, 2K, 4K; lightweight PBR painting).
  - `trellis_image_mesh_painting` (Resolutions: 1K, 2K; sharp atlas).
- [x] **Standardized Post-Processing Services**:
  - `skintokens_auto_rigging` (auto-rigging).
  - `fastmesh_v1k_retopology` (retopology).
  - `partuv_uv_unwrapping` (UV unwrapping).
  - `ardy_motion_generation` (motion/animation).

---

## Phase 3: Backend API Serialization (`system.py` & `backend/core/config.py`)
- [x] **Updated `ModelConfig` (`backend/core/config.py`)**:
  - Added explicit fields for `model_name`, `model_type`, `ui_label`, `ui_tag`, `ui_note`, `ui_badge`, and `enabled`.
- [x] **Updated `list_models` Endpoint (`backend/api/routers/system.py`)**:
  - Serialized `model_type`, `ui_label`, `ui_tag`, `ui_note`, `ui_badge`, `enabled`, and unstripped `capabilities` into `/api/v1/system/models` response.

---

## Phase 4: Frontend Types & Availability Hook (`types/api.ts` & `useFeatureAvailability.ts`)
- [x] **Extended `ModelRuntimeDetails` in `types/api.ts`**:
  - Added typing for `model_name`, `model_type`, `ui_label`, `ui_tag`, `ui_note`, `ui_badge`, `enabled`, and `capabilities`.
- [x] **Enhanced `useFeatureAvailability` Hook (`hooks/useFeatureAvailability.ts`)**:
  - Added helper selectors `getModelCapabilities(modelId: string)` and `getModelUiMeta(modelId: string)`.

---

## Phase 5: Frontend Panels Dynamic Refactor (`GeneratePanel.tsx` & `TexturePanel.tsx`)
- [x] **Removed Hardcoded Dictionaries in `GeneratePanel.tsx`**:
  - Deleted `MESH_MODEL_LABELS`.
  - Deleted `KNOWN_MESH_MODEL_IDS`.
  - Deleted `isMeshModelDisabled` name-matching function.
  - Deleted `MODEL_RESOLUTIONS` client-side object.
  - Deleted `MODEL_SUPPORTS_QUAD` client-side object.
- [x] **Bound UI Elements to Dynamic Model Capabilities (`GeneratePanel.tsx`)**:
  - Model candidate pool derives dynamically from `modelDetails` where `model_type === 'mesh' || feature.includes('raw_mesh')` and `enabled !== false`.
  - Resolution selector derives pills directly from `capabilities.supported_texture_resolutions`.
  - Topology selector derives Quad support from `capabilities.supports_quad_topology`.
  - Polycount slider derives `min`, `max`, and `step` directly from `capabilities.min_polycount` and `capabilities.max_polycount`.
  - Wired explicit state machine synchronization: on model change, automatically clamps resolution, topology mode, and polycount to valid bounds.
- [x] **Removed Hardcoded Dictionaries in `TexturePanel.tsx`**:
  - Deleted `TEXTURE_MODEL_LABELS`.
  - Deleted `KNOWN_TEXTURE_MODEL_IDS`.
  - Deleted `isTextureModelDisabled` function.
  - Deleted `MODEL_RESOLUTIONS`.
- [x] **Bound UI Elements to Dynamic Model Capabilities (`TexturePanel.tsx`)**:
  - Model candidate pool derives dynamically where `model_type === 'texture' || feature.includes('painting')` and `enabled !== false`.
  - Atlas resolution pills derive from `capabilities.supported_texture_resolutions`.
  - Wired explicit state machine synchronization: clamps resolution on model switch.

---

## Phase 6: Backend Postprocess Subsystem Clearance (UI Intact, Backend Cleaned & Deferred)
- [ ] **Clear Backend Postprocess Directory (`backend/postprocess/`)**:
  - Remove bloated legacy files (`pipeline.py`, `physics.py`, `services/*`, etc.) that carry outdated complexity and enterprise bloat.
  - Keep the frontend UI pages/panels 100% untouched and intact.
  - Isolate the raw-to-mesh pipeline so model-extracted generation works directly without relying on postprocess internals.
- [ ] **Stage Backend Services for Clean Rebuild**:
  - Defer rebuilding specific needed postprocess components (repair, retopo, baking, UV) into small, modular, clean micro-services later per user direction.

---

## Phase 7: Documentation Map Updates & Verification (AGENTS.md Compliance)
- [x] **Updated Documentation Map**:
  - Removed smart presets / intent references from `README.md`, `Docs/ARCHITECTURE.md`, `Docs/DESIGN.md`, `Docs/PRD.md`, `Docs/SYSTEM-BLUEPRINT.md`, `Docs/api-documentation.md`, and `Docs/MEMORY.md`.
- [x] **Typecheck Verification**: Verified `npx tsc --noEmit` completes with 0 errors.
- [x] **State Machine Audit**: Scanned touched panel state machines: verified all transitions have explicit triggers and guards against illegal combinations.
- [x] **Responsiveness Check**: Verified flyout panel, dynamic resolution grid (2-column / 3-column), and topology buttons render cleanly on mobile and desktop viewports.
- [x] **Upstream & Large GPU Preservation**: Verified modern GPU (`sm >= 80`) inference flows and model adapters remain 100% untouched.
