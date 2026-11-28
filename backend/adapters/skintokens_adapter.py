"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  SkinTokens Auto-Rigging Adapter                                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/SkinTokens (demo.py + bpy_server.py)          ║
║  Weights  : backend/pretrained/SkinTokens                                    ║
║  Patcher  : patcher.skintokens.apply_patch()  (sm < 80 + qwen3_compat)       ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import gc
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Dict

import torch

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, resolve_thirdparty, use_thirdparty
from patcher.skintokens import apply_patch, bpy_server_popen_args

logger = logging.getLogger(__name__)


class SkinTokensAdapter(BaseModel):
    MODEL_KEY = "SkinTokens"
    FEATURE_TYPE = "auto_rig"

    def __init__(self, vram_requirement: int, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self._server_proc: Any = None
        self._ckpt_path: str | None = None

    def _start_bpy_server(self) -> None:
        skintokens_root = resolve_thirdparty("SkinTokens")
        repo_root = Path(__file__).resolve().parents[2]
        with use_thirdparty("SkinTokens", chdir=True):
            self._server_proc = subprocess.Popen(
                bpy_server_popen_args(str(skintokens_root), str(repo_root)),
                stdout=None,
                stderr=None,
            )

    def _stop_bpy_server(self) -> None:
        proc = self._server_proc
        self._server_proc = None
        if proc is None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=3)
            except Exception:
                logger.warning("Could not reap SkinTokens bpy_server", exc_info=True)

    def _load_model(self) -> Any:
        # 1. Patcher FIRST
        apply_patch(gpu_id=self.gpu_id)

        weights_dir = Path(self.model_path) if self.model_path else resolve_pretrained(self.MODEL_KEY)
        if not weights_dir.is_dir():
            raise FileNotFoundError(f"SkinTokens weights missing: {weights_dir}")

        ckpts = sorted(weights_dir.rglob("*.ckpt")) + sorted(weights_dir.rglob("*.safetensors"))
        if not ckpts:
            raise FileNotFoundError(f"No SkinTokens checkpoint found in {weights_dir}")
        self._ckpt_path = str(ckpts[0])

        # 2. Upstream SECOND
        skintokens_root = resolve_thirdparty("SkinTokens")
        self._start_bpy_server()
        try:
            with use_thirdparty("SkinTokens", chdir=True):
                import demo
                demo.wait_for_bpy_server()
                for qcand in (weights_dir / "models" / "Qwen3-0.6B", skintokens_root / "models" / "Qwen3-0.6B"):
                    if qcand.is_dir():
                        import src.model.tokenrig as tokenrig_mod
                        tokenrig_mod.LLM_LOCAL_DIR = qcand
                        break
                logger.info("Loading SkinTokens from %s", self._ckpt_path)
                # SkinTokens resolves relative paths (e.g.
                # experiments/skin_vae_2_10_32768/last.ckpt) against the CWD,
                # so chdir to the weights dir before loading the model.
                prev_cwd = os.getcwd()
                os.chdir(str(weights_dir))
                try:
                    demo.load_model(model_ckpt=self._ckpt_path, hf_path=None)
                finally:
                    os.chdir(prev_cwd)
        except Exception:
            self._stop_bpy_server()
            raise
        return self._ckpt_path

    def _unload_model(self) -> None:
        self._stop_bpy_server()
        self._ckpt_path = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            return {"success": False, "error": f"Mesh not found: {mesh_path}"}

        seed = int(inputs["seed"])
        torch.manual_seed(seed)
        out_file = self._create_temporary_output_dir("skintokens") / f"{Path(mesh_path).stem}_rigged.glb"
        rig_kwargs = {
            "filepaths": [Path(mesh_path)],
            "top_k": int(inputs.get("top_k", 5)),
            "top_p": float(inputs.get("top_p", 0.95)),
            "temperature": float(inputs.get("temperature", 1.0)),
            "repetition_penalty": float(inputs.get("repetition_penalty", 2.0)),
            "num_beams": int(inputs.get("num_beams", 10)),
            "use_skeleton": bool(inputs.get("use_skeleton", False)),
            "use_transfer": bool(inputs.get("use_transfer", True)),
            "use_postprocess": bool(inputs.get("use_postprocess", False)),
            "output_paths": [out_file],
            "model_ckpt": self._ckpt_path or "",
            "hf_path": None,
        }

        with use_thirdparty("SkinTokens", chdir=True):
            import demo
            try:
                demo.run_rig(**rig_kwargs)
            except Exception as exc:
                if rig_kwargs["use_transfer"] and ("RemoteDisconnected" in repr(exc) or "Connection aborted" in repr(exc)):
                    logger.warning("[SKINTOKENS] bpy_server disconnected during transfer; restarting with use_transfer=False")
                    self._stop_bpy_server()
                    self._start_bpy_server()
                    demo.wait_for_bpy_server()
                    rig_kwargs["use_transfer"] = False
                    demo.run_rig(**rig_kwargs)
                else:
                    raise

        if not out_file.is_file() or out_file.stat().st_size == 0:
            return {"success": False, "error": "SkinTokens produced no rigged GLB"}

        return {
            "success": True,
            "output_mesh_path": str(out_file.resolve()),
            "mesh_path": str(out_file.resolve()),
            "generation_info": {"seed": seed, "use_transfer": rig_kwargs["use_transfer"]},
        }

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["glb", "obj", "fbx", "ply", "stl"], "output": ["glb"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {"parameters": {}}
