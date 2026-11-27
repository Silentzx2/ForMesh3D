"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Pixal3D Image-to-Mesh Adapter (Disabled by Default in models.yaml)          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/Pixal3D (pixal3d.pipelines)                   ║
║  Weights  : backend/pretrained/Pixal3D + dinov3-vitl16-pretrain-lvd1689m     ║
║  Patcher  : patcher.pixal3d (applied BEFORE upstream import)                 ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import contextlib
import logging
import math
import os
from pathlib import Path
from typing import Any, Dict

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from core.models.base import BaseModel, ModelStatus
from core.utils.upstream import resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)


# ── 1. Adapter Class ──────────────────────────────────────────────────────────

class Pixal3DImageToRawMeshAdapter(BaseModel):
    """Pixal3D — Image to Raw Mesh (pixel-aligned projection)."""

    MODEL_KEY = "Pixal3D"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=None,
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.status = ModelStatus.UNLOADED
        self.native_topology = False
        self.version = "1.0"
        self._pipeline: Any = None

    # ── 2. Lifecycle (Load / Unload) ──────────────────────────────────────────

    def _load_model(self) -> Any:
        pre_ampere = bool(
            torch is not None and torch.cuda.is_available() and self.gpu_id is not None
            and torch.cuda.get_device_capability(self.gpu_id)[0] < 8
        )
        if not os.environ.get("SPARSE_CONV_BACKEND") or os.environ.get("SPARSE_CONV_BACKEND") == "none":
            if pre_ampere:
                os.environ["SPARSE_CONV_BACKEND"] = "spconv"
            else:
                try:
                    import flex_gemm  # noqa: F401
                    os.environ["SPARSE_CONV_BACKEND"] = "flex_gemm"
                except Exception:
                    os.environ["SPARSE_CONV_BACKEND"] = "spconv"
        if pre_ampere:
            if not os.environ.get("SPARSE_ATTN_BACKEND"):
                try:
                    import xformers  # noqa: F401
                    os.environ["SPARSE_ATTN_BACKEND"] = "xformers"
                except ImportError:
                    pass
            os.environ.setdefault("ATTN_BACKEND", "sdpa")

        try:
            from utils.torchvision_fix import apply_fix
            apply_fix()
        except Exception:
            pass

        try:
            from patcher.pixal3d import apply_patch
            apply_patch()
        except Exception as exc:
            logger.warning("Pixal3D patcher skipped: %s", exc)

        weights_dir = resolve_pretrained(self.MODEL_KEY)
        with use_thirdparty("Pixal3D", chdir=False):
            try:
                import pixal3d.modules.sparse.config as sparse_config
                sparse_config.set_conv_backend(os.environ["SPARSE_CONV_BACKEND"])
                if os.environ.get("SPARSE_ATTN_BACKEND"):
                    sparse_config.set_attn_backend(os.environ["SPARSE_ATTN_BACKEND"])
            except Exception:
                pass

            from pixal3d.pipelines import Pixal3DImageTo3DPipeline
            from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor

            pipeline = Pixal3DImageTo3DPipeline.from_pretrained(str(weights_dir))
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cpu"
            pipeline.to(device)

            local_dino = weights_dir.parent / "dinov3-vitl16-pretrain-lvd1689m"
            dino_name = str(local_dino) if local_dino.is_dir() and any(local_dino.iterdir()) else "camenduru/dinov3-vitl16-pretrain-lvd1689m"

            def _build_cond(cfg: dict) -> Any:
                m = DinoV3ProjFeatureExtractor(model_name=dino_name, **cfg)
                m.eval()
                if not getattr(pipeline, "low_vram", True):
                    m.to(device)
                return m

            pipeline.image_cond_model_ss = _build_cond({"image_size": 512, "grid_resolution": 16})
            pipeline.image_cond_model_shape_512 = _build_cond({"image_size": 512, "grid_resolution": 32, "use_naf_upsample": True, "naf_target_size": 512})
            pipeline.image_cond_model_shape_1024 = _build_cond({"image_size": 1024, "grid_resolution": 64, "use_naf_upsample": True, "naf_target_size": 512})
            pipeline.image_cond_model_tex_1024 = _build_cond({"image_size": 1024, "grid_resolution": 64, "use_naf_upsample": True, "naf_target_size": 1024})

            if getattr(pipeline, "low_vram", False):
                for attr in ("image_cond_model_ss", "image_cond_model_shape_512", "image_cond_model_shape_1024", "image_cond_model_tex_1024"):
                    m = getattr(pipeline, attr, None)
                    if m is not None and getattr(m, "use_naf_upsample", False):
                        try:
                            m._load_naf()
                        except Exception as naf_exc:
                            logger.warning("Pixal3D %s NAF pre-load failed: %s", attr, naf_exc)

        self._pipeline = self.model = pipeline
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = self.model = None

    # ── 3. Inference & Export ─────────────────────────────────────────────────

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            return {"success": False, "error": "Pixal3D pipeline not loaded"}
        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        from PIL import Image
        import trimesh

        seed = int(inputs["seed"])
        resolution = int(inputs.get("resolution", 1024))
        image = Image.open(image_path).convert("RGB")
        camera_angle_x = 2 * math.atan(image.size[0] / 32.0)

        with (torch.no_grad() if torch is not None else contextlib.nullcontext()):
            mesh_list, _ = self._pipeline.run(
                image,
                camera_params={"camera_angle_x": camera_angle_x, "distance": 2.0},
                seed=seed, preprocess_image=False, return_latent=True,
                pipeline_type=f"{resolution}_cascade", max_num_tokens=49152,
            )

        mesh = mesh_list[0] if mesh_list else None
        if mesh is None:
            return {"success": False, "error": "Pixal3D produced no mesh"}
        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=False)

        out = self._create_temporary_output_dir("pixal3d") / f"pixal3d_{seed}.glb"
        mesh.export(str(out))
        return {
            "success": True, "output_mesh_path": str(out), "mesh_path": str(out),
            "generation_info": {"seed": seed, "resolution": resolution, "camera_angle_x": camera_angle_x},
        }

    # ── 4. Schema & Metadata ──────────────────────────────────────────────────

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {"type": "integer", "minimum": 0, "required": False},
                "resolution": {"type": "integer", "default": 1024, "required": False},
            }
        }
