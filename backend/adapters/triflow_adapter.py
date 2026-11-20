"""
=============================================================================
MODEL ADAPTER SPECIFICATION & AGENT GOVERNANCE
=============================================================================
Model ID          : triflow_retopology
Model Name        : TriFlow — Neural Quad-Dominant Retopology
Feature Target    : mesh_retopology
Status            : BETA / ACTIVE
Upstream Repo     : https://github.com/DerKleineLi/triflow
Upstream Pipeline : FlowEulerSampler + LatentFlow + topology_flow2mesh_QEM
Checkpoint / Path : backend/pretrained/TriFlow
Hardware / VRAM   : 10240 MB
-----------------------------------------------------------------------------
AGENT GOVERNANCE RULES:
1. DO NOT MODIFY, REFACTOR, OR RE-TUNE THIS FILE OR ITS UPSTREAM PIPELINE
   CODE UNLESS EXPLICITLY INSTRUCTED BY THE USER OR FIXING A VERIFIED DEFECT.
2. Supports dynamic target face count (e.g. 5,000 to 200,000), quad ratio,
   and constrained QEM decimation.
=============================================================================
"""
# Status - BETA / ACTIVE

from __future__ import annotations

import contextlib
import logging
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import trimesh

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from backend.core.models.base import BaseModel, ModelStatus
from backend.loader import get_model_weights_dir
from backend.pipelines.mesh_utils import compute_mesh_stats, export_mesh_safe, load_mesh_safe

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42891


def _setup_triflow_sys_paths(repo_root: Path) -> Path:
    """Setup sys.path for TriFlow and its submodules (TRELLIS, Direct3D-S2)."""
    triflow_root = (repo_root / "backend" / "thirdparty" / "triflow").resolve()
    if not triflow_root.exists():
        triflow_root = (repo_root / "thirdparty" / "triflow").resolve()

    trellis_path = triflow_root / "third_party" / "TRELLIS"
    direct3d_path = triflow_root / "third_party" / "Direct3D-S2"
    pyfqmr_path = triflow_root / "third_party" / "pyfqmr-triflow"

    for p in (str(triflow_root), str(trellis_path), str(direct3d_path), str(pyfqmr_path)):
        if p not in sys.path and Path(p).exists():
            sys.path.insert(0, p)

    return triflow_root


class TriFlowRetopologyAdapter(BaseModel):
    """TriFlow — Neural Quad-Dominant Retopology Adapter with dynamic target polycount."""

    MODEL_KEY = "TriFlow"
    FEATURE_TYPE = "mesh_retopology"

    def __init__(self, vram_requirement: int = 10240, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id", "triflow_retopology"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.device = "cuda" if (torch is not None and torch.cuda.is_available()) else "cpu"
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32
        self.version = "1.0"
        self.pipeline_components: Optional[Dict[str, Any]] = None

    def _resolve_checkpoints(self) -> Dict[str, Path]:
        """Resolve the 3 mandatory TriFlow checkpoints."""
        try:
            weights_dir = get_model_weights_dir(self.MODEL_KEY)
        except FileNotFoundError:
            repo_root = Path(__file__).resolve().parents[2]
            weights_dir = repo_root / "backend" / "pretrained" / self.MODEL_KEY
            weights_dir.mkdir(parents=True, exist_ok=True)

        ckpts = {
            "flow_model": weights_dir / "flow_model.safetensors",
            "sdf_vae": weights_dir / "sdf_vae.safetensors",
            "nvv_vae": weights_dir / "nvv_vae.safetensors",
        }
        return ckpts

    def _load_model(self) -> Any:
        """Load TriFlow VAEs, Latent Flow matching model, and preprocessing transforms."""
        repo_root = Path(__file__).resolve().parents[2]
        triflow_root = _setup_triflow_sys_paths(repo_root)

        ckpts = self._resolve_checkpoints()
        missing = [k for k, p in ckpts.items() if not p.exists()]
        if missing:
            weights_dir = ckpts["flow_model"].parent
            msg = (
                f"TriFlow checkpoints missing: {missing} under {weights_dir}. "
                "Download them via manager.sh option [19] or `bash backend/scripts/download_models.sh -m triflow`."
            )
            logger.warning("[TRIFLOW LOAD] %s", msg)
            return None

        logger.info("[TRIFLOW LOAD] Initializing TriFlow pipeline from %s...", triflow_root)

        try:
            from hydra import compose, initialize_config_dir
            from hydra.utils import instantiate
            from safetensors.torch import load_file
            from accelerate import Accelerator

            config_dir = str(triflow_root / "configs")
            with initialize_config_dir(version_base=None, config_dir=config_dir):
                cfg = compose(config_name="trellis_slatflow_latent_512")

            dataset = instantiate(cfg.trainer.dataset, dummy=True)

            model = instantiate(cfg.trainer.model)
            model_state = load_file(str(ckpts["flow_model"]), device="cpu")
            model.load_state_dict(model_state)
            model.eval()

            sdf_vae = instantiate(cfg.trainer.sdf_vae)
            sdf_state = load_file(str(ckpts["sdf_vae"]), device="cpu")
            sdf_vae.load_state_dict(sdf_state)
            sdf_vae.eval()

            nvv_vae = instantiate(cfg.trainer.nvv_vae)
            nvv_state = load_file(str(ckpts["nvv_vae"]), device="cpu")
            nvv_vae.load_state_dict(nvv_state)
            nvv_vae.eval()

            if self.device == "cuda":
                model.cuda()
                sdf_vae.cuda()
                nvv_vae.cuda()

            accelerator = Accelerator(mixed_precision="fp16" if self.device == "cuda" else "no")

            pre_process_data = instantiate(cfg.trainer.pre_process_data)
            post_process_recon = instantiate(cfg.trainer.post_process_recon)
            get_cond = instantiate(cfg.trainer.get_cond)

            pre_process_fn = pre_process_data(accelerator, nvv_vae)
            post_process_fn = post_process_recon(accelerator, nvv_vae)
            get_cond_fn = get_cond(accelerator, sdf_vae)

            self.pipeline_components = {
                "cfg": cfg,
                "dataset": dataset,
                "model": model,
                "sdf_vae": sdf_vae,
                "nvv_vae": nvv_vae,
                "accelerator": accelerator,
                "pre_process": pre_process_fn,
                "post_process": post_process_fn,
                "get_cond": get_cond_fn,
                "triflow_root": triflow_root,
            }
            self.status = ModelStatus.LOADED

            logger.info("[TRIFLOW LOAD] Successfully loaded TriFlow pipeline.")
            return self.pipeline_components

        except Exception as e:
            logger.error("[TRIFLOW LOAD ERROR] Failed to instantiate TriFlow: %s", str(e), exc_info=True)
            raise RuntimeError(f"Failed to load TriFlow model: {e}") from e

    def _unload_model(self) -> None:
        """Unload TriFlow from GPU memory."""
        if self.pipeline_components:
            for k in ("model", "sdf_vae", "nvv_vae"):
                m = self.pipeline_components.get(k)
                if m is not None and hasattr(m, "to"):
                    try:
                        m.to("cpu")
                    except Exception:
                        pass
            self.pipeline_components.clear()
            self.pipeline_components = None

        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.status = ModelStatus.UNLOADED
        logger.info("[TRIFLOW UNLOAD] Pipeline unloaded and CUDA cache emptied.")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process retopology request with neural vector flow matching and constrained QEM decimation."""
        start_time = time.time()
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).exists():
            raise ValueError(f"Valid mesh_path is required for TriFlow. Provided: {mesh_path}")

        # Parse hyperparameters
        target_faces = int(inputs.get("target_polycount") or inputs.get("face_count") or 50000)
        target_faces = max(500, min(300000, target_faces))

        poly_type = str(inputs.get("poly_type", "quad")).lower()
        default_quad_ratio = 0.95 if poly_type == "quad" else 0.0
        quad_ratio = float(inputs.get("quad_ratio", default_quad_ratio))
        quad_ratio = max(0.0, min(1.0, quad_ratio))

        qem_threshold = float(inputs.get("qem_threshold", 12.0))
        preserve_features = bool(inputs.get("preserve_features", True))
        if not preserve_features:
            qem_threshold = max(qem_threshold, 1e5)

        watertight = bool(inputs.get("watertight") or inputs.get("watertightHealing", False))
        adaptive = bool(inputs.get("adaptive") if "adaptive" in inputs else inputs.get("adaptiveDensity", True))
        output_format = str(inputs.get("output_format", "glb")).lower().lstrip(".")

        repo_root = Path(__file__).resolve().parents[2]
        triflow_root = _setup_triflow_sys_paths(repo_root)

        # Ensure pipeline is loaded
        if self.pipeline_components is None:
            self.pipeline_components = self._load_model()

        if self.pipeline_components is None:
            # Fallback path if weights are absent: high-quality quadric simplification
            logger.warning("[TRIFLOW FALLBACK] Weights absent, applying high-quality quadric decimation fallback.")
            input_mesh = load_mesh_safe(mesh_path)
            try:
                if hasattr(input_mesh, "simplify_quadric_decimation"):
                    simplified = input_mesh.simplify_quadric_decimation(face_count=target_faces)
                else:
                    simplified = input_mesh
            except Exception as e:
                logger.info("[TRIFLOW FALLBACK] Quadric decimation unavailable (%s), using input mesh", e)
                simplified = input_mesh

            if inputs.get("output_path"):
                out_file = Path(inputs["output_path"]).resolve()
            elif inputs.get("output_mesh_path"):
                out_file = Path(inputs["output_mesh_path"]).resolve()
            else:
                out_dir = Path(inputs.get("output_dir") or tempfile.mkdtemp())
                out_dir.mkdir(parents=True, exist_ok=True)
                stem = Path(mesh_path).stem
                out_file = out_dir / f"{stem}_retopo.{output_format}"
            out_file.parent.mkdir(parents=True, exist_ok=True)
            export_mesh_safe(simplified, out_file)
            stats = compute_mesh_stats(simplified)

            return {
                "success": True,
                "output_mesh_path": str(out_file),
                "mesh_path": str(out_file),
                "stats": stats,
                "generation_info": {
                    "engine": "triflow_fallback",
                    "target_faces": target_faces,
                    "quad_ratio": quad_ratio,
                    "execution_time_s": round(time.time() - start_time, 2),
                },
            }

        # Real Neural Pipeline Execution
        try:
            from triflow.utils.mesh_processing import process_one_mesh, robust_remesh
            from triflow.utils.mesh_reconstruction import topology_flow2mesh_QEM
            from triflow.utils.sampling import FlowEulerSampler
            from triflow.utils.sparse_voxel import nested_device_transfer

            accelerator = self.pipeline_components["accelerator"]
            model = self.pipeline_components["model"]
            dataset = self.pipeline_components["dataset"]
            pre_process = self.pipeline_components["pre_process"]
            post_process = self.pipeline_components["post_process"]
            get_cond = self.pipeline_components["get_cond"]

            logger.info("[TRIFLOW] Preprocessing mesh %s to sparse voxel grid...", mesh_path)
            results, trimesh_mesh, augmented_mesh, metadata = process_one_mesh(
                mesh_path,
                res_fine=512,
                pad=1.5,
                round_verts=False,
                decimate_length=1.0,
                vertex_merge_threshold=0.0,
                augment=False,
                augment_strength=1.0,
                augment_density=False,
                remesh_method="sdf" if watertight else "adaptive",
                cast=False,
                get_metadata=True,
                verbose=False,
            )

            results["face_count"] = target_faces
            results["quad_ratio"] = quad_ratio

            data = {}
            for k, v in results.items():
                if isinstance(v, np.ndarray):
                    data[k] = torch.tensor(v)
                    if data[k].dtype == torch.float64:
                        data[k] = data[k].half()
                else:
                    data[k] = torch.tensor([v])

            sample = {
                "data": data,
                "meta": {"path": str(mesh_path)},
                "mesh": {"original": trimesh_mesh, "augmented": augmented_mesh},
            }

            batch = dataset.collate_fn([sample])
            batch = nested_device_transfer(batch, accelerator.device)
            batch_data = batch["data"]

            clean_images = pre_process(batch_data)
            noise = clean_images.replace(torch.randn_like(clean_images.feats))
            sampler = FlowEulerSampler(1e-5)
            c = get_cond(batch)

            mesh_gt = batch["mesh"]["augmented"][0]
            remeshed_mesh, _ = robust_remesh(
                mesh_gt,
                remesh_method="adaptive" if adaptive else "sdf",
                allow_collapse=False,
                get_metadata=False,
                verbose=False,
            )

            nvv_smooth_kwargs = {
                "radius": 3.5,
                "threshold": 6,
                "sigma_s": 1.0,
                "sigma_r": 1.0,
            }

            logger.info("[TRIFLOW] Sampling Latent Flow Matching (50 steps)...")
            with torch.no_grad():
                with accelerator.autocast():
                    res = sampler.sample(model, noise=noise, cond=c, steps=50, verbose=False)

            recon = res.samples
            recon = post_process(batch_data, recon)

            coords = recon["occ_fine"][:, 1:].cpu().numpy()
            nvv = recon["nvv_fine"].cpu().numpy()
            resolution = int(recon["res_fine"])

            logger.info("[TRIFLOW] Reconstructing mesh with constrained QEM (target=%d)...", target_faces)
            mesh_qem = topology_flow2mesh_QEM(
                remeshed_mesh,
                coords,
                nvv,
                resolution,
                nvv_smooth_kwargs=nvv_smooth_kwargs,
                root_threshold=0.5,
                merge_threshold=1.0 if watertight else 0.0,
                target_face_count=target_faces,
                max_quadratic_error=qem_threshold,
                target_position_weight=0.1,
                verbose=False,
            )

            if inputs.get("output_path"):
                out_file = Path(inputs["output_path"]).resolve()
            elif inputs.get("output_mesh_path"):
                out_file = Path(inputs["output_mesh_path"]).resolve()
            else:
                out_dir = Path(inputs.get("output_dir") or tempfile.mkdtemp())
                out_dir.mkdir(parents=True, exist_ok=True)
                stem = Path(mesh_path).stem
                out_file = out_dir / f"{stem}_triflow.{output_format}"
            out_file.parent.mkdir(parents=True, exist_ok=True)
            export_mesh_safe(mesh_qem, out_file)

            stats = compute_mesh_stats(mesh_qem)
            elapsed = round(time.time() - start_time, 2)
            logger.info("[TRIFLOW] Retopology completed in %ss. Output: %s", elapsed, out_file)

            return {
                "success": True,
                "output_mesh_path": str(out_file),
                "mesh_path": str(out_file),
                "stats": stats,
                "generation_info": {
                    "engine": "triflow",
                    "target_faces": target_faces,
                    "quad_ratio": quad_ratio,
                    "execution_time_s": elapsed,
                    "output_format": output_format,
                },
            }

        except Exception as e:
            logger.error("[TRIFLOW ERROR] Inference failed: %s", str(e), exc_info=True)
            raise RuntimeError(f"TriFlow retopology failed: {e}") from e

    def get_supported_formats(self) -> Dict[str, list[str]]:
        """Return supported input and output mesh formats."""
        return {"input": ["obj", "glb", "ply", "stl"], "output": ["obj", "glb", "ply"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        """Return the JSON schema for TriFlow retopology parameters."""
        return {
            "parameters": {
                "target_polycount": {
                    "type": "integer",
                    "description": "Target polygon/face budget",
                    "default": 50000,
                    "minimum": 500,
                    "maximum": 300000,
                    "required": False,
                },
                "poly_type": {
                    "type": "string",
                    "description": "Output topology type (quad or tri)",
                    "default": "quad",
                    "enum": ["quad", "tri"],
                    "required": False,
                },
                "quad_ratio": {
                    "type": "number",
                    "description": "Quad dominance ratio between 0.0 and 1.0",
                    "default": 0.95,
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "required": False,
                },
                "qem_threshold": {
                    "type": "number",
                    "description": "QEM edge collapse threshold for feature retention",
                    "default": 12.0,
                    "minimum": 0.1,
                    "required": False,
                },
                "preserve_features": {
                    "type": "boolean",
                    "description": "Preserve hard surface crease angles",
                    "default": True,
                    "required": False,
                },
                "watertight": {
                    "type": "boolean",
                    "description": "Auto-repair holes and guarantee manifold surface",
                    "default": False,
                    "required": False,
                },
                "output_format": {
                    "type": "string",
                    "description": "Output file format",
                    "default": "glb",
                    "enum": ["glb", "obj"],
                    "required": False,
                },
            }
        }
