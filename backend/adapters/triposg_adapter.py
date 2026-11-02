"""TripoSG adapter — thin integration over the official ThirdParty inference API.

Wraps ``triposg.pipelines.pipeline_triposg.TripoSGPipeline`` and the official
``run_triposg`` helper from ``backend/thirdparty/TripoSG``. Weights resolved
through ``backend.loader.get_model_weights_dir``. Only seed + image identity are
caller-controlled; inference schedules are adapter-owned and stripped by the
scheduler. Background removal uses the official ``briaai/RMBG-1.4`` weights.
"""

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


class TripoSGImageToRawMeshAdapter(BaseModel):
    """Adapter for TripoSG image-to-raw-mesh generation."""

    MODEL_KEY = "TripoSG"
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
        self._pipe: Any = None
        self._rmbg: Any = None

    def _load_model(self) -> Any:
        # Make the vendored TripoSG source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _triposg_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TripoSG")
        if _triposg_root not in sys.path:
            sys.path.insert(0, _triposg_root)
        from triposg.pipelines.pipeline_triposg import TripoSGPipeline
        from briarmbg import BriaRMBG

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        # RMBG weights live beside the model weights under <root>/RMBG-1.4.
        rmbg_dir = Path(weights_dir).parent / "RMBG-1.4"
        logger.info("Loading TripoSG pipeline from %s", weights_dir)
        pipe = TripoSGPipeline.from_pretrained(str(weights_dir))
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        dtype = torch.float16 if torch is not None and torch.cuda.is_available() else torch.float32
        pipe.to(device, dtype)
        rmbg = BriaRMBG.from_pretrained(str(rmbg_dir)).to(device)
        rmbg.eval()
        self._pipe = pipe
        self._rmbg = rmbg
        self.model = pipe
        return pipe

    def _unload_model(self) -> None:
        self._pipe = None
        self._rmbg = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipe = self._pipe
        rmbg = self._rmbg
        if pipe is None or rmbg is None:
            return {"success": False, "error": "TripoSG pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        steps = int(inputs.get("num_inference_steps", 50))
        guidance = float(inputs.get("guidance_scale", 7.0))
        faces = int(inputs.get("faces", -1))

        from triposg.scripts.inference_triposg import run_triposg

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            scene = run_triposg(
                pipe,
                image_path,
                rmbg,
                seed=seed,
                num_inference_steps=steps,
                guidance_scale=guidance,
                faces=faces,
            )

        mesh = None
        if hasattr(scene, "geometry") and scene.geometry:
            mesh = next(iter(scene.geometry.values()))
        if mesh is None:
            return {"success": False, "error": "TripoSG produced no mesh"}

        import trimesh
        import tempfile

        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=False)
        out = Path(tempfile.mkdtemp()) / f"triposg_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": steps,
                "guidance_scale": guidance,
                "faces": faces,
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
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Adapter-owned inference steps",
                    "default": 50,
                    "minimum": 1,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Adapter-owned guidance scale",
                    "default": 7.0,
                    "required": False,
                },
            }
        }
