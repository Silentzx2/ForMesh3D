"""Deterministic geometric mesh segmentation with lossless face assignment."""
from __future__ import annotations

import colorsys
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

import numpy as np
import trimesh

from pipelines.mesh_utils import (
    compute_mesh_stats,
    export_mesh_safe,
    load_mesh_safe,
    to_single_trimesh,
)

logger = logging.getLogger(__name__)


def _generate_palette(num_colors: int) -> List[List[int]]:
    colors = []
    for i in range(num_colors):
        hue = (float(i) / float(max(1, num_colors)) * 0.618033988749895) % 1.0
        r, g, b = colorsys.hsv_to_rgb(hue, 0.75, 0.90)
        colors.append([int(r * 255), int(g * 255), int(b * 255), 255])
    return colors


def _renumber_labels(labels: np.ndarray) -> np.ndarray:
    unique = np.unique(labels)
    mapping = {int(value): index for index, value in enumerate(unique)}
    return np.asarray([mapping[int(value)] for value in labels], dtype=np.int32)


def _merge_to_part_limit(labels: np.ndarray, face_centers: np.ndarray, max_parts: int) -> np.ndarray:
    """Merge the smallest region into its nearest neighbor until the part cap is met."""
    result = labels.astype(np.int32, copy=True)
    while len(np.unique(result)) > max_parts:
        cluster_ids, counts = np.unique(result, return_counts=True)
        small_id = int(cluster_ids[int(np.argmin(counts))])
        small_center = face_centers[result == small_id].mean(axis=0)
        other_ids = [int(value) for value in cluster_ids if int(value) != small_id]
        other_centers = np.asarray([face_centers[result == value].mean(axis=0) for value in other_ids])
        nearest = other_ids[int(np.argmin(np.linalg.norm(other_centers - small_center, axis=1)))]
        result[result == small_id] = nearest
    return _renumber_labels(result)


def _merge_small_islands(
    labels: np.ndarray,
    face_centers: np.ndarray,
    min_face_count: int,
) -> np.ndarray:
    """Merge undersized clusters into their nearest remaining cluster; never drop faces."""
    result = labels.astype(np.int32, copy=True)
    if min_face_count <= 1:
        return _renumber_labels(result)

    while True:
        cluster_ids, counts = np.unique(result, return_counts=True)
        if len(cluster_ids) <= 1:
            break
        small_index = int(np.argmin(counts))
        if int(counts[small_index]) >= min_face_count:
            break

        small_id = int(cluster_ids[small_index])
        small_center = face_centers[result == small_id].mean(axis=0)
        other_ids = [int(value) for value in cluster_ids if int(value) != small_id]
        other_centers = np.asarray([
            face_centers[result == cluster_id].mean(axis=0)
            for cluster_id in other_ids
        ])
        nearest = other_ids[int(np.argmin(np.linalg.norm(other_centers - small_center, axis=1)))]
        result[result == small_id] = nearest

    return _renumber_labels(result)


def execute_segment(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    options: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> Dict[str, Any]:
    """Partition every input face into the requested number of geometric regions.

    The minimum face-island threshold merges tiny clusters into their nearest
    neighbor. Hierarchical mode adds a stable two-level part grouping to stats.
    """
    opts = options or {}
    num_parts = max(2, min(32, int(opts.get("num_parts") or opts.get("numParts") or 8)))
    method = str(opts.get("method") or "geometric").lower()
    if method not in {"geometric", "connected_components"}:
        raise ValueError("Script segmentation supports geometric or connected_components methods only")
    hierarchical = bool(opts.get("hierarchical", False))
    min_face_count = max(0, int(opts.get("min_face_island_threshold", opts.get("minFaceIslandThreshold", 0))))
    colorize = bool(opts.get("colorize_preview") if "colorize_preview" in opts else opts.get("colorizePreview", True))
    save_individual = bool(opts.get("save_individual_parts") if "save_individual_parts" in opts else opts.get("saveIndividualParts", False))
    output_format = str(opts.get("output_format") or "glb").lower().lstrip(".")
    if output_format not in {"glb", "obj"}:
        raise ValueError("Segmentation Script output format must be GLB or OBJ")

    in_file = Path(input_path).resolve()
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    if progress_callback:
        progress_callback("Analyzing mesh topology and connected face regions...", 0.2)

    mesh = to_single_trimesh(load_mesh_safe(in_file))
    face_count = len(mesh.faces)
    logger.info(
        "[SEGMENT] Input geometry: vertices=%d faces=%d method=%s requested_parts=%d",
        len(mesh.vertices), face_count, method, num_parts,
    )
    if progress_callback:
        progress_callback(f"Loaded mesh: {len(mesh.vertices):,} vertices / {face_count:,} faces; computing segmentation features...", 0.32)
    if face_count == 0:
        raise ValueError("Input mesh has zero faces; cannot perform segmentation")

    requested_parts = min(num_parts, face_count)
    face_centers = mesh.triangles_center
    centered = face_centers - face_centers.mean(axis=0)
    covariance = np.cov(centered, rowvar=False)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    principal_axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    logger.debug("[SEGMENT] PCA eigenvalues=%s principal_axis=%s", eigenvalues.tolist(), principal_axis.tolist())
    if progress_callback:
        progress_callback("Principal-axis feature analysis complete; assigning faces to parts...", 0.42)

    if method == "connected_components":
        components = mesh.split(only_watertight=False)
        components = sorted(components, key=lambda part: len(part.faces), reverse=True)
        labels = np.zeros(face_count, dtype=np.int32)
        face_lookup = {
            tuple(sorted(map(int, face))): index
            for index, face in enumerate(mesh.faces)
        }
        component_labels = []
        for component_id, component in enumerate(components):
            for face in component.faces:
                component_labels.append((face_lookup.get(tuple(sorted(map(int, face)))), component_id))
        for face_index, component_id in component_labels:
            if face_index is not None:
                labels[face_index] = component_id
        labels = _renumber_labels(labels)
        labels = _merge_to_part_limit(labels, face_centers, requested_parts)
    else:
        projected = centered @ principal_axis

        # Rank-based quantiles give every requested cluster faces, including tied centers.
        order = np.argsort(projected, kind="stable")
        labels = np.empty(face_count, dtype=np.int32)
        labels[order] = np.minimum(
            (np.arange(face_count, dtype=np.int64) * requested_parts) // face_count,
            requested_parts - 1,
        ).astype(np.int32)

    if progress_callback:
        progress_callback("Merging undersized face islands into nearest neighboring parts...", 0.50)
    labels = _merge_small_islands(labels, face_centers, min_face_count)
    actual_parts = int(len(np.unique(labels)))
    logger.info("[SEGMENT] Face assignment complete: faces=%d parts=%d", face_count, actual_parts)
    segmented_mesh = mesh.copy()

    if progress_callback:
        progress_callback(f"Assigned all {face_count:,} faces into {actual_parts} part(s)...", 0.55)

    individual_part_paths: List[str] = []
    if save_individual:
        if progress_callback:
            progress_callback("Exporting individual part meshes...", 0.68)
        parts_dir = out_file.parent / f"{out_file.stem}_parts"
        parts_dir.mkdir(parents=True, exist_ok=True)
        for part_id in range(actual_parts):
            if progress_callback:
                progress_callback(
                    f"Exporting individual part {part_id + 1}/{actual_parts}...",
                    0.68 + (0.10 * part_id / max(1, actual_parts)),
                )
            part_mask = labels == part_id
            part_faces = segmented_mesh.faces[part_mask]
            if not len(part_faces):
                continue
            unique_vertices, new_faces = np.unique(part_faces, return_inverse=True)
            submesh = trimesh.Trimesh(
                vertices=segmented_mesh.vertices[unique_vertices],
                faces=new_faces.reshape(-1, 3),
                process=False,
            )
            part_path = parts_dir / f"part_{part_id + 1:03d}.{output_format}"
            export_mesh_safe(submesh, part_path, file_type=output_format)
            individual_part_paths.append(str(part_path))

    if colorize:
        if progress_callback:
            progress_callback("Colorizing segmented part preview...", 0.82)
        palette = _generate_palette(actual_parts)
        vertex_colors = np.full((len(segmented_mesh.vertices), 4), 220, dtype=np.uint8)
        for cluster_id in range(actual_parts):
            part_faces = segmented_mesh.faces[labels == cluster_id]
            if len(part_faces):
                vertex_colors[np.unique(part_faces)] = palette[cluster_id % len(palette)]
        segmented_mesh.visual = trimesh.visual.ColorVisuals(
            mesh=segmented_mesh,
            vertex_colors=vertex_colors,
        )

    if progress_callback:
        progress_callback(f"Exporting combined segmented mesh as {output_format.upper()}...", 0.88)
    export_mesh_safe(segmented_mesh, out_file, file_type=output_format)
    logger.info("[SEGMENT] Combined mesh export complete: %s (%d bytes)", out_file.name, out_file.stat().st_size)

    hierarchy = None
    if hierarchical:
        part_centers = [
            face_centers[labels == part_id].mean(axis=0).tolist()
            for part_id in range(actual_parts)
        ]
        center_values = np.asarray(part_centers) @ principal_axis
        split_value = float(np.median(center_values))
        left = [part_id for part_id, value in enumerate(center_values) if value <= split_value]
        right = [part_id for part_id, value in enumerate(center_values) if value > split_value]
        hierarchy = {
            "id": "root",
            "label": "Mesh",
            "children": [
                {"id": "group_01", "label": "Group 1", "part_ids": left},
                {"id": "group_02", "label": "Group 2", "part_ids": right},
            ],
        }

    if progress_callback:
        progress_callback("Verifying segmentation face coverage...", 0.95)

    stats = compute_mesh_stats(segmented_mesh)
    logger.info(
        "[SEGMENT] Verification: face_coverage=%d/%d parts=%d output_bytes=%d",
        int(sum(np.count_nonzero(labels == part_id) for part_id in range(actual_parts))),
        face_count, actual_parts, out_file.stat().st_size,
    )
    stats["requested_parts"] = requested_parts
    stats["actual_parts"] = actual_parts
    stats["min_face_island_threshold"] = min_face_count
    stats["method"] = method
    stats["hierarchical"] = hierarchical
    stats["hierarchy"] = hierarchy
    stats["face_coverage"] = int(sum(np.count_nonzero(labels == part_id) for part_id in range(actual_parts)))
    stats["individual_part_files"] = individual_part_paths

    return {
        "success": True,
        "output_path": str(out_file),
        "format": output_format,
        "stats": stats,
    }
