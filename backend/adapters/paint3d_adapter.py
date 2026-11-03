"""Paint3D adapter — thin integration over the official ThirdParty inference API.

Wraps ``Paint3D/pipeline_paint3d_stage1.py`` and ``pipeline_paint3d_stage2.py``
from ``backend/thirdparty/Paint3D``. Coarse-to-fine UV texture generation
conditioned on a mesh and optional text/image prompt. Weights resolved through
``backend.loader.get_model_weights_dir``.
"""
# Status - debug
from __future__ import annotations

import contextlib
import logging
import subprocess
import sys
import tempfile
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


class Paint3DAdapter(BaseModel):
    """Paint3D — Image Mesh Painting."""

    MODEL_KEY = "Paint3D"
    FEATURE_TYPE = "image_mesh_painting"

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

    def _load_model(self) -> Any:
        # Paint3D does not expose a single importable inference class; it runs
        # its stage-1/stage-2 pipelines as subprocesses with config files. Scripts
        # and configs live under backend/thirdparty/Paint3D (source root), while
        # weights live under backend/pretrained/Paint3D (weights dir).
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        # Paint3D source root for pipeline scripts and configs
        _paint3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Paint3D")
        stage1 = Path(_paint3d_root) / "pipeline_paint3d_stage1.py"
        stage2 = Path(_paint3d_root) / "pipeline_paint3d_stage2.py"
        if not stage1.is_file() or not stage2.is_file():
            raise FileNotFoundError(
                f"Paint3D pipeline scripts not found under {_paint3d_root}"
            )
        logger.info("Paint3D pipelines resolved at %s", _paint3d_root)
        self.model = {"weights_dir": str(weights_dir), "paint3d_root": str(_paint3d_root)}
        return self.model

    def _unload_model(self) -> None:
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        paint = self.model
        if paint is None:
            return {"success": False, "error": "Paint3D not loaded"}

        weights_dir = Path(paint["weights_dir"])
        paint3d_root = Path(paint["paint3d_root"])

        mesh_path = inputs.get("mesh_path")
        image_path = inputs.get("image_path") or inputs.get("image")
        prompt = inputs.get("text_prompt", "")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"mesh not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))

        workdir = Path(tempfile.mkdtemp()) / f"paint3d_{seed}"
        workdir.mkdir(parents=True, exist_ok=True)

        ctx = contextlib.nullcontext()
        with ctx:
            # Stage 1: coarse texture generation.
            stage1 = paint3d_root / "pipeline_paint3d_stage1.py"
            out1 = workdir / "stage1"
            cmd = [
                sys.executable,
                str(stage1),
                "--sd_config",
                str(paint3d_root / "controlnet" / "config" / "depth_based_inpaint_template.yaml"),
                "--render_config",
                str(paint3d_root / "paint3d" / "config" / "train_config_paint3d.py"),
                "--mesh_path",
                str(mesh_path),
                "--outdir",
                str(out1),
            ]
            if prompt:
                cmd += ["--prompt", prompt]
            if image_path:
                cmd += ["--ip_adapter_image_path", str(image_path)]
            logger.info("Running Paint3D stage 1")
            proc = subprocess.run(cmd, cwd=str(paint3d_root), capture_output=True, text=True)
            if proc.returncode != 0:
                logger.error("Paint3D stage 1 failed: %s", proc.stderr[-2000:])
                return {
                    "success": False,
                    "error": f"Paint3D stage 1 failed: {proc.stderr[-500:]}",
                }

            # Stage 2: UV refinement.
            stage2 = paint3d_root / "pipeline_paint3d_stage2.py"
            out2 = workdir / "stage2"
            cmd2 = [
                sys.executable,
                str(stage2),
                "--sd_config",
                str(paint3d_root / "controlnet" / "config" / "UV_based_inpaint_template.yaml"),
                "--render_config",
                str(paint3d_root / "paint3d" / "config" / "train_config_paint3d.py"),
                "--mesh_path",
                str(mesh_path),
                "--outdir",
                str(out2),
            ]
            if prompt:
                cmd2 += ["--prompt", prompt]
            logger.info("Running Paint3D stage 2")
            proc2 = subprocess.run(cmd2, cwd=str(paint3d_root), capture_output=True, text=True)
            if proc2.returncode != 0:
                logger.error("Paint3D stage 2 failed: %s", proc2.stderr[-2000:])
                return {
                    "success": False,
                    "error": f"Paint3D stage 2 failed: {proc2.stderr[-500:]}",
                }

        # Locate the produced albedo texture and apply it to the mesh before export.
        albedo = next(out2.rglob("albedo.png"), None) or next(out2.rglob("*.png"), None)
        import trimesh

        mesh = trimesh.load(mesh_path, process=False)
        if albedo is not None and albedo.is_file():
            import PIL.Image as PILImage

            texture = PILImage.open(str(albedo)).convert("RGB")
            mesh.visual = trimesh.visual.TextureVisuals(image=texture)
        out = Path(tempfile.mkdtemp()) / f"paint3d_{seed}.glb"
        mesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "texture_atlas": str(albedo) if albedo else None,
                "stage1_dir": str(out1),
                "stage2_dir": str(out2),
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "obj", "png", "jpg"], "output": ["glb", "obj"]}

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
                "text_prompt": {
                    "type": "string",
                    "description": "Optional text prompt guiding the texture",
                    "default": "",
                    "required": False,
                },
            }
        }
