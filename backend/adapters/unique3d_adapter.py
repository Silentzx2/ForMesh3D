"""Unique3D adapter — thin integration over the official ThirdParty inference
API.

Calls Unique3D's app.gradio_3dgen.generate3dv2 Python inference entry point
from backend/thirdparty/Unique3D. Weights are resolved through
backend.loader.get_model_weights_dir.
"""
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
from backend.loader import get_model_weights_dir

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


class Unique3DImageToRawMeshAdapter(BaseModel):
    """Unique3D — Image to Raw Mesh."""

    MODEL_KEY = "Unique3D"
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
        self._zoo: Any = None
        self._generate3d: Any = None
        self._weights_dir: Path | None = None

    def _load_model(self) -> Any:
        unique3d_root = (
            Path(__file__).resolve().parents[1] / "thirdparty" / "Unique3D"
        ).resolve()
        if not (unique3d_root / "app" / "gradio_3dgen.py").is_file():
            raise ImportError(f"Unique3D source not found under {unique3d_root}")
        if str(unique3d_root) not in sys.path:
            sys.path.insert(0, str(unique3d_root))

        weights_dir = Path(get_model_weights_dir(self.MODEL_KEY)).resolve()
        # If checkpoints are placed directly in weights_dir without a ckpt/ folder,
        # create a local relative symlink within weights_dir so upstream ./ckpt resolves.
        actual_ckpt = weights_dir / "ckpt" if (weights_dir / "ckpt").exists() else weights_dir
        if not (weights_dir / "ckpt").exists() and (weights_dir / "controlnet-tile").exists():
            with contextlib.suppress(OSError):
                (weights_dir / "ckpt").symlink_to(".")
                actual_ckpt = weights_dir / "ckpt"

        # Guard: clean up any misplaced symlink at project root to prevent root downloads
        project_root = Path(__file__).resolve().parents[2]
        if (project_root / "ckpt").is_symlink():
            with contextlib.suppress(OSError):
                (project_root / "ckpt").unlink()

        # Guard: verify required checkpoints exist locally before letting diffusers/Unique3D run,
        # preventing upstream from attempting to download files into project root or thirdparty root.
        required_items = ["controlnet-tile", "image2normal", "img2mvimg", "realesrgan-x4.onnx"]
        missing = [item for item in required_items if not (actual_ckpt / item).exists()]
        if missing:
            raise FileNotFoundError(
                f"Unique3D checkpoints missing from {actual_ckpt}: {missing}. "
                "Download them via `bash backend/scripts/download_models.sh -m unique3d`."
            )

        # Ensure thirdparty Unique3D has ckpt symlink pointing to pretrained weights
        thirdparty_ckpt = unique3d_root / "ckpt"
        if not thirdparty_ckpt.exists() and actual_ckpt.exists():
            with contextlib.suppress(OSError):
                thirdparty_ckpt.symlink_to(actual_ckpt)

        previous_cwd = Path.cwd()
        try:
            # Unique3D resolves its ckpt/, config and RealESRGAN paths relative
            # to CWD, and its model modules load checkpoints during import.
            os.chdir(str(weights_dir))
            from app.all_models import model_zoo

            # Prefer a locally downloaded SD 1.5 checkpoint over a Hub lookup.
            for candidate in (
                weights_dir,
                weights_dir / "stable-diffusion-v1-5",
                weights_dir / "sd-v1-5",
                weights_dir / "v1-5",
                weights_dir / "runwayml" / "stable-diffusion-v1-5",
            ):
                if candidate.is_dir() and (candidate / "model_index.json").is_file():
                    model_zoo.base_model = str(candidate)
                    logger.info("Using local Unique3D SD v1.5 base model: %s", candidate)
                    break

            model_zoo.init_models()
            # Import the upstream callable only after CWD is set: importing it
            # initializes the multiview and normal predictors from ./ckpt/.
            from app.gradio_3dgen import generate3dv2
        finally:
            os.chdir(str(previous_cwd))

        self._zoo = model_zoo
        self._generate3d = generate3dv2
        self._weights_dir = weights_dir
        self.model = model_zoo
        return model_zoo

    def _unload_model(self) -> None:
        self._zoo = None
        self._generate3d = None
        self._weights_dir = None
        self.model = None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        generate3d = self._generate3d
        weights_dir = self._weights_dir
        if generate3d is None or weights_dir is None:
            return {"success": False, "error": "Unique3D inference pipeline not loaded"}

        image_path = inputs.get("image_path") or inputs.get("image")
        if not image_path or not Path(image_path).is_file():
            return {"success": False, "error": f"image not found: {image_path}"}

        from PIL import Image

        try:
            with Image.open(image_path) as source:
                image = source.convert("RGB")
        except Exception as image_error:
            return {"success": False, "error": f"Failed to open image {image_path}: {image_error}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        output_dir = Path("/tmp/gradio")
        output_dir.mkdir(parents=True, exist_ok=True)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        previous_cwd = Path.cwd()
        try:
            # The upstream function hardcodes ./ckpt and /tmp/gradio rather
            # than accepting roots. Run it from the model weights directory.
            os.chdir(str(weights_dir))
            with ctx:
                output_mesh_path, _ = generate3d(
                    preview_img=image,
                    input_processing=True,
                    seed=seed,
                    render_video=False,
                )
        finally:
            os.chdir(str(previous_cwd))

        if not output_mesh_path:
            return {"success": False, "error": "Unique3D produced no mesh path"}
        output_path = Path(output_mesh_path)
        if not output_path.is_file():
            return {
                "success": False,
                "error": f"Unique3D did not create its returned mesh file: {output_path}",
            }

        return {
            "success": True,
            "output_mesh_path": str(output_path.resolve()),
            "mesh_path": str(output_path.resolve()),
            "generation_info": {"seed": seed},
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
