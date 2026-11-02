"""TRELLIS.2 adapter — thin integration over the official ThirdParty inference API.

Wraps ``trellis2.pipelines.trellis2_image_to_3d.Trellis2ImageTo3DPipeline`` from
``backend/thirdparty/TRELLIS.2``. Weights resolved through
``backend.loader.get_model_weights_dir``. Only seed + image identity are
caller-controlled; inference schedules (steps, guidance, cascade resolution,
token budget) are adapter-owned and stripped by the scheduler.
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
from huggingface_hub import snapshot_download

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Trellis2ImageToRawMeshAdapter(BaseModel):
    """TRELLIS.2 — Image to Raw Mesh."""

    MODEL_KEY = "TRELLIS.2"
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
        # Make the vendored TRELLIS.2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _trellis2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS.2")
        if _trellis2_root not in sys.path:
            sys.path.insert(0, _trellis2_root)
        from trellis2.pipelines.trellis2_image_to_3d import Trellis2ImageTo3DPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading TRELLIS.2 pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        # weights download to nested TRELLIS.2-4B/ subfolder per download_models.sh
        alt_weights_dir = weights_dir_path / "TRELLIS.2-4B"

        def _has_pipeline(d: Path) -> bool:
            return (d / "pipeline.json").is_file()

        if not _has_pipeline(weights_dir_path) and not _has_pipeline(alt_weights_dir):
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "TRELLIS.2 weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub microsoft/TRELLIS.2-4B..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="microsoft/TRELLIS.2-4B",
                local_dir=str(weights_dir_path),
            )
            pipeline_path = weights_dir_path
        elif _has_pipeline(alt_weights_dir):
            pipeline_path = alt_weights_dir
        else:
            pipeline_path = weights_dir_path

        pipeline = Trellis2ImageTo3DPipeline.from_pretrained(str(pipeline_path))
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline.to(device)
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TRELLIS.2 pipeline not loaded"}

        image_path = inputs.get("image_path")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        from PIL import Image

        image = Image.open(image_path)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            meshes = pipeline.run(
                image,
                seed=seed,
                pipeline_type="1024_cascade",
                max_num_tokens=49152,
            )

        mesh_list = meshes if isinstance(meshes, list) else [meshes]
        if not mesh_list:
            return {"success": False, "error": "TRELLIS.2 produced no mesh"}

        mesh = mesh_list[0]

        import tempfile
        import trimesh
        from o_voxel.postprocess import to_glb

        out = Path(tempfile.mkdtemp()) / f"trellis2_{seed}.glb"
        # MeshWithVoxel has no .export() method; use o_voxel.postprocess.to_glb()
        glb_bytes = to_glb(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size,
        )
        with open(str(out), "wb") as f:
            f.write(glb_bytes)

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
                "pipeline_type": "1024_cascade",
                "max_num_tokens": 49152,
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


class Trellis2ImageTo3DAdapter(Trellis2ImageToRawMeshAdapter):
    """TRELLIS.2 — Image to 3D (raw mesh alias)."""

    MODEL_KEY = "TRELLIS.2"
    FEATURE_TYPE = "image_to_raw_mesh"


class Trellis2ImageMeshPaintingAdapter(Trellis2ImageToRawMeshAdapter):
    """TRELLIS.2 — Image Mesh Painting."""

    MODEL_KEY = "TRELLIS.2"
    FEATURE_TYPE = "image_mesh_painting"

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TRELLIS.2 texturing pipeline not loaded"}

        mesh_path = inputs.get("mesh_path")
        image_path = inputs.get("image_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        import trimesh
        from PIL import Image

        mesh = trimesh.load(mesh_path, process=False)
        image = Image.open(image_path).convert("RGB")

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            textured = pipeline(
                mesh=mesh,
                image=image,
                seed=seed,
            )

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"trellis2_paint_{seed}.glb"
        if hasattr(textured, "export"):
            textured.export(str(out))
        else:
            return {"success": False, "error": "Texturing pipeline returned non-exportable object"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
                "pipeline_type": "1024_cascade",
                "max_num_tokens": 49152,
            },
        }
