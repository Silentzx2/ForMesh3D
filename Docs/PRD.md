# Product Requirements Document — ForMesh 3D

## Product

**ForMesh3D** — An open-source, self-hosted generative 3D asset studio. Directly bridges modern research neural 3D models into a unified studio for local generation, inspection, and engine-ready delivery.

## Problem & Product Position

Creating production 3D assets typically demands expensive commercial suites, manual modeling skills, and fragmented open-source model runtimes with fragile dependency chains.

**ForMesh3D addresses this by providing:**
1. **Direct Model-Native High Fidelity**: Direct neural mesh synthesis without lossy intermediate decimation or destructive smoothing.
2. **Private & Self-Hosted**: 100% local GPU execution on personal workstations or private VPS, with zero external cloud dependencies or telemetry.
3. **Studio 3D Workspace**: Integrated interactive Three.js viewport with dynamic tool inspectors (Generate, Texture, Remesh, UV, Rigging, Animation).
4. **Hardware Stability**: Standalone GPU Doctor (`patcher/doctor.py`) ensuring native BFloat16 FlashAttention on modern GPUs (`sm >= 80`) and chunked SDPA on pre-Ampere hardware (`sm < 80`).

## Target Users

- **Game Developers & Technical Artists**: Prototyping and generating assets for Unreal Engine 5, Unity, and Godot 4.
- **Researchers & Enthusiasts**: Exploring state-of-the-art neural shape, texturing, and rigging models locally.
- **Studios with Data Sovereignty Requirements**: Requiring air-gapped or local-only generative asset pipelines.

## Core Capabilities

### 1. Direct Neural Shape Generation
- **Image-to-3D**: Direct generation of detailed 3D meshes from single reference images using Hunyuan3D-2.1, TRELLIS, TRELLIS.2, Stable Fast 3D, and TripoSG.
- **Source Preservation**: Master mesh is immutably stored in the workspace (`master/source.glb`).
- **Dynamic Parameter Passthrough**: User-configured budgets (`native_target_polycount`, `texture_resolution`, `seed`) pass directly to model adapters without router-level interceptors.

### 2. Texture Generation & Painting
- **Integrated Texture Generation**: Direct textured mesh synthesis via models supporting native texture outputs (e.g. Stable Fast 3D, Hunyuan3D-Paint).
- **Independent Texture Resolution**: Dynamic UI controls matching adapter capabilities (512, 1K, 2K, 4K).

### 3. Studio 3D Tool Suite
- **Remeshing & Retopology**: Quad-dominant retopology powered by FastMesh (V1K contract) with target polygon budgets.
- **Smart UV Unwrapping**: Automated UV island generation and packing via PartUV and xatlas.
- **Auto-Rigging**: Armature generation powered by SkinTokens.
- **Motion Generation**: Text-to-motion generation via ARDY, outputting playable Three.js JSON animations.
- **Specialist Tools API**: Standalone SSE streaming router (`/api/v1/mesh-tools`) for format validation and real-time event streaming.

### 4. Interactive 3D Viewport & Workspace
- **Viewport Engine**: Three.js WebGL viewport with 7 shading modes (`textured`, `solid`, `clay`, `matcap-gold`, `matcap-chrome`, `uv-checker`, `wireframe`).
- **Workspace Identity**: Persistent `/workspace/generate/<workspace_id>` deep linking with immutable parent-child versioning.
- **Preview & Operation Action Bar**: Non-destructive preview staging with explicit Keep (commit) and Discard (restore base) lifecycle.

---

## Technical Constraints & Contracts

### 1. Hardware Isolation (Priority Rule 1)
- Modern GPUs (`sm >= 80`): Must run 100% native upstream code with official FlashAttention and native BF16.
- Pre-Ampere (`sm < 80`): Isolated query-chunked SDPA and FP16 guards under `_is_pre_ampere` checks.
- Patcher Isolation: Model-specific runtime patches strictly contained in `patcher/<model-name>/`.

### 2. Database & Queue Authority
- Authoritative SQLite database at `backend/storage/job_queue.db` with WAL mode and `busy_timeout=30000`.
- Dual state machines:
  - **Execution**: `queued` -> `processing` -> `completed` | `failed` | `interrupted` | `cancelled`
  - **Persistence**: `not_saved` -> `saving` -> `saved` | `save_failed` | `discarded` | `cleanup_pending` | `preview_expired`

### 3. Repository Scope & Lean Architecture
- Single-user local runtime: no multi-tenant JWT auth or artificial quality gate rejections.
- Pure upstream delivery: zero unmaintained external postprocess forks.
