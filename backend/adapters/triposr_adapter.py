"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TripoSR Image-to-3D & Base-Color Paint Adapter                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/TripoSR (tsr.system.TSR, tsr.bake_texture)    ║
║  Weights  : backend/pretrained/TripoSR                                       ║
║  Patcher  : patcher.triposr (ensure_torchmcubes, patch_texture_baker)        ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import importlib
import logging
import shutil
import time
from pathlib import Path
from typing import Any, Dict

import numpy as np
import rembg
import torch
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)
TEXTURE_RESOLUTIONS = (1024, 2048, 4096)


class TripoSRAdapter(BaseModel):
    MODEL_KEY = "TripoSR"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.device = "cpu"
        self._remove_background: Any = None
        self._resize_foreground: Any = None
        self._rembg_session: Any = None
        self._bake_texture: Any = None

    def _load_model(self) -> Any:
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        if not (weights_dir / "config.yaml").is_file() or not (weights_dir / "model.ckpt").is_file():
            raise FileNotFoundError(f"TripoSR weights (config.yaml, model.ckpt) missing in {weights_dir}")

        self.device = f"cuda:{self.gpu_id or 0}" if torch.cuda.is_available() else "cpu"

        # 1. Patcher FIRST
        from patcher.triposr import ensure_torchmcubes
        ensure_torchmcubes()

        # 2. Upstream SECOND
        with use_thirdparty("TripoSR", chdir=False):
            from tsr.system import TSR
            from tsr.utils import remove_background, resize_foreground

            logger.info("Loading TripoSR from %s on %s", weights_dir, self.device)
            pipeline = TSR.from_pretrained(str(weights_dir), config_name="config.yaml", weight_name="model.ckpt")
            pipeline.renderer.set_chunk_size(8192)
            pipeline.to(self.device)

            self._remove_background = remove_background
            self._resize_foreground = resize_foreground
            self._rembg_session = rembg.new_session()
            return pipeline

    def _get_texture_baker(self):
        if self._bake_texture is None:
            with use_thirdparty("TripoSR", chdir=False):
                baker = importlib.import_module("tsr.bake_texture")
                from patcher.triposr import patch_texture_baker
                patch_texture_baker(baker, torch_module=torch)
                self._bake_texture = baker.bake_texture
        return self._bake_texture

    def _unload_model(self) -> None:
        self._remove_background = self._resize_foreground = None
        self._rembg_session = self._bake_texture = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _prepare_image(self, image_path: Path, foreground_ratio: float = 0.85) -> Image.Image:
        with Image.open(image_path) as source:
            rgba = self._remove_background(source.convert("RGBA"), self._rembg_session)
        rgba = self._resize_foreground(rgba.convert("RGBA"), foreground_ratio)
        pixels = np.asarray(rgba, dtype=np.float32) / 255.0
        rgb = pixels[..., :3] * pixels[..., 3:4] + (1.0 - pixels[..., 3:4]) * 0.5
        return Image.fromarray(np.rint(np.clip(rgb, 0.0, 1.0) * 255.0).astype(np.uint8))

    def _export_mesh(self, mesh: trimesh.Trimesh, baked: Dict[str, Any] | None, resolution: int, prefix: str):
        temp = self._create_temporary_output_dir(prefix)
        output = temp / "triposr_output.glb"
        z_up_to_y_up = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
        try:
            if baked is None:
                out_mesh = mesh.copy()
                out_mesh.apply_transform(z_up_to_y_up)
                out_mesh.export(str(output), file_type="glb")
            else:
                vmapping = np.asarray(baked["vmapping"], dtype=np.int64)
                colors = np.asarray(baked["colors"], dtype=np.float32)
                atlas = Image.fromarray(np.clip(colors * 255.0, 0, 255).astype(np.uint8)).transpose(
                    Image.Transpose.FLIP_TOP_BOTTOM
                )
                material = PBRMaterial(
                    name="TripoSR Base Color", baseColorTexture=atlas, metallicFactor=0.0, roughnessFactor=1.0
                )
                painted = trimesh.Trimesh(
                    vertices=np.asarray(mesh.vertices)[vmapping],
                    faces=baked["indices"],
                    vertex_normals=np.asarray(mesh.vertex_normals)[vmapping],
                    visual=TextureVisuals(uv=baked["uvs"], material=material),
                    process=False,
                )
                painted.apply_transform(z_up_to_y_up)
                painted.export(str(output), file_type="glb")
        except Exception:
            shutil.rmtree(temp, ignore_errors=True)
            raise
        return output, temp

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self.model is None:
            raise RuntimeError("TripoSR pipeline is not loaded")
        image_path = Path(inputs.get("reference_image_path") or inputs.get("image_path") or "").expanduser()
        if not image_path.is_file():
            raise FileNotFoundError("TripoSR requires a valid reference image")

        painting = self.feature_type == "image_mesh_painting"
        tex_raw = inputs.get("texture_enabled", inputs.get("generate_texture", False))
        texture_enabled = True if painting else (
            tex_raw.strip().lower() in {"1", "true", "yes", "on"} if isinstance(tex_raw, str) else bool(tex_raw)
        )
        resolution = int(inputs.get("texture_resolution") or 2048)
        if texture_enabled and resolution not in TEXTURE_RESOLUTIONS:
            raise ValueError(f"texture_resolution must be one of {TEXTURE_RESOLUTIONS}")

        image = self._prepare_image(image_path, foreground_ratio=float(inputs.get("foreground_ratio", 0.85)))
        mc_resolution = int(inputs.get("mc_resolution", 512))

        t0 = time.perf_counter()
        with torch.no_grad():
            scene_codes = self.model([image], device=self.device)
            scene_code = scene_codes[0]
            logger.info("[TRIPOSR] Triplane sampling completed elapsed=%.2fs", time.perf_counter() - t0)

            if painting:
                mesh = trimesh.load(str(inputs["mesh_path"]), force="mesh", process=False)
                extent = float(np.max(mesh.extents))
                radius = float(self.model.renderer.cfg.radius)
                sample_mesh = mesh.copy()
                sample_mesh.vertices = (np.asarray(mesh.vertices) - mesh.bounds.mean(axis=0)) * (1.7 * radius / max(extent, 1e-8))
                baked = self._get_texture_baker()(sample_mesh, self.model, scene_code, resolution)
                output_mesh, temp = self._export_mesh(mesh, baked, resolution, "triposr_paint")
                mode, geometry_generated = "image_mesh_painting", False
            else:
                mesh = self.model.extract_mesh(scene_codes, not texture_enabled, resolution=mc_resolution)[0]
                mesh.fix_normals()
                baked = self._get_texture_baker()(mesh, self.model, scene_code, resolution) if texture_enabled else None
                output_mesh, temp = self._export_mesh(
                    mesh, baked, resolution, "triposr_textured" if texture_enabled else "triposr_raw"
                )
                mode = "image_to_textured_mesh" if texture_enabled else "image_to_raw_mesh"
                geometry_generated = True

        return {
            "success": True,
            "output_mesh_path": str(output_mesh.resolve()),
            "mesh_path": str(output_mesh.resolve()),
            "textured_mesh_path": str(output_mesh.resolve()) if texture_enabled else None,
            "texture_enabled": texture_enabled,
            "texture_maps": ["base_color"] if texture_enabled else [],
            "actual_face_count": len(mesh.faces) if baked is None else len(baked["indices"]),
            "actual_vertex_count": len(mesh.vertices) if baked is None else len(baked["vmapping"]),
            "generation_info": {
                "mode": mode,
                "texture_resolution": resolution if texture_enabled else None,
                "geometry_generated": geometry_generated,
            },
            "_temporary_output_dir": str(temp.resolve()),
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "gltf", "obj", "ply", "stl", "png", "jpg", "jpeg", "webp"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
