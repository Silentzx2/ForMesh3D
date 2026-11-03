"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : hunyuan3d_shape_v21_image_to_raw_mesh
Model Name        : Hunyuan3D Shape v2.1 — Image to Raw Mesh
Feature Target    : image_to_raw_mesh
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
Upstream Pipeline : hy3dshape.pipelines.Hunyuan3DDiTFlowMatchingPipeline
Checkpoint / Path : backend/pretrained/tencent/Hunyuan3D-2.1
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Adhere strictly to the adapter-owned inference profile and direct patching.
=============================================================================
"""
# Status - BETA / ACTIVE
from __future__ import annotations

import contextlib
import logging
import os
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


class Hunyuan3DShapeV21ImageToRawMeshAdapter(BaseModel):
    """Adapter for Hunyuan3D-2.1 Shape image-to-raw-mesh generation."""

    MODEL_KEY = "tencent/Hunyuan3D-2.1"
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
        # hy3dshape is the package directory; sys.path must contain its parent.
        # Hunyuan3D-2.1/hy3dshape/hy3dshape/__init__.py is the package entrypoint.
        shape_import_root = (
            Path(__file__).resolve().parents[1]
            / "thirdparty"
            / "Hunyuan3D-2.1"
            / "hy3dshape"
        )
        if not (shape_import_root / "hy3dshape" / "__init__.py").is_file():
            raise ImportError(f"Hunyuan3D-2.1 Shape package not found under {shape_import_root}")
        shape_import_root = str(shape_import_root)
        if shape_import_root not in sys.path:
            sys.path.insert(0, shape_import_root)

        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-2.1 Shape pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        # Check for actual Hunyuan3D-2.1 checkpoint structure (hunyuan3d-dit-v2-1 subfolder)
        is_downloaded = (
            (weights_dir_path / "hunyuan3d-dit-v2-1").is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        if not is_downloaded:
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D-2.1 Shape weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2.1..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2.1",
                local_dir=str(weights_dir_path),
            )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch and torch.cuda.is_available() else "cpu"
        self.device = device
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            str(weights_dir_path),
            device=device,
        )
        if torch is not None and torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
            try:
                pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id if self.gpu_id is not None else 0)
            except Exception as offload_err:
                logger.warning("Could not enable model CPU offload for Hunyuan3D Shape v2.1: %s", offload_err)
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2.1 Shape pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        import gc
        gc.collect()
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

        seed = int(inputs.get("seed", DEFAULT_SEED))
        exec_device = getattr(pipeline, "_execution_device", None)
        gen_device = exec_device if exec_device is not None else (f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch and torch.cuda.is_available() else "cpu")
        generator = torch.Generator(device=gen_device).manual_seed(seed) if torch is not None else None

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            outputs = pipeline(
                image=image_path,
                num_inference_steps=50,
                guidance_scale=7.5,
                octree_resolution=512,
                num_chunks=8000,
                output_type="trimesh",
                generator=generator,
            )

        # The vendored pipeline exports a flat List[trimesh.Trimesh]; failed
        # surface extraction is represented by None entries in that list.
        if isinstance(outputs, (list, tuple)):
            mesh = next((item for item in outputs if item is not None), None)
        else:
            mesh = outputs
        if mesh is None:
            return {"success": False, "error": "Hunyuan3D-2.1 Shape produced no mesh"}
        if not callable(getattr(mesh, "export", None)):
            return {
                "success": False,
                "error": f"Hunyuan3D-2.1 returned an unsupported mesh result: {type(mesh).__name__}",
            }

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_shape_{seed}.glb"
        mesh.export(str(out))
        if not out.is_file():
            return {"success": False, "error": "Hunyuan3D-2.1 mesh export did not create a file"}

        gc.collect()
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": 50,
                "guidance_scale": 7.5,
                "octree_resolution": 512,
                "num_chunks": 8000,
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
