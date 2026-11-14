<!-- ===================== HERO BANNER ===================== -->

<p align="center">
  <img src="assets/banner.png" alt="ForMesh3D Banner — Open Source Generative 3D Mesh Studio" width="100%">
</p>

<h1 align="center">
  ForMesh3D — Open-Source Generative 3D Studio & Production Pipeline
</h1>

<p align="center">
  <strong>A unified, self-hosted 3D creation suite for neural 3D generation, asset finishing, and engine-ready delivery</strong><br>
  <em>Text-to-Motion • Image-to-3D • Quad Retopology • PBR Material Painting • Auto-Rigging • Automated LODs • Game Engine Ready</em>
</p>

<!-- ===================== DEVELOPER BADGE BAR ===================== -->

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square" alt="License Apache 2.0"></a>
  <a href="https://developer.nvidia.com/cuda-toolkit"><img src="https://img.shields.io/badge/Compute-NVIDIA_CUDA_12.4-76B900.svg?style=flat-square&logo=nvidia&logoColor=white" alt="CUDA 12.4"></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/Backend-FastAPI-009688.svg?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Frontend-Next.js_16-000000.svg?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 16"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.10-3776AB.svg?style=flat-square&logo=python&logoColor=white" alt="Python 3.10"></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/Runtime-Bun-fbf0df.svg?style=flat-square&logo=bun&logoColor=black" alt="Bun"></a>
  <a href="Docs/MEMORY.md"><img src="https://img.shields.io/badge/Tests-57%20Pytest%20Passed%20|%2018%20Bun%20Run-blue.svg?style=flat-square" alt="Test Status"></a>
</p>

<p align="center">
  <strong>⚡ Quick Start:</strong> <code>git clone --recurse-submodules https://github.com/Silentzx2/ForMesh3D.git</code> → <code>bash scripts/setup.sh</code> → <code>bash scripts/start.sh</code> → Open <a href="http://localhost:3000">http://localhost:3000</a>
</p>

---

## 📑 Table of Contents

- [1. Overview & Core Mission](#1-overview--core-mission)
- [2. Core Capability Matrix](#2-core-capability-matrix)
- [3. End-to-End Asset Generation Pipeline](#3-end-to-end-asset-generation-pipeline)
- [4. System Architecture](#4-system-architecture)
- [5. Supported AI Model Catalog](#5-supported-ai-model-catalog)
- [6. GPU Doctor & Hardware Execution Planner](#6-gpu-doctor--hardware-execution-planner)
- [7. Studio Workspace & Interactive 3D Viewport](#7-studio-workspace--interactive-3d-viewport)
- [8. Direct Model-Native Delivery & Post-Processing Status](#8-direct-model-native-delivery--post-processing-status)
- [9. Technology Stack](#9-technology-stack)
- [10. Installation & Quick Start](#10-installation--quick-start)
- [11. REST & Streaming API Reference](#11-rest--streaming-api-reference)
- [12. Verification & Test Suite](#12-verification--test-suite)
- [13. Frequently Asked Questions (FAQ)](#13-frequently-asked-questions-faq)
- [14. State Machines and Implicit State Machine Audit](#14-state-machines-and-implicit-state-machine-audit)
- [15. Technical Documentation Index](#15-technical-documentation-index)
- [16. License & Legal Attribution](#16-license--legal-attribution)

---

## 1. Overview & Core Mission

> [!NOTE]
> **Phase: BETA** — ForMesh3D core studio, API gateway, and post-processing pipeline are active and stabilizing. Breaking changes may land before 1.0.

**ForMesh3D** is an open-source, self-hosted generative 3D asset creation platform. It bridges modern open research neural models into a single, cohesive studio running entirely on your local workstation or private GPU cluster.

ForMesh3D delivers **direct high-fidelity model-native generation**, preserving 100% of the raw neural surface detail without destructive downstream decimation or smoothing:

- **100% Private & Self-Hosted**: Run neural inference locally on NVIDIA GPUs without cloud subscriptions, usage queues, or uploading proprietary concept art to external services.
- **Immutable Source Preservation**: Raw model-native generation is snapshotted at `master/source.glb` with SHA-256 validation.
- **Direct Model-Native Output**: Upstream neural models (Hunyuan3D-2.1, TRELLIS.2, TaoFlowForge, TripoSG) output native, detailed geometry directly. The post-processing pipeline is permanently disabled by default (`postprocessing.enabled: false`) to ensure zero loss of fine surface features.
- **Hardware-Adaptive GPU Doctor**: Standalone hardware compatibility and memory execution planner ([`patcher/doctor.py`](patcher/doctor.py)), guaranteeing 100% native BFloat16 FlashAttention on modern GPUs (`sm >= 80`) and mathematically exact query-chunked SDPA on pre-Ampere GPUs (`sm < 80`).

### Choose Your Contributor Path

| No GPU (CPU-Only Contributor) | GPU Workstation (NVIDIA CUDA 12.4+) |
|---|---|
| • Studio UI/UX, React Three Fiber Viewport | • Model Adapters (TRELLIS.2, Hunyuan3D, TaoFlowForge, TripoSG) |
| • API Gateway routers, job queues, SQLite sync | • GPU Doctor hardware execution planning & attention routing |
| • Mesh algorithms, contract tests & documentation | • Live GPU inference validation & production quality gates |
| 🔗 **[Explore Task Tracker & Roadmap →](Docs/TASKS.md)** | 🔗 **[Review System Architecture →](Docs/ARCHITECTURE.md)** |

> [!WARNING]
> ### ⚖️ Licensing, Commercial & SaaS Advisory (Important)
>
> 1. **Core Repository License**: ForMesh3D's original code (orchestrator, API gateway, scheduler, and Next.js studio UI) is open-source under the **[Apache License 2.0](LICENSE)**.
> 2. **Direct Upstream Model Architecture**: Upstream neural models (Hunyuan3D-2.1, TRELLIS.2, Stable Fast 3D, TripoSG) output native, detailed geometry directly without destructive legacy post-processing.
> 3. **Use of Generated Outputs**: Rights to generated outputs depend on upstream model/checkpoint terms and applicable law. The Apache license on this repository does not grant unrestricted rights to every third-party model output; check the exact model and checkpoint terms before commercial use.
> 4. **Notice for Commercial & SaaS Implementors**:
>    - The Apache 2.0 license applies **strictly to ForMesh3D's original code**. We do **not** own or re-license underlying third-party models, research weights, or ported submodules.
>    - Individual model source snapshots and checkpoints have their own terms. Read the **[`backend/thirdparty/LICENSE`](backend/thirdparty/LICENSE)** directory for complete license details.
>    - **Do NOT blindly deploy or redistribute ForMesh3D as a paid commercial product or SaaS** without auditing and complying with the respective licenses of each integrated model and component!

---

## 2. Core Capability Matrix

| Capability | Technical Implementation | Output Deliverable |
|---|---|---|
| **Neural 3D Generation** | Upstream model adapters with locked native inference contracts | Immutable `master/source.glb` |
| **Source Preservation** | SHA-256 lineage tracking before any destructive modifications | Canonical source snapshot |
| **Production Decimation** | Feature-preserving QEM decimation protecting crease edges ($>35^\circ$) | Targeted budget polygon count |
| **Quad Retopology** | FastMesh V1K / V4K neural quad-dominant edge-loop reconstruction | Clean animatable quad mesh |
| **Conformal UV Unwrapping** | Automated GPU PartUV routing with CPU/GPU xatlas fallback ($0\%$ overlap) | Single/Multi-chart UV atlas |
| **PBR Material Baking** | Tangent-space normal baking (OpenGL Y+ convention) & packed RMA maps | Complete 5-channel PBR material maps |
| **LOD Generation** | Cascaded LOD0 to LOD3 with `meshoptimizer` vertex-cache optimization | Multi-tier `lods/lod[0-3].glb` |
| **Physics Collision Hulls** | CoACD approximate convex decomposition with mass & inertia tensors | Watertight `collision.glb` & `physics.json` |
| **Automated Rigging & Motion** | SkinTokens unified autoregressive armature generation & ARDY motion synthesis | Rigged FBX/GLB & playable motion JSON |
| **Game Engine Packages** | Structured directory packaging for Unreal Engine 5, Unity, and Godot 4 | Complete engine-ready ZIP archive |

---

## 3. End-to-End Asset Generation Pipeline

ForMesh3D enforces an **immutable master preservation architecture**. The raw neural model output is directly generated and snapshotted at `master/source.glb` with SHA-256 validation. Post-processing (decimation, hole repair, automated LODs) is permanently disabled by default (`postprocessing.enabled: false`) to deliver the highest native surface fidelity:

```mermaid
flowchart LR
    %% High-Contrast Styling
    classDef input fill:#262213,stroke:#eab308,stroke-width:2px,color:#fef08a;
    classDef neural fill:#211833,stroke:#a855f7,stroke-width:2px,color:#e9d5ff;
    classDef master fill:#0d242a,stroke:#06b6d4,stroke-width:2px,color:#a5f3fc;
    classDef export fill:#181c24,stroke:#64748b,stroke-width:2px,color:#f1f5f9;

    IMG["Input Concept Image<br/>(Single Reference)"]:::input
    MODEL["Neural Model Adapter<br/>TRELLIS.2 / Hunyuan3D / TaoFlowForge / TripoSG"]:::neural
    MASTER["master/source.glb<br/>Immutable Native Mesh<br/>(SHA-256 Verified)"]:::master
    OUT["Direct Asset Delivery<br/>• Model-Native High-Fidelity GLB<br/>• Preserved Neural Geometry<br/>• Engine-Ready (UE5 / Unity / Godot)"]:::export

    IMG --> MODEL
    MODEL --> MASTER
    MASTER --> OUT
```

---

## 4. System Architecture

The following diagram illustrates the multi-tier system architecture connecting the Next.js studio frontend, FastAPI control plane, VRAM scheduler, neural adapters, and post-processing pipeline:

```mermaid
flowchart TD
    %% Styling Definitions
    classDef gold fill:#262213,stroke:#eab308,stroke-width:2px,color:#fef08a;
    classDef cyan fill:#0d242a,stroke:#06b6d4,stroke-width:2px,color:#a5f3fc;
    classDef purple fill:#211833,stroke:#a855f7,stroke-width:2px,color:#e9d5ff;
    classDef green fill:#0d271c,stroke:#10b981,stroke-width:2px,color:#a7f3d0;
    classDef amber fill:#2d1b0d,stroke:#f59e0b,stroke-width:2px,color:#fde68a;
    classDef slate fill:#181c24,stroke:#64748b,stroke-width:2px,color:#f1f5f9;

    subgraph Client ["Studio Frontend (Next.js 16 : Port 3000)"]
        UI["Unified Studio UI<br/>React 19 + Radix UI + Motion"]:::gold
        VIEWER["Continuous 3D WebGL Viewport<br/>Three.js Persistent Canvas Stage"]:::gold
        STORES["Reactive State Stores<br/>Zustand + TanStack Query"]:::gold
    end

    subgraph Gateway ["API Gateway & Control Plane (FastAPI : Port 7842)"]
        ROUTERS["API Routers (100 Active Endpoints)<br/>Generation / Retopo / UV / Rigging / Tools"]:::cyan
        QUEUE["Job Queue & Execution<br/>SQLite FIFO (WAL) + Scheduler"]:::cyan
    end

    subgraph Scheduler ["VRAM-Aware Scheduler"]
        GPU_LOCK["GPU Mutual Exclusion<br/>Single Job Concurrency"]:::amber
        MONITOR["Hardware Telemetry<br/>1024 MB Headroom Guard"]:::amber
    end

    subgraph Engines ["Neural 3D Synthesis Engines"]
        HUNYUAN["Hunyuan3D-2.1 Suite<br/>Shape + Paint 2B + Turbo"]:::purple
        TRELLIS["TRELLIS & TRELLIS.2<br/>FlexiCubes Structured Meshes"]:::purple
        TRIPO["TripoSG<br/>High-Fidelity Image-to-Mesh"]:::purple
        TAO["TaoFlowForge<br/>Cascaded Flow Matching"]:::purple
        RETOPO["FastMesh V1K / V4K<br/>Neural Quad Retopology"]:::purple
        RIGGING["SkinTokens & ARDY<br/>Auto-Rigging & Motion AI"]:::purple
        UNIQUE3D["Unique3D<br/>Multi-View Diffusion"]:::purple
    end

    subgraph DirectDelivery ["Direct High-Fidelity Model-Native Delivery"]
        PREVIEW["storage/temp/<operation_id>/<br/>Verified Model-Native Preview (not_saved)"]:::green
        KEEP["Keep in Workspace<br/>Atomic Commit & Versioning (saved)"]:::green
        DISCARD["Discard Preview<br/>Safe Temp Purge (discarded)"]:::green
    end

    subgraph Delivery ["Workspace Asset Delivery"]
        ASSET_STORE["backend/storage/<workspace_id>/<br/>Canonical Asset Hierarchy"]:::slate
        ZIP["Structured ZIP Export<br/>Unreal Engine 5 • Unity • Godot 4"]:::slate
    end

    UI --> STORES
    STORES -->|REST / SSE Stream| ROUTERS
    ROUTERS --> QUEUE
    QUEUE --> GPU_LOCK
    GPU_LOCK --> MONITOR
    MONITOR --> HUNYUAN
    MONITOR --> TRELLIS
    MONITOR --> TRIPO
    MONITOR --> TAO
    MONITOR --> RETOPO
    MONITOR --> RIGGING
    MONITOR --> UNIQUE3D

    HUNYUAN -->|Model Native GLB| PREVIEW
    TRELLIS -->|Model Native GLB| PREVIEW
    TRIPO -->|Model Native GLB| PREVIEW
    TAO -->|Model Native GLB| PREVIEW
    UNIQUE3D -->|Model Native GLB| PREVIEW

    PREVIEW --> KEEP
    PREVIEW --> DISCARD
    KEEP --> ASSET_STORE
    ASSET_STORE --> ZIP
    ASSET_STORE -.->|Model Stream| VIEWER
    RETOPO -.->|Quad Mesh| ASSET_STORE
    RIGGING -.->|Rigged Bones| ASSET_STORE
```

---

## 5. Supported AI Model Catalog

The model registry is dynamically configured via `backend/config/models.yaml` and loaded lazily:

| Model Architecture | Registered Model ID | Category / Task | VRAM Budget | Key Technical Capabilities & Live Audit Status |
|---|---|---|:---:|---|
| **Hunyuan3D-Shape-v2.1** | `hunyuan3d_shape_v21_image_to_raw_mesh` | Raw Mesh | ~10 GB | 3.3B shape model, official 2.1 pipeline, octree res 1300. **Status: VERIFIED PASS / LOCKED** (live Kaggle GPU verified: 935k faces, 16.1MB GLB). |
| **Hunyuan3D-DiT-v2-mini-Turbo** | `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` | Raw Mesh | ~6 GB | 0.6B low-VRAM step-distilled shape model. **Status: VERIFIED PASS / LOCKED** (live Kaggle GPU: 758k faces, 13.0MB GLB, 3.87GB VRAM). |
| **Unique3D** | `unique3d_image_to_raw_mesh` | Raw Mesh | ~10 GB | Multi-view geometry reconstruction, SD1.5 dependency bypassed. **Status: VERIFIED PASS / LOCKED** (live Kaggle GPU: 54k faces, 1.0MB GLB). |
| **TRELLIS.2** | `trellis2_image_to_3d` / `trellis2_image_to_raw_mesh` | Raw Mesh | 23.5 GB | High-fidelity FlexiCubes geometry; FP32 attention on pre-Ampere prevents logit collapse; adaptive top-k percentile voxel fallback; rembg zero-alpha guard; texture generation via `pipeline(mesh=, image=, seed=)` — implemented, 4K atlas |
| **TaoFlowForge** | `taoflowforge_image_to_raw_mesh` | Raw Mesh | 20 GB (10 GB low-VRAM) | Progressive native-mesh generation. Stage 1 query chunking SDPA (diff=0.0) eliminates 10.06 GiB OOM; stage offload enforced. |
| **Pixal3D** | `pixal3d_image_to_raw_mesh` / `pixal3d_image_to_3d` | Raw Mesh | ~18 GB configured reservation | Pixel-aligned O-Voxel source; DinoV3 feature extractor condition models initialized. |
| **Hunyuan3D-Paint-v2.0** | `hunyuan3d_v20_paint_image_mesh_painting` | PBR Texture | ~11 GB | Paint an existing mesh with PBR textures. |
| **Hunyuan3D-Paint-v2.1** | `hunyuan3d_paint_v21_image_mesh_painting` | PBR Texture | ~12 GB configured reservation | 2B PBR texture checkpoint, internal RealESRGAN, exported 4K/8K atlas validation. |
| **TripoSG** | `triposg_image_to_raw_mesh` | Image/Scribble to 3D | 8 GB | High-fidelity image and scribble guided 3D geometry; in-line canonical storage resolution. |
| **SkinTokens** | `skintokens_auto_rigging` | Auto-Rigging | 14 GB | Unified autoregressive armature and discrete skin token generation. |
| **ARDY** | `ardy_motion_generation` | Motion AI | CPU-only | Interactive autoregressive text-to-motion generation; CPU/RAM-bound. |
| **PartUV** | `partuv_uv_unwrapping` | UV Unwrapping | 7 GB | Automated seam placement and GPU UV chart packing. |
| **TRELLIS** | `trellis_image_to_3d` / `trellis_image_to_raw_mesh` | Raw Mesh | 11.5 GB | Raw FlexiCubes geometry; texture generation via `to_glb(gs, mesh, texture_size=...)` — implemented, 2K atlas |

### Texture Pipeline & Texture-Capable Models

Texture generation runs inside the selected model's adapter after raw mesh inference, using already-loaded weights — no second weights load for models that share the texture-capable adapter. The raw `master/source.glb` stays immutable; textured output is stored as a separate artifact (`textures/<base>_textured.glb`).

|| Model | Texture Capability | Status |
|---|---|---|
| **Hunyuan3D-2.1** (`hunyuan3d_paint_v21_image_mesh_painting`) | PBR texture with internal RealESRGAN enhancement; 4K/8K atlas targets | Done — texture runs in `hunyuan3d_adapter_v21.py` `_process_request` after raw inference |
| **TRELLIS** (`trellis_image_to_raw_mesh`) | Texture via `to_glb(gs, mesh, texture_size=...)` | Done — implemented in `_TrellisBaseAdapter._process_request`, 2K atlas |
| **TRELLIS.2** (`trellis2_image_to_raw_mesh`) | Texture via `pipeline(mesh=, image=, seed=)` | Done — implemented in `Trellis2ImageToRawMeshAdapter._process_request`, 4K atlas |

Paint3D has been removed from the main repo. Texture Studio sends the selected paint model ID; atlas resolution does not override the selection. Hunyuan3D-Paint v2.1 uses internal RealESRGAN for 4K/8K targets.

> **Registry source of truth:** the catalog above mirrors `backend/config/models.yaml`. Only entries with `enabled: true` are exposed by `GET /api/v1/system/models`. Model capabilities, limits, and supported options are fully model-driven.

---

## 6. GPU Doctor & Hardware Execution Planner

ForMesh3D features **GPU Doctor** ([`patcher/doctor.py`](patcher/doctor.py)), a lightweight, non-invasive hardware compatibility, precision routing, and memory management subsystem. Built strictly following **Ponytail Ultra** principles (single compact file, zero unnecessary dependencies, native PyTorch + Hugging Face Accelerate), GPU Doctor resolves hardware heterogeneity between modern cloud GPUs and budget pre-Ampere workstations:

```mermaid
flowchart TD
    %% Styling Definitions
    classDef modern fill:#0d271c,stroke:#10b981,stroke-width:2px,color:#a7f3d0;
    classDef preAmpere fill:#2d1b0d,stroke:#f59e0b,stroke-width:2px,color:#fde68a;
    classDef core fill:#0d242a,stroke:#06b6d4,stroke-width:2px,color:#a5f3fc;
    classDef action fill:#211833,stroke:#a855f7,stroke-width:2px,color:#e9d5ff;

    GPU["GPU Inspection (inspect_gpu)<br/>Compute Capability & VRAM Probe"]:::core
    DECISION{"Compute Capability<br/>sm >= 80 ?"}:::core

    GPU --> DECISION
    DECISION -->|YES: A100 / H100 / RTX 3090 / 4090| MODERN["Rule 1: Upstream Native Mode<br/>• Native BFloat16 Precision<br/>• Official FlashAttention 2 / 3<br/>• Resident Full VRAM Schedule<br/>• Zero Fallback Overhead"]:::modern

    DECISION -->|NO: Tesla T4 / V100 / RTX 2080| PRE["Pre-Ampere Mitigations<br/>• Precision: Native FP16 / BF16 DiT<br/>• Attention: Query-Chunked SDPA<br/>• Memory: Accelerate Offload / low_vram<br/>• Stage-wise Cache Purging"]:::preAmpere

    MODERN --> EXEC["Guarded Inference Execution<br/>(with doctor.track_stage)"]:::action
    PRE --> EXEC

    EXEC --> OK["Clean Mesh Output<br/>(Immutable master/source.glb)"]:::modern
    EXEC -->|Intercepted Exception| ERR{"Error Classifier<br/>(classify_error)"}:::action

    ERR -->|CUDA OOM| REC1["Cache Purge & GC<br/>empty_cache() + ipc_collect()"]:::action
    ERR -->|SDPA Math OOM| REC2["Query Chunking (1024)<br/>Peak Memory: 10GB -> 30MB"]:::action
    ERR -->|Empty Voxels| REC3["Adaptive Top-K Percentile<br/>Fallback Voxel Recovery"]:::action
    ERR -->|Max Retries Exceeded| FAIL["Safe Terminal Error Report"]:::preAmpere
```

### Core Architecture Invariants:
1. **Rule 1 Priority (Zero Modern GPU Regression)**: On modern GPUs (`sm >= 80`, e.g. A100, RTX 3090/4090, H100), GPU Doctor preserves 100% native BF16 precision and native FlashAttention with zero fallbacks, zero performance penalties, and official README parity.
2. **Mathematically Exact Query-Chunked SDPA**: On pre-Ampere GPUs (`sm < 80`), large token sequences (e.g. 15,000+ tokens in TaoFlowForge Stage 1) trigger PyTorch SDPA Math fallback, causing 10.06 GiB OOM crashes. GPU Doctor slices query tokens along the sequence dimension (`chunk_size=1024`) while evaluating against all key/value tokens. Because softmax normalizes along the key dimension, the output is mathematically identical (`diff = 0.0`) while peak attention memory drops from 10.06 GiB to ~30 MB across both 3D and 4D tensors.
3. **Structured Diagnostics & Bounded Recovery**: Tracks stage-by-stage timings, peak VRAM allocations, and classifies exceptions into 7 actionable categories (`cuda_oom`, `unsupported_precision`, `dtype_mismatch`, `device_mismatch`, `attention_backend_failure`, `sparse_empty_voxels`, `unknown`) with a strict retry limit (`max_retries=2`) to prevent infinite failure loops.

---

<!-- ===================== STUDIO WORKSPACE SHOWCASE (MIDDLE OF README) ===================== -->

## 7. Studio Workspace & Interactive 3D Viewport

<div align="center">
  <img src="assets/workspace-screenshot-1.png" alt="ForMesh3D Studio Workspace — Generate Model Panel" width="100%" style="border-radius: 8px; border: 1px solid #30363d; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); margin-bottom: 12px;">
</div>

<p align="center">
  <sub><b>Figure 1:</b> ForMesh3D unified Studio Workspace — live interactive Three.js viewport, Generate Model panel with image/mesh upload, geometry & texture settings, AI model selector, and production post-processing toggles. Captured from <code>http://localhost:3000/workspace</code>.</sub>
</p>

The ForMesh3D Studio UI integrates neural generation and mesh finishing into a cohesive desktop-grade web application:

### 🎮 Viewport & Generation Controls:
- **Interactive Three.js Viewport**: Smooth orbital camera controls, perspective/orthographic toggle, wireframe overlay, PBR matcap rendering, and continuous WebGL staging.
- **Floating XYZ Orientation Gizmo**: Reference-matched image-backed camera control with interactive positive and negative X/Y/Z snaps, integrated into the existing viewport without a second renderer.
- **Snapshot Capture**: Two separate capture buttons — Header Snapshot captures the entire workspace as-is (`<name>_<hash>-workspace.png`) at 1920×1080 PNG; Tool Rail Camera captures mesh only (grid/axes hidden) (`<name>_<hash>-mesh.png`) at 1080p 100% quality. Both save to current route identity.
- **Real-Time Geometry Telemetry HUD**: Direct in-viewport telemetry tracking triangle count, vertex count, watertight manifold status, physical bounding box dimensions (W x H x D), and quality score — replaces the collapsible Mesh Details panel formerly in `ViewportToolOverlay`.
- **Hardware-Aware Model Selector**: Real-time VRAM estimator comparing model memory reservations with live GPU telemetry (`torch.cuda.mem_get_info`) to prevent out-of-memory crashes before jobs are queued.
- **Production Post-Processing Controls**: Toggle automated quad retopology, hole repair, conformal UV unwrapping, normal baking, and collision hull generation without mutating the immutable `master/source.glb`.

### 🧰 Creative Workspace Modules:
- **Generate Studio (`/workspace`)**: Image-to-3D generation with reference image intake, model selector, unified Target Polycount, and Output Presets (`mobile`, `game_ready`, `cinematic`, `animation`, `3d_print`, `native`).
- **Texture Studio (`/workspace/texture`)**: Multi-view PBR texture painting and PBR map inspection/export (Albedo, Normal, Roughness, Metallic, AO), with explicit Hunyuan3D-Paint v2.0/v2.1 model selection. Hunyuan3D-Paint v2.1 runs internal RealESRGAN enhancement for 4K/8K atlas targets.
- **Retopology & Remesh (`/workspace/remesh`)**: FastMesh quad-dominant retopology with V1K and V4K target presets.
- **UV Unwrapping (`/workspace/uv`)**: Automated conformal seam placement and atlas chart packing.
- **Mesh Segmentation (`/workspace/segment`)**: Semantic part decomposition interface.
- **Animation & Motion (`/animation`)**: SkinTokens autoregressive armature generation and ARDY motion synthesis.
- **Jobs & Run Inspector (`/workspace/jobs`)**: Real-time progress tracking, step telemetry, and VRAM monitoring.
- **Admin & Model Registry (`/admin?tab=models`)**: Live GPU health, temperature, and adapter configuration.
- **Database Administration (`/admin?tab=database`)**: Store telemetry (authoritative SQLite job queue / file metadata / disk storage) and paginated jobs table with per-row cancel/delete.

### 🔗 Workspace Identity & Route Contract
- **Route format:** `/workspace/<tool>/<workspace_id>` — e.g. `/workspace/generate/rabbit_a8f32c`. Directly addresses the authoritative backend `workspace_id`.
- **Active Asset Selection:** Selecting an asset or version in the Assets panel updates only `active_mesh_asset_id` on the workspace state without mutating or replacing the URL route.
- **Dynamic Mesh Versions:** Hidden when only a raw base mesh exists; displays retained versions (`_v002`, `_v003`) once derived operations are retained.
- **Operation Action Bar:** Dockable action bar in viewport for Keep in Workspace (commits derived preview asset to `saved`), Regenerate (linked attempt with `parent_operation_id`), and Discard Preview.
- **Adaptive Task Polling:** Fast 1.5s initial interval, backing off to 5s after 2 minutes, pausing on tab hidden, and terminating on completion.
- **Global Workspaces Gallery:** Direct navigation to `/workspace/generate/<workspace_id>` from the studio dashboard.

---

## 8. Direct Model-Native Delivery & Post-Processing Status

ForMesh3D prioritizes **direct, uncompromised model-native mesh output**. The automated generation post-processing pipeline is permanently disabled by default via `postprocessing.enabled: false` in `backend/config/system.yaml`.

> [!IMPORTANT]
> ### 🛡️ Post-Processing Core Component Preservation Notice
> While automated post-processing is disabled by default during initial generation to preserve 100% of the raw neural surface fidelity without unwanted polygon collapse or smoothing, **all files, services, and modules in `backend/postprocess/` are CORE foundational components of ForMesh3D and MUST NEVER BE REMOVED OR DELETED**.
> They power all on-demand interactive studio tools—including Conformal UV Unwrapping (`autouv`), FastMesh Quad Retopology (`autoretopo`), Normal Map Raycast Baking (`bake.py`), CoACD Convex Collision Hull Generation (`collision.py`), and Objective QA Metrics & Watertight Repair (`repair.py`). They remain fully available for discrete manual tool workflows and explicit opt-in execution.

When post-processing is disabled:
- The scheduler forces `postprocess_mode = "none"` and `enable_postprocess = False`, returning the high-fidelity neural mesh extracted by the model adapter directly.
- No decimation, aggressive smoothing, or destructive polygon collapse is applied.
- The raw neural asset is delivered as the canonical deliverable directly to the workspace and export archives.

```text
backend/storage/<workspace_id>/
├── input/
│   └── source_image.png        # Byte-for-byte original reference image (ast_<12hex>)
├── mesh/
│   └── <workspace_id>.glb      # High-fidelity model-native mesh (SHA-256 verified)
├── texture/pbr/                # PBR textured derived assets (_v002, _v003...)
├── retopology/                 # Clean quad-topology derived assets
├── segmentation/               # Segmented parts & labeled masks
├── rigging/                    # Armatures and skinned assets
├── animation/                  # Motion-rigged export files
└── metadata.json               # Authoritative workspace manifest rebuilt from SQLite
```

### Operation Lifecycle & Dual State Machines (Milestone 3)

ForMesh3D governs execution and asset persistence via two decoupled, strict state machines:

1. **Execution State Machine (`executionState`):**
   `queued` ➔ `processing` ➔ `completed` | `failed` | `interrupted` | `cancelled`
   - Queue capacity cap: enforces a maximum of 10 queued operations (`QUEUE_FULL`).
   - Single-worker claim lock: atomic conditional SQL updates with cross-process file locks prevent duplicate claims.
   - Deduplication: SHA-256 request fingerprints return existing active operations; explicit "Regenerate" links to `parent_operation_id`.
   - Lease verification: startup recovery inspects active worker process IDs before marking operations `interrupted`.

2. **Persistence State Machine (`persistenceState`):**
   `not_saved` ➔ `saving` ➔ `saved` | `save_failed` | `discarded` | `preview_expired`
   - Generation outputs are isolated to `storage/temp/<operation_id>/` in preview mode (`not_saved`).
   - "Keep in Workspace" atomically stages and commits assets to the workspace tool directory, updates `active_mesh_asset_id`, and projects `metadata.json` (`saved`).
   - "Discard" safely cleans temp folders without altering saved assets (`discarded`).
   - Unretained previews past 24 hours TTL are purged automatically without touching permanent assets (`preview_expired`).

---

## 9. Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **Frontend Framework** | **Next.js 16** (App Router), React 19, TypeScript | Server Components, fast client routing, static optimization |
| **UI Design System** | Tailwind CSS v4, Radix UI, Hugeicons | Studio Gold dark theme (`hsl(48, 100%, 50%)`), accessible, responsive |
| **State & Query** | Zustand, TanStack Query | Reactive real-time stores and optimistic server-state sync |
| **3D Rendering** | Three.js, React Three Fiber | Real-time PBR shaders, wireframe inspection, matcaps |
| **Physics Preview** | `@dimforge/rapier3d-compat` (WebAssembly) | Fast browser physics simulation without external dependencies |
| **Backend API** | **FastAPI**, Python 3.10, Pydantic V2 | Async high-throughput REST, SSE event streaming |
| **GPU Scheduling** | Multiprocess VRAM Scheduler (`MultiprocessModelScheduler`), SQLite FIFO Queue (`JobQueue`) with WAL Mode | Single persistent worker, FIFO queuing, crash recovery |
| **Hardware Doctor** | PyTorch Native + Hugging Face Accelerate | Clean precision routing, query-chunked SDPA, zero regression |
| **Geometry Core** | PyMeshLab, Trimesh, CoACD, meshoptimizer | Watertight repair, quad retopo, texture decimation |
| **Package Managers** | Bun (Frontend), Conda (Python 3.10 `3daigc-api`) | Ultra-fast JS bundling and deterministic CUDA C++ bindings |

---

## 10. Installation & Quick Start

### Prerequisites
- **OS**: Linux (Ubuntu 20.04, 22.04, or 24.04 recommended) or Windows WSL2.
- **GPU**: NVIDIA GPU with CUDA 12.4+ (minimum 8GB VRAM for basic models, 16GB–24GB+ recommended).
- **Node Environment**: [Bun](https://bun.sh/) installed.
- **Python**: Python 3.10 via Conda (`conda create -n 3daigc-api python=3.10`).

### 1. Clone with Submodules
```bash
git clone --recurse-submodules https://github.com/Silentzx2/ForMesh3D.git
cd ForMesh3D

# Install frontend dependencies with Bun
bun install
```

### 2. Backend Environment & Setup
```bash
# Automated setup prepares the environment, builds C++/CUDA kernels,
# installs backend dependencies, and initializes the thirdparty submodule
bash scripts/setup.sh
```

### 3. Model Weights & Checkpoints
Download pre-trained weights for the models you wish to use:
```bash
# Download core model checkpoints
bash backend/scripts/download_models.sh
```

### 4. Running the Studio
```bash
# Launch both backend (Port 7842) and Next.js frontend (Port 3000)
bash scripts/start.sh
```

Open **`http://localhost:3000`** in your browser.

- Frontend Studio: `http://localhost:3000`
- Backend API: `http://localhost:7842`
- Interactive Swagger Docs: `http://localhost:7842/docs`
- Health Endpoint: `http://localhost:7842/api/v1/system/health`

### Docker Compose (NVIDIA GPU)
From the repository root, build and start the containerized backend stack:
```bash
docker compose -f docker-compose.yml up --build -d
```

---

## 11. REST & Streaming API Reference

The FastAPI backend exposes 100 active API endpoints (98 mounted across 13 `APIRouter` modules plus `/health` and `/`) covering generation, tool operations, and cluster telemetry:

| Endpoint | Method | Description |
|---|:---:|---|
| `/health` | `GET` | Application-level health probe |
| `/api/v1/system/info` | `GET` | System health, GPU specs, VRAM utilization, active worker mode |
| `/api/v1/system/health` | `GET` | Lightweight system router health check |
| `/api/v1/system/models` | `GET` | List registered models, readiness, capabilities, and VRAM requirements |
| `/api/v1/mesh-generation/image-to-raw-mesh` | `POST` | Generate high-fidelity raw geometry from single reference image |
| `/api/v1/mesh-generation/image-to-textured-mesh` | `POST` | Combined mesh generation + texturing |
| `/api/v1/mesh-generation/image-mesh-painting` | `POST` | Paint PBR textures onto existing 3D geometry from image |
| `/api/v1/mesh-generation/text-mesh-painting` | `POST` | Paint PBR textures onto existing 3D geometry from text prompt |
| `/api/v1/mesh-retopology/retopologize-mesh` | `POST` | Run FastMesh quad retopology on mesh |
| `/api/v1/mesh-uv-unwrapping/unwrap-mesh` | `POST` | Generate conformal UV atlas charts |
| `/api/v1/mesh-segmentation/segment-mesh` | `POST` | Segment mesh into semantic parts |
| `/api/v1/mesh-editing/*` | `POST` | Text and image guided localized mesh editing |
| `/api/v1/image-enhancement/*` | `POST`/`GET` | Image enhancement preview and artifact resolution |
| `/api/v1/auto-rigging/generate-rig` | `POST` | Generate bipedal skeleton armature |
| `/api/v1/motion-generation/generate-motion` | `POST` | Synthesize motion sequence into playable JSON |
| `/api/v1/system/jobs/{job_id}` | `GET` | Durable job status and production progress polling |
| `/api/v1/system/jobs/{job_id}/postprocess/retry` | `POST` | Retry production processing from immutable master |
| `/api/v1/mesh-tools/*` | `POST` | In-process Auto UV, Retopo, Repair, Optimize, LOD, Collision, Bake, and Convert tools |

---

## 12. Verification & Test Suite

ForMesh3D maintains unit and regression test suites across frontend and backend. Counts below reflect execution under conda environment `3daigc-api` and Bun:

```bash
# Backend Pytest Suite — 57 tests passed across backend/tests/
/opt/conda/envs/3daigc-api/bin/pytest backend/tests/

# Frontend Bun Test Suite — 18 tests across 4 files: 18 passed, 0 failed
bun test

# Frontend TypeScript compiler check
bun run test   # runs tsc --noEmit (0 errors)

# Shell Script static syntax and compliance audit (17 scripts: 17 passed)
bash scripts/tests/script_test.sh

# Compute mode resolver verification (8 checks: 8 passed)
bash scripts/tests/compute_mode_test.sh
```

**Verification Status (Audited Baseline)**:
- **Pytest Backend**: **57 passed, 0 failed** across all active test suites.
- **Bun Frontend**: **18/18 passed** across 4 files (`buildGenerationParameters.test.ts`, `meshStats.test.ts`, `workspaceBatch5.test.ts`, `route.test.mjs`); 0 failures.
- **Frontend TypeScript**: `tsc --noEmit` verified with 0 errors.
- **Shell Scripts**: 17/17 scripts verified clean.
- **Compute Mode**: 8/8 tests verified clean.

---

## 13. Frequently Asked Questions (FAQ)

<details>
<summary><strong>How does ForMesh3D protect source quality?</strong></summary>

Source generation uses model-specific inference schedules and source-density settings. Upstream models (Hunyuan3D-2.1, TRELLIS.2, SF3D) export native geometry directly without destructive intermediate smoothing. The resulting `master/source.glb` is immutable; derived artifacts operate on isolated workspaces.
</details>

<details>
<summary><strong>Can I use ForMesh3D commercially or deploy it as a paid SaaS service?</strong></summary>

**For Outputs**: Do not assume unrestricted commercial rights. Check the upstream model and checkpoint terms for the specific generator, along with applicable law, before redistributing or commercially using generated assets.

**For Code & Hosting**: ForMesh3D's original code is under Apache 2.0, while model source code, pretrained checkpoints, and datasets have separate upstream terms. Review the [ThirdParty licensing directory](backend/thirdparty/LICENSE). The main repository license does not override upstream terms.
</details>

<details>
<summary><strong>Can I generate clean quad-topology meshes for game animation?</strong></summary>

Yes. ForMesh3D natively integrates **FastMesh** alongside an adaptive **AutoRetopo** pipeline. Unlike raw generative outputs that yield messy triangle soups, ForMesh3D outputs clean quad-dominant edge loops with preserved feature creases, ready for skeletal auto-rigging and subdivision.
</details>

<details>
<summary><strong>Can ForMesh3D run 100% offline without internet?</strong></summary>

Yes. Once your model checkpoints are downloaded via `bash backend/scripts/download_models.sh`, ForMesh3D operates **completely offline**. No telemetry, prompts, reference images, or generated models are ever transmitted to any external server, ensuring complete data privacy and NDA compliance for commercial game studios.
</details>

<details>
<summary><strong>What GPU hardware is required to run ForMesh3D?</strong></summary>

ForMesh3D runs on modern NVIDIA GPUs supporting CUDA 12.4+. VRAM figures are the scheduler reservations declared in `backend/config/models.yaml`:
- **Lightweight Models (6 GB–10 GB VRAM)**: TripoSG (~8 GB), Hunyuan3D-DiT-v2-mini-Turbo (~6 GB), Unique3D (~10 GB), PartUV (~7 GB).
- **Standard Models (11.5 GB–14 GB VRAM)**: TRELLIS (~11.5 GB), Hunyuan3D-Paint v2.1 (~12 GB configured reservation), SkinTokens (~14 GB).
- **Heavy & High-Poly Models (16 GB–24 GB+ VRAM)**: FastMesh V1K (~16 GB), Pixal3D (~18 GB), TaoFlowForge (~20 GB / 10 GB low-VRAM), TRELLIS.2 (~23.5 GB, runs on RTX 3090, 4090, A10, A100).
</details>

<details>
<summary><strong>What file formats can ForMesh3D export for game engines?</strong></summary>

ForMesh3D exports standard **GLB / glTF 2.0**, **OBJ**, **STL**, and **FBX** (via isolated Blender automation). Downloaded ZIP archives are structured specifically for **Unreal Engine 5**, **Unity**, and **Godot 4**, containing game-ready meshes, LOD cascades (`lod0.glb`–`lod3.glb`), convex collision hulls (`collision.glb`), and portable physics metadata (`physics.json`).
</details>

---

## 14. State Machines and Implicit State Machine Audit

ForMesh3D's studio and scheduler are driven by dozens of scattered booleans, enums, and flags that act as **implicit state machines** — none centralized in a state-chart library. The full inventory, with verified file paths and line numbers, lives in **[Docs/TASKS.md](Docs/TASKS.md)** §2–§3 and its per-machine verification status sections, a read-only multi-agent audit.

### Post-processing default state machine
Post-processing is **disabled by default** through `postprocessing.enabled: false` in `backend/config/system.yaml`. When disabled, the scheduler forces `postprocess_mode = "none"` and `enable_postprocess = False` at `backend/core/scheduler/multiprocess_scheduler.py:2386-2388`, bypassing `run_postprocess_job` entirely. The raw model-extracted mesh is returned directly. Setting `postprocessing.enabled: true` restores the existing post-processing path.

### Frontend machines (F1–F40)
Generation/execution FSM, batch queue, viewport model load, image/mesh upload, task polling, SSE connection, feature availability, comparison, panel open/close, viewport shading/display, texture settings.

### Backend machines (B1–B19)
Job lifecycle and queue residency, worker lifecycle and busy bookkeeping, model load states, texture pipeline state.

### Generation UI Restructuring
In `GeneratePanel.tsx`, target polycount (500–600K slider passing `native_target_polycount` to adapters) and model-aware texture generation (2K/4K) are placed directly in the main panel. Secondary controls (Remove Lighting, PBR maps, Quad/Triangle topology) reside inside the dynamic portal flyout (`#geometry-texture-flyout`). The post-processing master toggle is completely removed from the UI.

### Audit methodology
On every task, scan the codebase for scattered booleans/flags acting as implicit state machines — UI toggles, loading/idle/error flows, compare modes, shading modes, presets, turntable, wireframe, snapshot, settings popover, mesh upload lifecycle, job status transitions, texture pipeline states, abort/controller flows, panel open/close, camera presets, lighting tone, exposure slider, model loader states, scheduler/worker states, job queue states, adapter registry states. For each machine report: name, states, transitions, triggers, file + line, and explicit vs implicit. Resolve overlaps, delete dead machines with zero callers, and fix shared transition logic once rather than per caller.

Docs/TASKS.md is the source of truth for the inventory; update it when machines are added, promoted to explicit enums, or removed.

---

## 15. Technical Documentation Index

| Documentation Guide | Description |
|---|---|
| 🏛️ **[System Architecture](Docs/ARCHITECTURE.md)** | Deep architectural layers, gateway design, and scheduler contracts |
| 📋 **[Product Requirements (PRD)](Docs/PRD.md)** | Core features, target users, and product roadmaps |
| 🎨 **[Design System](Docs/DESIGN.md)** | Studio Gold color tokens, UI component specifications, and layouts |
| 🛡️ **[Agent & Engineering Rules](AGENTS.md)** | Authoritative coding standards, minimalist practices, and change policies |
| 📝 **[Project Decisions (ADRs)](Docs/DECISIONS.md)** | Architecture Decision Records (up to ADR-103) |
| 🧠 **[Project Memory & Status](Docs/MEMORY.md)** | Active state, hardware prerequisites, and verified milestones |
| 📜 **[Change Log](Docs/CHANGELOG.md)** | Chronological history of releases, fixes, and optimizations |
| 📋 **[Task Tracker](Docs/TASKS.md)** | Future tasks and follow-ups; new tasks will be added here |
| ⚡ **[Physics Runtime Specification](Docs/SYSTEM-BLUEPRINT.md#physics-path)** | Rigid-body simulation, mass properties, and Rapier3D integration |
| 🔌 **[API Documentation](Docs/api-documentation.md)** | Complete endpoint schemas, request payloads, and status codes |
| ⚖️ **[Third-Party Model Sources & Licensing](backend/thirdparty/LICENSE)** | Upstream model inventory, licensing terms, and usage conditions |
| 🔒 **[Security Policy](Docs/SECURITY.md)** | Vulnerability reporting and isolated environment safety guidelines |

---

## 16. License & Legal Attribution

- **ForMesh3D Core**: Licensed under the **[Apache License 2.0](LICENSE)**.
- **Post-Processing Pipeline**: Ported and adapted from **[visualbruno/3DGenStudio](https://github.com/visualbruno/3DGenStudio)** under the **3D Gen Studio Community License**. See **[backend/postprocess/THIRD_PARTY_LICENSE.md](backend/postprocess/THIRD_PARTY_LICENSE.md)**.
- **Backend API Gateway Base**: Forked and modernized from **[FishWoWater/3DAIGC-API](https://github.com/FishWoWater/3DAIGC-API)**.
- **Neural Model Checkpoints**: Source and checkpoint terms are controlled by their respective upstream authors. See the [ThirdParty licensing directory](backend/thirdparty/LICENSE).
