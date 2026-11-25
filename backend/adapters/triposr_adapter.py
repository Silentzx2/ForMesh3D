"""Unified official TripoSR image-to-mesh and image-mesh-painting adapter."""
from __future__ import annotations
import importlib, logging, shutil, sys, tempfile
from pathlib import Path
from typing import Any, Dict
try:
    import torch
except ImportError:
    torch = None
import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals
from backend.core.models.base import BaseModel
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)
MODEL_KEY = "TripoSR"
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "thirdparty" / "TripoSR"
TEXTURE_RESOLUTIONS = (1024, 2048, 4096)
MARCHING_CUBES_RESOLUTION = 256


class TripoSRAdapter(BaseModel):
    """One official TSR pipeline for raw generation, optional baking and mesh painting."""
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int = 6144, **kwargs: Any):
        super().__init__(vram_requirement, model_id=kwargs.get("model_id"),
                         feature_type=kwargs.get("feature_type", self.FEATURE_TYPE))
        self.device = "cpu"
        self._remove_background = self._resize_foreground = None
        self._rembg_session = self._bake_texture = None

    def _load_model(self) -> Any:
        if torch is None:
            raise RuntimeError("PyTorch is required for TripoSR.")
        if not (SOURCE_ROOT / "tsr" / "system.py").is_file():
            raise FileNotFoundError(f"Official TripoSR source is missing: {SOURCE_ROOT}")
        if str(SOURCE_ROOT) not in sys.path:
            sys.path.insert(0, str(SOURCE_ROOT))
        try:
            from patcher.triposr import ensure_torchmcubes
            ensure_torchmcubes()
            from tsr.system import TSR
            from tsr.utils import remove_background, resize_foreground
            import rembg
        except ImportError as exc:
            raise RuntimeError(f"TripoSR source/dependencies are incomplete: {exc}") from exc
        weights = Path(get_model_weights_dir(MODEL_KEY))
        missing = [name for name in ("config.yaml", "model.ckpt") if not (weights / name).is_file()]
        if missing:
            raise FileNotFoundError(f"TripoSR checkpoints missing {missing}; run download_models.sh -m triposr")
        self.device = f"cuda:{self.gpu_id}" if self.gpu_id is not None and torch.cuda.is_available() else "cpu"
        pipeline = TSR.from_pretrained(str(weights), config_name="config.yaml", weight_name="model.ckpt")
        pipeline.to(self.device)
        pipeline.eval()
        pipeline.renderer.set_chunk_size(8192)
        self.model_path = weights
        self._remove_background, self._resize_foreground = remove_background, resize_foreground
        self._rembg_session = rembg.new_session()
        # Raw-only requests do not import or execute the texture baker.
        return pipeline

    def _get_texture_baker(self):
        if self._bake_texture is None:
            baker = importlib.import_module("tsr.bake_texture")
            from patcher.triposr import patch_texture_baker
            patch_texture_baker(baker, torch_module=torch)
            self._bake_texture = baker.bake_texture
        return self._bake_texture

    def _unload_model(self) -> None:
        self._remove_background = self._resize_foreground = None
        self._rembg_session = self._bake_texture = None

    def _prepare_image(self, image_path: Path, foreground_ratio: float = 0.85) -> Image.Image:
        with Image.open(image_path) as source:
            rgba = self._remove_background(source.convert("RGBA"), self._rembg_session)
        if rgba is None:
            raise RuntimeError("TripoSR background removal returned no image")
        rgba = self._resize_foreground(rgba.convert("RGBA"), foreground_ratio)
        pixels = np.asarray(rgba, dtype=np.float32) / 255.0
        rgb = pixels[..., :3] * pixels[..., 3:4] + (1.0 - pixels[..., 3:4]) * 0.5
        return Image.fromarray(np.rint(np.clip(rgb, 0.0, 1.0) * 255.0).astype(np.uint8))

    @staticmethod
    def _texture_enabled(inputs: Dict[str, Any]) -> bool:
        value = inputs.get("texture_enabled", inputs.get("generate_texture", False))
        return value.strip().lower() in {"1", "true", "yes", "on"} if isinstance(value, str) else bool(value)

    def _export_mesh(self, mesh: trimesh.Trimesh, baked: Dict[str, Any] | None,
                     resolution: int, prefix: str):
        temp = self._create_temporary_output_dir(prefix.removeprefix("triposr_") or "triposr")
        output = temp / "triposr_output.glb"
        try:
            if baked is None:
                mesh.export(str(output), file_type="glb")
            else:
                vmapping = np.asarray(baked["vmapping"], dtype=np.int64)
                if vmapping.ndim != 1 or not len(vmapping) or vmapping.min() < 0 or vmapping.max() >= len(mesh.vertices):
                    raise RuntimeError("Official TripoSR baker returned an invalid vertex mapping")
                colors = np.asarray(baked["colors"], dtype=np.float32)
                if colors.shape != (resolution, resolution, 4) or not np.isfinite(colors).all():
                    raise RuntimeError("Official TripoSR baker returned an invalid RGBA atlas")
                atlas = Image.fromarray(np.clip(colors * 255.0, 0, 255).astype(np.uint8)).transpose(
                    Image.Transpose.FLIP_TOP_BOTTOM)
                material = PBRMaterial(name="TripoSR Base Color", baseColorTexture=atlas,
                                        metallicFactor=0.0, roughnessFactor=1.0)
                painted = trimesh.Trimesh(
                    vertices=np.asarray(mesh.vertices)[vmapping], faces=baked["indices"],
                    vertex_normals=np.asarray(mesh.vertex_normals)[vmapping],
                    visual=TextureVisuals(uv=baked["uvs"], material=material), process=False)
                painted.export(str(output), file_type="glb")
            if not output.is_file() or output.read_bytes()[:4] != b"glTF":
                raise RuntimeError("TripoSR did not produce a valid GLB")
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
        texture_enabled = True if painting else self._texture_enabled(inputs)
        resolution = int(inputs.get("texture_resolution") or 2048)
        if texture_enabled and resolution not in TEXTURE_RESOLUTIONS:
            raise ValueError(f"texture_resolution must be one of {TEXTURE_RESOLUTIONS}")
        foreground_ratio = float(inputs["foreground_ratio"])
        mc_resolution = int(inputs["mc_resolution"])
        image = self._prepare_image(image_path, foreground_ratio=foreground_ratio)
        logger.info("[TRIPOSR] Encoding image into 3D triplane representation (device=%s)...", self.device)
        t_stage = __import__("time").perf_counter()
        with torch.no_grad():
            scene_codes = self.model([image], device=self.device)
            scene_code = scene_codes[0]
            logger.info("[TRIPOSR] Triplane sampling completed elapsed=%.2fs", __import__("time").perf_counter() - t_stage)
            if painting:
                mesh_path = Path(inputs.get("mesh_path") or "").expanduser()
                if not mesh_path.is_file():
                    raise FileNotFoundError("TripoSR image painting requires an existing mesh_path")
                mesh = trimesh.load(str(mesh_path), force="mesh", process=False)
                if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces):
                    raise ValueError("TripoSR painting requires a non-empty triangle mesh")
                extent = float(np.max(mesh.extents))
                if extent <= 1e-8:
                    raise ValueError("Input mesh has zero spatial extent")
                radius = float(self.model.renderer.cfg.radius)
                sample_mesh = mesh.copy()
                sample_mesh.vertices = (np.asarray(mesh.vertices) - mesh.bounds.mean(axis=0)) * (1.7 * radius / extent)
                logger.info("[TRIPOSR] Baking reference texture onto mesh (resolution=%d)...", resolution)
                t_bake = __import__("time").perf_counter()
                baked = self._get_texture_baker()(sample_mesh, self.model, scene_code, resolution)
                logger.info("[TRIPOSR] Texture baking completed elapsed=%.2fs", __import__("time").perf_counter() - t_bake)
                output_mesh, temp = self._export_mesh(mesh, baked, resolution, "triposr_paint_")
                geometry_generated, mode = False, "image_mesh_painting"
            else:
                logger.info("[TRIPOSR] Extracting 3D mesh via Marching Cubes (resolution=%d)...", mc_resolution)
                t_mc = __import__("time").perf_counter()
                meshes = self.model.extract_mesh(scene_codes, not texture_enabled,
                                                  resolution=mc_resolution)
                if not meshes or not isinstance(meshes[0], trimesh.Trimesh) or not len(meshes[0].faces):
                    raise RuntimeError("Official TripoSR mesh extraction returned no valid mesh")
                mesh = meshes[0]
                # Ensure consistent outward winding so Three.js never back-face-culls half the mesh.
                mesh.fix_normals()
                logger.info("[TRIPOSR] Mesh decoding completed elapsed=%.2fs faces=%d", __import__("time").perf_counter() - t_mc, len(mesh.faces))
                if texture_enabled:
                    logger.info("[TRIPOSR] Baking UV base-color atlas (resolution=%d)...", resolution)
                    t_bake = __import__("time").perf_counter()
                    baked = self._get_texture_baker()(mesh, self.model, scene_code, resolution)
                    logger.info("[TRIPOSR] Texture baking completed elapsed=%.2fs", __import__("time").perf_counter() - t_bake)
                else:
                    baked = None
                output_mesh, temp = self._export_mesh(
                    mesh, baked, resolution, "triposr_textured_" if texture_enabled else "triposr_raw_")
                geometry_generated = True
                mode = "image_to_textured_mesh" if texture_enabled else "image_to_raw_mesh"
        return {
            "success": True, "output_mesh_path": str(output_mesh.resolve()),
            "mesh_path": str(output_mesh.resolve()),
            "textured_mesh_path": str(output_mesh.resolve()) if texture_enabled else None,
            "texture_enabled": texture_enabled,
            "texture_maps": ["base_color"] if texture_enabled else [],
            "actual_face_count": len(mesh.faces) if baked is None else len(baked["indices"]),
            "actual_vertex_count": len(mesh.vertices) if baked is None else len(baked["vmapping"]),
            "generation_info": {
                "upstream_pipeline": "TSR.extract_mesh + tsr.bake_texture.bake_texture" if texture_enabled else "TSR.extract_mesh",
                "mode": mode, "texture_resolution": resolution if texture_enabled else None,
                "texture_maps": ["base_color"] if texture_enabled else [],
                "geometry_generated": geometry_generated,
            },
            "_temporary_output_dir": str(temp.resolve()),
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "gltf", "obj", "ply", "stl", "png", "jpg", "jpeg", "webp"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {"texture_resolution": {
            "type": "integer", "default": 2048, "enum": list(TEXTURE_RESOLUTIONS),
            "description": "Optional UV-baked base-color atlas resolution.",
        }}}
