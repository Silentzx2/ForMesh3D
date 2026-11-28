"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TRELLIS Image-to-3D & Paint Adapter                                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/TRELLIS (TrellisImageTo3DPipeline, to_glb)    ║
║  Weights  : backend/pretrained/TRELLIS  (or TRELLIS/TRELLIS-image-large)     ║
║  Patcher  : SPARSE_ATTN_BACKEND=sdpa for sm < 80 before TRELLIS import;     ║
║             patcher.trellis.apply_spconv_workarounds (SPCONV_ALGO native)   ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import logging
import os
from pathlib import Path
from typing import Any, Dict

import numpy as np
import torch
import trimesh
from PIL import Image

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, use_thirdparty

logger = logging.getLogger(__name__)


class _TrellisBaseAdapter(BaseModel):
    MODEL_KEY = "TRELLIS"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self._pipeline: Any = None
        self._paint_pipeline: Any = None

    def _load_model(self) -> Any:
        # Must be set before TRELLIS imports so sm < 80 (e.g. T4) uses SDPA cleanly
        if torch.cuda.is_available() and self.gpu_id is not None:
            major, _ = torch.cuda.get_device_capability(self.gpu_id)
            if major < 8:
                os.environ.setdefault("SPARSE_ATTN_BACKEND", "sdpa")

        # TRELLIS worker-scoped patcher: set spconv env vars before TRELLIS/spconv
        # import to avoid CUDA illegal-address in spconv implicit_gemm merge_sort
        # during SLAT sampling.  sm >= 80 stays native; this is isolated to TRELLIS.
        from patcher.trellis import apply_spconv_workarounds

        apply_spconv_workarounds()

        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        alt_dir = weights_dir / "TRELLIS-image-large"
        pipeline_path = alt_dir if (alt_dir / "pipeline.json").is_file() else weights_dir
        if not (pipeline_path / "pipeline.json").is_file():
            raise FileNotFoundError(f"TRELLIS pipeline.json missing in {weights_dir} or {alt_dir}")

        with use_thirdparty("TRELLIS", chdir=False):
            from trellis.pipelines.trellis_image_to_3d import TrellisImageTo3DPipeline

            device = f"cuda:{self.gpu_id}" if torch.cuda.is_available() and self.gpu_id is not None else "cpu"
            logger.info("Loading TRELLIS from %s (device=%s)", pipeline_path, device)
            self._pipeline = TrellisImageTo3DPipeline.from_pretrained(str(pipeline_path))
            self._pipeline.to(device)

            try:
                from trellis.utils.postprocessing_utils import to_glb
                self._paint_pipeline = to_glb
            except Exception as exc:
                logger.warning("TRELLIS texture bake (to_glb) disabled: %s", exc)
                self._paint_pipeline = None

        return self._pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
        self._paint_pipeline = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._pipeline is None:
            return {"success": False, "error": "TRELLIS pipeline not loaded"}
        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"Image not found: {image_path}"}

        seed = int(inputs["seed"])
        tex_res = max(512, min(2048, int(inputs.get("texture_resolution", 1024) or 1024)))
        want_texture = bool(inputs.get("texture_enabled")) and self._paint_pipeline is not None
        formats = ["mesh", "gaussian"] if want_texture else ["mesh"]

        with torch.no_grad():
            result = self._pipeline.run(
                Image.open(image_path),
                seed=seed,
                formats=formats,
                sparse_structure_sampler_params={
                    "steps": int(inputs.get("ss_sampling_steps", 12)),
                    "cfg_strength": float(inputs.get("ss_guidance_strength", 7.5)),
                },
                slat_sampler_params={
                    "steps": int(inputs.get("slat_sampling_steps", 12)),
                    "cfg_strength": float(inputs.get("slat_guidance_strength", 3.0)),
                },
            )

        mesh = result.get("mesh")
        if isinstance(mesh, list):
            mesh = mesh[0] if mesh else None
        if mesh is None:
            return {"success": False, "error": "TRELLIS produced no mesh"}

        app_rep = result.get("gaussian")
        if isinstance(app_rep, list):
            app_rep = app_rep[0] if app_rep else None

        verts = np.asarray(mesh.vertices.cpu().numpy(), dtype=float)
        tmesh = trimesh.Trimesh(vertices=verts - verts.mean(axis=0), faces=mesh.faces.cpu().numpy(), process=False)

        out_dir = self._create_temporary_output_dir("trellis")
        out = out_dir / f"trellis_{seed}.glb"
        tmesh.export(str(out))

        textured_out: Path | None = None
        if want_texture and app_rep is not None:
            try:
                import utils3d.torch
                if not hasattr(utils3d.torch, "perspective_from_fov_xy") and hasattr(utils3d.torch, "perspective_from_fov"):
                    utils3d.torch.perspective_from_fov_xy = lambda fx, fy, n, f: utils3d.torch.perspective_from_fov(
                        fov_x=fx, fov_y=fy, near=n, far=f
                    )
                textured = self._paint_pipeline(app_rep, mesh, texture_size=tex_res)
                if hasattr(textured, "export"):
                    textured_out = out_dir / f"trellis_textured_{seed}.glb"
                    textured.export(str(textured_out))
            except Exception as exc:
                logger.warning("TRELLIS texture bake failed (%s); returning raw mesh", exc)
                textured_out = None

        return {
            "success": True,
            "output_mesh_path": str(out.resolve()),
            "mesh_path": str(out.resolve()),
            "textured_mesh_path": str(textured_out.resolve()) if textured_out else None,
            "texture_enabled": textured_out is not None,
            "actual_face_count": len(tmesh.faces),
            "actual_vertex_count": len(tmesh.vertices),
            "generation_info": {"seed": seed, "texture_resolution": tex_res},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["png", "jpg", "jpeg", "webp"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}


class TrellisImageToRawMeshAdapter(_TrellisBaseAdapter):
    FEATURE_TYPE = "image_to_raw_mesh"


class TrellisImageTo3DAdapter(_TrellisBaseAdapter):
    FEATURE_TYPE = "image_to_raw_mesh"


class TrellisTextMeshPaintingAdapter(_TrellisBaseAdapter):
    FEATURE_TYPE = "text_mesh_painting"


class TrellisImageMeshPaintingAdapter(_TrellisBaseAdapter):
    FEATURE_TYPE = "image_mesh_painting"
