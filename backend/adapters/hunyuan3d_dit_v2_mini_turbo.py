"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh
Model Name        : Hunyuan3D Mini Turbo — Image to Raw Mesh
Feature Target    : image_to_raw_mesh
Status            : STABLE - LOCKED
Upstream Repo     : https://github.com/Tencent-Hunyuan/Hunyuan3D-2
Upstream Pipeline : hy3dgen.shapegen.pipelines.Hunyuan3DDiTFlowMatchingPipeline
Checkpoint / Path : backend/pretrained/tencent/Hunyuan3D-2mini
Hardware / VRAM   : 6144 MB
-----------------------------------------------------------------------------
CRITICAL NOTICE FOR AI AGENTS:
1. THIS MODEL IS VERIFIED WORKING IN PRODUCTION INFERENCE.
2. DO NOT TOUCH, MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM
   PIPELINE CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER.
3. Locked profile: steps=20, guidance_scale=5.0, octree_resolution=380,
   num_chunks=20000. Preserved for high stability and fast execution.
=============================================================================
"""
# Status - STABLE (PROTECTED / LOCKED)
from __future__ import annotations

import contextlib
import logging
import sys
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover - torch optional in CPU-only environments
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(BaseModel):
    """Hunyuan3D Mini Turbo — Image to Raw Mesh."""

    MODEL_KEY = "tencent/Hunyuan3D-2mini"
    FEATURE_TYPE = "image_to_raw_mesh"

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
        # Make the vendored hunyuan3d-2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-2")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)
        from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D Mini Turbo pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        subfolder = "hunyuan3d-dit-v2-mini-turbo"
        subfolder_path = weights_dir_path / subfolder
        is_downloaded = (
            subfolder_path.is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        if not is_downloaded:
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D Mini Turbo weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2mini..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2mini",
                local_dir=str(weights_dir_path),
            )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        use_safetensors = (
            (subfolder_path / "model.fp16.safetensors").is_file()
            or (subfolder_path / "model.safetensors").is_file()
        )
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            str(weights_dir_path),
            subfolder=subfolder,
            use_safetensors=use_safetensors,
            device=device,
        )
        if torch is not None and torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
            try:
                pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id if self.gpu_id is not None else 0)
            except Exception as offload_err:
                logger.warning("Could not enable model CPU offload for Hunyuan3D Mini Turbo: %s", offload_err)
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D Mini Turbo pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        # Native polycount target: passed through from the generation request.
        # Hunyuan3D Mini Turbo does not expose a direct face-count parameter in its
        # upstream pipeline, so the value is logged and preserved in generation_info
        # without downstream decimation.
        native_target_polycount = int(inputs.get("native_target_polycount", 0) or 0)
        if native_target_polycount:
            logger.info("Hunyuan3D Mini Turbo received native_target_polycount=%d (upstream pipeline has no direct face-count control; preserved native output)", native_target_polycount)

        import gc
        import os
        import trimesh

        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        gc.collect()
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

        generator = None
        if torch is not None:
            generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu")
            generator.manual_seed(seed)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            outputs = pipeline(
                image=image_path,
                num_inference_steps=20,
                guidance_scale=5.0,
                octree_resolution=380,
                num_chunks=20000,
                output_type="trimesh",
                generator=generator,
            )

        gc.collect()
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

        meshes = outputs if isinstance(outputs, list) else [outputs]
        if not meshes:
            return {"success": False, "error": "Hunyuan3D Mini Turbo produced no mesh"}

        mesh = meshes[0]

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_mini_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": 20,
                "guidance_scale": 5.0,
                "octree_resolution": 380,
                "num_chunks": 20000,
                "native_target_polycount": native_target_polycount or None,
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
                }
            }
        }
