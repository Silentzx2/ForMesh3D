"""Mesh geometric segmentation and part clustering pipeline.

Supports:
- Connected component decomposition via Trimesh
- Curvature/spatial geometric face clustering for arbitrary requested part counts
- Vivid part-colorized viewport preview generation
- Individual sub-mesh export
"""
from __future__ import annotations

import colorsys
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

import numpy as np
import trimesh

from backend.pipelines.mesh_utils import (
    compute_mesh_stats,
    export_mesh_safe,
    load_mesh_safe,
    to_single_trimesh,
)

logger = logging.getLogger(__name__)


def _generate_palette(num_colors: int) -> List[List[int]]:
    """Generate visually distinct RGB colors using equidistant HSV hue steps."""
    colors = []
    for i in range(num_colors):
        hue = float(i) / float(max(1, num_colors))
        # Golden ratio offset to keep neighboring parts contrasting
        hue = (hue * 0.618033988749895) % 1.0
        sat = 0.75
        val = 0.90
        r, g, b = colorsys.hsv_to_rgb(hue, sat, val)
        colors.append([int(r * 255), int(g * 255), int(b * 255), 255])
    return colors


def execute_segment(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    options: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> Dict[str, Any]:
    """Execute geometric mesh segmentation.

    Args:
        input_path: Path to input mesh (GLB/OBJ).
        output_path: Destination path for segmented preview mesh.
        options: Dictionary of segmentation settings:
            - num_parts: Desired number of partitions (default 8)
            - method: 'geometric' | 'connected_components' (default 'geometric')
            - colorize_preview: Assign distinct part colors to faces (default True)
            - save_individual_parts: Write submesh files to output directory (default False)
            - output_format: Target format (default 'glb')
        progress_callback: Optional callback for streaming progress updates.

    Returns:
        Dictionary containing execution result and part segmentation statistics.
    """
    opts = options or {}
    num_parts = max(2, min(64, int(opts.get("num_parts") or opts.get("numParts") or 8)))
    colorize = bool(opts.get("colorize_preview") if "colorize_preview" in opts else opts.get("colorizePreview", True))
    save_individual = bool(opts.get("save_individual_parts") if "save_individual_parts" in opts else opts.get("saveIndividualParts", False))
    output_format = str(opts.get("output_format") or "glb").lower().lstrip(".")

    in_file = Path(input_path).resolve()
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    if progress_callback:
        progress_callback("Analyzing mesh topology and face connectivity...", 0.2)

    loaded = load_mesh_safe(in_file)
    mesh = to_single_trimesh(loaded)

    if len(mesh.faces) == 0:
        raise ValueError("Input mesh has zero faces; cannot perform segmentation")

    num_parts = min(num_parts, len(mesh.faces))

    # 1. Attempt connected component decomposition
    parts = mesh.split(only_watertight=False)
    face_clusters: np.ndarray

    if len(parts) >= num_parts:
        # Mesh already consists of multiple disconnected components
        if progress_callback:
            progress_callback(f"Partitioning {len(parts)} connected components into {num_parts} clusters...", 0.5)

        # Sort by face count descending, keep top clusters
        parts = sorted(parts, key=lambda p: len(p.faces), reverse=True)
        # Assign cluster indices
        combined_meshes = []
        cluster_labels = []
        for idx, part in enumerate(parts[:num_parts]):
            combined_meshes.append(part)
            cluster_labels.extend([idx] * len(part.faces))
        segmented_mesh = trimesh.util.concatenate(combined_meshes)
        face_clusters = np.array(cluster_labels, dtype=np.int32)
        actual_parts = min(len(parts), num_parts)
    else:
        # Single or few components: partition geometrically using spatial clustering
        if progress_callback:
            progress_callback(f"Performing spatial clustering into {num_parts} geometric partitions...", 0.5)

        face_centers = mesh.triangles_center
        # PCA projection to align clustering with principal axis of variation
        centered = face_centers - face_centers.mean(axis=0)
        cov = np.cov(centered, rowvar=False)
        eigenvalues, eigenvectors = np.linalg.eigh(cov)
        # Sort eigenvectors by eigenvalue descending
        sort_idx = np.argsort(eigenvalues)[::-1]
        principal_axes = eigenvectors[:, sort_idx]
        projected = centered @ principal_axes

        # 1D/2D spatial binning based on requested parts
        primary_coord = projected[:, 0]
        # Quantile thresholds for balanced part sizes
        percentiles = np.linspace(0, 100, num_parts + 1)
        bins = np.percentile(primary_coord, percentiles)
        bins[0] -= 1e-6
        bins[-1] += 1e-6
        face_clusters = np.digitize(primary_coord, bins[1:-1])
        actual_parts = num_parts
        segmented_mesh = mesh.copy()

    # 2. Export individual parts if requested (pure numpy submesh, 0 scipy dependency)
    individual_part_paths = []
    if save_individual:
        if progress_callback:
            progress_callback("Exporting individual sub-mesh part files...", 0.7)

        parts_dir = out_file.parent / f"{out_file.stem}_parts"
        parts_dir.mkdir(parents=True, exist_ok=True)
        for part_id in range(actual_parts):
            part_mask = face_clusters == part_id
            if np.any(part_mask):
                sub_faces = segmented_mesh.faces[part_mask]
                unique_v_idx, new_faces = np.unique(sub_faces, return_inverse=True)
                sub_vertices = segmented_mesh.vertices[unique_v_idx]
                submesh = trimesh.Trimesh(
                    vertices=sub_vertices,
                    faces=new_faces.reshape(-1, 3),
                    process=False,
                )
                part_path = parts_dir / f"part_{part_id + 1:03d}.{output_format}"
                export_mesh_safe(submesh, part_path, file_type=output_format)
                individual_part_paths.append(str(part_path))

    # 3. Colorize preview for Three.js viewport
    palette = _generate_palette(actual_parts)
    if colorize:
        if progress_callback:
            progress_callback("Applying part color scheme for viewport preview...", 0.85)

        # Assign vertex colors mapped from face clusters using pure numpy
        num_vertices = len(segmented_mesh.vertices)
        v_colors = np.full((num_vertices, 4), 220, dtype=np.uint8)
        # For each face cluster, assign its color to its constituent vertices
        for cluster_id in range(actual_parts):
            part_mask = face_clusters == cluster_id
            if np.any(part_mask):
                c_faces = segmented_mesh.faces[part_mask]
                c_verts = np.unique(c_faces)
                v_colors[c_verts] = palette[cluster_id % len(palette)]
        segmented_mesh.visual = trimesh.visual.ColorVisuals(
            mesh=segmented_mesh,
            vertex_colors=v_colors,
        )

    # 4. Export combined colorized mesh
    export_mesh_safe(segmented_mesh, out_file, file_type=output_format)

    if progress_callback:
        progress_callback("Finalizing segmentation results...", 0.95)

    stats = compute_mesh_stats(segmented_mesh)
    stats["requested_parts"] = num_parts
    stats["actual_parts"] = actual_parts
    stats["individual_part_files"] = individual_part_paths

    return {
        "success": True,
        "output_path": str(out_file),
        "format": output_format,
        "stats": stats,
    }
