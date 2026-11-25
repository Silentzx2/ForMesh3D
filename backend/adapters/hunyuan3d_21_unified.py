"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : hunyuan3d_21_unified
Model Name        : Hunyuan3D-2.1 Unified — Image to Raw Mesh + Texture Paint
Feature Target    : image_to_raw_mesh / image_mesh_painting
Status            : STABLE / WORKING
Upstream Repo     : https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
Upstream Pipeline :
  - Shape : hy3dshape.pipelines.Hunyuan3DDiTFlowMatchingPipeline
  - Paint : hy3dgen.texgen.pipelines.Hunyuan3DPaintPipeline
Checkpoint / Path : backend/pretrained/tencent/Hunyuan3D-2.1
Hardware / VRAM   : 10–12 GB — fits on 16 GB consumer cards
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. Single unified adapter for Hunyuan3D-2.1. Handles both raw mesh
   generation and image mesh painting (texture autochain).
2. When feature_type == 'image_to_raw_mesh':
     - Loads shape pipeline, generates raw mesh from image.
     - If texture_enabled, runs paint pipeline on result (autochain).
3. When feature_type == 'image_mesh_painting':
     - Loads paint pipeline only, takes existing mesh + reference image,
       returns textured mesh (texture page / standalone paint mode).
4. Does NOT modify upstream pipeline code. Checkpoint load failures are
   retried once because upstream from_pretrained() only downloads when
   the PARENT directory is missing — incomplete subdirs pass bad paths
   to DiffusionPipeline.from_pretrained() which raises ValueError.
-----------------------------------------------------------------------------
"""
from __future__ import annotations

import contextlib
import logging
import os
import sys
import tempfile
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


class Hunyuan3D21UnifiedAdapter(BaseModel):
    """
    Hunyuan3D-2.1 Unified — Image to Raw Mesh + Texture Painting.

    Single adapter that owns both the shape generation pipeline and the
    texture painting pipeline for Hunyuan3D-2.1. Both pipelines load from
    the same weights directory (backend/pretrained/tencent/Hunyuan3D-2.1),
    so a single _load_model() call can initialise both and the adapter
    decides at request time which to run.
    """

    MODEL_KEY = "tencent/Hunyuan3D-2.1"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        self.model_id = kwargs.get("model_id")
        self.model_path: Path | None = None
        self.vram_requirement = vram_requirement
        self.feature_type = kwargs.get("feature_type", "image_to_raw_mesh")
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
        self._shape_pipeline: Any = None
        self._paint_pipeline: Any = None

    # ── checkpoint validation ──────────────────────────────────────────

    def _has_valid_checkpoint(self, subdir: str, weights_dir_path: Path) -> bool:
        """True iff subdir contains model_index.json AND at least one weight file."""
        p = weights_dir_path / subdir
        if not p.is_dir():
            return False
        if not (p / "model_index.json").is_file():
            return False
        return any(
            f.is_file() and f.suffix in {".safetensors", ".bin", ".pt", ".ckpt"}
            for f in p.iterdir()
        )

    def _download_weights(self, weights_dir_path: Path) -> None:
        weights_dir_path.mkdir(parents=True, exist_ok=True)
        logger.info(
            "Hunyuan3D-2.1 Unified weights not found locally; downloading "
            "checkpoints from HuggingFace Hub tencent/Hunyuan3D-2.1..."
        )
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id="tencent/Hunyuan3D-2.1",
            local_dir=str(weights_dir_path),
        )

    # ── model lifecycle ────────────────────────────────────────────────

    def _load_model(self) -> Any:
        # Make the vendored hunyuan3d-2 source importable in the worker
        # process, which only has backend/ on sys.path.
        _hunyuan2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-2")
        if _hunyuan2_root not in sys.path:
            sys.path.insert(0, _hunyuan2_root)

        # Hunyuan3D-2.1 shape pipeline lives under thirdparty/Hunyuan3D-2.1/hy3dshape
        _hy3dshape_root = (
            str(Path(__file__).resolve().parents[1] / "thirdparty" / "Hunyuan3D-2.1" / "hy3dshape")
        )
        if _hy3dshape_root not in sys.path:
            sys.path.insert(0, _hy3dshape_root)

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Hunyuan3D-2.1 Unified pipeline from %s", weights_dir)
        weights_dir_path = Path(weights_dir)

        # Validate checkpoints before attempting to load pipelines.
        delight_ok = self._has_valid_checkpoint("hunyuan3d-delight-v2-0", weights_dir_path)
        paint_ok = self._has_valid_checkpoint("hunyuan3d-paint-v2-0-turbo", weights_dir_path) or self._has_valid_checkpoint(
            "hunyuan3d-paint-v2-0", weights_dir_path
        )
        shape_ok = (
            (weights_dir_path / "hunyuan3d-dit-v2-1").is_dir()
            or (weights_dir_path / "config.json").is_file()
        )
        is_downloaded = shape_ok and delight_ok and paint_ok
        if not is_downloaded:
            self._download_weights(weights_dir_path)

        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"

        # ── Load shape pipeline (always needed for image_to_raw_mesh) ──
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        try:
            shape_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(weights_dir_path),
                device=device,
            )
        except Exception as load_err:
            logger.warning(
                "Hunyuan3D-2.1 Unified shape load failed (%s); re-downloading and retrying.",
                load_err,
            )
            self._download_weights(weights_dir_path)
            shape_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(weights_dir_path),
                device=device,
            )

        if torch is not None and torch.cuda.is_available() and hasattr(shape_pipeline, "enable_model_cpu_offload"):
            try:
                shape_pipeline.enable_model_cpu_offload(
                    gpu_id=self.gpu_id if self.gpu_id is not None else 0
                )
            except Exception as offload_err:
                logger.warning(
                    "Could not enable model CPU offload for Hunyuan3D-2.1 Unified: %s",
                    offload_err,
                )

        self._shape_pipeline = shape_pipeline
        self.model = shape_pipeline

        # ── Load paint pipeline (needed for texture autochain / paint page) ──
        try:
            from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline

            try:
                paint_pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir_path))
            except Exception as paint_err:
                logger.warning(
                    "Hunyuan3D-2.1 Unified paint load failed (%s); re-downloading and retrying.",
                    paint_err,
                )
                self._download_weights(weights_dir_path)
                paint_pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(weights_dir_path))

            self._paint_pipeline = paint_pipeline
            logger.info("Hunyuan3D-2.1 Unified paint pipeline loaded from %s", weights_dir_path)
        except Exception as paint_load_err:
            logger.warning(
                "Hunyuan3D-2.1 Unified paint pipeline not loaded (texture disabled): %s",
                paint_load_err,
            )
            self._paint_pipeline = None

        return shape_pipeline

    def _unload_model(self) -> None:
        self._shape_pipeline = None
        self._paint_pipeline = None
        self.model = None

    # ── inference ──────────────────────────────────────────────────────

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        texture_enabled = bool(
            inputs.get("texture_enabled", False) and inputs.get("generate_texture", True)
        )

        # ── Paint-only mode: existing mesh + reference image → textured mesh ──
        if self.feature_type == "image_mesh_painting":
            pipeline = self._paint_pipeline
            if pipeline is None:
                return {
                    "success": False,
                    "error": "Hunyuan3D-2.1 Unified paint pipeline not loaded",
                }

            mesh_path = inputs.get("mesh_path")
            image_path = inputs.get("image_path")
            if not mesh_path or not Path(mesh_path).is_file():
                return {"success": False, "error": f"mesh not found: {mesh_path}"}
            if not image_path or not Path(image_path).is_file():
                return {"success": False, "error": f"image not found: {image_path}"}

            seed = int(inputs.get("seed", DEFAULT_SEED))
            texture_resolution = int(inputs.get("texture_resolution", 2048) or 2048)
            texture_resolution = max(512, min(4096, texture_resolution))

            import trimesh
            from PIL import Image

            mesh = trimesh.load(mesh_path, process=False)
            image = Image.open(image_path)

            ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
            with ctx:
                textured = pipeline(mesh=mesh, image=image)

            out = Path(tempfile.mkdtemp()) / f"hunyuan3d_21_paint_{seed}.glb"
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
                    "feature_type": "image_mesh_painting",
                },
            }

        # ── Shape generation mode (default) ──
        pipeline = self._shape_pipeline
        if pipeline is None:
            return {
                "success": False,
                "error": "Hunyuan3D-2.1 Unified shape pipeline not loaded",
            }

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        import trimesh

        generator = None
        if torch is not None:
            gen_device = (
                getattr(pipeline, "_execution_device", None)
                or (f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu")
            )
            generator = torch.Generator(device=gen_device)
            generator.manual_seed(seed)

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

        meshes = outputs if isinstance(outputs, list) else [outputs]
        if not meshes:
            return {"success": False, "error": "Hunyuan3D-2.1 Unified produced no mesh"}

        mesh = meshes[0]

        out = Path(tempfile.mkdtemp()) / f"hunyuan3d_21_{seed}.glb"
        mesh.export(str(out))

        # ── Texture autochain: paint on the raw mesh using already-loaded weights ──
        if texture_enabled and self._paint_pipeline is not None:
            texture_image_path = inputs.get("image_path") or inputs.get("image")
            if texture_image_path and Path(texture_image_path).is_file():
                try:
                    from PIL import Image

                    ref_image = Image.open(texture_image_path)
                    with ctx:
                        textured = self._paint_pipeline(mesh=mesh, image=ref_image)
                    textured_out = Path(tempfile.mkdtemp()) / f"hunyuan3d_21_textured_{seed}.glb"
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
                                "num_chunks": 8000,
                                "texture_enabled": True,
                                "feature_type": "image_to_raw_mesh",
                            },
                        }
                    logger.warning(
                        "Paint pipeline returned non-exportable object; returning raw mesh only"
                    )
                except Exception as tex_err:
                    logger.warning(
                        "Hunyuan3D-2.1 Unified texture generation failed: %s",
                        tex_err,
                        exc_info=True,
                    )

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
                "texture_enabled": False,
                "feature_type": "image_to_raw_mesh",
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
                "texture_enabled": {
                    "type": "boolean",
                    "description": "Generate PBR texture after raw mesh (autochain)",
                    "default": False,
                    "required": False,
                },
                "texture_resolution": {
                    "type": "integer",
                    "description": "Texture resolution (512–4096)",
                    "default": 2048,
                    "minimum": 512,
                    "maximum": 4096,
                    "required": False,
                },
            }
        }
