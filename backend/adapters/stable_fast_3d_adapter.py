"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : stable_fast_3d_image_to_textured_mesh
Model Name        : Stable Fast 3D (SF3D) — Image to Textured Mesh
Feature Target    : image_to_textured_mesh
Status            : ACTIVE
Upstream Repo     : https://github.com/Stability-AI/stable-fast-3d
Upstream Pipeline : sf3d.system.SF3D
Checkpoint / Path : stabilityai/stable-fast-3d (Hugging Face, gated)
Hardware / VRAM   : ~6GB for single image (fits T4/16GB consumer cards)
Speed             : ~0.5 seconds per asset on GPU with 7GB+ VRAM
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Single-image to textured-mesh adapter. Generates raw mesh + PBR texture
   (albedo + normal) in one forward pass. No separate texture stage needed.
3. Model weights are gated on Hugging Face — requires HF_TOKEN and accepted
   license before download/inference.
=============================================================================
"""
# Status - ACTIVE
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


class StableFast3DAdapter(BaseModel):
    """Stable Fast 3D — Image to Textured Mesh.

    Single-image to textured-mesh adapter. Generates a UV-unwrapped mesh with
    PBR textures (albedo + normal maps) from a single reference image in one
    forward pass. No separate texture stage needed — mesh and texture are
    produced together by the SF3D pipeline.

    Does NOT generate raw mesh without texture — use
    hunyuan3d_shape_v21_image_to_raw_mesh for raw-only generation.
    """

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
        """Load the SF3D pipeline from Hugging Face Hub.

        The model is gated — requires HF_TOKEN with accepted license on
        stabilityai/stable-fast-3d before weights can be downloaded.
        """
        # Make the vendored sf3d source importable in the worker process
        _sf3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "StableFast3D")
        if _sf3d_root not in sys.path:
            sys.path.insert(0, _sf3d_root)

        from sf3d.system import SF3D

        hf_token = os.getenv("HF_TOKEN")
        if not hf_token:
            logger.warning(
                "HF_TOKEN not set — stabilityai/stable-fast-3d weights are gated. "
                "Run 'huggingface-cli login' and accept the license on HF first."
            )

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Stable Fast 3D pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)

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
                image_path,
                bake_resolution=texture_resolution,
                remesh=remesh_option,
                vertex_count=target_vertex_count,
            )

        # SF3D exports mesh with embedded textures. Save as GLB.
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
