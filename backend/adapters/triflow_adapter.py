"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  TriFlow Neural Quad-Dominant Retopology Adapter                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/triflow (Hydra + FlowEulerSampler + QEM)      ║
║  Weights  : backend/pretrained/TriFlow (flow_model, sdf_vae, nvv_vae)        ║
║  Patcher  : None (worker-local meshlib >=3.1 _offsetof_tp alias)             ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import importlib.util
import logging
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import trimesh

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from core.models.base import BaseModel
from core.utils.upstream import resolve_pretrained, use_thirdparty
from pipelines.mesh_utils import compute_mesh_stats, export_mesh_safe, find_blender_binary, load_mesh_safe

logger = logging.getLogger(__name__)


# ── 1. Adapter Class ──────────────────────────────────────────────────────────

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
        weights_dir = resolve_pretrained(self.MODEL_KEY)
        return {k: weights_dir / f"{k}.safetensors" for k in ("flow_model", "sdf_vae", "nvv_vae")}

    # ── 2. Lifecycle (Load / Unload) ──────────────────────────────────────────

    def _load_model(self) -> Any:
        try:
            ckpts = self._resolve_checkpoints()
        except FileNotFoundError as exc:
            logger.warning("[TRIFLOW LOAD] %s", exc)
            return None
        if any(not p.exists() for p in ckpts.values()):
            logger.warning("[TRIFLOW LOAD] Missing checkpoints under %s", ckpts["flow_model"].parent)
            return None

        with use_thirdparty("triflow", chdir=False) as triflow_root:
            for sub in ("TRELLIS", "Direct3D-S2", "pyfqmr-triflow"):
                p = triflow_root / "third_party" / sub
                if p.exists() and str(p) not in sys.path:
                    sys.path.insert(0, str(p))

            from accelerate import Accelerator
            from hydra import compose, initialize_config_dir
            from hydra.utils import instantiate
            from safetensors.torch import load_file

            with initialize_config_dir(version_base=None, config_dir=str(triflow_root / "configs")):
                cfg = compose(config_name="trellis_slatflow_latent_512")

            dataset = instantiate(cfg.trainer.dataset, dummy=True)
            loaded = {}
            for key in ("model", "sdf_vae", "nvv_vae"):
                obj = instantiate(getattr(cfg.trainer, key))
                obj.load_state_dict(load_file(str(ckpts["flow_model" if key == "model" else key]), device="cpu"))
                obj.eval()
                if self.device == "cuda":
                    obj.cuda()
                loaded[key] = obj

            acc = Accelerator(mixed_precision="fp16" if self.device == "cuda" else "no")
            self.pipeline_components = {
                **loaded,
                "cfg": cfg, "dataset": dataset, "accelerator": acc, "triflow_root": triflow_root,
                "pre_process": instantiate(cfg.trainer.pre_process_data)(acc, loaded["nvv_vae"]),
                "post_process": instantiate(cfg.trainer.post_process_recon)(acc, loaded["nvv_vae"]),
                "get_cond": instantiate(cfg.trainer.get_cond)(acc, loaded["sdf_vae"]),
            }
            return self.pipeline_components

    def _unload_model(self) -> None:
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

    # ── 3. Inference & Fallback ───────────────────────────────────────────────

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).exists():
            raise ValueError(f"Valid mesh_path is required for TriFlow. Provided: {mesh_path}")

        target_faces = max(500, min(300000, int(inputs.get("target_polycount") or inputs.get("face_count") or 50000)))
        poly_type = str(inputs.get("poly_type", "quad")).lower()
        quad_ratio = max(0.0, min(1.0, float(inputs.get("quad_ratio", 0.95 if poly_type == "quad" else 0.0))))
        qem_threshold = float(inputs.get("qem_threshold", 12.0))
        if not bool(inputs.get("preserve_features", True)):
            qem_threshold = max(qem_threshold, 1e5)
        watertight = bool(inputs.get("watertight") or inputs.get("watertightHealing", False))
        adaptive = bool(inputs.get("adaptive") if "adaptive" in inputs else inputs.get("adaptiveDensity", True))
        output_format = str(inputs.get("output_format") or "obj").lower().lstrip(".")
        steps = int(inputs.get("num_inference_steps", 50))

        if self.pipeline_components is None:
            self.pipeline_components = self._load_model()
        if self.pipeline_components is None:
            return self._triflow_fallback_mesh(mesh_path, target_faces, quad_ratio, output_format, inputs, start_time)

        try:
            with use_thirdparty("triflow", chdir=False) as triflow_root:
                for sub in ("TRELLIS", "Direct3D-S2", "pyfqmr-triflow"):
                    p = triflow_root / "third_party" / sub
                    if p.exists() and str(p) not in sys.path:
                        sys.path.insert(0, str(p))
                try:
                    import meshlib.mrmeshpy as _mrmesh  # type: ignore

                    if not hasattr(_mrmesh.MeshProjectionResult, "_offsetof_mtp") and hasattr(_mrmesh.MeshProjectionResult, "_offsetof_tp"):
                        _mrmesh.MeshProjectionResult._offsetof_mtp = _mrmesh.MeshProjectionResult._offsetof_tp
                except Exception:
                    pass

                from triflow.utils.mesh_processing import process_one_mesh, robust_remesh
                from triflow.utils.mesh_reconstruction import topology_flow2mesh_QEM
                from triflow.utils.sampling import FlowEulerSampler
                from triflow.utils.sparse_voxel import nested_device_transfer

                c_map = self.pipeline_components
                acc = c_map["accelerator"]
                results, trimesh_mesh, augmented_mesh, _ = process_one_mesh(
                    mesh_path, res_fine=512, pad=1.5, round_verts=False, decimate_length=1.0,
                    vertex_merge_threshold=0.0, augment=False, augment_strength=1.0, augment_density=False,
                    remesh_method="sdf" if watertight else "adaptive", cast=False, get_metadata=True, verbose=False,
                )
                results["face_count"], results["quad_ratio"] = target_faces, quad_ratio
                data = {
                    k: (torch.tensor(v).half() if isinstance(v, np.ndarray) and v.dtype == np.float64
                        else torch.tensor(v) if isinstance(v, np.ndarray) else torch.tensor([v]))
                    for k, v in results.items()
                }
                batch = nested_device_transfer(
                    c_map["dataset"].collate_fn([{"data": data, "meta": {"path": str(mesh_path)}, "mesh": {"original": trimesh_mesh, "augmented": augmented_mesh}}]),
                    acc.device,
                )
                clean = c_map["pre_process"](batch["data"])
                noise = clean.replace(torch.randn_like(clean.feats))
                remeshed, _ = robust_remesh(
                    batch["mesh"]["augmented"][0], remesh_method="adaptive" if adaptive else "sdf",
                    allow_collapse=False, get_metadata=False, verbose=False,
                )
                with torch.no_grad(), acc.autocast():
                    res = FlowEulerSampler(1e-5).sample(c_map["model"], noise=noise, cond=c_map["get_cond"](batch), steps=steps, verbose=True)
                recon = c_map["post_process"](batch["data"], res.samples)
                mesh_qem = topology_flow2mesh_QEM(
                    remeshed, recon["occ_fine"][:, 1:].cpu().numpy(), recon["nvv_fine"].cpu().numpy(), int(recon["res_fine"]),
                    nvv_smooth_kwargs={"radius": 3.5, "threshold": 6, "sigma_s": 1.0, "sigma_r": 1.0},
                    root_threshold=0.5, merge_threshold=1.0 if watertight else 0.0,
                    target_face_count=target_faces, max_quadratic_error=qem_threshold, target_position_weight=0.1, verbose=False,
                )
            return self._build_result(mesh_qem, mesh_path, output_format, poly_type, target_faces, quad_ratio, inputs, start_time, "triflow", "triflow")
        except ModuleNotFoundError as exc:
            if "pyfqmr_triflow" in str(exc):
                return self._triflow_fallback_mesh(mesh_path, target_faces, quad_ratio, output_format, inputs, start_time)
            raise
        except Exception as exc:
            logger.error("[TRIFLOW ERROR] Inference failed: %s", exc, exc_info=True)
            raise RuntimeError(f"TriFlow retopology failed: {exc}") from exc

    def _triflow_fallback_mesh(self, mesh_path: str, target_faces: int, quad_ratio: float, output_format: str, inputs: Dict[str, Any], start_time: float) -> Dict[str, Any]:
        mesh = load_mesh_safe(mesh_path)
        if hasattr(mesh, "dump"):
            mesh = mesh.dump(concatenate=True)
        try:
            simplified = (mesh.simplify_quadric_decimation(face_count=target_faces) if hasattr(mesh, "simplify_quadric_decimation") else mesh) or mesh
        except Exception:
            simplified = mesh
        poly_type = str(inputs.get("poly_type", "quad")).lower()
        return self._build_result(simplified, mesh_path, output_format, poly_type, target_faces, quad_ratio, inputs, start_time, "retopo", "triflow_fallback")

    def _build_result(self, mesh: trimesh.Trimesh, mesh_path: str, output_format: str, poly_type: str, target_faces: int, quad_ratio: float, inputs: Dict[str, Any], start_time: float, suffix: str, engine: str) -> Dict[str, Any]:
        if inputs.get("output_path"):
            out_file = Path(inputs["output_path"]).resolve()
        elif inputs.get("output_mesh_path"):
            out_file = Path(inputs["output_mesh_path"]).resolve()
        else:
            out_dir = Path(inputs["output_dir"]) if inputs.get("output_dir") else self._create_temporary_output_dir("triflow")
            out_dir.mkdir(parents=True, exist_ok=True)
            out_file = out_dir / f"{Path(mesh_path).stem}_{suffix}.{output_format}"
        out_file.parent.mkdir(parents=True, exist_ok=True)

        stats, actual_quad_ratio, quad_obj_path = self._export_triflow_output(mesh, out_file, output_format, poly_type, quad_ratio)
        res_dict: Dict[str, Any] = {
            "success": True, "output_mesh_path": str(out_file), "mesh_path": str(out_file), "stats": stats,
            "generation_info": {
                "engine": engine, "target_faces": target_faces, "poly_type": poly_type,
                "quad_ratio": actual_quad_ratio, "execution_time_s": round(time.time() - start_time, 2), "output_format": output_format,
            },
        }
        if quad_obj_path is not None:
            res_dict["quad_obj_path"] = str(quad_obj_path)
        return res_dict

    # ── 4. Quad Export Helpers ────────────────────────────────────────────────

    @staticmethod
    def _pair_triangles_to_quads(mesh: trimesh.Trimesh, max_angle_deg: float = 45.0):
        faces, adj, angles = np.asarray(mesh.faces), mesh.face_adjacency, mesh.face_adjacency_angles
        max_rad, used, mixed_faces, quad_count = float(np.deg2rad(max_angle_deg)), np.zeros(len(faces), dtype=bool), [], 0
        for idx in np.argsort(angles):
            if angles[idx] > max_rad:
                break
            f0, f1 = int(adj[idx, 0]), int(adj[idx, 1])
            if used[f0] or used[f1]:
                continue
            t0, t1 = faces[f0], faces[f1]
            shared = set(t0.tolist()) & set(t1.tolist())
            if len(shared) != 2:
                continue
            opp0 = next(i for i, v in enumerate(t0) if v not in shared)
            mixed_faces.append([int(t0[opp0]), int(t0[(opp0 + 1) % 3]), next(int(v) for v in t1 if v not in shared), int(t0[(opp0 + 2) % 3])])
            used[f0] = used[f1] = True
            quad_count += 1
        tri_count = 0
        for fi in range(len(faces)):
            if not used[fi]:
                mixed_faces.append([int(v) for v in faces[fi]])
                tri_count += 1
        return mixed_faces, quad_count, tri_count

    @staticmethod
    def _write_quad_obj(mesh: trimesh.Trimesh, mixed_faces: list[list[int]], out_path: Path) -> None:
        lines = [f"v {x:.6f} {y:.6f} {z:.6f}\n" for x, y, z in np.asarray(mesh.vertices)]
        lines.extend("f " + " ".join(str(i + 1) for i in f) + "\n" for f in mixed_faces)
        out_path.write_text("".join(lines), encoding="utf-8")

    @staticmethod
    def _convert_obj_to_fbx(obj_path: Path, fbx_path: Path) -> None:
        snippet = (
            "import bpy, sys\nsrc, dst = sys.argv[-2], sys.argv[-1]\nbpy.ops.wm.read_factory_settings(use_empty=True)\n"
            "(bpy.ops.wm.obj_import if hasattr(bpy.ops.wm, 'obj_import') else bpy.ops.import_scene.obj)(filepath=src)\n"
            "bpy.ops.export_scene.fbx(filepath=dst, use_selection=False, mesh_smooth_type='FACE')\n"
        )
        if importlib.util.find_spec("bpy") is not None:
            cmd = [sys.executable, "-c", snippet, str(obj_path), str(fbx_path)]
        else:
            blender_bin = find_blender_binary()
            if not blender_bin:
                raise RuntimeError("FBX export requires bpy or Blender installed")
            cmd = [blender_bin, "-b", "--python-expr", snippet, "--", str(obj_path), str(fbx_path)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0 or not fbx_path.is_file():
            raise RuntimeError(f"FBX export failed: {proc.stderr.strip() or proc.stdout.strip()}")

    def _export_triflow_output(self, mesh: trimesh.Trimesh, out_file: Path, output_format: str, poly_type: str, quad_ratio: float):
        stats = compute_mesh_stats(mesh)
        if poly_type == "quad" and quad_ratio > 0.0:
            mixed, qc, tc = self._pair_triangles_to_quads(mesh)
            ratio = round(qc / max(1, qc + tc), 4)
            stats.update({"quad_count": qc, "tri_count": tc, "topology": "Quad-Dominant" if qc > 0 else "Triangle", "quad_ratio": ratio})
            quad_obj = None if output_format == "obj" else out_file.with_suffix(".obj")
            self._write_quad_obj(mesh, mixed, out_file if output_format == "obj" else quad_obj)
            if output_format == "fbx":
                self._convert_obj_to_fbx(quad_obj, out_file)
            elif output_format != "obj":
                export_mesh_safe(mesh, out_file)
            return stats, ratio, quad_obj

        if output_format == "fbx":
            tmp_obj = out_file.with_suffix(".obj")
            export_mesh_safe(mesh, tmp_obj, file_type="obj")
            try:
                self._convert_obj_to_fbx(tmp_obj, out_file)
            finally:
                tmp_obj.unlink(missing_ok=True)
        else:
            export_mesh_safe(mesh, out_file, file_type=output_format)
        stats.update({"quad_count": 0, "tri_count": int(len(mesh.faces)), "topology": "Triangle", "quad_ratio": 0.0})
        return stats, 0.0, None

    # ── 5. Schema & Metadata ──────────────────────────────────────────────────

    def get_supported_formats(self) -> Dict[str, list[str]]:
        return {"input": ["obj", "glb", "ply", "stl"], "output": ["obj", "fbx", "glb", "ply"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "target_polycount": {"type": "integer", "default": 50000, "minimum": 500, "maximum": 300000, "required": False},
                "poly_type": {"type": "string", "default": "quad", "enum": ["quad", "tri"], "required": False},
                "quad_ratio": {"type": "number", "default": 0.95, "minimum": 0.0, "maximum": 1.0, "required": False},
                "qem_threshold": {"type": "number", "default": 12.0, "minimum": 0.1, "required": False},
                "preserve_features": {"type": "boolean", "default": True, "required": False},
                "watertight": {"type": "boolean", "default": False, "required": False},
                "output_format": {"type": "string", "default": "obj", "enum": ["obj", "fbx", "glb", "ply"], "required": False},
            }
        }
