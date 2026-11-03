"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : trellis_image_to_3d / trellis_image_to_raw_mesh / trellis_image_to_textured_mesh
Model Name        : TRELLIS — Image to 3D / Raw Mesh / Textured Mesh
Feature Target    : image_to_3d / image_to_raw_mesh / image_to_textured_mesh
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/microsoft/TRELLIS
Upstream Pipeline : trellis.pipelines.trellis_image_to_3d.TrellisImageTo3DPipeline
Checkpoint / Path : backend/pretrained/microsoft/TRELLIS.2-4B
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Inference schedules (steps, guidance, sparse structure) are adapter-owned.
=============================================================================
"""
# Status - BETA / ACTIVE
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
        return pipeline

    def _unload_model(self) -> None:
        self._pipeline = None
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

        from PIL import Image

        image = Image.open(image_path)

        ctx = torch.no_grad() if torch is not None else contextlib.nullcontext()
        with ctx:
            result = pipeline.run(image, seed=seed, formats=["mesh"])

        mesh = result.get("mesh") if isinstance(result, dict) else None
        if mesh is None:
            return {"success": False, "error": "TRELLIS produced no mesh"}
        if isinstance(mesh, list):
            mesh = mesh[0] if mesh else None
            if mesh is None:
                return {"success": False, "error": "TRELLIS produced no mesh"}

        import trimesh
        import tempfile

        out = Path(tempfile.mkdtemp()) / f"trellis_{seed}.glb"
        # MeshExtractResult has vertices/faces as torch tensors, no .export() method
        tmesh = trimesh.Trimesh(
            vertices=mesh.vertices.cpu().numpy(),
            faces=mesh.faces.cpu().numpy(),
            process=False,
        )
        tmesh.export(str(out))

        return {
            "success": True,
            "output_mesh_path": str(out),
            "mesh_path": str(out),
            "generation_info": {
                "seed": seed,
                "num_inference_steps": "adapter_owned",
                "guidance_scale": "adapter_owned",
                "octree_resolution": "adapter_owned",
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
