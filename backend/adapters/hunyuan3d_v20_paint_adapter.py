"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Hunyuan3D-2 (v2.0) Image Mesh Painting Adapter                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/hunyuan3d-2 (hy3dgen.texgen.pipelines)        ║
║  Weights  : backend/pretrained/Hunyuan3D-2                                   ║
║  Patcher  : None (CPU offload enabled on CUDA)                               ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import logging
from pathlib import Path
from typing import Any, Dict

import torch
import trimesh
from PIL import Image

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)


class Hunyuan3DV20PaintImageMeshPaintingAdapter(BaseModel):
    MODEL_KEY = "Hunyuan3D-2"
    FEATURE_TYPE = "image_mesh_painting"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self._paint_pipeline: Any = None

    def _load_model(self) -> Any:
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        if not weights_dir.is_dir():
            raise FileNotFoundError(f"Hunyuan3D-2 Paint weights missing: {weights_dir}")

        paint_sub = (
            "hunyuan3d-paint-v2-0-turbo"
            if (weights_dir / "hunyuan3d-paint-v2-0-turbo" / "model_index.json").is_file()
            else "hunyuan3d-paint-v2-0"
        )
        if not (weights_dir / paint_sub / "model_index.json").is_file():
            raise FileNotFoundError(f"Hunyuan3D-2 Paint checkpoint ({paint_sub}) missing in {weights_dir}")

        with use_thirdparty("hunyuan3d-2", chdir=False):
            from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline
            logger.info("Loading Hunyuan3D-2 Paint (%s) from %s", paint_sub, weights_dir)
            pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir), subfolder=paint_sub)
            if torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
                try:
                    pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id or 0)
                except Exception as exc:
                    logger.warning("Could not enable CPU offload for Hunyuan3D v2.0 Paint: %s", exc)
            self._paint_pipeline = pipeline
            return pipeline

    def _unload_model(self) -> None:
        self._paint_pipeline = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._paint_pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2 Paint pipeline not loaded"}
        mesh_path = inputs.get("mesh_path")
        image_path = inputs.get("image_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"Mesh not found: {mesh_path}"}
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"Image not found: {image_path}"}

        seed = int(inputs["seed"])
        mesh = trimesh.load(mesh_path, process=False)
        image = Image.open(image_path)
        with torch.no_grad():
            textured = self._paint_pipeline(mesh=mesh, image=image)

        out = self._create_temporary_output_dir("hunyuan3d_v20_paint") / f"hunyuan3d_v20_paint_{seed}.glb"
        textured.export(str(out))
        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "generation_info": {"seed": seed, "texture_enabled": True},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "obj", "ply", "stl"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
