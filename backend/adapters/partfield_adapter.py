"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  PartField Learned 3D Feature-Field Segmentation Adapter                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Repo     : backend/thirdparty/PartUV (partuv.preprocess.PFInferenceModel)   ║
║  Weights  : backend/pretrained/PartField or PartUV (model_objaverse.ckpt)    ║
║  Patcher  : None (worker-local partuv._core & preprocess_utils shims)        ║
║  States   : UNLOADED -> LOADING -> LOADED -> PROCESSING -> LOADED / ERROR    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import importlib
import logging
import sys
import time
import types
from pathlib import Path
from typing import Any, Dict, List

import numpy as np

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

try:
    import trimesh
except ImportError:  # pragma: no cover
    trimesh = None

from core.models.base import BaseModel
from core.utils.mesh_segmentation_utils import _generate_palette, _merge_small_islands
from core.utils.upstream import resolve_pretrained, resolve_thirdparty, use_thirdparty
from pipelines.mesh_utils import compute_mesh_stats, export_mesh_safe, load_mesh_safe, to_single_trimesh

logger = logging.getLogger(__name__)


# ── 1. Merge-Tree Decoding ────────────────────────────────────────────────────

def _labels_from_merge_tree(tree: Dict[int, Dict[str, int]], face_count: int, target_parts: int) -> np.ndarray:
    """Cut the official bottom-up PartField merge tree into a fixed part count."""
    if face_count < 1:
        raise ValueError("PartField returned no face features")
    target_parts = max(1, min(int(target_parts), face_count))
    active = set(range(face_count))
    parent: Dict[int, int] = {}

    for node_id in sorted(tree, key=int):
        if len(active) <= target_parts:
            break
        left_id, right_id = int(tree[node_id]["left"]), int(tree[node_id]["right"])
        if left_id not in active or right_id not in active:
            raise ValueError(f"PartField merge tree is invalid at node {node_id}")
        merged_id = int(node_id)
        parent[merged_id] = parent[left_id] = parent[right_id] = merged_id
        active.remove(left_id)
        active.remove(right_id)
        active.add(merged_id)

    if len(active) != target_parts:
        raise ValueError(f"PartField merge tree produced {len(active)} parts, expected {target_parts}")

    def find_root(fid: int) -> int:
        cur = fid
        while parent.get(cur, cur) != cur:
            cur = parent[cur]
        while parent.get(fid, fid) != fid:
            parent[fid], fid = cur, parent[fid]
        return cur

    cluster_labels: Dict[int, int] = {}

    def label_for_face(fid: int) -> int:
        root_id = find_root(fid)
        if root_id not in cluster_labels:
            cluster_labels[root_id] = len(cluster_labels)
        return cluster_labels[root_id]

    return np.fromiter(
        (label_for_face(fid) for fid in range(face_count)),
        dtype=np.int32,
        count=face_count,
    )


# ── 2. Adapter Class ──────────────────────────────────────────────────────────

class PartFieldSegmentationAdapter(BaseModel):
    """Official learned PartField feature inference and agglomerative segmentation."""

    MODEL_KEY = "PartField"
    FEATURE_TYPE = "mesh_segmentation"
    MIN_CHECKPOINT_BYTES = 50_000_000
    REQUIRED_MODULES = (
        "torch_scatter", "lightning", "yacs", "sklearn", "scipy",
        "matplotlib", "networkx", "einops", "h5py", "plyfile", "skimage", "tqdm", "joblib",
    )

    def __init__(self, vram_requirement: int = 8192, **kwargs: Any):
        super().__init__(
            vram_requirement=vram_requirement,
            model_id=kwargs.get("model_id", "partfield_segmentation"),
            model_path=kwargs.get("model_path"),
            feature_type=kwargs.get("feature_type", self.FEATURE_TYPE),
        )
        self.device = "cuda" if torch is not None and torch.cuda.is_available() else "cpu"
        self.model: Any = None
        self.experimental = False
        self.version = "1.0"

    def _resolve_checkpoint(self) -> Path:
        for key in (self.MODEL_KEY, "PartUV"):
            try:
                ckpt = resolve_pretrained(key) / "model_objaverse.ckpt"
                if ckpt.is_file() and ckpt.stat().st_size >= self.MIN_CHECKPOINT_BYTES:
                    return ckpt
            except FileNotFoundError:
                continue
        return resolve_pretrained(self.MODEL_KEY) / "model_objaverse.ckpt"

    @classmethod
    def get_readiness(cls) -> Dict[str, Any]:
        reasons: List[str] = []
        has_cuda = bool(torch is not None and torch.cuda.is_available())
        if not has_cuda:
            reasons.append("PartField requires a CUDA-enabled NVIDIA GPU.")

        ckpt_ok = False
        try:
            ckpt = cls(vram_requirement=8192)._resolve_checkpoint()
            ckpt_ok = ckpt.is_file() and ckpt.stat().st_size >= cls.MIN_CHECKPOINT_BYTES
        except Exception as exc:
            reasons.append(f"Could not resolve PartField checkpoint: {exc}")
        if not ckpt_ok:
            reasons.append("PartField checkpoint missing or incomplete.")

        try:
            root = resolve_thirdparty("PartUV")
            pf_dir = root / "preprocess_utils" / "partfield_official"
            src_ok = (pf_dir / "run_PF.py").is_file() and (pf_dir / "configs" / "final" / "demo.yaml").is_file()
        except FileNotFoundError:
            src_ok = False
        if not src_ok:
            reasons.append("Vendored PartField inference source missing.")

        missing: List[str] = []
        for m in cls.REQUIRED_MODULES:
            try:
                importlib.import_module(m)
            except Exception:
                missing.append(m)
        if missing:
            reasons.append("Missing PartField dependencies: " + ", ".join(missing))

        available = has_cuda and ckpt_ok and src_ok and not missing
        return {
            "available": available,
            "model_id": "partfield_segmentation",
            "device": "cuda" if has_cuda else "cpu",
            "checkpoint_available": ckpt_ok,
            "missing_dependencies": missing,
            "reason": "PartField runtime ready" if available else " ".join(reasons),
        }

    # ── 3. Lifecycle (Load / Unload) ──────────────────────────────────────────

    def _load_model(self) -> Any:
        readiness = self.get_readiness()
        if not readiness["available"]:
            raise RuntimeError(readiness["reason"])
        checkpoint = self._resolve_checkpoint()
        with use_thirdparty("PartUV", chdir=False) as root:
            try:
                importlib.import_module("partuv._core")
            except Exception:
                sys.modules.setdefault("partuv._core", types.ModuleType("partuv._core"))
            sys.modules["partuv.preprocess_utils"] = importlib.import_module("preprocess_utils")
            PFInferenceModel = getattr(importlib.import_module("partuv.preprocess"), "PFInferenceModel")
            cfg = root / "preprocess_utils" / "partfield_official" / "configs" / "final" / "demo.yaml"
            device = torch.device("cuda", torch.cuda.current_device())
            self.device = str(device)
            return PFInferenceModel(cfg_path=str(cfg), checkpoint_path=str(checkpoint), device=device)

    def _unload_model(self) -> None:
        self.model = None
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.device = "cuda" if torch is not None and torch.cuda.is_available() else "cpu"

    # ── 4. Inference & Export ─────────────────────────────────────────────────

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if self.model is None:
            raise RuntimeError("PartField is not loaded; AI segmentation cannot run")
        if trimesh is None:
            raise RuntimeError("Trimesh is required for PartField segmentation")
        mesh_path = inputs.get("mesh_path")
        if not mesh_path or not Path(mesh_path).is_file():
            raise FileNotFoundError(f"Mesh file not found: {mesh_path}")

        output_format = str(inputs.get("output_format", "glb")).lower().lstrip(".")
        if output_format not in {"glb", "obj"}:
            raise ValueError("PartField output_format must be 'glb' or 'obj'")
        if str(inputs.get("method", "semantic")).lower() not in {"semantic", "agglomerative"}:
            raise ValueError("PartField AI only supports semantic/agglomerative clustering")

        target_parts = max(2, min(32, int(inputs["num_parts"])))
        min_face_island = max(0, int(inputs["min_face_island_threshold"]))
        colorize = bool(inputs["colorize_preview"])
        save_individual = bool(inputs["save_individual_parts"])
        hierarchical = bool(inputs.get("hierarchical", False))
        progress = inputs.get("progress_callback")

        source_file = Path(mesh_path).resolve()
        output_dir = Path(inputs.get("output_dir") or source_file.parent)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{source_file.stem}_partfield_segmented.{output_format}"

        if callable(progress):
            progress("Loading source mesh", 5, "preprocess")
        original_mesh = to_single_trimesh(load_mesh_safe(source_file))
        face_count = len(original_mesh.faces)
        if face_count < 2:
            raise ValueError("PartField needs at least two mesh faces to segment")

        if callable(progress):
            progress("Extracting trained PartField feature fields", 15, "inference")
        t0 = time.perf_counter()
        tree, _, _ = self.model.process_face(
            str(source_file), mesh=original_mesh.copy(), output_path=None,
            max_cluster=min(target_parts, face_count), udf_mesh=False,
            save_features=False, save_segmentation=False,
            seed=int(inputs.get("seed", 42)),
            sample_on_faces=int(inputs.get("sample_on_faces", 10)),
            sample_batch_size=int(inputs.get("sample_batch_size", 8192)), pca_dim=None,
        )
        logger.info("[PARTFIELD] Feature inference completed in %.2fs", time.perf_counter() - t0)

        if callable(progress):
            progress("Clustering learned PartField features", 75, "clustering")
        labels = _labels_from_merge_tree(tree, face_count, min(target_parts, face_count))
        if min_face_island > 0:
            labels = _merge_small_islands(labels, original_mesh.triangles_center, min_face_island)
            remap = {int(old): new for new, old in enumerate(np.unique(labels))}
            labels = np.asarray([remap[int(lbl)] for lbl in labels], dtype=np.int32)

        actual_parts = int(len(np.unique(labels)))
        segmented_mesh = original_mesh.copy()
        palette = _generate_palette(actual_parts)
        if colorize:
            fc = np.full((face_count, 4), 220, dtype=np.uint8)
            for pid in range(actual_parts):
                fc[labels == pid] = palette[pid % len(palette)]
            segmented_mesh.visual.face_colors = fc

        individual_paths: List[str] = []
        if save_individual:
            parts_dir = output_dir / f"{output_path.stem}_parts"
            parts_dir.mkdir(parents=True, exist_ok=True)
            scene = trimesh.Scene()
            for pid in range(actual_parts):
                pf = segmented_mesh.faces[labels == pid]
                if not len(pf):
                    continue
                v_ids, inv = np.unique(pf, return_inverse=True)
                pm = trimesh.Trimesh(vertices=segmented_mesh.vertices[v_ids], faces=inv.reshape(-1, 3), process=False)
                rgb = palette[pid % len(palette)]
                if colorize:
                    pm.visual.face_colors = np.tile(np.asarray(rgb, dtype=np.uint8), (len(pm.faces), 1))
                p_path = parts_dir / f"part_{pid + 1:02d}.{output_format}"
                export_mesh_safe(pm, p_path, file_type=output_format)
                individual_paths.append(str(p_path))
                scene.add_geometry(pm, node_name=f"part_{pid + 1:02d}")
            scene.export(str(output_path), file_type=output_format)
        else:
            export_mesh_safe(segmented_mesh, output_path, file_type=output_format)

        total_faces = max(1, len(segmented_mesh.faces))
        parts = [
            {
                "id": f"p{pid + 1}", "name": f"Part {pid + 1}",
                "color": f"#{int(palette[pid % len(palette)][0]):02x}{int(palette[pid % len(palette)][1]):02x}{int(palette[pid % len(palette)][2]):02x}",
                "faces": (cnt := int(np.count_nonzero(labels == pid))),
                "volumePercent": round(cnt / total_faces * 100.0, 1), "visible": True,
            }
            for pid in range(actual_parts)
        ]

        hierarchy = None
        if hierarchical:
            fc_centers = original_mesh.triangles_center
            if actual_parts > 1:
                p_centers = [fc_centers[labels == pid].mean(axis=0).tolist() for pid in range(actual_parts)]
                _, eigvecs = np.linalg.eigh(np.cov(fc_centers - fc_centers.mean(axis=0), rowvar=False))
                vals = np.asarray(p_centers) @ eigvecs[:, -1]
                med = float(np.median(vals))
                left = [pid for pid, v in enumerate(vals) if v <= med]
                right = [pid for pid, v in enumerate(vals) if v > med]
            else:
                left, right = [0], []
            hierarchy = {
                "id": "root", "label": "Assembly",
                "children": [
                    {"id": "assembly_01", "label": "Subassembly A", "part_ids": left},
                    {"id": "assembly_02", "label": "Subassembly B", "part_ids": right},
                ],
            }

        stats = compute_mesh_stats(segmented_mesh)
        stats.update({
            "requested_parts": target_parts, "actual_parts": actual_parts,
            "method": "partfield_feature_agglomerative", "hierarchical": hierarchical,
            "hierarchy": hierarchy, "parts": parts, "individual_part_files": individual_paths,
        })
        if callable(progress):
            progress("PartField segmentation complete", 100, "completed")
        return {
            "success": True, "status": "success", "mesh_path": str(output_path),
            "output_path": str(output_path), "format": output_format, "num_parts": actual_parts,
            "parts": parts, "stats": stats, "hierarchy": hierarchy,
            "individual_part_paths": individual_paths,
            "metrics": {"vertices": len(segmented_mesh.vertices), "triangles": len(segmented_mesh.faces), "actual_parts": actual_parts},
        }

    execute = _process_request

    # ── 5. Schema & Metadata ──────────────────────────────────────────────────

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "num_parts": {"type": "integer", "minimum": 2, "maximum": 32, "default": 8},
                "method": {"type": "string", "enum": ["semantic"], "default": "semantic"},
                "hierarchical": {"type": "boolean", "default": False},
                "min_face_island_threshold": {"type": "integer", "minimum": 0, "maximum": 5000, "default": 50},
                "colorize_preview": {"type": "boolean", "default": True},
                "save_individual_parts": {"type": "boolean", "default": False},
                "output_format": {"type": "string", "enum": ["glb", "obj"], "default": "glb"},
            },
        }

    def get_supported_formats(self) -> List[str]:
        return ["glb", "obj"]

    def estimate_vram(self, **kwargs: Any) -> int:
        return self.vram_requirement

    def health_check(self) -> bool:
        return bool(self.get_readiness()["available"])
