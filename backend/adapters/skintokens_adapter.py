"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : skintokens_auto_rigging
Model Name        : SkinTokens — Unified Autoregressive Rigging
Feature Target    : auto_rig
Status            : PRODUCTION / ACTIVE
Upstream Repo     : https://github.com/VAST-AI-Research/SkinTokens
Upstream Pipeline : TokenRig (FSQ-CVAE + Qwen3-0.6B + GRPO refinement)
Checkpoint / Path : backend/pretrained/SkinTokens
Hardware / VRAM   : 14336 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. Large GPU & Upstream Native Logic Preservation:
   On sm >= 80, SkinTokens runs in 100% native upstream mode (official
   FlashAttention 2, native BF16, official inference schedule).
2. Direct model execution: Thin adapter directly loads and invokes TokenRig
   predict_step in-process; companion bpy_server handles mesh binding.
3. Legacy alias: unirig_auto_rig resolves to this adapter for backward compatibility.
=============================================================================
"""

from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
import time
import urllib.request
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
BPY_SERVER_URL = "http://localhost:59876"


class SkinTokensAdapter(BaseModel):
    """SkinTokens — Unified Autoregressive Rigging (Thin Model Adapter)."""

    MODEL_KEY = "SkinTokens"
    FEATURE_TYPE = "auto_rig"

    _LOCKED_INFERENCE_PROFILE = {
        "architecture": "TokenRig",
        "llm_backbone": "Qwen3-0.6B",
        "skin_quantizer": "FSQ-CVAE",
        "precision": "bfloat16",
        "attention": "flash_attention_2",
    }

    def __init__(self, vram_requirement: int = 14336, **kwargs: Any):
        self.model_id = kwargs.get("model_id", "skintokens_auto_rigging")
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
        self._model: Any = None
        self._tokenizer: Any = None
        self._transform: Any = None
        self._bpy_proc: subprocess.Popen | None = None
        self._skintokens_root: Path | None = None

    def _ensure_bpy_server(self) -> None:
        """Ensure the companion Blender binding service is responsive."""
        try:
            with urllib.request.urlopen(f"{BPY_SERVER_URL}/ping", timeout=0.5) as resp:
                if resp.status == 200:
                    return
        except Exception:
            pass

        if not self._skintokens_root:
            return

        server_script = self._skintokens_root / "bpy_server.py"
        if not server_script.is_file():
            return

        logger.info("Starting SkinTokens companion bpy_server on %s", BPY_SERVER_URL)
        self._bpy_proc = subprocess.Popen(
            [sys.executable, str(server_script)],
            cwd=str(self._skintokens_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        t0 = time.time()
        while time.time() - t0 < 15:
            try:
                with urllib.request.urlopen(f"{BPY_SERVER_URL}/ping", timeout=0.5) as resp:
                    if resp.status == 200:
                        logger.info("Companion bpy_server ready")
                        return
            except Exception:
                time.sleep(0.3)
        logger.warning("bpy_server did not respond to ping within 15s")

    def _load_model(self) -> Any:
        skintokens_root = Path(__file__).resolve().parents[1] / "thirdparty" / "SkinTokens"
        if not skintokens_root.is_dir():
            raise FileNotFoundError(f"SkinTokens thirdparty missing at {skintokens_root}")

        root_str = str(skintokens_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

        self._skintokens_root = skintokens_root
        weights_dir = get_model_weights_dir(self.MODEL_KEY)

        # Start companion bpy binding server
        self._ensure_bpy_server()

        # Resolve primary TokenRig checkpoint
        ckpt_path = self._resolve_checkpoint(weights_dir, skintokens_root)

        device = (
            f"cuda:{self.gpu_id}"
            if self.gpu_id is not None and torch is not None and torch.cuda.is_available()
            else ("cuda" if torch is not None and torch.cuda.is_available() else "cpu")
        )

        from src.server.spec import get_model
        from src.tokenizer.parse import get_tokenizer
        from src.data.transform import Transform

        logger.info("Loading TokenRig model from %s on %s", ckpt_path or "default", device)
        model = get_model(ckpt_path=ckpt_path or "", device=device)
        tokenizer = get_tokenizer(**model.tokenizer_config)
        transform = Transform.parse(**model.transform_config["predict_transform"])

        self._model = model
        self._tokenizer = tokenizer
        self._transform = transform
        self.device = device
        self.model = model
        self.status = ModelStatus.LOADED
        return model

    def _unload_model(self) -> None:
        if self._bpy_proc is not None:
            try:
                self._bpy_proc.terminate()
                self._bpy_proc.wait(timeout=3)
            except Exception:
                pass
            self._bpy_proc = None

        self._model = None
        self._tokenizer = None
        self._transform = None
        self.model = None
        self.status = ModelStatus.UNLOADED

    @staticmethod
    def _resolve_checkpoint(weights_dir: Path, skintokens_root: Path) -> str | None:
        candidates = [
            weights_dir / "experiments" / "articulation_xl_quantization_256_token_4" / "grpo_1400.ckpt",
            weights_dir / "experiments" / "articulation_xl_quantization_256_token_4" / "last.ckpt",
            weights_dir / "grpo_1400.ckpt",
            skintokens_root / "experiments" / "articulation_xl_quantization_256_token_4" / "grpo_1400.ckpt",
            skintokens_root / "experiments" / "articulation_xl_quantization_256_token_4" / "last.ckpt",
        ]
        for cand in candidates:
            if cand.is_file():
                return str(cand)
        return None

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self._model is None:
            return {"success": False, "error": "SkinTokens not loaded"}

        mesh_path = inputs.get("mesh_path") or inputs.get("image_path") or inputs.get("image")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"Mesh file not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        top_k = int(inputs.get("top_k", 5))
        top_p = float(inputs.get("top_p", 0.95))
        temperature = float(inputs.get("temperature", 1.0))
        repetition_penalty = float(inputs.get("repetition_penalty", 2.0))
        num_beams = int(inputs.get("num_beams", 10))
        use_skeleton = bool(inputs.get("use_skeleton", False))
        use_transfer = bool(inputs.get("use_transfer", True))
        use_postprocess = bool(inputs.get("use_postprocess", False))

        workdir = Path(tempfile.mkdtemp(prefix=f"skintokens_{seed}_"))
        out_file = workdir / f"{Path(mesh_path).stem}_rigged.glb"

        from src.data.dataset import DatasetConfig, RigDatasetModule
        from src.server.spec import post_bpy_payload
        from src.data.vertex_group import voxel_skin

        datapath = {
            "data_name": None,
            "loader": "bpy_server",
            "filepaths": {"articulation": [str(mesh_path)]},
        }

        dataset_config = DatasetConfig.parse(
            shuffle=False,
            batch_size=1,
            num_workers=0,
            pin_memory=False,
            persistent_workers=False,
            datapath=datapath,
        ).split_by_cls()

        module = RigDatasetModule(
            predict_dataset_config=dataset_config,
            predict_transform=self._transform,
            tokenizer=self._tokenizer,
            process_fn=self._model._process_fn,
        )

        dataloader = module.predict_dataloader()["articulation"]
        for batch in dataloader:
            if torch is not None and torch.cuda.is_available() and self.device.startswith("cuda"):
                batch = {
                    k: v.to(self.device) if isinstance(v, torch.Tensor) else v
                    for k, v in batch.items()
                }

            if not use_skeleton:
                batch.pop("skeleton_tokens", None)
                batch.pop("skeleton_mask", None)

            batch["generate_kwargs"] = dict(
                max_length=2048,
                top_k=top_k,
                top_p=top_p,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                num_return_sequences=1,
                num_beams=num_beams,
                do_sample=True,
            )

            skeleton_tokens = None
            if "skeleton_tokens" in batch and "skeleton_mask" in batch:
                mask = batch["skeleton_mask"][0] == 1
                skeleton_tokens = batch["skeleton_tokens"][0][mask].cpu().numpy()

            preds = self._model.predict_step(
                batch,
                skeleton_tokens=[skeleton_tokens] if skeleton_tokens is not None else None,
                make_asset=True,
            )["results"]

            asset = preds[0].asset
            if asset is None:
                return {"success": False, "error": "SkinTokens produced no asset"}

            if use_postprocess:
                voxel = asset.voxel(resolution=196)
                asset.skin *= voxel_skin(
                    grid=0,
                    grid_coords=voxel.coords,
                    joints=asset.joints,
                    vertices=asset.vertices,
                    faces=asset.faces,
                    mode="square",
                    voxel_size=voxel.voxel_size,
                )
                asset.normalize_skin()

            if use_transfer:
                payload = dict(
                    source_asset=asset,
                    target_path=asset.path,
                    export_path=str(out_file),
                    group_per_vertex=4,
                )
                res = post_bpy_payload("transfer", payload)
            else:
                payload = dict(
                    asset=asset,
                    filepath=str(out_file),
                    group_per_vertex=4,
                )
                res = post_bpy_payload("export", payload)

            if res != "ok":
                return {"success": False, "error": f"SkinTokens export failed: {res}"}
            break

        if not out_file.is_file() or out_file.stat().st_size == 0:
            return {"success": False, "error": "SkinTokens produced no output file"}

        return {
            "success": True,
            "output_mesh_path": str(out_file),
            "mesh_path": str(out_file),
            "generation_info": {
                "seed": seed,
                "top_k": top_k,
                "top_p": top_p,
                "temperature": temperature,
                "repetition_penalty": repetition_penalty,
                "num_beams": num_beams,
                "use_skeleton": use_skeleton,
                "use_transfer": use_transfer,
                "use_postprocess": use_postprocess,
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb", "fbx"], "output": ["glb"]}

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
                "top_k": {
                    "type": "integer",
                    "description": "Top-k sampling threshold",
                    "default": 5,
                    "minimum": 1,
                    "maximum": 50,
                    "required": False,
                },
                "top_p": {
                    "type": "number",
                    "description": "Top-p sampling probability",
                    "default": 0.95,
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "required": False,
                },
                "temperature": {
                    "type": "number",
                    "description": "Sampling temperature",
                    "default": 1.0,
                    "minimum": 0.01,
                    "maximum": 2.0,
                    "required": False,
                },
                "repetition_penalty": {
                    "type": "number",
                    "description": "Repetition penalty",
                    "default": 2.0,
                    "minimum": 1.0,
                    "maximum": 5.0,
                    "required": False,
                },
                "num_beams": {
                    "type": "integer",
                    "description": "Beam search count",
                    "default": 10,
                    "minimum": 1,
                    "maximum": 20,
                    "required": False,
                },
                "use_skeleton": {
                    "type": "boolean",
                    "description": "Use existing mesh skeleton if present",
                    "default": False,
                    "required": False,
                },
                "use_transfer": {
                    "type": "boolean",
                    "description": "Transfer original materials, textures, and scale",
                    "default": True,
                    "required": False,
                },
                "use_postprocess": {
                    "type": "boolean",
                    "description": "Apply voxel skin postprocessing",
                    "default": False,
                    "required": False,
                },
            }
        }
