# ForMesh3D — System Blueprint

> **Document role:** Architecture notes and dated design history. Historical entries explain intended or previously implemented behavior; they are not a guarantee that the current branch still implements it.
>
> **Current status (2026-11-05):** Use [MEMORY.md](MEMORY.md) for the latest source audit and [ARCHITECTURE.md](ARCHITECTURE.md) for current responsibility boundaries. Hunyuan3D-Shape v2.1, Hunyuan3D DiT Mini Turbo, and Unique3D (geometry mode) are verified working on live GPU (status: STABLE & LOCKED). GPU Doctor is implemented in `patcher/doctor.py` as a standalone hardware planner and error recovery coordinator. TaoFlowForge Stage 1 incorporates query-chunked SDPA (eliminating 10.06 GiB OOM) and stage-wise offloading. TRELLIS.2 incorporates adaptive top-k percentile voxel fallback and rembg zero-alpha guard.

---

# 🏛️ ForMesh 3D — Complete System Architecture & Pipeline Blueprint

> **System Version**: 0.2.0 (FastAPI + Next.js 16, Python 3.10, GPU Doctor)
> **Target Deployments**: Single- or multi-GPU Linux / Cloud GPU / Local Workstations
> **Last Verified**: November 5, 2026
> **Design Tokens**: Studio Gold `#FFCC00` (`48 100% 50%`) on Matte Black `#080808`

---

## 1. Executive System Overview

ForMesh 3D is an end-to-end generative 3D reconstruction and asset optimization platform that converts reference images into game-ready 3D assets. Text prompts remain supported for mesh painting, localized mesh editing, and motion generation.

### Core Stack
- **Frontend**: Next.js 16 (React 19, TypeScript, Three.js, React Three Fiber, Tailwind CSS)
- **API Gateway**: FastAPI (Python 3.10, Conda env `3daigc-api`, Pydantic V2, AsyncIO)
- **GPU Doctor & Compatibility Engine**: Standalone hardware planner (`patcher/doctor.py`), precision router, query-chunked SDPA (diff = 0.0), Accelerate offload, and bounded error recovery.
- **Model Adapters**: 14 adapter modules and registry entries connecting the application to TRELLIS, TRELLIS.2, Hunyuan3D, TripoSG, Unique3D, Pixal3D, TaoFlowForge, PartUV, SkinTokens, FastMesh, ARDY. Live GPU verified and locked: Hunyuan3D-Shape v2.1, Hunyuan3D DiT Mini Turbo, and Unique3D. See `Docs/MEMORY.md`.
- **Scheduler**: VRAM-aware multiprocess scheduler with GPU monitoring
- **Queue/Broker**: Redis 7 (optional, multi-worker mode only)
- **File Storage**: Local filesystem + Redis FileStore (multi-worker mode)

### Model-Native Source Fidelity Contract
1. Model-native inference settings must be confirmed against each current adapter and upstream API. The frontend must not expose a setting unless it is consumed by that adapter. Do not copy unverified profile numbers into this blueprint; current adapters do not all expose a consistent locked-profile implementation.
2. Scheduler removes post-process-only target, extraction/decimation/remesh, LOD, physics, and paint controls before model inference, and also strips adapter-owned inference keys.
3. Adapter extraction and inference profiles are adapter-owned; the canonical values live in the adapter implementations and must not be copied into a second documentation table. Configured requests and effective runtime values are not interchangeable.
4. Source texture settings are model-owned and separate from downstream production atlas resolution.
5. master/source.glb is immutable; derived retopo, UV, LOD, collision, and bake artifacts cannot rewrite it.


### Intent Preset Contract

Intent presets (`backend/config/smart_presets.yaml`, version 1) define the default production budget for a generation request:

| Intent | Target polycount | Atlas | LOD | Collision | Auto-rig | Printability | Auto-repair |
|---|---:|---:|---|---|---|---|---|
| `mobile` | 20,000 | 1024 | on (`mobile` preset, 4 levels) | off | off | off | off |
| `game_ready` | 50,000 | 1024 | on (`high` preset, 4 levels) | on | off | off | off |
| `cinematic` | 200,000 | 2048 | on (`high` preset, 4 levels) | off | off | off | off |
| `animation` | 30,000 | 1024 | on (`high` preset, 4 levels) | off | on | off | off |
| `3d_print` | 0 (native passthrough) | 0 (none) | off | off | off | on | on |
| `native` | -1 (backend-only sentinel) | 0 | off | off | off | off | off |

- `native` is a backend sentinel (`backend/core/smart_presets.py`), not a YAML preset entry. The workspace's Native card reaches the same Native/Raw outcome by setting `enable_postprocess=false`.
- Production-option precedence is explicit request value > intent preset > backend default.
- `texture_resolution`, `enable_printability_check`, `enable_auto_repair`, `enable_auto_rig`, `physics_enabled`, `generate_lod`, `lod_preset` and `lod_count` are tri-state request fields; omitting them lets the intent preset supply the value.
- `target_polycount`: an explicit value > 0 or the `-1` native sentinel wins, `0` means "no explicit budget" and falls back to the intent preset. Native/Raw output is requested with `intent=native` or `enable_postprocess=false`.
- The request builder posts to `/api/v1/mesh-generation/image-to-raw-mesh` and sends only `seed` inside `model_parameters`; there is no `output_preset`, `auto_optimize` or `physics_collider` request field.

### Shared Model Runtime Dependency Contract

- ARDY is explicitly CPU-only in the model manifest and scheduler. The worker reserves no GPU memory and hides CUDA in its dedicated process; the model and local LLM2Vec encoder both receive device=cpu.
- The vendored LLM2Vec text encoder keeps non-CUDA requests on the single-process path even when multiple GPUs are visible on the host. CPU generation is slower and requires sufficient system RAM and access to the gated text-encoder checkpoint.
- Transformers is pinned at 4.48.3 for Hunyuan3D Mini's upstream minimum and PEFT's `HybridCache` import; Diffusers 0.30.3 and PyTorch 2.6.0 + CUDA 12.4 stay pinned.
- Hunyuan loaders resolve vendored module roots explicitly, validate expected source/checkpoint paths, and keep full initialization tracebacks in backend logs.

### GPU Placement & Derived Artifact Contract
- The scheduler combines tracked reservations with live per-device free memory. Aggregate VRAM is admitted only for adapters that actually shard model layers or place independent components on multiple GPUs.
- FastMesh multi-GPU placement is not a verified current capability: the manifest exposes V1K only and the shared adapter is hard-coded to the V1K checkpoint key. Hunyuan3D-Paint's source-level placement logic still requires supported-host validation before treating its multi-GPU behavior as production-ready.
- Texture generation runs inside the selected model's adapter after raw mesh inference, using already-loaded weights. Hunyuan3D-Paint v2.0/v2.1 adapters operate in dedicated worker processes.
- Rigging stores native FBX plus a GLB viewport artifact. The viewer obeys canonical artifact-format query values, and rigged geometry invalidates the previous thumbnail.


```mermaid
graph TD
    classDef gold fill:#1a1915,stroke:#ffcc00,stroke-width:2px,color:#ffcc00;
    classDef cyan fill:#0f1d24,stroke:#06b6d4,stroke-width:2px,color:#67e8f9;
    classDef purple fill:#191326,stroke:#a855f7,stroke-width:2px,color:#d8b4fe;
    classDef green fill:#0d2018,stroke:#10b981,stroke-width:2px,color:#6ee7b7;
    classDef orange fill:#24160c,stroke:#f97316,stroke-width:2px,color:#fdba74;
    classDef slate fill:#14171f,stroke:#475569,stroke-width:1.5px,color:#e2e8f0;

    subgraph Client["🌐 Studio Frontend — Next.js 16 (:3000)"]
        direction TB
        UI["React 19 + TypeScript + R3F"]:::gold
        STATE["Zustand Global State"]:::gold
        QUERY["TanStack Query"]:::gold
    end

    subgraph Gateway["⚡ FastAPI Gateway :7842"]
        direction TB
        API["Routers: system, generation,<br/>editing, rigging, segmentation"]:::cyan
        SCHED["VRAM-Aware Scheduler"]:::cyan
    end

    subgraph S["🛡️ VRAM-Aware Multi-Process Scheduler"]
        direction TB
        GPU_LOCK["GPU Mutual Exclusion"]:::orange
        MONITOR["GPU Monitor<br/>VRAM / Temp"]:::orange
        SAFETY["VRAM Safety Buffer<br/>1024 MB Free Margin"]:::orange
        AUTO_UNLOAD["Auto-Unload After Job"]:::orange
    end

    subgraph Adapters["🧠 Model Adapters"]
        direction TB
        TRELLIS["TRELLIS & TRELLIS.2<br/>FlexiCubes PBR"]:::purple
        HUNY["Hunyuan3D-2.1<br/>Shape + Paint 2B"]:::purple
        TRIPO["TripoSG<br/>High-Fidelity Image-to-Mesh"]:::purple
        FM["FastMesh Quad Retopo"]:::purple
        UR["SkinTokens & ARDY Motion"]:::purple
    end

    subgraph PostProcess["⚙️ Production Post-Processing"]
        direction TB
        CHECK["master/source.glb<br/>Immutable Master Checkpoint"]:::green
        FINISH["Repair • Retopo • Optimize • UV • Bake<br/>Texture • Game-Ready • LOD0-LOD3 • CoACD"]:::green
    end

    subgraph Storage["📦 Persistent Storage & Export"]
        direction TB
        LOCAL["Asset Workspace<br/>backend/storage/models/meshes/<asset>_<job_id>/"]:::slate
        ZIP["Structured Game-Ready ZIP<br/>Unreal Engine 5 • Unity • Godot 4"]:::slate
    end

    Client -- "REST / SSE" --> Gateway
    Gateway --> SCHED
    SCHED --> GPU_LOCK
    SCHED --> MONITOR
    SCHED --> SAFETY
    SCHED --> AUTO_UNLOAD
    SCHED --> Adapters
    Adapters -->|Raw Model Output| CHECK
    CHECK --> FINISH
    FINISH --> LOCAL
    LOCAL --> ZIP
    LOCAL -- "Static Stream" --> Client
```

---

## 2. End-to-End Generation Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as Next.js 16 Frontend
    participant API as FastAPI Router (:7842)
    participant SCHED as VRAM-Aware Scheduler
    participant Adapter as Model Adapter
    participant PP as Production Postprocess
    participant Storage as backend/storage/

    User->>Frontend: Select image + intent preset / polycount budget
    Frontend->>API: POST /api/v1/mesh-generation/image-to-raw-mesh
    API->>SCHED: Submit job (VRAM-aware)
    SCHED->>Adapter: Run inference (TRELLIS/Hunyuan3D/etc.)
    Adapter-->>SCHED: Raw 3D mesh output
    SCHED->>Storage: Persist raw master/source.glb
    opt Production post-processing enabled
        SCHED->>PP: run_postprocess_job(master, options)
        PP->>Storage: Write game_ready derivative and QA status
        PP->>Storage: Write requested LOD, texture, and collision artifacts
        PP->>Storage: Update asset manifest and quality report
    end
    SCHED-->>API: Job complete
    API-->>Frontend: Return {job_id, status: "completed", outputs}
    Frontend->>User: Render 3D model in WebGL Viewport
```

The scheduler owns model workers and job state; `backend/postprocess/pipeline.py` owns derivative generation and final production status. When production post-processing is disabled, the scheduler marks it bypassed and returns the raw master result.

---

## 3. Paint Pipeline Flow (v2.0/v2.1)

```mermaid
flowchart TD
    classDef input fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff
    classDef process fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#fff
    classDef output fill:#1e293b,stroke:#ec4899,stroke-width:2px,color:#fff
    classDef guard fill:#0f172a,stroke:#f59e0b,stroke-width:2px,color:#fff

    IN["Immutable master/source.glb<br/>Raw Geometry"]:::input
    IN --> TEXTURE{"Textured Generation enabled?"}:::guard
    TEXTURE -->|No| RAW["Keep raw master<br/>No texture stage"]:::output
    TEXTURE -->|Yes| SIZE{"Requested atlas preset"}:::guard
    SIZE -->|Any atlas size| PAINT["Selected paint model: v2.0 or v2.1; v2.1 uses RealESRGAN at 4K / 8K"]:::process
    PAINT --> VERIFY
    VERIFY -->|Verified| EXPORT["Export separate textured GLB<br/>Keep source.glb untouched"]:::output
    VERIFY -->|Missing / mismatch / failure| RAWFAIL["Preserve raw master<br/>Record texture-stage failure"]:::output
```mermaid
flowchart TD
    classDef input fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff
    classDef process fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#fff
    classDef output fill:#1e293b,stroke:#ec4899,stroke-width:2px,color:#fff
    classDef guard fill:#0f172a,stroke:#f59e0b,stroke-width:2px,color:#fff

    IN["Immutable master/source.glb<br/>Raw Geometry"]:::input
    IN --> TEXTURE{"Textured Generation enabled?"}:::guard
    TEXTURE -->|No| RAW["Keep raw master<br/>No texture stage"]:::output
    TEXTURE -->|Yes| SIZE{"Requested atlas preset"}:::guard
    SIZE -->|Any atlas size| PAINT["Selected paint model: v2.0 or v2.1; v2.1 uses RealESRGAN at 4K / 8K"]:::process
    PAINT --> VERIFY
    VERIFY -->|Verified| EXPORT["Export separate textured GLB<br/>Keep source.glb untouched"]:::output
    VERIFY -->|Failed / mismatch| RAWFAIL["Preserve raw master<br/>Record texture-stage failure"]:::output
```

    style IN fill:#1e293b
    style SHAPE fill:#0f172a
    style PAINT fill:#0f172a
    style RES fill:#0f172a
    style PBR fill:#0f172a
    style VRAM fill:#0f172a
    style OK fill:#1e293b
    style EXPORT fill:#1e293b
```

---

## 4. High-Throughput & Low-Latency Performance Architecture

### 4.1 VRAM-Aware Scheduling

| Optimization | Mechanism | Impact |
|---|---|---|
| **GPU Mutual Exclusion** | Strict locking prevents multi-provider GPU OOM | Safe concurrent inference |
| **GPU Monitoring** | Real-time VRAM/temperature polling via `GPUMonitor` | Dynamic scheduling decisions |
| **VRAM Safety Buffer** | `memory_buffer=1024` (1GB free) + `VRAM_SAFETY_MARGIN_MB=1024` | Prevents OOM on loaded models |
| **Auto Unload** | `AUTO_UNLOAD_AFTER_JOB=true` | Frees VRAM between jobs |

### 4.2 API Performance

| Optimization | Mechanism | Impact |
|---|---|---|
| **Request Timing** | `X-Process-Time` response header on every request | Latency visibility |
| **Connection Reuse** | Frontend uses axios singleton (`services/apiClient.ts`) | Eliminates per-request overhead |
| **SSE Streaming** | Server-Sent Events for generation progress | Real-time feedback without polling |
| **Pydantic Serialization** | `FastAPI native response_model` | 10-20x faster JSON |
| **GZip Compression** | `GZipMiddleware(minimum_size=1000)` | 75-85% response size reduction |
| **Native Dense Decoder Enforcement** | `configure_native_dense_decoder()` forces `VanillaVolumeDecoder + MCSurfaceExtractor` with `mc_algo="mc"`, disables FlashVDM | Eliminates detail smoothing/loss in Hunyuan3D raw geometry |
| **Official Mini Turbo Resolution** | `octree_resolution=768` (adapter-locked `_LOCKED_INFERENCE_PROFILE`) | Locks Mini Turbo geometry sampling to the adapter-owned profile |
| **TripoSG Max Hierarchical Depth** | `dense_octree_depth=10`, `hierarchical_octree_depth=11` (adapter-locked; no automatic VRAM downgrade) | Preserves fine details in TripoSG raw extraction |

### 4.3 VRAM Requirements by Model

| Model | VRAM Required | Quality | Speed |
|---|---|---|---|
| TRELLIS | 11.5 GB | High quality | ~60 seconds |
| TRELLIS.2 | 23 GB | Highest quality | ~60 seconds |
| Hunyuan3D-Shape-v2-1 | 10 GB (shape) / 29 GB (shape+texture) | High quality | ~90 seconds |
| Hunyuan3D-Paint-v2-1 | ~21 GB | PBR texture with RealESRGAN x4+ | ~120 seconds |
| Hunyuan3D-DiT-v2-mini-Turbo | ~6 GB | Low-resource shape | ~30 seconds |
| TripoSG | 8 GB | High-fidelity image/scribble | ~10-20 seconds |
| ARDY | CPU-only; no GPU VRAM reservation | Motion AI & Animation; CPU/RAM-bound | Host-dependent; slower than GPU inference |
| SkinTokens | 14 GB | Auto-rigging | ~20 seconds |
| FastMesh-V1K | 16 GB | Retopology | ~30 seconds |

**FastMesh VRAM and weights note:** The 16 GB (V1K) value is a conservative ForMesh3D scheduler reservation, not a minimum published by upstream. The official repository lists an A6000-tested environment and uses batch size 3 for V1K, but does not publish an exact minimum VRAM. Public checkpoint files are about 4.38 GB (V1K) on disk; disk size is not peak inference memory. FastMesh is single-GPU-only in the current adapter. [Upstream FastMesh](https://github.com/jhkim0759/FastMesh) · [V1K checkpoint](https://huggingface.co/WopperSet/FastMesh-V1K)

---

## 5. Multi-Format Asset Packaging & Delivery

Generated assets are packaged for delivery via the API. The following formats are supported for export:

| Format | Target Software / Engine | PBR Support |
|---|---|---|
| **GLB** | WebGL, Three.js, Godot 4 | Complete PBR (Roughness/Metallic) |
| **GLTF** | WebGL, Three.js | Complete PBR |
| **FBX** | Unreal Engine 5, Unity | Skeletal Rig + Materials |
| **OBJ** | Wavefront, ZBrush | Geometry + MTL |
| **STL** | 3D Printing, CAD | Pure Surface Geometry |
| **PLY** | Point Clouds, MeshLab | Vertex Coordinates & Colors |

Production ZIP bundles mirror the canonical asset workspace (the archive is built from the workspace root, so the real folder names are preserved):
```
Project_Export_<job_id>.zip
├── master/
│   └── source.glb             # Original byte-for-byte neural output
├── game_ready/
│   └── <asset>_<job_id>.glb    # Engine-compliant decimated mesh
├── lods/
│   ├── lod0.glb               # 100% of the game-ready triangles
│   ├── lod1.glb               # LOD ratio preset (e.g. 60% for 'high')
│   ├── lod2.glb               # LOD ratio preset (e.g. 30% for 'high')
│   └── lod3.glb               # LOD ratio preset (e.g. 15% for 'high')
├── collision/
│   └── collision.glb          # Watertight physics convex hull
├── textures/                  # Textured GLB and packed maps (when the texture stage ran)
├── previews/                  # Asset preview images
└── metadata/
    ├── quality_report.json    # Topology validation score (0-100)
    ├── asset.json             # Canonical asset manifest
    └── physics.json           # Physics configuration (when requested)
```

LOD ratios come from the `lod_preset` table — `mobile` [1.0, 0.35, 0.12, 0.05], `low` [1.0, 0.5, 0.2, 0.08], `medium` [1.0, 0.5, 0.25, 0.125], `high` [1.0, 0.6, 0.3, 0.15], `cinematic` [1.0, 0.75, 0.5, 0.25]. At most four levels are produced (LOD0-LOD3) and `lod_count` is clamped to 1-4; there is no fixed 100/50/25/12.5 default.

> **Note**: Asset delivery uses GET /api/v1/system/jobs/{job_id}/download?artifact_format=.... ZIP archives are generated on demand from the canonical asset workspace.

---

## 6. Deployment Modes

### Single-Worker (Default)

```bash
cd backend && conda activate 3daigc-api
uvicorn api.main_singleworker:app --workers 1 --port 7842
```

- Embedded VRAM-aware scheduler
- No external broker required
- Best for single-GPU and CPU deployments

### Multi-Worker (Redis Queue)

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start scheduler service
conda activate 3daigc-api
python backend/scripts/scheduler_service.py

# Terminal 3: Start API workers
cd backend && conda activate 3daigc-api
uvicorn api.main_multiworker:app --workers 4 --port 7842
```

- Redis-backed job queue (`RedisJobQueue`)
- Multiple uvicorn workers
- Redis FileStore for cross-worker metadata sharing
- Optional Redis-based authentication (`P3D_USER_AUTH_ENABLED=true`)

---

## 7. Verification & Health Check

The backend exposes a health endpoint for runtime verification:
```bash
curl -s http://localhost:7842/health | jq .
# {"status": "healthy", "timestamp": ..., "version": "0.1.0"}
```
`/health` is a liveness check and does not load or validate inference models. Use
`/api/v1/system/models` for non-loading per-model readiness, which checks the
manifest path and local weight/config files, and reports CUDA availability.

The frontend can be type-checked and built with:
```bash
npx tsc --noEmit
bun run build
```

> **Note**: An automated `backend/tests/test_backend_e2e.py` test script referenced in earlier documentation does not currently exist. The health endpoint and TypeScript compiler provide the available self-check mechanisms.

## Production Asset Lifecycle & Two-Way PostProcess Pipeline

ForMesh3D executes post-processing via two complementary pathways:
1. **Conditional Production Chaining:** When `enable_postprocess` is enabled, generation -> raw model output -> immutable `master/source.glb` -> scheduler call to `run_postprocess_job` (repair -> conditional retopo -> target budget -> UV -> bake/texture -> requested LOD/collision -> QA) -> production completion -> `WorkspaceContext.tsx` artifacts. Native/Raw requests with post-processing disabled bypass this chain.
2. **Manual On-Demand PostProcess: Users can select any workspace model or upload an external mesh (`.glb`, `.obj`, `.stl`, `.ply`) inside `RemeshPanel.tsx`, `UVUnwrapPanel.tsx`, or `MeshSegmentPanel.tsx` to execute discrete operations on demand via REST API (`/api/v1/mesh-retopology/*`, `/api/v1/mesh-uv-unwrapping/*`, `/api/v1/mesh-segmentation/*`).
The post-processing stage runs in `asyncio.to_thread` so CPU/GPU mesh operations do not block FastAPI's event loop.

## Physics path
Generation requests may carry a physics intent and provider-neutral controller values. The scheduler preserves those values as job metadata. Post-processing conditionally reuses the existing collision service and writes `metadata/physics.json`. The viewer consumes the canonical collision artifact and metadata through a pinned Rapier 0.19.3 browser adapter while the existing Three.js rendering pipeline remains unchanged. Physics binding waits for asset-load completion to prevent cross-asset state leakage.

## Review Audit — Current Job Lifecycle

Browser JobStore / Workspace jobs → FastAPI submit → scheduler → GPU worker → **raw model result** → immutable master → production postprocess → game-ready/LOD/physics/QA artifacts → terminal completion.

Batch submissions use a scheduler-owned batch identifier and `max_parallel`; blocked batch items remain queued without consuming another worker slot.

## Review Audit Final Runtime Flow

Browser → versioned API → canonical model/capability readiness → scheduler/resource reservation → worker → raw result visible → background post-processing → canonical asset manifest → QA/game-ready/export artifacts.

Batch jobs share one batch ID but retain independent job IDs. Cancellation is centralized through the scheduler control plane, including Redis deployments.


## 2026-09-30 Final Runtime Contract Reconciliation

- Container dependency paths resolve against the repository's backend layout and the maintained Wheels release.
- SQLite status/progress persistence is offloaded and bounded; status reads do not mutate or synchronously persist jobs.
- Successful raw inference is terminal for GPU execution; background production post-processing carries independent status/progress/error metadata and preserves input lineage until completion.
- Model readiness is based on canonical manifest paths, local checkpoint payloads plus model descriptors for directory paths, CUDA availability, capabilities, and manifest VRAM; adapter defaults do not override that contract. Health routes remain liveness-only and never load models.
- The workspace uses backend capability metadata for route selection, maintains bounded LRU GLB cache accounting, and rehydrates final production artifacts into the same job asset.
- Artifact naming is UUID-based across generation/segmentation/rig outputs, and stale request temp directories are removed during scheduler recovery.


## Runtime Contract Update — 2026-10-02
- Interactive mesh tools run in-process through `/api/v1/mesh-tools/*`; the default runtime does not launch a browser-facing port 8200 sidecar.
- Durable job polling owns generation progress; mesh-tool operations may use SSE for operation-level progress.
- Failed production post-processing keeps the canonical asset root and immutable master so the job can retry without model inference.

## High-Fidelity Generation Control Plane — 2026-10-08

The production path is now conceptually:

`Input -> capability detection -> model-aware preprocessing -> resource-aware routing -> retained model -> immutable master -> conservative repair/remesh/retopo -> UV -> bake -> optimized derivative -> LOD/game-ready -> quality gates`

Resource placement is handled centrally. Single-GPU loading is preferred when safe; multi-GPU loading is attempted only for adapters that explicitly declare a supported strategy. Current supported generic multi-GPU integration uses Accelerate component dispatch for compatible diffusers-style pipelines, including the TRELLIS.2 adapter path.

The production result distinguishes the immutable high-fidelity master from the optimized game-ready mesh and exposes quality diagnostics without turning non-ground-truth metrics into false absolute scores.

## Normalized Capability Contract — 2026-10-08

Model configuration is normalized once at load time into a shared capability contract. The same contract drives smart intent admission, scheduler routing, optional preprocessing profiles, runtime model details, multi-GPU eligibility and UI capability state. Production QA reports finite-geometry checks, UV/material checks, LOD lineage and master-to-derivative drift without modifying master/source.glb.

## Continuous 3D Viewport & Dynamic-Tab Architecture — 2026-10-13

The Next.js 16 Presentation Layer runs a persistent, non-destructive 3D workspace:
- **Permanent WebGL Viewport (`MeshViewer`)**: The Three.js 3D canvas and `ViewportToolOverlay` stay mounted continuously in `#center-viewport-stage` across all workspace tool switches (`model`, `remesh`, `texture`, `uv`, `segment`, `edit`, `animation`, `rigging`), eliminating canvas destructions, WebGL context recreation lag, and mesh re-loading.
- **Dynamic Floating Rails**:
  - Left floating rail routes via `renderToolPanel()` to lightweight modules (`GeneratePanel`, `RemeshPanel`, `TexturePanel`, `UVUnwrapPanel`, `MeshSegmentPanel`, `MeshEditPanel`, `AnimationLeftPanel`, `RiggingLeftPanel`).
  - Right inspector rail routes via `RightWorkspacePanel` to tool-specific inspectors (`RightPropertyPanel`, `UVInspector`, `SegmentInspector`, `MeshEditInspector`, `AnimationRightInspector`, `RiggingRightInspector`).
  - Viewport-anchored overlays (`AnimationTimelineDock`) provide in-canvas transport controls, scrubbing, and FPS selection.
- **Non-Destructive Navigation**: `navigateToMain` in `WorkspaceContext` uses `window.history.replaceState` for hub views (`overview`, `assets`, `jobs`, `system`), preserving the 3D scene state in memory without page destruction.

## Viewport Performance Engine & Postprocessing Hardening — 2026-10-14

### Viewport Performance & Manipulator Controls
- **Zero-Allocation Material Switcher**: Caches alternate shading materials lazily on `child.userData.__shadingMaterialCache`, dynamically toggling wireframe and swapping materials with 0 runtime memory allocations.
- **Event-Driven Reflection Peek**: Replaced 1-second continuous polling with OrbitControls `'end'` event listener debounced at 250ms, eliminating idle GPU load and revoking stale object URLs cleanly.
- **Interactive TransformControls**: Embedded 3D translate/rotate/scale gizmo in Edit mode, synchronized with OrbitControls mutual exclusion to prevent camera rotation while dragging.
- **Axial Camera View Presets**: Perspective, Front, Side, and Top alignment presets smoothly snapping camera position to cardinal coordinate axes.
- **Floating XYZ Orientation Gizmo**: A responsive, image-backed viewport control uses the reference artwork at `public/assets/xyz-orientation-gizmo.png`. Six separate hit targets dispatch the existing camera-preset event for `±X`, `±Y`, and `±Z`; the `back` and `bottom` presets are handled explicitly in `MeshViewer` rather than falling back to the isometric view.
- **Floating Mesh Details HUD**: The existing stats chip becomes a collapsible five-metric card. Geometry counts and materials come from the loaded Three.js scene; file size comes from upload or backend job metadata. Missing values are omitted. Exact edge counting is capped at 250,000 faces to protect viewport responsiveness.
- **Decoupled MeshDiffViewer RAF Loop**: Replaced stateful React animation frame re-render loop with a direct `requestAnimationFrame` render loop with `cancelAnimationFrame` cleanup, eliminating 60–120fps component re-render overhead.

### Postprocessing Pipeline Hardening
- **Quad OBJ Polygonal Export**: `_export_quad_obj` serializes genuine 4-vertex polygonal faces (`f v/vt/vn ...`), with automatic decimation passthrough when quad retopology is requested.
- **Smart Preset Budget Precedence**: `_resolve_target_polycount_precedence` gives explicit top-level request budgets (a positive value or the `-1` native sentinel) priority over nested parameters and smart presets, while `_resolve_preset_option` resolves every other production option as explicit request value > intent preset > backend default. A request value of `0` means "no explicit budget" and falls back to the intent preset; Native/Raw output is requested with `intent=native` or `enable_postprocess=false`.
- **Headless Blender Execution**: `blender_worker_argv` and `blender_expr_argv` prefer `BLENDER_EXECUTABLE` on `PATH` with automatic fallback to `sys.executable` via the embedded `bpy` Python wheel.
- **Dynamic Canonical Storage**: `get_storage_base_dir()` dynamically resolves `STORAGE_LOCAL_PATH` relative to project root or defaults to `backend/storage`, preventing directory nesting bugs.
- **Watertight 3D Print Preservation**: AutoRetopo shell reconstruction respects existing watertightness without voxel-rounding distortion, and `3d_print` presets set `target_polycount: 0` for 100% native resolution passthrough.

## Direct Native Generation & 59 State Machines Baseline — 2026-11-13

### State Machine Catalog & Verification
The system coordinates 59 identified state machines (40 Frontend F1–F40, 19 Backend B1–B19) detailed in `Docs/TASKS.md`:
- Frontend machines govern execution lifecycles, batch polling, Three.js loaders, SSE streaming, multi-tier GLB LRU caching (F40), dynamic inspectors, and UI overlays.
- Backend machines govern SQLite/Redis job queues (B1), BaseModel lifecycle (B2), multiprocess worker pooling (B3), GPU hardware isolation with `_is_pre_ampere` guards (B6), candidate promotion (B9), and adapter parameter precedence (B19).

### UI Generation Panel Streamlining
`GeneratePanel.tsx` is restructured to align with native mesh output:
- **Primary Panel Body:** Hosts direct inputs for target polycount (500–600K slider passing `native_target_polycount` to adapters) and model-aware texture resolution (2K/4K).
- **Dynamic Portal Flyout (`#geometry-texture-flyout`):** Houses secondary refinement controls (Remove Lighting, PBR maps, Quad/Triangle topology).
- **Post-Processing Bypass:** The post-processing master toggle is completely removed from the UI, delivering extracted raw meshes directly without unnecessary pipeline stages.

