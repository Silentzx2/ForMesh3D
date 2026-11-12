# ForMesh3D — Active Engineering Tasks & Implementation Specifications

**Document Status:** Active Engineering Roadmap & Implementation Plan  
**Updated:** 2026-11-11

---

## 🟡 OPEN — TEX-4: Stable Fast 3D (SF3D) Adapter — Single Image → Textured Mesh

**Priority:** High | **Area:** Backend Adapters / Scheduler / Frontend / Download Manager | **Status:** PLANNED — NOT IMPLEMENTED

**Description:**
Add Stability Fast 3D (SF3D) as a new image-to-textured-mesh adapter. SF3D generates a raw mesh AND PBR textures (albedo + normal) from a single reference image in one forward pass, using ~6GB VRAM and running in ~0.5 seconds on a GPU with 7GB+. Unlike Hunyuan3D-2-Paint (texture-only), SF3D is a complete image→textured-mesh pipeline. The model is gated on Hugging Face (requires access request + HF token) and uses the Stability AI license (non-MIT).

**Model Details (from research):**
- Model ID: `stabilityai/stable-fast-3d` (Hugging Face, gated)
- Upstream: https://github.com/Stability-AI/stable-fast-3d
- Paper: SIGGRAPH Asia 2026
- VRAM: ~6GB for single image input (fits T4/16GB consumer cards)
- Speed: ~0.5 seconds per asset on GPU with 7GB+ VRAM
- Output: Textured GLB with UV unwrapping, albedo + normal maps
- License: Stability AI Community License (non-MIT, gated weights)
- Python: 3.8+, CUDA or MPS
- Texture resolution: 512 / 1024 (default) / 2048 pixels
- Based on TripoSR architecture with UV-unwrapping and illumination disentanglement
- Third-party vendored at: `backend/thirdparty/StableFast3D/`

**Files to touch:**

1. `backend/adapters/stable_fast_3d_adapter.py` — NEW adapter file
   - Class: `StableFast3DAdapter(BaseModel)`
   - MODEL_KEY: `stabilityai/stable-fast-3d`
   - FEATURE_TYPE: `image_to_textured_mesh` (single pass: raw mesh + texture)
   - `__init__`: `self._pipeline = None`, `self.device = "cpu"`, `self.gpu_id = None`
   - `_load_model`: Load SF3D pipeline from `stabilityai/stable-fast-3d` HF repo. Requires HF token for gated access. Move pipeline to GPU device. Import from vendored `thirdparty/StableFast3D/sf3d/system.py`.
   - `_unload_model`: Clear `self._pipeline`, `self.model`
   - `_process_request`: Takes `image_path` + `texture_resolution`, runs `pipeline.run_image(image, bake_resolution=..., remesh=..., vertex_count=...)`, returns `(mesh, glob_dict)` → save as GLB, return `output_mesh_path`, `mesh_path`, `texture_enabled: True`, `generation_info` with seed, texture_resolution
   - Texture is generated as part of the same pipeline (not separate stage)
   - Guard with try/except — texture/mesh generation failure returns error gracefully

2. `backend/adapters/__init__.py` — Register `stable_fast_3d_image_to_textured_mesh` → `backend.adapters.stable_fast_3d_adapter`

3. `backend/config/models.yaml` — Add `stable_fast_3d_image_to_textured_mesh` entry under `image_to_textured_mesh` feature category with `vram_requirement: 6144`, `supportsTexture: true`, `cpu_offload: false`

4. `backend/scripts/download_models.sh` — Add `download_stable_fast_3d()` function that downloads from `stabilityai/stable-fast-3d` HF repo (requires HF token). Add to `AVAILABLE_MODELS`, case statement, and "all" case.

5. `constants/models.ts` — Add frontend model entry with `category: 'mesh_generation'`, `feature: 'image_to_textured_mesh'`, `vramMb: 6144`, `supportsTexture: true`, `supportedInputs: ['image']`, `supportedOutputs: ['glb', 'obj']`, `modelPath: 'backend/pretrained/stable-fast-3d'`

6. `features/workspace/Panels/GeneratePanel.tsx` — Model appears automatically via `getModelsForFeature('image_to_textured_mesh')` if registry-driven. May need to add to model selection UI.

7. `backend/api/routers/mesh_generation.py` — No code change needed if `validate_model_preference()` checks `_ADAPTER_MAP` registry. Model ID flows through as `model_preference`.

**Adapter pattern for SF3D:**

```python
class StableFast3DAdapter(BaseModel):
    """Stable Fast 3D — Single image to textured mesh."""

    MODEL_KEY = "stabilityai/stable-fast-3d"
    FEATURE_TYPE = "image_to_textured_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        self.model_id = kwargs.get("model_id")
        self.model_path: Path | None = None
        self.vram_requirement = vram_requirement
        self.feature_type = kwargs.get("feature_type", self.FEATURE_TYPE)
        self.status = ModelStatus.UNLOADED
        self.gpu_id: int | None = None
        self.gpu_ids: list[int] = []
        self.resource_plan: dict[str, Any] = {}
        self.native_topology = False
        self.model: Any = None
        self.device = "cpu"
        self.dtype = None
        self.version = "1.0"
        self.experimental = False
        self._pipeline: Any = None

    def _load_model(self) -> Any:
        _sf3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "StableFast3D")
        if _sf3d_root not in sys.path:
            sys.path.insert(0, _sf3d_root)
        from sf3d.system import SF3D
        hf_token = os.getenv("HF_TOKEN")
        if not hf_token:
            logger.warning("HF_TOKEN not set — SF3D weights are gated")
        pipeline = SF3D.from_pretrained(
            str(weights_dir_path),
            config_name="config.yaml",
            weight_name="model.safetensors",
        )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline.to(device)
        pipeline.eval()
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Stable Fast 3D pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        texture_resolution = int(inputs.get("texture_resolution", 1024))
        remesh_option = inputs.get("remesh_option", "none")
        target_vertex_count = int(inputs.get("target_vertex_count", -1))

        import tempfile
        output_dir = Path(tempfile.mkdtemp())

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            mesh, glob_dict = pipeline.run_image(
                image,
                bake_resolution=texture_resolution,
                remesh=remesh_option,
                vertex_count=target_vertex_count,
            )

        out = Path(tempfile.mkdtemp()) / f"stable_fast_3d_{seed}.glb"
        mesh.export(str(out), include_normals=True)

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "textured_mesh_path": str(out),
            "texture_enabled": True,
            "generation_info": {
                "seed": seed,
                "texture_resolution": texture_resolution,
                "remesh_option": remesh_option,
                "target_vertex_count": target_vertex_count,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": DEFAULT_SEED,
                    "minimum": 0,
                    "required": False,
                },
                "texture_resolution": {
                    "type": "integer",
                    "description": "Output texture atlas resolution in pixels",
                    "default": 1024,
                    "minimum": 512,
                    "maximum": 2048,
                    "required": False,
                },
                "remesh_option": {
                    "type": "string",
                    "description": "Remeshing operation: none, triangle, or quad",
                    "default": "none",
                    "required": False,
                },
                "target_vertex_count": {
                    "type": "integer",
                    "description": "Target vertex count for decimation (-1 = no reduction)",
                    "default": -1,
                    "required": False,
                },
            }
        }
```

**Acceptance criteria:**
- `py_compile` passes on new adapter file
- `tsc --noEmit` → 0 errors (frontend model entry)
- `bash -n download_models.sh` → shell syntax OK
- `texture_enabled` flows from API → scheduler → adapter (already wired)
- Adapter loads pipeline in single `_load_model` call (no second weights load)
- Model appears in TexturePanel / GeneratePanel dropdowns
- Download script downloads SF3D weights via HF (requires HF token)
- `sm >= 80` path untouched (zero regression)
- HF token required for gated weights — adapter logs warning if missing

**Risks / skipped:**
- Live GPU inference not run (no GPU available)
- SF3D model is gated on Hugging Face — requires `hf auth login` + accepted license before weights can download
- SF3D license is Stability AI Community License (non-MIT) — review before commercial use
- SF3D Python API follows `pipeline.run_image(image, bake_resolution=..., remesh=..., vertex_count=...)` — verified from vendored `sf3d/system.py`
- Texture resolution is set per-request (512/1024/2048), not per-model preset

---

## ✅ COMPLETE — TEX-1: Texture pipeline inside adapter; raw + texture in one weights load; complete Paint3D removal from main repo

**Priority:** High | **Status:** DONE

All three texture-capable models implemented:
- Hunyuan3D-2.1 (`hunyuan3d_adapter_v21.py`) ✅
- TRELLIS (`trellis_adapter.py`) ✅
- TRELLIS.2 (`trellis2_adapter.py`) ✅

Paint3D fully removed from main repo. CPU offload wired. Structured logging wired.

---

## ✅ COMPLETE — TEX-2: Strong pipeline logging & clear log formatting

**Priority:** High | **Status:** DONE

JobContextFilter created, logging.yaml Option 2 format, API entry/exit logging wired.

---

## ✅ COMPLETE — TEX-3: Hunyuan3D-2 (v2.0) Paint texture adapter

**Priority:** Medium | **Status:** IMPLEMENTED — NOT COMMITTED

Hunyuan3D-2 (v2.0) texture-only paint adapter implemented:
- `backend/adapters/hunyuan3d_v20_paint_adapter.py` — NEW texture-only adapter
- `backend/adapters/__init__.py` — registered `hunyuan3d_v20_paint_image_mesh_painting`
- `backend/config/models.yaml` — added entry with `cpu_offload: true`, 11000 MB VRAM
- `backend/scripts/download_models.sh` — added `download_hunyuan3d_v20_paint()` (texture weights only)
- `constants/models.ts` — added frontend model entry
- VRAM: ~11 GB — fits on 16 GB consumer cards

---
