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
2. T4 pre-Ampere execution: patcher/skintokens/ adapts attention to SDPA
   and precision to FP16 without touching model code.
3. Thin adapter: directly invokes official upstream demo.load_model and demo.run_rig.
=============================================================================
"""

from __future__ import annotations

import logging
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir
from patcher.skintokens import apply_patch

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891  # matches quality.yaml seeds.base_seed / scheduler auto-seed base


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
        self._server_proc: Any = None
        self._ckpt_path: str | None = None

    def _load_model(self) -> Any:
        skintokens_root = Path(__file__).resolve().parents[1] / "thirdparty" / "SkinTokens"
        root_str = str(skintokens_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

        # Apply model-specific pre-Ampere (T4) hardware patcher and import shims
        apply_patch(gpu_id=self.gpu_id)

        import demo

        # Start companion bpy binding server
        self._server_proc = demo.start_bpy_server()
        demo.wait_for_bpy_server()

        # Resolve weights and call official upstream model loader
        weights_dir = get_model_weights_dir(self.MODEL_KEY)
        ckpt_path = self._resolve_checkpoint(weights_dir, skintokens_root)
        self._ckpt_path = ckpt_path

        # Ensure TokenRig locates local Qwen3-0.6B LLM config
        for qcand in [weights_dir / "models" / "Qwen3-0.6B", skintokens_root / "models" / "Qwen3-0.6B", Path("models/Qwen3-0.6B")]:
            if qcand.is_dir():
                try:
                    import src.model.tokenrig as tokenrig_mod
                    tokenrig_mod.LLM_LOCAL_DIR = qcand
                except Exception:
                    pass
                break

        logger.info("Loading SkinTokens model from %s", ckpt_path or "default")
        demo.load_model(model_ckpt=ckpt_path or "", hf_path=None)
        self.model = demo.model
        self.status = ModelStatus.LOADED
        return self.model

    def _unload_model(self) -> None:
        if self._server_proc is not None:
            try:
                self._server_proc.terminate()
            except Exception:
                pass
            self._server_proc = None

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
        return next((str(c) for c in candidates if c.is_file()), None)

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self.model is None:
            return {"success": False, "error": "SkinTokens not loaded"}

        mesh_path = inputs.get("mesh_path") or inputs.get("image_path") or inputs.get("image")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"Mesh file not found: {mesh_path}"}

        seed = int(inputs.get("seed", DEFAULT_SEED))
        workdir = Path(tempfile.mkdtemp(prefix=f"skintokens_{seed}_"))
        out_file = workdir / f"{Path(mesh_path).stem}_rigged.glb"

        # Direct execution of official upstream inference function
        import demo
        demo.run_rig(
            filepaths=[Path(mesh_path)],
            top_k=int(inputs.get("top_k", 5)),
            top_p=float(inputs.get("top_p", 0.95)),
            temperature=float(inputs.get("temperature", 1.0)),
            repetition_penalty=float(inputs.get("repetition_penalty", 2.0)),
            num_beams=int(inputs.get("num_beams", 10)),
            use_skeleton=bool(inputs.get("use_skeleton", False)),
            use_transfer=bool(inputs.get("use_transfer", True)),
            use_postprocess=bool(inputs.get("use_postprocess", False)),
            output_paths=[out_file],
            model_ckpt=self._ckpt_path or "",
            hf_path=None,
        )

        if not out_file.is_file() or out_file.stat().st_size == 0:
            return {"success": False, "error": "SkinTokens produced no output file"}

        return {
            "success": True,
            "output_mesh_path": str(out_file),
            "mesh_path": str(out_file),
            "generation_info": {
                "seed": seed,
                "top_k": inputs.get("top_k", 5),
                "top_p": inputs.get("top_p", 0.95),
                "temperature": inputs.get("temperature", 1.0),
                "repetition_penalty": inputs.get("repetition_penalty", 2.0),
                "num_beams": inputs.get("num_beams", 10),
                "use_skeleton": inputs.get("use_skeleton", False),
                "use_transfer": inputs.get("use_transfer", True),
                "use_postprocess": inputs.get("use_postprocess", False),
            },
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb", "fbx"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "seed": {"type": "integer", "description": "Random seed", "default": DEFAULT_SEED, "minimum": 0, "required": False},
                "top_k": {"type": "integer", "description": "Top-k sampling threshold", "default": 5, "minimum": 1, "maximum": 50, "required": False},
                "top_p": {"type": "number", "description": "Top-p sampling probability", "default": 0.95, "minimum": 0.0, "maximum": 1.0, "required": False},
                "temperature": {"type": "number", "description": "Sampling temperature", "default": 1.0, "minimum": 0.01, "maximum": 2.0, "required": False},
                "repetition_penalty": {"type": "number", "description": "Repetition penalty", "default": 2.0, "minimum": 1.0, "maximum": 5.0, "required": False},
                "num_beams": {"type": "integer", "description": "Beam search count", "default": 10, "minimum": 1, "maximum": 20, "required": False},
                "use_skeleton": {"type": "boolean", "description": "Use existing mesh skeleton", "default": False, "required": False},
                "use_transfer": {"type": "boolean", "description": "Transfer original textures and scale", "default": True, "required": False},
                "use_postprocess": {"type": "boolean", "description": "Apply voxel skin postprocessing", "default": False, "required": False},
            }
        }
