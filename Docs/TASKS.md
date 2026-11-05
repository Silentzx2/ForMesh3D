# ForMesh3D GPU Doctor — Architecture & Implementation Plan

**Target File:** `patcher/doctor.py` (exposed via `patcher/__init__.py`)  
**Purpose:** A unified, lightweight, reusable GPU compatibility, memory management, and error-recovery utility for large 3D neural generative models.  
**Primary Target Models:** TRELLIS.2, Pixal3D, and TaoFlowForge.  
**Governing Philosophy:** Ponytail Ultra Mode — shortest working diff, zero unrequested bloat, zero global monkeypatching, 100% upstream parity for modern GPUs (`sm >= 80`).  
**Adapter Integration Status:** Staged / Deferred (Doctor core implemented standalone first; no adapter or model code modified until explicit user verification).

---

## 1. Why We Are Building GPU Doctor

Running large 2025/2026 generative 3D neural models (1.3B to 3B+ parameters) on heterogeneous GPU environments (ranging from consumer 16GB GPUs like Tesla T4 `sm_75` to large cloud GPUs like A100/H100 `sm >= 80`) introduces distinct hardware and runtime bottlenecks:

1. **Precision & Exponent Range Mismatches**:
   - Modern DiT models are trained in native BFloat16. Running them on pre-Ampere GPUs (which lack hardware BF16 tensor cores) triggers slow software scalar emulation (~10s/step instead of ~1s/step) or numerical drift (e.g. Stage 0 exponent overflow or negative logit shifting).
   - Inappropriate FP16 casting can cause catastrophic underflow/overflow (> 65,504) resulting in `NaN` occupancy grids.
2. **Attention Backend Incompatibilities**:
   - Official FlashAttention 2/3 requires `sm >= 80` (Ampere+).
   - Pre-Ampere GPUs (`sm < 80`) fall back to PyTorch SDPA or xFormers. When PyTorch SDPA falls back to `SDPBackend.MATH` on long token sequences (e.g. 15,000+ tokens in TaoFlowForge Stage 1), it materializes unchunked $N \times L \times L$ attention matrices, causing **10.06 GiB CUDA Out of Memory** crashes.
3. **VRAM Exhaustion on 16GB Cards**:
   - Large multi-stage pipelines (e.g., TRELLIS.2's 14.2 GB checkpoint suite across 8 submodels, or TaoFlowForge's 3-stage flow) cannot fit all submodels resident in 16GB VRAM simultaneously alongside activation buffers.
   - Submodels must be offloaded sequentially (CPU $\leftrightarrow$ GPU) without leaking VRAM or thrashing memory.
4. **Scattered Workarounds & Technical Debt**:
   - Previously, fixes were placed ad-hoc across third-party sources or individual adapters. This made maintaining and onboarding new models fragile.

**GPU Doctor centralizes reusable GPU diagnosis, precision routing, memory offloading (via Hugging Face Accelerate & native PyTorch), attention negotiation, and guarded error recovery in one standalone file.**

---

## 2. Current Codebase Audit & Architectural Reality

An exhaustive audit of the active ForMesh3D repository reveals the following baseline:

### 2.1 Dependencies & Environment
- **Hugging Face `accelerate`**: Verified present in `backend/requirements.txt` (`accelerate>=1.0.0`) and installed in the active environment as `v1.15.0`.
- **PyTorch**: PyTorch 2.5.1 / CUDA 12.4 with SDPA (`torch.nn.functional.scaled_dot_product_attention`) and `sdpa_kernel` context managers.
- **xFormers**: Verified importable for pre-Ampere memory-efficient attention.

### 2.2 Model Architecture & Existing Workarounds Audit

| Model | Architecture & Checkpoints | Known Pre-Ampere Bottlenecks | Current Codebase Status | Doctor Integration Strategy |
|---|---|---|---|---|
| **TRELLIS.2** | 1.3B Flow DiT (`ss_flow_img_dit_1_3B_64_bf16`) + 3D Conv Decoder (`ss_dec_conv3d_16l8_fp16`) + SLat Cascade (512/1024/1536) | 1. T4 lacks FlashAttention (`sm_75`).<br>2. 12 Euler steps on pre-Ampere shift logits to negative values (`max_logit = -74.8`).<br>3. Total checkpoints = 14.2 GB. | Fixed: Native `low_vram=True` moves submodels CPU$\leftrightarrow$GPU. Palette alpha transparency handled. Adaptive top-k percentile voxel fallback prevents empty coordinate crashes. Native BF16 preserved on `sm >= 80`. | Declare `ModelProfile` with native `low_vram` hooks, top-k voxel recovery guard, and SDPA fallback. |
| **Pixal3D** | DinoV3Proj Feature Extractor (`camenduru/dinov3-vitl16-pretrain-lvd1689m`) + Pixel-aligned 512/1024 Cascade Flow Matching | 1. High VRAM requirement (14,336 MB declared in `models.yaml`).<br>2. Multiple projection condition feature extractors (SS, shape_512, shape_1024, tex_1024) take VRAM.<br>3. Requires camera angle estimation. | Fixed: Image condition models load from HuggingFace with fallback; resolution cascade supported up to 1024. | Declare `ModelProfile` supporting HuggingFace Accelerate `dispatch_model` or CPU offload for condition extractors; precision routing to FP16 on T4. |
| **TaoFlowForge** | 3-Stage Cascaded Flow Matching (Stage 0: 64³ coarse occupancy, Stage 1: 512³ fine vertices with Octree DiT, Stage 2: topology & connectivity) | 1. FP16 autocast caused DiT exponent overflow (`max_prob=nan`).<br>2. Stage 1 refinement (15,000+ tokens) triggered 10.06 GiB SDPA Math OOM. | Fixed: `get_compute_dtype()` returns `torch.bfloat16` to prevent NaN collapse. Stage 1 query chunking (`chunk_size=1024`) reduces peak attention memory from 10.06 GiB to 30 MB. Stage-wise VRAM offload (`offload="on"`). | Declare `ModelProfile` with stage-wise offload enforcement, query chunking, and BF16 DiT / FP16 SDPA precision policy. |
| **Locked Models** (Hunyuan3D-2.1 Shape, Hunyuan3D-2 Mini Turbo, Unique3D) | Diverse | Fully stable, verified in production inference. | **STABLE / LOCKED**: Do not touch or modify under any circumstances. | Excluded from active modifications. |

---

## 3. Analysis of Candidate Implementation Approaches

To design GPU Doctor, three distinct architectural approaches were evaluated:

### Approach 1: Global Runtime Monkeypatching & Exception Interceptor
- **Mechanism**: Globally patch `torch.nn.functional.scaled_dot_product_attention`, override `torch.Tensor.to`, and install a global `sys.excepthook` to intercept and rewrite operations dynamically across all models.
- **Drawbacks**:
  - Blatantly violates AGENTS.md Priority Rule #2 ("Model Code Direct Patching over Global Monkeypatching").
  - In a multi-worker architecture (`multiprocess_scheduler.py`), global monkeypatches leak across workers, breaking sibling pipelines (e.g., interfering with locked Hunyuan3D models).
  - Hard to debug, highly unpredictable under load.
- **Verdict**: **REJECTED.**

### Approach 2: Heavyweight Multi-File Subsystem / Framework
- **Mechanism**: Build a multi-package framework (`backend/doctor/` with `backends/`, `dispatchers/`, `monitors/`, `quantization/`, `strategies/`, `profiles/`).
- **Drawbacks**:
  - Extreme boilerplate and unnecessary abstraction (violates Ponytail Ultra and YAGNI).
  - Complicates remote deployment on Kaggle/Colab/headless nodes where single-file distribution is optimal.
  - High maintenance overhead without adding architectural value.
- **Verdict**: **REJECTED.**

### Approach 3: Smart Minimalist Single-File Doctor Facade with Declarative Profiles (Chosen Approach)
- **Mechanism**:
  - Implement everything inside **one compact, modular, fully typed file**: `patcher/doctor.py` (exposed via `patcher/__init__.py`).
  - Use native PyTorch (`torch.cuda`, `torch.autocast`, `sdpa_kernel`) and Hugging Face `accelerate` (`infer_auto_device_map`, `dispatch_model`, `cpu_offload`) directly.
  - Model facts (supported dtypes, no-split classes, offload styles, chunking rules) are stored in declarative `ModelProfile` instances.
  - The public facade `GPUDoctor` provides pure, testable methods (`inspect_gpu`, `select_precision`, `build_memory_plan`, `prepare_model`, `track_stage`, `classify_error`, `recover`).
- **Why this is the Smartest & Easiest Approach**:
  1. **Zero Adapter Invasiveness**: Adapters remain 100% functional without it. Connecting GPU Doctor requires only 2-3 lines at the adapter boundary (`doctor.prepare_model` and `with doctor.track_stage`).
  2. **100% Upstream Parity on Modern GPUs (`sm >= 80`)**: When `gpu_info.is_pre_ampere` is False, GPU Doctor selects native BF16 FlashAttention mode with zero fallbacks and zero overhead.
  3. **Mathematically Exact Pre-Ampere Mitigations**: Query chunking (`chunk_size=1024`) reduces peak attention memory from 10.06 GiB to 30 MB with a mathematical difference of `0.0`.
  4. **Fully Testable on CPU**: Every logic branch, precision decision, device plan, error classification, and fallback rule can be verified via unit tests on CPU without requiring physical GPUs.
- **Verdict**: **ACCEPTED & CHOSEN.**

---

## 4. Architectural Blueprint of `GPUDoctor`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ForMesh3D Model Worker Process                        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      Adapter Lifecycle Boundary                     │   │
│   │                                                                     │   │
│   │  1. adapter._load_model()                                           │   │
│   │     └─► doctor.inspect_gpu(device_id)                               │   │
│   │     └─► doctor.build_memory_plan(model_id, profile, model)          │   │
│   │     └─► doctor.prepare_model(model, plan)                           │   │
│   │                                                                     │   │
│   │  2. adapter._process_request(inputs)                                │   │
│   │     └─► with doctor.track_stage(stage_name="sampling"):             │   │
│   │             outputs = pipeline.run(...)                             │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         patcher/doctor.py                           │   │
│   │                                                                     │   │
│   │  ┌───────────────────────┐         ┌─────────────────────────────┐  │   │
│   │  │   GPU & Capability    │         │      Precision Engine       │  │   │
│   │  │   - sm_capability     │         │   - sm >= 80 -> Native BF16 │  │   │
│   │  │   - total / free VRAM │         │   - sm < 80  -> FP16 / BF16 │  │   │
│   │  │   - is_pre_ampere     │         │   - scoped autocast context │  │   │
│   │  └──────────┬────────────┘         └──────────────┬──────────────┘  │   │
│   │             │                                     │                 │   │
│   │  ┌──────────▼────────────┐         ┌──────────────▼──────────────┐  │   │
│   │  │ Accelerate / Offload  │         │      Attention Router       │  │   │
│   │  │   - cpu_offload       │         │   - FlashAttention on sm>=80│  │   │
│   │  │   - dispatch_model    │         │   - xFormers on pre-Ampere  │  │   │
│   │  │   - stage cache purge │         │   - Query chunking (1024)   │  │   │
│   │  └──────────┬────────────┘         └──────────────┬──────────────┘  │   │
│   │             │                                     │                 │   │
│   │             └──────────────────┬──────────────────┘                 │   │
│   │                                │                                    │   │
│   │             ┌──────────────────▼──────────────────┐                 │   │
│   │             │    Error Classifier & Recovery      │                 │   │
│   │             │   - CUDA OOM -> Cache reset/offload │                 │   │
│   │             │   - Logit shift -> Top-k recovery   │                 │   │
│   │             │   - Math OOM -> Query chunking      │                 │   │
│   │             └─────────────────────────────────────┘                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Specification of Public API & Data Contracts

All data structures and functions reside in `patcher/doctor.py`:

### 5.1 `GPUInfo`
```python
@dataclass
class GPUInfo:
    device_id: int
    device_name: str
    major: int
    minor: int
    compute_capability: Tuple[int, int]
    total_vram_gb: float
    free_vram_gb: float
    supports_bf16: bool
    supports_flash_attn: bool
    is_pre_ampere: bool
    is_cpu: bool = False
```

### 5.2 `DoctorConfig`
```python
@dataclass
class DoctorConfig:
    mode: Literal["auto", "safe", "disabled"] = "auto"
    vram_safety_reserve_gb: float = 1.5
    enable_offload: bool = True
    enable_attention_fallback: bool = True
    enable_recovery: bool = True
    max_retries: int = 2
    verbose: bool = True
```

### 5.3 `ModelProfile`
```python
@dataclass
class ModelProfile:
    model_id: str
    supported_dtypes: List[torch.dtype] = field(default_factory=lambda: [torch.float32])
    supports_bf16: bool = False
    supports_fp16: bool = True
    supports_fp32: bool = True
    supports_accelerate_dispatch: bool = False
    supports_cpu_offload: bool = False
    no_split_module_classes: List[str] = field(default_factory=list)
    pipeline_type: str = "generic"
    attention_backend_preference: List[str] = field(default_factory=lambda: ["flash_attn", "sdpa", "xformers"])
    allow_query_chunking: bool = False
    default_chunk_size: int = 1024
```

### 5.4 `StageRecord`
```python
@dataclass
class StageRecord:
    stage_name: str
    duration_s: float = 0.0
    initial_vram_mb: float = 0.0
    peak_vram_mb: float = 0.0
    success: bool = True
    error_msg: Optional[str] = None
```

### 5.5 `RecoveryEvent`
```python
@dataclass
class RecoveryEvent:
    stage_name: str
    error_type: str
    original_error: str
    action_taken: str
    success: bool
    timestamp: float = field(default_factory=time.time)
    details: Dict[str, Any] = field(default_factory=dict)
```

### 5.6 `DoctorReport`
```python
@dataclass
class DoctorReport:
    model_name: str = "unknown"
    gpu_info: Optional[GPUInfo] = None
    plan: Dict[str, Any] = field(default_factory=dict)
    events: List[RecoveryEvent] = field(default_factory=list)
    stages: List[StageRecord] = field(default_factory=list)
    stage_timings: Dict[str, float] = field(default_factory=dict)
    final_status: Literal["PASS", "FAIL", "NOT_RUN"] = "NOT_RUN"

    def format_summary(self) -> str: ...
```

### 5.7 Built-In Target Model Profiles

#### Profile: TRELLIS.2
- `model_id`: `"trellis2"`
- `supports_bf16`: `True` (native DiT trained in BF16)
- `supports_fp16`: `True` (decoders in FP16)
- `supports_accelerate_dispatch`: `False` (TRELLIS.2 uses custom SparseTensor and sparse coordinates; generic split causes graph partition errors)
- `supports_cpu_offload`: `True` (native sequential `pipeline.low_vram=True`)
- `attention_backend_preference`: `["flash_attn", "sdpa", "xformers"]`
- `allow_query_chunking`: `False` (dense attention in DiT uses standard SDPA; sparse attention uses spconv/xformers)

#### Profile: Pixal3D
- `model_id`: `"pixal3d"`
- `supports_bf16`: `True`
- `supports_fp16`: `True`
- `supports_accelerate_dispatch`: `True` (standard DiT / projection feature extractor modules)
- `supports_cpu_offload`: `True`
- `no_split_module_classes`: `["DinoV3ProjFeatureExtractor"]`
- `attention_backend_preference`: `["flash_attn", "sdpa"]`
- `allow_query_chunking`: `True`

#### Profile: TaoFlowForge
- `model_id`: `"taoflowforge"`
- `supports_bf16`: `True` (DiT flow matching compute dtype)
- `supports_fp16`: `True` (SDPA kernel execution on pre-Ampere)
- `supports_accelerate_dispatch`: `False` (pipeline manages stage modules natively)
- `supports_cpu_offload`: `True` (explicit stage-wise `offload="on"`)
- `no_split_module_classes`: `["OctreeDiTBlock", "Stage0Model", "Stage1Model", "Stage2Model"]`
- `attention_backend_preference`: `["fa3", "fa2", "sdpa"]`
- `allow_query_chunking`: `True` (`chunk_size=1024` eliminates 10 GiB OOM in Stage 1)

---

## 6. Implementation Stages & Verification Checklist

- [x] **Stage 0 — Audit & Dependency Verification**:
  - `accelerate` confirmed at `backend/requirements.txt:31` and installed (`v1.15.0`).
  - Verified TRELLIS.2, Pixal3D, and TaoFlowForge loading mechanisms.
  - Locked models verified and excluded.
- [x] **Stage 1 — Core Standalone Implementation (`patcher/doctor.py`)**:
  - Implement `GPUInfo`, `DoctorConfig`, `ModelProfile`, `StageRecord`, `RecoveryEvent`, `DoctorReport`.
  - Implement `GPUDoctor` methods:
    - `inspect_gpu()`
    - `select_precision()`
    - `get_autocast_context()`
    - `build_memory_plan()`
    - `prepare_model()`
    - `select_attention_backend()`
    - `chunked_scaled_dot_product_attention()` (supports 3D/4D tensors, sliced masks, custom scale)
    - `clean_cache()`
    - `track_stage()` (yields `StageRecord` with duration and peak VRAM)
    - `classify_error()`
    - `can_recover()`
    - `recover()` (bounded retries via `max_retries`)
    - `get_model_profile()` & `register_profile()`
    - `get_report()` & `clear_report()`
  - Exposed via `patcher/__init__.py` and `patcher/doctor.py`.
- [x] **Stage 2 — Unit Test Coverage (`backend/tests/test_gpu_doctor.py`)**:
  - GPU capability detection on CPU and mocked CUDA environments (T4, A100, H100).
  - Precision policy validation (native BF16 on `sm >= 80`, FP16/BF16 on T4).
  - Query chunking mathematical equivalence tests (diff = 0.0) across 3D, 4D, with/without masks, custom scales, and causal rejection.
  - Error classification tests across all 7 categories (`cuda_oom`, `unsupported_precision`, `dtype_mismatch`, `device_mismatch`, `attention_backend_failure`, `sparse_empty_voxels`, `unknown`).
  - Stage tracking yielding `StageRecord`, memory telemetry, and bounded recovery event logging.
  - Safe cache cleanup execution on CPU.
  - **Result: 28/28 tests passed**.
- [ ] **Stage 3 — Adapter Integration (Deferred as instructed)**:
  - DO NOT touch adapters or models right now.
  - Integration will be performed model-by-model upon explicit user instruction.

---

## 7. Deferred Adapter Integration Reference

When the user gives the instruction to wire an adapter into GPU Doctor, the integration is minimal (2-3 lines per adapter):

```python
# In adapter._load_model():
from patcher import GPUDoctor

doctor = GPUDoctor()
gpu_info = doctor.inspect_gpu(self.gpu_id)
profile = doctor.get_model_profile("trellis2")
plan = doctor.build_memory_plan("trellis2", profile, pipeline, gpu_info)
pipeline = doctor.prepare_model(pipeline, plan)

# In adapter._process_request():
with doctor.track_stage("trellis2_inference"):
    meshes = pipeline.run(...)
```

No third-party model code needs to be modified. All adapters for locked/working models remain completely untouched.
