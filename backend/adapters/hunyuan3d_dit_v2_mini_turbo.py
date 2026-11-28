"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Hunyuan3D-2 Mini Turbo Image-to-Raw-Mesh Adapter                               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/hunyuan3d-2 (hy3dgen.shapegen.pipelines)      ║
║  Weights  : backend/pretrained/tencent/Hunyuan3D-2mini                       ║
║  Patcher  : None (CPU offload enabled on CUDA)                               ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
║  Status   : STABLE & ACTIVE                                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import logging
import os
from pathlib import Path
from typing import Any, Dict

import torch

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)


class Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(BaseModel):
    MODEL_KEY = "tencent/Hunyuan3D-2mini"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self._pipeline: Any = None

    def _load_model(self) -> Any:
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        subfolder = "hunyuan3d-dit-v2-mini-turbo"
        sub_path = weights_dir / subfolder
        if not (sub_path / "config.yaml").is_file():
            raise FileNotFoundError(f"Hunyuan3D-2mini Turbo weights missing in {weights_dir}")

        device = f"cuda:{self.gpu_id or 0}" if torch.cuda.is_available() else "cpu"
        use_safetensors = (sub_path / "model.fp16.safetensors").is_file() or (sub_path / "model.safetensors").is_file()

        with use_thirdparty("hunyuan3d-2", chdir=False):
            from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline
            logger.info("Loading Hunyuan3D-2mini Turbo from %s (device=%s)", weights_dir, device)
            pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(weights_dir), subfolder=subfolder, use_safetensors=use_safetensors, device=device
            )
            if torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
                try:
                    pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id or 0)
                except Exception as exc:
                    logger.warning("Could not enable CPU offload for Hunyuan3D-2mini: %s", exc)
            self._pipeline = pipeline
            return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            return {"success": False, "error": "Hunyuan3D Mini Turbo pipeline not loaded"}
        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"Image not found: {image_path}"}

        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        seed = int(inputs["seed"])
        gen = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(seed)
        params = {
            "num_inference_steps": int(inputs.get("num_inference_steps", 20)),
            "guidance_scale": float(inputs.get("guidance_scale", 7.5)),
            "octree_resolution": int(inputs.get("octree_resolution", 380)),
            "num_chunks": int(inputs.get("num_chunks", 20000)),
        }

        with torch.no_grad():
            mesh = self._pipeline(image=str(image_path), generator=gen, **params)[0]

        out = self._create_temporary_output_dir("hunyuan3d_mini") / f"hunyuan3d_mini_{seed}.glb"
        mesh.export(str(out))
        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "actual_face_count": len(mesh.faces),
            "actual_vertex_count": len(mesh.vertices),
            "generation_info": {"seed": seed, **params},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}


# Backward-compatible import name (previous "Standard" rename).
Hunyuan3DDiTV2MiniImageToRawMeshAdapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter
