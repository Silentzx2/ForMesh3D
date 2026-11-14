# Architecture Decisions — ForMesh 3D

> **Version**: 0.2.0
> **Last Updated**: November 14, 2026
> **Retention Policy**: Keep only the last 3 active Architectural Decision Records (ADRs) to preserve lean context.

---

## ADR-103: Decoupling and Elimination of Legacy Postprocess, Auth, and Quality Gate Bloat (2026-11-14)

**Context:** The codebase contained legacy modules from earlier iterations and an external fork (`backend/postprocess/` adapted from 3DGenStudio, 16 files, 136KB), a multi-tenant authentication system (`backend/core/auth/` with JWT/passlib), artificial heuristic quality checks (`backend/core/quality/` and `backend/config/quality.yaml`), preprocessing bridging layers, and dummy mock model classes. ForMesh3D is a single-user, self-hosted 3D studio where modern upstream generative models (Hunyuan3D-2.1, TRELLIS.2, Stable Fast 3D) produce high-fidelity geometry directly. The postprocess pipeline was already disabled by default, and having 136KB of unmaintained postprocess code, restrictive third-party licensing conditions, and mock quality scoring created brittle imports, complex dependency trees, and maintenance drag.

**Decision:**
1. **Complete Removal of Legacy Postprocess**:
   - Deleted `backend/postprocess/` in its entirety. Removed external 3DGenStudio community license constraints.
   - Decoupled `multiprocess_scheduler.py` from `run_postprocess_job`. Generation jobs deliver direct model-native meshes to the workspace.
   - Replaced heavy mesh processing dependencies in `artifact_utils.py` with lightweight, canonical asset workspace helpers (`canonical_asset_workspace`, `prepare_asset_job_workspace`, `register_asset_job_manifest`).
2. **Elimination of Multi-Tenant Auth Bloat**:
   - Deleted `backend/core/auth/` and associated user management scripts.
   - Single-user local workstation/VPS requires no JWT tokens or password hashing overhead. Rate limiting and dependency checks operate without auth database lookups.
3. **Removal of Heuristic Quality Gates**:
   - Deleted `backend/core/quality/` and `backend/config/quality.yaml`.
   - Cleaned `backend/core/config.py` of 100+ lines of quality YAML parsing; quality tiers are validated cleanly as known strings without hard-coded geometric threshold rejections.
4. **Self-Contained Specialist Mesh Tools**:
   - Refactored `backend/api/routers/mesh_tools.py` into a standalone, SSE streaming router that provides real-time progress events and strict mesh format validation (`.glb`, `.gltf`, `.obj`, `.ply`, `.stl`) without relying on the legacy postprocess pipeline.
5. **Direct Preprocessing Intake**:
   - Removed `backend/core/preprocess/image_enhancement.py` and `hi3dgen_bridging.py`, unmounting the unused image enhancement router. Image inputs are passed directly to model adapters.
6. **Clean Model Architecture**:
   - Deleted dummy model mock files (`mesh_models.py`, `retopo_models.py`, etc.) from `backend/core/models/`, retaining a clean, authoritative `BaseModel` and `ModelStatus`.

**Consequences:**
- Zero dead code or dangling postprocess imports across the entire backend.
- Full 57-test pytest suite passing with zero regressions on upstream model flows or hardware isolation (`sm >= 80` vs `sm < 80`).
- Dramatically reduced repository surface area, zero third-party licensing baggage from 3DGenStudio, and improved startup speed and maintainability.

---

## ADR-102: Universal Model Adapter Parameter Passthrough and Dynamic Model-Aware UI Controls (2026-11-14)

**Context:** Generation parameters explicitly configured by users in the UI (e.g. polycount target 400K, texture atlas resolution, texture enable toggle, remesh topology) were previously intercepted by router-level preset overrides or logged and dropped by adapters, resulting in meshes with default resolutions (e.g. 8K faces for SF3D regardless of slider setting). Furthermore, static UI buttons offered unsupported resolutions (e.g. 4K for SF3D which only supports up to 2K) and Quad topology buttons for models producing only native triangles.

**Decision:**
1. **Dynamic Model-Aware UI Controls**:
   - `GeneratePanel` and `TexturePanel` resolve texture resolutions dynamically based on the active model: SF3D offers `512`, `1K`, `2K`; Hunyuan3D-Paint offers `1K`, `2K`, `4K`; raw mesh generators hide the texture section.
   - Geometry topology selector dynamically disables/indicates when a model does not support Quad remeshing, preventing user confusion.
2. **Authoritative Parameter Passthrough**:
   - `buildGenerationParameters.ts` maps user-selected polycount directly to `native_target_polycount` and routes user parameters without intermediate decimation post-processing flags.
   - `mesh_generation.py` router respects user-specified `native_target_polycount`, `texture_resolution`, and `seed` over preset fallbacks.
3. **Universal Adapter Polycount & Texture Handling**:
   - Adapters (`stable_fast_3d_adapter.py`, `hunyuan3d_shape_v21.py`, `hunyuan3d_dit_v2_mini_turbo.py`, `trellis_adapter.py`, `triposg_adapter.py`, etc.) consume `native_target_polycount` and apply direct geometric subdivision/simplification before export to ensure meshes match user budgets.
   - When `texture_enabled` is false, adapters skip texture baking and export clean untextured geometry with `ColorVisuals`.
4. **Workspace Operations Keep/Discard Endpoints**:
   - Implemented `POST /api/v1/workspace/operations/{operation_id}/keep` and `discard` in `backend/api/routers/system.py` with alias paths, resolving preview retention 404 errors.

---

## ADR-101: Studio 3D Unified Tool Panel Architecture & Dynamic Right Panel Extension (2026-11-09)

**Context:** The Studio 3D workspace previously used placeholder cards (`StudioToolTemplate`) for specialized processing workflows (Smart UV, Segmentation, Auto-Rigging, Animation), while right inspector panels were static and did not offer contextual tool inspections (e.g. UV atlas layout visualization or texel density inspection). In addition, disparate panel widths and multiline wrapping degraded usability on smaller laptop displays.

**Decision:**
1. **Canonical Tool Panels**: Implement dedicated, production-grade panels for all 7 left-rail studio tools:
   - `GeneratePanel.tsx`: 3D generation studio with image intake, model preference, polycount budget, and topology.
   - `TexturePanel.tsx`: 3D PBR texturing with resolution (1K/2K/4K) and lighting presets.
   - `RemeshPanel.tsx`: Quad/triangle remeshing with 120fps smooth budget slider (5K–200K) and quick presets.
   - `UVPanel.tsx`: Smart UV unwrap with single-line pill selectors (Organic vs Hard-Surface, 1K–4K, Island Margins).
   - `SegmentationPanel.tsx`: Mesh part decomposition (2–32 parts, Semantic vs Geometric, hierarchical tree toggle).
   - `RiggingPanel.tsx`: Character auto-rigging (Humanoid, Quadruped, Generic templates, T/A bind poses, facial/finger bones).
   - `AnimationPanel.tsx`: 3D motion generation (duration slider 1.0–15.0s, prompt chips, ground lock cleanup).
2. **Untouched Input Dropzone Card**: Standardize the top Image & 3D Mesh dropzone card across all panels to be 100% byte-for-byte identical, guaranteeing zero workflow disruption when switching tools.
3. **No Model Branding in CTAs**: Action buttons and subtitles use purely action-oriented terminology (`Generate Model`, `Run Retopology`, `Run Smart UV`, `Segment Mesh`, `Auto-Rig Character`, `Apply Animation`) without leaking internal model names.
4. **Dynamic Right Panel Extension**: Create `features/workspace/dynamic/` as a modular extension point. When `activeTool === 'uv'`, `RightPropertyPanel.tsx` dynamically mounts `DynamicUVInspector.tsx`; when `activeTool === 'segment'`, it mounts `DynamicSegmentationInspector.tsx`; when `activeTool === 'animation'`, it mounts `DynamicAnimationInspector.tsx`. Essential controls are preserved on the left panel with zero vertical scroll down to 577px viewport heights, and fine-tuning knobs are placed in dynamic portal flyouts.
5. **Ergonomic Sizing & Clearance**: Ensure 8px top clearance (`top-2`), 228px inner panel width with `px-8` header padding so centered tool headers never collide with the floating panel collapse button.

**Consequences:** Users have immediate, full control over all 7 primary 3D studio workflows with consistent, responsive single-line controls and zero horizontal overflow. Dedicated tool inspectors can be added to `features/workspace/dynamic/` in the future without modifying core property inspector logic.
