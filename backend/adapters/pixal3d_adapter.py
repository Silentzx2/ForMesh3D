"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : pixal3d_image_to_raw_mesh / pixal3d_image_to_3d
Model Name        : Pixal3D — Image to Raw Mesh / 3D
Feature Target    : image_to_raw_mesh / image_to_3d
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/Pixal3D/Pixal3D
Upstream Pipeline : pixal3d.pipelines.Pixal3DImageTo3DPipeline
Checkpoint / Path : backend/pretrained/Pixal3D
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Condition model loads DinoV3ProjFeatureExtractor from HF with local fallback.
=============================================================================
"""
# Status - BETA / ACTIVE
from __future__ import annotations

import contextlib
import logging
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Pixal3DImageToRawMeshAdapter(BaseModel):
    """Pixal3D — Image to Raw Mesh (pixel-aligned projection)."""

    MODEL_KEY = "Pixal3D"
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
        # Determine whether worker is on pre-Ampere GPU (e.g. Tesla T4)
        device_is_pre_ampere = False
        if torch is not None and torch.cuda.is_available() and self.gpu_id is not None:
            try:
                major, _ = torch.cuda.get_device_capability(self.gpu_id)
                device_is_pre_ampere = major < 8
            except Exception:
                pass

        # Select sparse-convolution backend. Never use 'none' because Pixal3D
        # has no conv_none backend and will fail to instantiate SparseUNetVae.
        # On pre-Ampere (T4 sm_75), prefer spconv; on Ampere+ (sm >= 80), prefer flex_gemm.
        current_backend = os.environ.get("SPARSE_CONV_BACKEND", "")
        if not current_backend or current_backend == "none":
            if device_is_pre_ampere:
                os.environ["SPARSE_CONV_BACKEND"] = "spconv"
            else:
                try:
                    import flex_gemm  # noqa: F401
                    os.environ["SPARSE_CONV_BACKEND"] = "flex_gemm"
                except Exception:
                    os.environ["SPARSE_CONV_BACKEND"] = "spconv"

        if device_is_pre_ampere:
            if not os.environ.get("SPARSE_ATTN_BACKEND"):
                try:
                    import xformers  # noqa: F401
                    os.environ["SPARSE_ATTN_BACKEND"] = "xformers"
                except ImportError:
                    pass
            if not os.environ.get("ATTN_BACKEND"):
                os.environ["ATTN_BACKEND"] = "sdpa"

        # Apply compatibility shims (flex_gemm autotune/fallback, cumesh, dinov3)
        try:
            from utils.torchvision_fix import apply_fix
            apply_fix()
        except Exception:
            try:
                from backend.utils.torchvision_fix import apply_fix
                apply_fix()
            except Exception:
                pass

        _pixal3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Pixal3D")
        if _pixal3d_root not in sys.path:
            sys.path.insert(0, _pixal3d_root)

        # Synchronize Pixal3D sparse config with chosen environment setting
        try:
            import pixal3d.modules.sparse.config as sparse_config
            sparse_config.set_conv_backend(os.environ["SPARSE_CONV_BACKEND"])
            if os.environ.get("SPARSE_ATTN_BACKEND"):
                sparse_config.set_attn_backend(os.environ["SPARSE_ATTN_BACKEND"])
        except Exception:
            pass

        # Apply Pixal3D pre-Ampere NATTEN / NAF resilience patch
        try:
            from patcher.pixal3d import apply_patch
            apply_patch()
        except Exception as patch_exc:
            logger.warning("Pixal3D patcher application failed: %s", patch_exc)

        from pixal3d.pipelines import Pixal3DImageTo3DPipeline

        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        logger.info("Loading Pixal3D pipeline from %s", weights_dir)
        pipeline = Pixal3DImageTo3DPipeline.from_pretrained(str(weights_dir))
        device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
        pipeline.to(device)
        # Pixal3D's image_cond_model_* attributes must be loaded externally
        # (DinoV3ProjFeatureExtractor instances). Mirror upstream inference.py
        # IMAGE_COND_CONFIGS — constructor kwargs, not from_pretrained.
        try:
            from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor

            # Resolve local DINOv3 directory if present to avoid redundant HF download
            weights_root = Path(weights_dir).resolve().parent
            local_dino_dir = weights_root / "dinov3-vitl16-pretrain-lvd1689m"
            if not (local_dino_dir.is_dir() and any(local_dino_dir.iterdir())):
                fallback_local = Path("/kaggle/working/ForMash3D/backend/pretrained/dinov3-vitl16-pretrain-lvd1689m")
                if fallback_local.is_dir() and any(fallback_local.iterdir()):
                    local_dino_dir = fallback_local
            dino_model_name = str(local_dino_dir) if (local_dino_dir.is_dir() and any(local_dino_dir.iterdir())) else "camenduru/dinov3-vitl16-pretrain-lvd1689m"

            def _build(cfg: dict):
                cfg["model_name"] = dino_model_name
                m = DinoV3ProjFeatureExtractor(**cfg)
                m.eval()
                if not getattr(pipeline, "low_vram", True):
                    m.to(device)
                return m

            pipeline.image_cond_model_ss = _build({
                "image_size": 512, "grid_resolution": 16,
            })
            pipeline.image_cond_model_shape_512 = _build({
                "image_size": 512, "grid_resolution": 32,
                "use_naf_upsample": True, "naf_target_size": 512,
            })
            pipeline.image_cond_model_shape_1024 = _build({
                "image_size": 1024, "grid_resolution": 64,
                "use_naf_upsample": True, "naf_target_size": 512,
            })
            pipeline.image_cond_model_tex_1024 = _build({
                "image_size": 1024, "grid_resolution": 64,
                "use_naf_upsample": True, "naf_target_size": 1024,
            })

            if getattr(pipeline, "low_vram", False):
                for attr in [
                    "image_cond_model_ss",
                    "image_cond_model_shape_512",
                    "image_cond_model_shape_1024",
                    "image_cond_model_tex_1024",
                ]:
                    m = getattr(pipeline, attr, None)
                    if m is not None and getattr(m, "use_naf_upsample", False):
                        try:
                            m._load_naf()
                        except Exception as naf_exc:
                            logger.warning(
                                "Pixal3D %s NAF pre-load failed (%s). Ensure 'natten' is installed via install.sh.",
                                attr,
                                naf_exc,
                            )
        except Exception as exc:  # pragma: no cover - optional cond models
            logger.error(
                "Pixal3D image_cond_model_* not loaded: %s; pipeline.run() "
                "will fail unless these are set externally.", exc,
                exc_info=True,
            )
            raise RuntimeError(
                f"Failed to initialize Pixal3D image condition models: {exc}"
            ) from exc
        self._pipeline = pipeline
        self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        pipeline = self._pipeline
        if pipeline is None:
            return {"success": False, "error": "Pixal3D pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        resolution = int(inputs.get("resolution", 1024))

        from PIL import Image

        image = Image.open(image_path).convert("RGB")

        # Camera angle estimate matching the official app.py flow.
        width = image.size[0]
        camera_angle_x = 2 * math.atan(width / 32.0)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            mesh_list, _ = pipeline.run(
                image,
                camera_params={"camera_angle_x": camera_angle_x, "distance": 2.0},
                seed=seed,
                preprocess_image=False,
                return_latent=True,
                pipeline_type=f"{resolution}_cascade",
                max_num_tokens=49152,
            )

        mesh = mesh_list[0] if mesh_list else None
        if mesh is None:
            return {"success": False, "error": "Pixal3D produced no mesh"}

        import trimesh
        import tempfile

        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(
                vertices=mesh.vertices, faces=mesh.faces, process=False
            )
        out = Path(tempfile.mkdtemp()) / f"pixal3d_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "resolution": resolution,
                "camera_angle_x": camera_angle_x,
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
                "resolution": {
                    "type": "integer",
                    "description": "Output resolution (512, 1024)",
                    "default": 1024,
                    "required": False,
                },
            }
        }
