"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : hunyuan3d_adapter_v21 (legacy routing)
Model Name        : Hunyuan3D v2.1 Legacy Adapter
Feature Target    : image_to_raw_mesh / legacy routing
Status            : LEGACY / ACTIVE
Upstream Repo     : https://github.com/Tencent-Hunyuan/Hunyuan3D-2
Upstream Pipeline : hy3dgen.shapegen.pipelines.Hunyuan3DDiTFlowMatchingPipeline
Checkpoint / Path : backend/pretrained/tencent/Hunyuan3D-2
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Legacy aliases route here. Maintain backward-compatible adapter interfaces.
=============================================================================
"""
# Status - LEGACY / ACTIVE
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


class Hunyuan3DV21ImageToRawMeshAdapter(BaseModel):
    """Hunyuan3D-2.1 legacy — Image to Raw Mesh."""

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
        self._paint_pipeline: Any = None

    def _load_model(self) -> Any:
        # Make the vendored hunyuan3d-2 source importable in the worker process,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-2")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)
        from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-2.1 legacy pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        is_downloaded = (
            (weights_dir_path / "hunyuan3d-dit-v2-1").is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        if not is_downloaded:
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D-2.1 legacy weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2.1..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2.1",
                local_dir=str(weights_dir_path),
            )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            str(weights_dir_path),
            device=device,
        )
        if torch is not None and torch.cuda.is_available() and hasattr(pipeline, "enable_model_cpu_offload"):
            try:
                pipeline.enable_model_cpu_offload(gpu_id=self.gpu_id if self.gpu_id is not None else 0)
            except Exception as offload_err:
                logger.warning("Could not enable model CPU offload for Hunyuan3D v2.1 Legacy: %s", offload_err)
        self._pipeline = pipeline
        self.model = pipeline

        # Load paint pipeline from the same weights directory — one weights load,
        # two pipelines (shape + paint). Enables raw + texture in a single _load_model call.
        try:
            paint_pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir_path))
            self._paint_pipeline = paint_pipeline
            logger.info("Hunyuan3D-2.1 paint pipeline loaded from %s", weights_dir_path)
        except Exception as paint_err:
            logger.warning("Hunyuan3D-2.1 paint pipeline not loaded (texture disabled): %s", paint_err)
            self._paint_pipeline = None
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self._paint_pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2.1 legacy pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        import trimesh

        generator = None
        if torch is not None:
            gen_device = getattr(pipeline, "_execution_device", None) or ("cuda" if torch.cuda.is_available() else "cpu")
            generator = torch.Generator(device=gen_device)
            generator.manual_seed(seed)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            outputs = pipeline(
                image=image_path,
                num_inference_steps=50,
                guidance_scale=7.5,
                octree_resolution=512,
                num_chunks=80000,
                output_type="trimesh",
                generator=generator,
            )

        meshes = outputs if isinstance(outputs, list) else [outputs]
        if not meshes:
            return {"success": False, "error": "Hunyuan3D-2.1 legacy produced no mesh"}

        mesh = meshes[0]

        # Cap max topology at 600k faces per user specification
        MAX_TOPOLOGY_FACES = 600_000
        face_count = len(mesh.faces) if hasattr(mesh, "faces") else 0
        if face_count > MAX_TOPOLOGY_FACES:
            logger.info(
                "Hunyuan3D legacy mesh has %d faces, exceeding %d cap. Decimating...",
                face_count,
                MAX_TOPOLOGY_FACES,
            )
            try:
                import fast_simplification
                v_red, f_red = fast_simplification.simplify(
                    mesh.vertices,
                    mesh.faces,
                    target_count=MAX_TOPOLOGY_FACES,
                )
                import trimesh
                mesh = trimesh.Trimesh(vertices=v_red, faces=f_red, process=True)
                mesh.remove_unreferenced_vertices()
            except Exception:
                try:
                    mesh = mesh.simplify_quadric_decimation(face_count=MAX_TOPOLOGY_FACES)
                    mesh.remove_unreferenced_vertices()
                except Exception as simp_err:
                    logger.warning("Could not decimate Hunyuan3D legacy mesh to %d faces: %s", MAX_TOPOLOGY_FACES, simp_err)

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_v21_{seed}.glb"
        mesh.export(str(out))

        # Texture pipeline: run paint on the raw mesh using already-loaded weights
        # (single _load_model call loaded both shape + paint pipelines).
        texture_enabled = bool(inputs.get("texture_enabled"))
        texture_image_path = inputs.get("image_path") or inputs.get("image")
        if texture_enabled and texture_image_path and Path(texture_image_path).is_file() and self._paint_pipeline is not None:
            try:
                from PIL import Image
                image = Image.open(texture_image_path)
                with ctx:
                    textured = self._paint_pipeline(mesh=mesh, image=image)
                textured_out = Path(tempfile.mkdtemp()) / f"hunyuan3d_v21_textured_{seed}.glb"
                if hasattr(textured, "export"):
                    textured.export(str(textured_out))
                    return {
                        "success": True,
                        "output_mesh_path": str(out),
                        "mesh_path": str(out),
                        "textured_mesh_path": str(textured_out),
                        "texture_enabled": True,
                        "generation_info": {
                            "seed": seed,
                            "num_inference_steps": 50,
                            "guidance_scale": 7.5,
                            "octree_resolution": 512,
                            "num_chunks": 80000,
                        },
                    }
                logger.warning("Paint pipeline returned non-exportable object; returning raw mesh only")
            except Exception as tex_err:
                logger.warning("Hunyuan3D-2.1 texture generation failed: %s", tex_err, exc_info=True)

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": 50,
                "guidance_scale": 7.5,
                "octree_resolution": 512,
                "num_chunks": 80000,
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


class Hunyuan3DV21ImageMeshPaintingAdapter(Hunyuan3DV21ImageToRawMeshAdapter):
    """Hunyuan3D-2.1 legacy — Image Mesh Painting."""

    MODEL_KEY = "tencent/Hunyuan3D-2.1"
    FEATURE_TYPE = "image_mesh_painting"

    def _load_model(self) -> Any:
        # Paint uses the texgen pipeline, not the shape pipeline.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-2")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)
        from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-2.1 legacy paint pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)
        is_downloaded = (
            (weights_dir_path / "hunyuan3d-paintpbr-v2-1").is_dir()
            or (weights_dir_path / "hunyuan3d-dit-v2-1").is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        if not is_downloaded:
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Hunyuan3D-2.1 paint weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub tencent/Hunyuan3D-2.1..."
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id="tencent/Hunyuan3D-2.1",
                local_dir=str(weights_dir_path),
            )
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir_path))
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2.1 legacy paint pipeline not loaded"}

        mesh_path = inputs.get("mesh_path")
        image_path = inputs.get("image_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        texture_resolution = int(inputs.get("texture_resolution", 2048) or 2048)
        texture_resolution = max(512, min(4096, texture_resolution))
        texture_enabled = bool(inputs.get("texture_enabled", True) and inputs.get("generate_texture", True))

        if not texture_enabled:
            return {
                "success": True,
                "output_mesh_path": mesh_path,
                "mesh_path": mesh_path,
                "texture_enabled": False,
                "generation_info": {"seed": seed, "texture_enabled": False},
            }

        import trimesh
        from PIL import Image

        mesh = trimesh.load(mesh_path, process=False)
        image = Image.open(image_path)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            textured = pipeline(mesh=mesh, image=image)

        import tempfile

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_v21_paint_{seed}.glb"
        if hasattr(textured, "export"):
            textured.export(str(out))
        else:
            return {"success": False, "error": "Paint pipeline returned non-exportable object"}

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "textured_mesh_path": str(out),
            "texture_enabled": True,
            "generation_info": {
                "seed": seed,
                "texture_resolution": texture_resolution,
                "num_inference_steps": 50,
                "guidance_scale": 7.5,
            },
        }
