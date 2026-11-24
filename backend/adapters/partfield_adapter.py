"""
PartField — NVIDIA learned 3D feature-field mesh segmentation.

AI mode uses the vendored PartUV copy of the official PartField inference model.
There is deliberately no geometric fallback here: a missing checkpoint, CUDA
runtime, or model dependency is a load error, not a successful AI result.
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
except ImportError:  # pragma: no cover - CPU-only lightweight installs
    torch = None

try:
    import trimesh
except ImportError:  # pragma: no cover
    trimesh = None

from backend.core.models.base import BaseModel
from backend.loader import get_model_weights_dir
from pipelines.mesh_utils import (
    compute_mesh_stats,
    export_mesh_safe,
    load_mesh_safe,
    to_single_trimesh,
)
from pipelines.segment import _generate_palette

logger = logging.getLogger(__name__)


def _partuv_root() -> Path:
    repo_root = Path(__file__).resolve().parents[2]
    return (repo_root / "backend" / "thirdparty" / "PartUV").resolve()


def _labels_from_merge_tree(
    tree: Dict[int, Dict[str, int]], face_count: int, target_parts: int
) -> np.ndarray:
    """Cut the official bottom-up PartField merge tree into a fixed part count."""
    if face_count < 1:
        raise ValueError("PartField returned no face features")
    target_parts = max(1, min(int(target_parts), face_count))
    # Keep only merge-parent links instead of copying face-index lists at each
    # merge. The latter becomes quadratic in memory for large meshes.
    active = set(range(face_count))
    parent: Dict[int, int] = {}

    for node_id in sorted(tree, key=int):
        if len(active) <= target_parts:
            break
        node = tree[node_id]
        left_id = int(node["left"])
        right_id = int(node["right"])
        if left_id not in active or right_id not in active:
            raise ValueError(f"PartField merge tree is invalid at node {node_id}")
        merged_id = int(node_id)
        parent[merged_id] = merged_id
        parent[left_id] = merged_id
        parent[right_id] = merged_id
        active.remove(left_id)
        active.remove(right_id)
        active.add(merged_id)

    if len(active) != target_parts:
        raise ValueError(
            f"PartField merge tree could not produce {target_parts} parts "
            f"from {face_count} faces (produced {len(active)})"
        )

    cluster_labels = {node_id: label for label, node_id in enumerate(sorted(active))}

    def find_root(face_id: int) -> int:
        node_id = face_id
        while parent.get(node_id, node_id) != node_id:
            node_id = parent[node_id]
        root_id = node_id
        node_id = face_id
        while parent.get(node_id, node_id) != node_id:
            next_id = parent[node_id]
            parent[node_id] = root_id
            node_id = next_id
        return root_id

    labels = np.fromiter(
        (cluster_labels[find_root(face_id)] for face_id in range(face_count)),
        dtype=np.int32,
        count=face_count,
    )
    return labels


class PartFieldSegmentationAdapter(BaseModel):
    """Official learned PartField feature inference and agglomerative segmentation.

    Status: STABLE / WORKING
    """

    MODEL_KEY = "PartField"
    FEATURE_TYPE = "mesh_segmentation"
    MIN_CHECKPOINT_BYTES = 50_000_000
    REQUIRED_MODULES = (
        "torch_scatter",
        "lightning",
        "yacs",
        "sklearn",
        "scipy",
        "matplotlib",
        "networkx",
        "einops",
        "h5py",
        "plyfile",
        "skimage",
        "tqdm",
        "joblib",
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
        repo_root = Path(__file__).resolve().parents[2]
        candidates: List[Path] = []
        for model_key in (self.MODEL_KEY, "PartUV"):
            try:
                weights_dir = get_model_weights_dir(model_key)
            except Exception:
                weights_dir = repo_root / "backend" / "pretrained" / model_key
            candidates.append(Path(weights_dir) / "model_objaverse.ckpt")

        for checkpoint in candidates:
            if checkpoint.is_file() and checkpoint.stat().st_size >= self.MIN_CHECKPOINT_BYTES:
                return checkpoint
        return candidates[0]

    @classmethod
    def get_readiness(cls) -> Dict[str, Any]:
        """Cheap runtime probe used by the UI before enabling PartField AI mode."""
        reasons: List[str] = []
        has_cuda = bool(torch is not None and torch.cuda.is_available())
        if not has_cuda:
            reasons.append("PartField requires a CUDA-enabled NVIDIA GPU.")

        try:
            checkpoint = cls(vram_requirement=8192)._resolve_checkpoint()
            checkpoint_ok = checkpoint.is_file() and checkpoint.stat().st_size >= cls.MIN_CHECKPOINT_BYTES
        except Exception as exc:
            checkpoint = None
            checkpoint_ok = False
            reasons.append(f"Could not resolve the PartField checkpoint: {exc}")
        if not checkpoint_ok:
            reasons.append(
                "PartField checkpoint is missing or incomplete. Run manager.sh → Models → PartField."
            )

        root = _partuv_root()
        inference_file = root / "preprocess_utils" / "partfield_official" / "run_PF.py"
        config_file = root / "preprocess_utils" / "partfield_official" / "configs" / "final" / "demo.yaml"
        if not inference_file.is_file() or not config_file.is_file():
            reasons.append("Vendored PartField inference source is missing; initialize backend/thirdparty.")

        missing_modules: List[str] = []
        for module_name in cls.REQUIRED_MODULES:
            try:
                importlib.import_module(module_name)
            except Exception as exc:
                logger.debug("PartField dependency %s is not usable: %s", module_name, exc)
                missing_modules.append(module_name)
        if missing_modules:
            reasons.append("Missing or unusable PartField runtime dependencies: " + ", ".join(missing_modules))

        available = has_cuda and checkpoint_ok and inference_file.is_file() and config_file.is_file() and not missing_modules
        return {
            "available": available,
            "model_id": "partfield_segmentation",
            "device": "cuda" if has_cuda else "cpu",
            "checkpoint_available": checkpoint_ok,
            "missing_dependencies": missing_modules,
            "reason": "PartField runtime ready" if available else " ".join(reasons),
        }

    def _load_model(self) -> Any:
        readiness = self.get_readiness()
        if not readiness["available"]:
            raise RuntimeError(readiness["reason"])
        if torch is None:
            raise RuntimeError("PyTorch is not installed")

        root = _partuv_root()
        root_string = str(root)
        if root_string not in sys.path:
            sys.path.insert(0, root_string)

        # The PartUV package imports its optional compiled _core extension at
        # package import time. PartField inference does not call that extension;
        # mirror PartUV's existing worker-local import shim when it is absent.
        try:
            importlib.import_module("partuv._core")
        except Exception:
            sys.modules.setdefault("partuv._core", types.ModuleType("partuv._core"))

        try:
            # PartUV's package imports helper modules from its root-level
            # preprocess_utils package. Keep this alias local to the model
            # worker, matching backend/adapters/partuv_adapter.py.
            preprocess_utils = importlib.import_module("preprocess_utils")
            sys.modules["partuv.preprocess_utils"] = preprocess_utils
            partuv_module = importlib.import_module("partuv.preprocess")
            inference_class = getattr(partuv_module, "PFInferenceModel")
        except Exception as exc:
            raise RuntimeError(f"Could not import vendored PartField inference: {exc}") from exc

        checkpoint = self._resolve_checkpoint()
        config_file = (
            root
            / "preprocess_utils"
            / "partfield_official"
            / "configs"
            / "final"
            / "demo.yaml"
        )
        device = torch.device("cuda", torch.cuda.current_device())
        logger.info("Loading trained PartField checkpoint from %s on %s", checkpoint, device)
        model = inference_class(
            cfg_path=str(config_file),
            checkpoint_path=str(checkpoint),
            device=device,
        )
        self.device = str(device)
        return model

    def _unload_model(self) -> None:
        self.model = None
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.device = "cuda" if torch is not None and torch.cuda.is_available() else "cpu"

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

        method = str(inputs.get("method", "semantic")).lower()
        if method not in {"semantic", "agglomerative"}:
            raise ValueError(
                "PartField AI uses learned semantic features with agglomerative clustering; "
                "use Script mode for geometric or connected-component decomposition."
            )

        target_parts = max(2, min(32, int(inputs.get("num_parts", 8))))
        min_face_island = max(0, int(inputs.get("min_face_island_threshold", 50)))
        colorize = bool(inputs.get("colorize_preview", True))
        save_individual = bool(inputs.get("save_individual_parts", False))
        hierarchical = bool(inputs.get("hierarchical", False))
        progress = inputs.get("progress_callback")
        output_dir = Path(inputs.get("output_dir") or Path(mesh_path).resolve().parent)
        output_dir.mkdir(parents=True, exist_ok=True)
        source_file = Path(mesh_path).resolve()
        output_path = output_dir / f"{source_file.stem}_partfield_segmented.{output_format}"

        if callable(progress):
            progress("Loading source mesh", 5, "preprocess")
        original_mesh = to_single_trimesh(load_mesh_safe(source_file))
        face_count = len(original_mesh.faces)
        if face_count < 2:
            raise ValueError("PartField needs at least two mesh faces to segment")

        # The upstream inference normalizes its mesh in-place. Give it a copy so
        # exported geometry retains the source transform, coordinates and scale.
        inference_mesh = original_mesh.copy()
        if callable(progress):
            progress("Extracting trained PartField feature fields", 15, "inference")
        seed = int(inputs.get("seed", 42))
        sampling_started = time.perf_counter()
        logger.info(
            "[PARTFIELD] Sampling face features: samples_per_face=%d batch_size=%d seed=%d",
            10, 8192, seed,
        )
        tree, _root_node, _normalized_mesh = self.model.process_face(
            str(source_file),
            mesh=inference_mesh,
            output_path=None,
            max_cluster=min(target_parts, face_count),
            udf_mesh=False,
            save_features=False,
            save_segmentation=False,
            seed=seed,
            sample_on_faces=10,
            sample_batch_size=8192,
            pca_dim=None,
        )
        logger.info(
            "[PARTFIELD] Feature sampling/inference completed elapsed=%.2fs",
            time.perf_counter() - sampling_started,
        )

        if callable(progress):
            progress("Clustering learned PartField features", 75, "clustering")
        logger.info("[PARTFIELD] Decoding merge tree into per-face segmentation labels...")
        labels = _labels_from_merge_tree(tree, face_count, min(target_parts, face_count))
        logger.info(
            "[PARTFIELD] Merge-tree decoding completed: faces=%d parts=%d",
            face_count, len(np.unique(labels)),
        )

        # Drop very small face islands into their nearest segment using the
        # existing mesh-processing helper; it does not invent semantic features.
        if min_face_island > 0:
            from pipelines.segment import _merge_small_islands

            labels = _merge_small_islands(labels, original_mesh.triangles_center, min_face_island)
            unique_labels = np.unique(labels)
            remap = {int(old): new for new, old in enumerate(unique_labels)}
            labels = np.asarray([remap[int(label)] for label in labels], dtype=np.int32)

        actual_parts = int(len(np.unique(labels)))
        segmented_mesh = original_mesh.copy()
        palette = _generate_palette(actual_parts)

        if colorize:
            face_colors = np.full((face_count, 4), 220, dtype=np.uint8)
            for part_id in range(actual_parts):
                face_colors[labels == part_id] = palette[part_id % len(palette)]
            segmented_mesh.visual.face_colors = face_colors

        individual_paths: List[str] = []
        if save_individual:
            parts_dir = output_dir / f"{output_path.stem}_parts"
            parts_dir.mkdir(parents=True, exist_ok=True)
            for part_id in range(actual_parts):
                part_faces = segmented_mesh.faces[labels == part_id]
                if len(part_faces) == 0:
                    continue
                vertex_ids, inverse = np.unique(part_faces, return_inverse=True)
                part_mesh = trimesh.Trimesh(
                    vertices=segmented_mesh.vertices[vertex_ids],
                    faces=inverse.reshape(-1, 3),
                    process=False,
                )
                if colorize:
                    part_mesh.visual.face_colors = np.tile(
                        np.asarray(palette[part_id % len(palette)], dtype=np.uint8),
                        (len(part_mesh.faces), 1),
                    )
                part_path = parts_dir / f"part_{part_id + 1:02d}.{output_format}"
                export_mesh_safe(part_mesh, part_path, file_type=output_format)
                individual_paths.append(str(part_path))

        if callable(progress):
            progress("Writing segmented mesh", 90, "export")
        export_mesh_safe(segmented_mesh, output_path, file_type=output_format)

        parts = []
        total_faces = max(1, len(segmented_mesh.faces))
        for part_id in range(actual_parts):
            face_total = int(np.count_nonzero(labels == part_id))
            rgb = palette[part_id % len(palette)]
            parts.append({
                "id": f"p{part_id + 1}",
                "name": f"Part {part_id + 1}",
                "color": f"#{int(rgb[0]):02x}{int(rgb[1]):02x}{int(rgb[2]):02x}",
                "faces": face_total,
                "volumePercent": round(face_total / total_faces * 100.0, 1),
                "visible": True,
            })

        hierarchy = None
        if hierarchical:
            face_centers = original_mesh.triangles_center
            if actual_parts > 1:
                part_centers = [
                    face_centers[labels == part_id].mean(axis=0).tolist()
                    for part_id in range(actual_parts)
                ]
                centered = face_centers - face_centers.mean(axis=0)
                covariance = np.cov(centered, rowvar=False)
                _, eigenvectors = np.linalg.eigh(covariance)
                principal_axis = eigenvectors[:, -1]
                center_values = np.asarray(part_centers) @ principal_axis
                split_value = float(np.median(center_values))
                left = [part_id for part_id, value in enumerate(center_values) if value <= split_value]
                right = [part_id for part_id, value in enumerate(center_values) if value > split_value]
            else:
                left, right = [0], []
            hierarchy = {
                "id": "root",
                "label": "Assembly",
                "children": [
                    {"id": "assembly_01", "label": "Subassembly A", "part_ids": left},
                    {"id": "assembly_02", "label": "Subassembly B", "part_ids": right},
                ],
            }

        stats = compute_mesh_stats(segmented_mesh)
        stats.update({
            "requested_parts": target_parts,
            "actual_parts": actual_parts,
            "method": "partfield_feature_agglomerative",
            "hierarchical": hierarchical,
            "hierarchy": hierarchy,
            "parts": parts,
            "individual_part_files": individual_paths,
        })

        if callable(progress):
            progress("PartField segmentation complete", 100, "completed")
        logger.info(
            "PartField inference completed: faces=%d parts=%d output=%s",
            face_count, actual_parts, output_path,
        )
        return {
            "success": True,
            "status": "success",
            "mesh_path": str(output_path),
            "output_path": str(output_path),
            "format": output_format,
            "num_parts": actual_parts,
            "parts": parts,
            "stats": stats,
            "hierarchy": hierarchy,
            "individual_part_paths": individual_paths,
            "metrics": {
                "vertices": len(segmented_mesh.vertices),
                "triangles": len(segmented_mesh.faces),
                "actual_parts": actual_parts,
            },
        }

    execute = _process_request

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "num_parts": {
                    "type": "integer",
                    "minimum": 2,
                    "maximum": 32,
                    "default": 8,
                    "description": "Target number of semantic mesh parts",
                },
                "method": {
                    "type": "string",
                    "enum": ["semantic"],
                    "default": "semantic",
                    "description": "Official PartField learned-feature agglomerative clustering",
                },
                "hierarchical": {
                    "type": "boolean",
                    "default": False,
                    "description": "Return a part-level assembly hierarchy",
                },
                "min_face_island_threshold": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 5000,
                    "default": 50,
                    "description": "Merge tiny disconnected face islands into retained parts",
                },
                "colorize_preview": {
                    "type": "boolean",
                    "default": True,
                    "description": "Assign a distinct color to each predicted part",
                },
                "save_individual_parts": {
                    "type": "boolean",
                    "default": False,
                    "description": "Export each predicted segment as a separate mesh",
                },
                "output_format": {
                    "type": "string",
                    "enum": ["glb", "obj"],
                    "default": "glb",
                },
            },
        }

    def get_supported_formats(self) -> List[str]:
        return ["glb", "obj"]

    def estimate_vram(self, **kwargs: Any) -> int:
        return self.vram_requirement

    def health_check(self) -> bool:
        return bool(self.get_readiness()["available"])
