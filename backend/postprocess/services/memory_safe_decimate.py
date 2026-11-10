"""Memory-aware mesh decimation using the shared PyMeshLab QEM implementation."""
from __future__ import annotations

import gc
import logging
from pathlib import Path
from typing import Any, Optional, Union

import psutil
import trimesh

try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config

try:
    from .simplify import _simplify
except ImportError:
    from postprocess.services.simplify import _simplify

logger = logging.getLogger(__name__)


def load_decimation_config(
    config_path: Optional[Union[str, Path, dict[str, Any]]] = None
) -> dict[str, Any]:
    """Load decimation configuration from canonical quality config."""
    if isinstance(config_path, dict):
        raw = config_path.get("decimation", config_path)
        dec = dict(raw)
        if "crease_angle_deg" not in dec:
            dec["crease_angle_deg"] = float(
                config_path.get("shared", {}).get("feature_edge_angle_deg", 35.0)
            )
        return dec
    path_str = str(config_path) if config_path is not None else None
    cfg = get_quality_config(path_str)
    dec = dict(cfg.get("decimation", {}))
    dec["crease_angle_deg"] = float(
        cfg.get("shared", {}).get("feature_edge_angle_deg", 35.0)
    )
    return dec


def memory_safe_decimate(
    mesh: trimesh.Trimesh,
    target_faces: int,
    crease_angle_deg: Optional[float] = None,
    config_path: Optional[Union[str, Path, dict[str, Any]]] = None,
    **kwargs: Any,
) -> tuple[trimesh.Trimesh, dict[str, Any]]:
    """Decimate once with the shared native QEM path and guard host RAM.

    Large inputs no longer pass through the slow Python QEM implementation or
    repeated 50% reductions. The configured size/RAM thresholds trigger garbage
    collection before the PyMeshLab C++ decimator allocates its working set.
    """
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected trimesh.Trimesh, got {type(mesh)}")

    working_mesh = mesh.copy()
    cfg = load_decimation_config(config_path)
    threshold_triangles = int(
        kwargs.get(
            "memory_safe_threshold_triangles",
            kwargs.get(
                "threshold_triangles",
                cfg.get("memory_safe_threshold_triangles", 2_000_000),
            ),
        )
    )
    max_ram_fraction = float(
        kwargs.get("max_ram_fraction", cfg.get("max_ram_fraction", 0.80))
    )
    effective_crease_deg = float(
        kwargs.get(
            "crease_angle_deg",
            crease_angle_deg
            if crease_angle_deg is not None
            else cfg.get("crease_angle_deg", 35.0),
        )
    )

    process = psutil.Process()
    peak_rss = process.memory_info().rss
    virtual_memory = psutil.virtual_memory()
    used_fraction = (
        (virtual_memory.total - virtual_memory.available) / virtual_memory.total
        if virtual_memory.total > 0
        else 0.0
    )

    initial_face_count = int(len(working_mesh.faces))
    target_faces = max(1, int(target_faces))
    if initial_face_count <= target_faces or initial_face_count == 0:
        telemetry = {
            "triangles_before": initial_face_count,
            "triangles_after": initial_face_count,
            "reduction_ratio": 1.0,
            "peak_rss_mb": round(peak_rss / (1024.0 * 1024.0), 2),
            "memory_safe_mode_engaged": False,
        }
        return working_mesh, telemetry

    memory_safe_mode_engaged = (
        initial_face_count > threshold_triangles or used_fraction >= max_ram_fraction
    )
    if memory_safe_mode_engaged:
        logger.info(
            "Large or RAM-constrained mesh (%d triangles, host RAM %.1f%%); "
            "collecting garbage before one native QEM pass.",
            initial_face_count,
            used_fraction * 100.0,
        )
        gc.collect()

    decimated_mesh, simplify_stats = _simplify(
        working_mesh,
        target_faces,
        crease_angle_deg=effective_crease_deg,
    )

    rss_after = process.memory_info().rss
    peak_rss = max(peak_rss, rss_after)
    triangles_after = int(len(decimated_mesh.faces))
    telemetry = {
        "triangles_before": initial_face_count,
        "triangles_after": triangles_after,
        "reduction_ratio": round(
            float(triangles_after) / float(max(initial_face_count, 1)), 4
        ),
        "peak_rss_mb": round(peak_rss / (1024.0 * 1024.0), 2),
        "memory_safe_mode_engaged": memory_safe_mode_engaged,
        "simplify": simplify_stats,
    }
    return decimated_mesh, telemetry
