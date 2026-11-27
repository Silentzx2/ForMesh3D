"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Stable Fast 3D (SF3D) Image-to-Textured-Mesh Adapter                        ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/StableFast3D (sf3d.system.SF3D)               ║
║  Weights  : backend/pretrained/stable-fast-3d                                ║
║  Patcher  : patcher.stable_fast_3d.attention.pre_ampere_chunked_sdpa (sm<80) ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
║  Status   : STABLE & ACTIVE                                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import contextlib
import gc
import importlib
import importlib.util
import logging
import sys
import uuid
from pathlib import Path
from typing import Any, Dict

import rembg
import torch
import trimesh
from PIL import Image

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, resolve_thirdparty, use_thirdparty

logger = logging.getLogger(__name__)


def _preload_native_ext(pkg_root: Path, pkg_name: str) -> None:
    """Pre-inject _C.so into sys.modules to prevent circular PyInit imports."""
    pkg_dir = pkg_root / pkg_name
    c_so = next(pkg_dir.glob("_C*.so"), None) if pkg_dir.is_dir() else None
    if c_so is None:
        c_so = next(pkg_root.glob(f"build/*/{pkg_name}/_C*.so"), None)
    if c_so is None:
        raise RuntimeError(f"SF3D native extension {pkg_name}._C not found under {pkg_root}")
    sys.modules.pop(pkg_name, None)
    sys.modules.pop(f"{pkg_name}._C", None)
    spec = importlib.util.spec_from_file_location(f"{pkg_name}._C", str(c_so))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{pkg_name}._C"] = mod
    spec.loader.exec_module(mod)
    importlib.import_module(pkg_name)


class StableFast3DAdapter(BaseModel):
    MODEL_KEY = "stable-fast-3d"
    FEATURE_TYPE = "image_to_textured_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.device = "cpu"
        self._pipeline: Any = None
        self._rembg_session: Any = None
        self._remove_background: Any = None
        self._resize_foreground: Any = None

    def _load_model(self) -> Any:
        sf3d_root = resolve_thirdparty("StableFast3D")
        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        if not (weights_dir / "config.yaml").is_file() or not (weights_dir / "model.safetensors").is_file():
            raise FileNotFoundError(f"SF3D weights (config.yaml, model.safetensors) missing in {weights_dir}")

        for ext_name in ("texture_baker", "uv_unwrapper"):
            ext_root = sf3d_root / ext_name
            if str(ext_root) not in sys.path:
                sys.path.insert(0, str(ext_root))
            _preload_native_ext(ext_root, ext_name)

        self.device = f"cuda:{self.gpu_id or 0}" if torch.cuda.is_available() else "cpu"
        with use_thirdparty("StableFast3D", chdir=False):
            from sf3d.system import SF3D
            from sf3d.utils import remove_background, resize_foreground

            logger.info("Loading SF3D from %s on %s", weights_dir, self.device)
            pipeline = SF3D.from_pretrained(str(weights_dir), config_name="config.yaml", weight_name="model.safetensors")
            pipeline.to(self.device)
            pipeline.eval()

            self._pipeline = pipeline
            self._remove_background = remove_background
            self._resize_foreground = resize_foreground
            self._rembg_session = rembg.new_session()
            return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self._rembg_session = None
        self._remove_background = None
        self._resize_foreground = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            raise RuntimeError("SF3D pipeline not loaded")
        image_path = Path(inputs.get("image_path") or inputs.get("image") or "")
        if not image_path.is_file():
            raise FileNotFoundError(f"SF3D image not found: {image_path}")

        tex_res = max(512, min(4096, int(inputs.get("texture_resolution", 1024))))
        remesh = str(inputs.get("remesh_option") or "none").strip().lower()
        target_verts = int(inputs.get("target_vertex_count") or inputs.get("vertex_count") or -1)
        if remesh == "none":
            target_verts = -1
        elif target_verts <= 0:
            poly = int(inputs.get("native_target_polycount") or inputs.get("target_polycount") or 0)
            target_verts = max(500, poly // 2) if poly > 0 else (50000 if remesh == "triangle" else -1)

        fg_ratio = float(inputs.get("foreground_ratio", 0.85))
        image = self._remove_background(Image.open(image_path).convert("RGBA"), self._rembg_session)
        image = self._resize_foreground(image, fg_ratio)

        is_pre_ampere = False
        autocast_ctx: Any = contextlib.nullcontext()
        if str(self.device).startswith("cuda") and torch.cuda.is_available():
            major, _ = torch.cuda.get_device_capability(self.gpu_id or 0)
            is_pre_ampere = major < 8
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            autocast_ctx = torch.autocast(device_type="cuda", dtype=dtype)

        # 1. Patcher FIRST (sm < 80 only; sm >= 80 stays native)
        from patcher.stable_fast_3d.attention import pre_ampere_chunked_sdpa

        with pre_ampere_chunked_sdpa(torch, enabled=is_pre_ampere, chunk_size=1024):
            with torch.no_grad(), autocast_ctx:
                try:
                    mesh, _ = self._pipeline.run_image(image, bake_resolution=tex_res, remesh=remesh, vertex_count=target_verts)
                except Exception as exc:
                    if remesh != "none":
                        logger.warning("SF3D remesh (%s) failed (%s); falling back to raw", remesh, exc)
                        mesh, _ = self._pipeline.run_image(image, bake_resolution=tex_res, remesh="none", vertex_count=-1)
                    else:
                        raise

        if isinstance(mesh, (list, tuple)):
            mesh = mesh[0]
        texture_enabled = bool(inputs.get("texture_enabled", True) and inputs.get("generate_texture", True))
        if not texture_enabled:
            mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh)

        out = self._create_temporary_output_dir("stable_fast_3d") / f"sf3d_{uuid.uuid4().hex[:12]}.glb"
        mesh.export(str(out), include_normals=True)
        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "textured_mesh_path": str(out.resolve()) if texture_enabled else None,
            "texture_enabled": texture_enabled,
            "actual_face_count": len(mesh.faces),
            "actual_vertex_count": len(mesh.vertices),
            "generation_info": {"texture_resolution": tex_res, "remesh_option": remesh},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
