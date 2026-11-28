"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Hunyuan3D-2.1 Unified Shape & Paint Adapter                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/Hunyuan3D-2.1 (+ hunyuan3d-2 fallback)        ║
║  Weights  : backend/pretrained/tencent/Hunyuan3D-2.1                         ║
║  Patcher  : None (FlashVDM + CPU offload on CUDA)                            ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
║  Status   : STABLE & ACTIVE                                                  ║
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
from core.utils.upstream import resolve_pretrained, resolve_thirdparty, use_thirdparty

logger = logging.getLogger(__name__)


class Hunyuan3D21UnifiedAdapter(BaseModel):
    MODEL_KEY = "tencent/Hunyuan3D-2.1"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", "image_to_raw_mesh"),
        )
        self._shape_pipeline: Any = None
        self._paint_pipeline: Any = None
        self._paint_is_hy3dpaint = False

    def _load_model(self) -> Any:
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        if not weights_dir.is_dir():
            raise FileNotFoundError(f"Hunyuan3D-2.1 weights missing: {weights_dir}")

        device = f"cuda:{self.gpu_id or 0}" if torch.cuda.is_available() else "cpu"

        with use_thirdparty("Hunyuan3D-2.1/hy3dshape", chdir=False):
            from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

            logger.info("Loading Hunyuan3D-2.1 shape pipeline from %s", weights_dir)
            shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(str(weights_dir), device=device)
            if hasattr(shape_pipe, "enable_flashvdm"):
                try:
                    shape_pipe.enable_flashvdm()
                except Exception as exc:
                    logger.warning("Could not enable FlashVDM: %s", exc)
            if torch.cuda.is_available() and hasattr(shape_pipe, "enable_model_cpu_offload"):
                try:
                    shape_pipe.enable_model_cpu_offload(gpu_id=self.gpu_id or 0)
                except Exception as exc:
                    logger.warning("Could not enable CPU offload: %s", exc)
            self._shape_pipeline = shape_pipe

        try:
            paint_root = resolve_thirdparty("Hunyuan3D-2.1/hy3dpaint")
            paint_weights = weights_dir / "hunyuan3d-paintpbr-v2-1"
            dinov2_weights = resolve_pretrained("dinov2-giant")
            realesrgan_weights = paint_root / "ckpt" / "RealESRGAN_x4plus.pth"
            paint_config_path = paint_root / "cfgs" / "hunyuan-paint-pbr.yaml"

            required_paint_files = (
                paint_weights / "model_index.json",
                paint_weights / "unet" / "config.json",
                dinov2_weights / "config.json",
                dinov2_weights / "preprocessor_config.json",
                dinov2_weights / "model.safetensors",
                realesrgan_weights,
                paint_config_path,
            )
            missing = [str(path) for path in required_paint_files if not path.is_file()]
            if missing:
                raise FileNotFoundError(
                    "Hunyuan3D-2.1 Paint dependencies are incomplete: " + ", ".join(missing)
                )

            with use_thirdparty("Hunyuan3D-2.1/hy3dpaint", chdir=False):
                from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline as Hy3DPaintV21

                paint_config = Hunyuan3DPaintConfig(6, 512)
                paint_config.device = device
                paint_config.multiview_cfg_path = str(paint_config_path)
                paint_config.multiview_pretrained_path = str(weights_dir)
                paint_config.dino_ckpt_path = str(dinov2_weights)
                paint_config.realesrgan_ckpt_path = str(realesrgan_weights)

                self._paint_pipeline = Hy3DPaintV21(paint_config)
                self._paint_is_hy3dpaint = True
                logger.info(
                    "Hunyuan3D-2.1 Paint loaded from local weights (paint=%s, dino=%s, realesrgan=%s)",
                    paint_weights,
                    dinov2_weights,
                    realesrgan_weights,
                )
        except Exception as exc:
            if self.feature_type == "image_mesh_painting":
                raise RuntimeError(f"Hunyuan3D-2.1 Paint initialization failed: {exc}") from exc
            logger.warning("hy3dpaint unavailable (%s); trying hy3dgen paint fallback", exc)
            try:
                paint_dir = resolve_pretrained("tencent/Hunyuan3D-2")
                paint_sub = (
                    "hunyuan3d-paint-v2-0-turbo"
                    if (paint_dir / "hunyuan3d-paint-v2-0-turbo" / "model_index.json").is_file()
                    else "hunyuan3d-paint-v2-0"
                )
                with use_thirdparty("hunyuan3d-2", chdir=False):
                    from hy3dgen.texgen.pipelines import Hunyuan3DPaintPipeline
                    self._paint_pipeline = Hunyuan3DPaintPipeline.from_pretrained(str(paint_dir), subfolder=paint_sub)
            except Exception as fb_exc:
                logger.warning("Hunyuan3D-2.1 paint disabled: %s", fb_exc)
                self._paint_pipeline = None

        return self._shape_pipeline

    def _unload_model(self) -> None:
        self._shape_pipeline = None
        self._paint_pipeline = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _run_paint(self, mesh_path: str, image_path: str, out: Path) -> None:
        if self._paint_is_hy3dpaint:
            self._paint_pipeline(
                mesh_path=str(mesh_path),
                image_path=str(image_path),
                output_mesh_path=str(out.with_suffix(".obj")),
                use_remesh=False,
                save_glb=True,
            )
        else:
            textured = self._paint_pipeline(mesh=trimesh.load(mesh_path, process=False), image=Image.open(image_path))
            textured.export(str(out))

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        seed = int(inputs["seed"])
        tex_raw = inputs.get("texture_enabled", inputs.get("generate_texture", False))
        texture_enabled = tex_raw.strip().lower() in {"1", "true", "yes", "on"} if isinstance(tex_raw, str) else bool(tex_raw)
        tex_res = max(512, min(4096, int(inputs.get("texture_resolution") or 2048)))

        if self.feature_type == "image_mesh_painting":
            if self._paint_pipeline is None:
                return {"success": False, "error": "Hunyuan3D-2.1 paint pipeline not loaded"}
            mesh_path, image_path = inputs.get("mesh_path"), inputs.get("image_path")
            if not mesh_path or not Path(mesh_path).is_file():
                return {"success": False, "error": f"Mesh not found: {mesh_path}"}
            if not image_path or not Path(image_path).is_file():
                return {"success": False, "error": f"Image not found: {image_path}"}
            out = self._create_temporary_output_dir("hunyuan3d21_paint") / f"hunyuan3d_21_paint_{seed}.glb"
            with torch.no_grad():
                self._run_paint(str(mesh_path), str(image_path), out)
            return {
                "success": True,
                "output_mesh_path": str(out.resolve()),
                "mesh_path": str(out.resolve()),
                "textured_mesh_path": str(out.resolve()),
                "texture_enabled": True,
                "generation_info": {"seed": seed, "texture_resolution": tex_res},
            }

        if self._shape_pipeline is None:
            return {"success": False, "error": "Hunyuan3D-2.1 shape pipeline not loaded"}
        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"Image not found: {image_path}"}

        gen = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(seed)
        shape_params = {
            "num_inference_steps": int(inputs.get("num_inference_steps", 50)),
            "guidance_scale": float(inputs.get("guidance_scale", 7.5)),
            "octree_resolution": int(inputs.get("octree_resolution", 512)),
            "num_chunks": int(inputs.get("num_chunks", 8000)),
        }
        with torch.no_grad():
            mesh = self._shape_pipeline(image=str(image_path), generator=gen, **shape_params)[0]

        out_dir = self._create_temporary_output_dir("hunyuan3d21")
        out = out_dir / f"hunyuan3d_21_{seed}.glb"
        mesh.export(str(out))

        textured_out: Path | None = None
        if texture_enabled and self._paint_pipeline is not None:
            try:
                textured_out = out_dir / f"hunyuan3d_21_textured_{seed}.glb"
                with torch.no_grad():
                    self._run_paint(str(out), str(image_path), textured_out)
            except Exception as exc:
                logger.warning("Hunyuan3D-2.1 texture autochain failed: %s", exc)
                textured_out = None

        return {
            "success": True,
            "output_mesh_path": str((textured_out or out).resolve()),
            "mesh_path": str((textured_out or out).resolve()),
            "textured_mesh_path": str(textured_out.resolve()) if textured_out else None,
            "texture_enabled": textured_out is not None,
            "actual_face_count": len(mesh.faces),
            "actual_vertex_count": len(mesh.vertices),
            "generation_info": {"seed": seed, "texture_resolution": tex_res, **shape_params},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp", "glb", "obj"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
