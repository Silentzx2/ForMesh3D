"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TripoSG Image-to-Raw-Mesh Adapter                                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/TripoSG (scripts/inference_triposg.py)        ║
║  Weights  : backend/pretrained/TripoSG (+ sibling RMBG-1.4)                  ║
║  Patcher  : patcher.triposg.apply_patch()                                    ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import logging
from pathlib import Path
from typing import Any, Dict

import torch

from core.models.base import BaseModel
from core.utils.upstream import load_thirdparty_script, resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)


class TripoSGImageToRawMeshAdapter(BaseModel):
    MODEL_KEY = "TripoSG"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.device = "cpu"
        self.dtype = None
        self._pipe: Any = None
        self._rmbg: Any = None

    def _load_model(self) -> Any:
        self.device = f"cuda:{self.gpu_id or 0}" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if self.device.startswith("cuda") else torch.float32

        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        rmbg_dir = weights_dir.parent / "RMBG-1.4"
        if not weights_dir.is_dir():
            raise FileNotFoundError(f"TripoSG weights missing: {weights_dir}")
        if not rmbg_dir.is_dir():
            raise FileNotFoundError(f"RMBG-1.4 weights missing: {rmbg_dir}")

        try:
            from patcher.triposg import apply_patch
            apply_patch()
        except ImportError:
            pass

        with use_thirdparty("TripoSG", chdir=False):
            from triposg.pipelines.pipeline_triposg import TripoSGPipeline
            briarmbg = load_thirdparty_script("TripoSG", "scripts/briarmbg.py")
            logger.info("Loading TripoSG from %s on %s", weights_dir, self.device)
            self._rmbg = briarmbg.BriaRMBG.from_pretrained(str(rmbg_dir)).to(self.device).eval()
            self._pipe = TripoSGPipeline.from_pretrained(str(weights_dir), torch_dtype=self.dtype).to(self.device)
        return self._pipe

    def _unload_model(self) -> None:
        self._pipe = None
        self._rmbg = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        image_path = inputs.get("image_path") or inputs.get("image")
        params = {
            "seed": int(inputs["seed"]),
            "num_inference_steps": int(inputs.get("num_inference_steps", 50)),
            "guidance_scale": float(inputs.get("guidance_scale", 7.0)),
            "faces": int(inputs.get("faces", -1)),
        }
        inf = load_thirdparty_script("TripoSG", "scripts/inference_triposg.py")
        with torch.no_grad():
            mesh = inf.run_triposg(self._pipe, image_path, self._rmbg, **params)

        out = self._create_temporary_output_dir("triposg") / f"triposg_{params['seed']}.glb"
        mesh.export(str(out))
        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "generation_info": params,
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
