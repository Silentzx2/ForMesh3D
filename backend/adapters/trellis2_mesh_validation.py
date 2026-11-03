"""Lightweight geometry integrity checks for TRELLIS.2 raw mesh export."""

from __future__ import annotations

from typing import Any

import numpy as np


def validate_mesh_arrays(vertices: Any, faces: Any, *, stage: str) -> dict[str, Any]:
    """Validate triangle geometry and return compact export diagnostics.

    No minimum face count is imposed: a small mesh is valid when it has finite,
    non-collapsed geometry and at least one usable triangle.
    """
    vertices = np.asarray(vertices)
    faces = np.asarray(faces)

    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise ValueError(f"{stage}: vertices must have shape (N, 3), got {vertices.shape}")
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError(f"{stage}: faces must have shape (M, 3), got {faces.shape}")
    if not len(vertices) or not len(faces):
        raise ValueError(f"{stage}: mesh must contain vertices and triangle faces")
    if not np.issubdtype(vertices.dtype, np.number) or np.issubdtype(vertices.dtype, np.complexfloating):
        raise ValueError(f"{stage}: vertex coordinates must be real numeric values")
    if not np.isfinite(vertices).all():
        raise ValueError(f"{stage}: vertex coordinates contain NaN or Inf")
    if not np.issubdtype(faces.dtype, np.integer):
        raise ValueError(f"{stage}: face indices must use an integer dtype")
    if np.any(faces < 0) or np.any(faces >= len(vertices)):
        raise ValueError(f"{stage}: face indices reference vertices outside the vertex array")

    bounds_min = vertices.min(axis=0).astype(np.float64, copy=False)
    bounds_max = vertices.max(axis=0).astype(np.float64, copy=False)
    extents = bounds_max - bounds_min
    bbox_diagonal = float(np.linalg.norm(extents))
    if not np.isfinite(bounds_min).all() or not np.isfinite(bounds_max).all():
        raise ValueError(f"{stage}: bounding box contains NaN or Inf")
    if not np.isfinite(bbox_diagonal) or not np.any(extents > 0):
        raise ValueError(f"{stage}: geometry has zero or invalid spatial extent")

    # Convert bounded face batches, not the full vertex array, to float64.
    degenerate_faces = 0
    for start in range(0, len(faces), 131072):
        triangles = vertices[faces[start : start + 131072]].astype(np.float64, copy=False)
        edge_a = (triangles[:, 1] - triangles[:, 0]) / bbox_diagonal
        edge_b = (triangles[:, 2] - triangles[:, 0]) / bbox_diagonal
        cross = np.cross(edge_a, edge_b)
        twice_area_sq = np.einsum("ij,ij->i", cross, cross)
        degenerate_faces += int(np.count_nonzero(twice_area_sq <= 1e-24))

    if degenerate_faces == len(faces):
        raise ValueError(f"{stage}: every triangle is degenerate")

    return {
        "vertex_count": int(len(vertices)),
        "face_count": int(len(faces)),
        "degenerate_faces": degenerate_faces,
        "bbox_min": bounds_min.tolist(),
        "bbox_max": bounds_max.tolist(),
        "bbox_extents": extents.tolist(),
        "bbox_diagonal": bbox_diagonal,
    }
