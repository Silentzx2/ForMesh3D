"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : trellis_image_to_3d / trellis_image_to_raw_mesh / trellis_image_to_textured_mesh
Model Name        : TRELLIS — Image to 3D / Raw Mesh / Textured Mesh
Feature Target    : image_to_3d / image_to_raw_mesh / image_to_textured_mesh
Status            : STABLE - LOCKED
Upstream Repo     : https://github.com/microsoft/TRELLIS
Upstream Pipeline : trellis.pipelines.trellis_image_to_3d.TrellisImageTo3DPipeline
Checkpoint / Path : backend/pretrained/microsoft/TRELLIS.2-4B
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
CRITICAL NOTICE FOR AI AGENTS:
1. THIS MODEL IS VERIFIED STABLE IN PRODUCTION.
2. DO NOT TOUCH, MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM
   PIPELINE CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER.
3. Inference schedules (steps, guidance, sparse structure) are adapter-owned.
=============================================================================
"""
# Status - STABLE (PROTECTED / LOCKED)
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
from backend.loader import _resolve_repo_root, get_model_weights_dir
from huggingface_hub import snapshot_download

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class _TrellisBaseAdapter(BaseModel):
    """Shared base for TRELLIS adapters.

    Subclasses set ``MODEL_KEY`` (weights-dir key) and ``feature_type``.
    """

    MODEL_KEY: str = ""
    FEATURE_TYPE: str = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        # ModelFactory calls model_class(**init_params) where init_params holds
        # only vram_requirement (plus model-specific keys from models.yaml).
        # model_id / feature_type are assigned by the factory after
        # construction, so we initialise them here and let the factory override.
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
        self._paint_app_rep: Any = None

    def _load_model(self) -> Any:
        # Make the vendored TRELLIS source importable in the worker subprocess,
        # which only has backend/ on sys.path. Model-specific source path setup
        # per TASKS.md §3.3 — not a global patch, not in loader.py.
        _trellis_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS")
        if _trellis_root not in sys.path:
            sys.path.insert(0, _trellis_root)

        # FlashAttention requires Ampere+ GPUs (sm_80+). Tesla T4 (sm_75) is
        # pre-Ampere, so fall back to PyTorch native scaled_dot_product_attention
        # which works on all CUDA GPUs. Must be set before TRELLIS modules import
        # so __init__ reads SPARSE_ATTN_BACKEND before binding ATTN locally.
        if torch is not None and torch.cuda.is_available() and self.gpu_id is not None:
            major, _ = torch.cuda.get_device_capability(self.gpu_id)
            if major < 8:
                os.environ.setdefault('SPARSE_ATTN_BACKEND', 'sdpa')

        try:
            import utils3d
            import utils3d.torch
        except Exception:
            pass

        from trellis.pipelines.trellis_image_to_3d import TrellisImageTo3DPipeline

        # Resolve the weights directory. MODEL_KEY="TRELLIS" maps to
        # pretrained/TRELLIS/. The download script also places v1 weights under
        # pretrained/TRELLIS/TRELLIS-image-large/, so check both locations.
        try:
            weights_dir = get_model_weights_dir(self.MODEL_KEY)
        except FileNotFoundError:
            weights_dir = Path(_resolve_repo_root()) / "backend" / "pretrained" / self.MODEL_KEY
            weights_dir.mkdir(parents=True, exist_ok=True)
        weights_dir_path = Path(weights_dir)
        logger.info("Loading TRELLIS pipeline from %s", weights_dir)

        # v1 weights (microsoft/TRELLIS-image-large) land under
        # pretrained/TRELLIS/TRELLIS-image-large/ per download_models.sh.
        alt_weights_dir = weights_dir_path / "TRELLIS-image-large"

        def _has_pipeline(d: Path) -> bool:
            return (d / "pipeline.json").is_file()

        # If neither location has pipeline.json, pull the whole
        # microsoft/TRELLIS.2-4B repo from HuggingFace Hub so every checkpoint
        # (.json + .safetensors) the vendored Pipeline.from_pretrained references
        # is present locally. Downloading only pipeline.json leaves the actual
        # model files missing, which makes models.from_pretrained treat the
        # absolute local path as a fake HF repo_id and 404.
        if not _has_pipeline(weights_dir_path) and not _has_pipeline(alt_weights_dir):
            weights_dir_path.mkdir(parents=True, exist_ok=True)
            logger.info(
                "TRELLIS weights not found locally; downloading all checkpoints "
                "from HuggingFace Hub microsoft/TRELLIS.2-4B..."
            )
            snapshot_download(
                repo_id="microsoft/TRELLIS.2-4B",
                local_dir=str(weights_dir_path),
            )
            pipeline_path = weights_dir_path
        elif _has_pipeline(alt_weights_dir):
            pipeline_path = alt_weights_dir
        else:
            pipeline_path = weights_dir_path

        pipeline = TrellisImageTo3DPipeline.from_pretrained(str(pipeline_path))
        # Move pipeline to the worker's GPU so xformers attention (CUDA-only)
        # works instead of failing on CPU with float32.
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline.to(device)
        self._pipeline = pipeline
        self.model = pipeline

        # TRELLIS has no separate paint weights: texture is baked from the
        # appearance representation with trellis.utils.postprocessing_utils.to_glb.
        # Load the capability here so _process_request only runs the bake.
        try:
            from trellis.utils.postprocessing_utils import to_glb

            self._paint_pipeline = to_glb
            logger.info("TRELLIS paint/texture capability loaded (to_glb)")
        except Exception as paint_err:
            logger.warning(
                "TRELLIS paint/texture capability not loaded (texture disabled): %s",
                paint_err,
            )
            self._paint_pipeline = None
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self._paint_pipeline = None
        self._paint_app_rep = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "TRELLIS pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path:
            return {"success": False, "error": "image_path is required"}
        if not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        ss_steps = int(inputs["ss_sampling_steps"])
        ss_cfg = float(inputs["ss_guidance_strength"])
        slat_steps = int(inputs["slat_sampling_steps"])
        slat_cfg = float(inputs["slat_guidance_strength"])

        from PIL import Image

        image = Image.open(image_path)

        # Native polycount target: passed through from the generation request.
        native_target_polycount = int(
            inputs.get("native_target_polycount")
            or inputs.get("target_polycount")
            or 0
        )
        texture_resolution = int(inputs.get("texture_resolution") or 2048)
        texture_resolution = max(512, min(2048, texture_resolution))
        remesh_option = str(inputs.get("remesh_option", "none") or "none").strip().lower()

        want_texture = bool(inputs.get("texture_enabled")) and self._paint_pipeline is not None
        formats = ["mesh", "gaussian"] if want_texture else ["mesh"]

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            result = pipeline.run(
                image,
                seed=seed,
                formats=formats,
                sparse_structure_sampler_params={"steps": ss_steps, "cfg_strength": ss_cfg},
                slat_sampler_params={"steps": slat_steps, "cfg_strength": slat_cfg},
            )

        mesh = result.get("mesh") if isinstance(result, dict) else None
        if mesh is None:
            return {"success": False, "error": "TRELLIS produced no mesh"}
        if isinstance(mesh, list):
            mesh = mesh[0] if mesh else None
            if mesh is None:
                return {"success": False, "error": "TRELLIS produced no mesh"}

        # Keep the appearance representation (gaussian) so the texture bake can
        # reuse it after the raw mesh is exported.
        app_rep = result.get("gaussian") if isinstance(result, dict) else None
        if isinstance(app_rep, list):
            app_rep = app_rep[0] if app_rep else None
        self._paint_app_rep = app_rep

        import numpy as np
        import trimesh
        import tempfile

        out_dir = self._create_temporary_output_dir("trellis")
        out = out_dir / f"trellis_{seed}.glb"
        # MeshExtractResult has vertices/faces as torch tensors, no .export() method
        tmesh = trimesh.Trimesh(
            vertices=mesh.vertices.cpu().numpy(),
            faces=mesh.faces.cpu().numpy(),
            process=False,
        )

        # Reorient TRELLIS output to a canonical upright pose.
        # TRELLIS sparse-structure decoder emits vertices in its own frame;
        # align the principal (tallest) axis with world Y-up and centre at origin.
        verts = np.asarray(tmesh.vertices, dtype=float)
        centroid = verts.mean(axis=0)
        centred = verts - centroid
        # TRELLIS outputs Z-up meshes; convert to Y-up (Rx(-90 deg): [x, y, z] -> [x, z, -y])
        verts = centred
        tmesh.vertices = np.stack([verts[:, 0], verts[:, 2], -verts[:, 1]], axis=1)

        tmesh.export(str(out))

        # Texture pipeline: bake a PBR texture from the appearance
        # representation onto the raw mesh using the already-loaded to_glb
        # (same capability as upstream postprocessing_utils.to_glb(app_rep, mesh, ...)).
        # Guarded so failures fall back to the raw mesh instead of failing the request.
        texture_enabled = bool(inputs.get("texture_enabled"))
        texture_image_path = inputs.get("image_path") or inputs.get("image")
        if (
            texture_enabled
            and texture_image_path
            and Path(texture_image_path).is_file()
            and self._paint_pipeline is not None
            and self._paint_app_rep is not None
        ):
            try:
                try:
                    import utils3d
                    import utils3d.torch
                    # Compatibility shim: utils3d >= 0.3.0 replaced perspective_from_fov_xy with perspective_from_fov
                    if not hasattr(utils3d.torch, "perspective_from_fov_xy"):
                        if hasattr(utils3d.torch, "perspective_from_fov"):
                            utils3d.torch.perspective_from_fov_xy = (
                                lambda fov_x, fov_y, near, far: utils3d.torch.perspective_from_fov(
                                    fov_x=fov_x, fov_y=fov_y, near=near, far=far
                                )
                            )
                        elif hasattr(utils3d, "perspective_from_fov"):
                            utils3d.torch.perspective_from_fov_xy = (
                                lambda fov_x, fov_y, near, far: utils3d.perspective_from_fov(
                                    fov_x=fov_x, fov_y=fov_y, near=near, far=far
                                )
                            )
                except Exception:
                    # utils3d not installed — texture generation unavailable;
                    # fall back to raw mesh instead of crashing.
                    logger.warning(
                        "TRELLIS texture generation skipped: utils3d not installed; "
                        "returning raw mesh"
                    )
                    return {
                        "success": True,
                        "output_mesh_path": str(out),
                        "mesh_path": str(out),
                        "textured_mesh_path": None,
                        "texture_enabled": False,
                        "actual_face_count": len(tmesh.faces),
                        "actual_vertex_count": len(tmesh.vertices),
                        "generation_info": {
                            "seed": seed,
                            "texture_resolution": texture_resolution,
                            "remesh_option": remesh_option,
                            "native_target_polycount": native_target_polycount or None,
                        },
                    }
                textured = self._paint_pipeline(
                    self._paint_app_rep, mesh, texture_size=texture_resolution
                )
                textured_out = out_dir / f"trellis_textured_{seed}.glb"
                if hasattr(textured, "export"):
                    textured.export(str(textured_out))
                    return {
                        "success": True,
                        "output_mesh_path": str(out),
                        "mesh_path": str(out),
                        "textured_mesh_path": str(textured_out),
                        "texture_enabled": True,
                        "actual_face_count": len(tmesh.faces),
                        "actual_vertex_count": len(tmesh.vertices),
                        "generation_info": {
                            "seed": seed,
                            "texture_resolution": texture_resolution,
                            "remesh_option": remesh_option,
                            "native_target_polycount": native_target_polycount or None,
                        },
                    }
                logger.warning(
                    "TRELLIS paint pipeline returned non-exportable object; returning raw mesh only"
                )
            except Exception as tex_err:
                logger.warning("TRELLIS texture generation failed: %s", tex_err, exc_info=True)

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "actual_face_count": len(tmesh.faces),
            "actual_vertex_count": len(tmesh.vertices),
            "generation_info": {
                "seed": seed,
                "texture_resolution": texture_resolution,
                "remesh_option": remesh_option,
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


class TrellisImageToRawMeshAdapter(_TrellisBaseAdapter):
    """TRELLIS — Image to Raw Mesh."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_to_raw_mesh"


class TrellisImageTo3DAdapter(_TrellisBaseAdapter):
    """TRELLIS — Image to 3D (raw mesh alias)."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_to_raw_mesh"


class TrellisTextMeshPaintingAdapter(_TrellisBaseAdapter):
    """TRELLIS — Text Mesh Painting (raw mesh output)."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "text_mesh_painting"


class TrellisImageMeshPaintingAdapter(_TrellisBaseAdapter):
    """TRELLIS — Image Mesh Painting (raw mesh output)."""

    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_mesh_painting"
