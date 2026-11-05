from __future__ import annotations

import numpy as np
import pytest

from backend.adapters.trellis2_mesh_validation import validate_mesh_arrays


def test_accepts_small_valid_mesh_without_face_count_minimum():
    vertices = np.array([[0.0, 0.0, 0.0], [1e-6, 0.0, 0.0], [0.0, 1e-6, 0.0]], dtype=np.float32)
    faces = np.array([[0, 1, 2]], dtype=np.int32)

    stats = validate_mesh_arrays(vertices, faces, stage="test")

    assert stats["vertex_count"] == 3
    assert stats["face_count"] == 1
    assert stats["degenerate_faces"] == 0
    assert stats["bbox_diagonal"] > 0


@pytest.mark.parametrize(
    ("vertices", "faces", "message"),
    [
        (np.empty((0, 3)), np.empty((0, 3), dtype=np.int32), "vertices and triangle faces"),
        (
            np.array([[0.0, 0.0, 0.0], [np.nan, 0.0, 0.0], [0.0, 1.0, 0.0]]),
            np.array([[0, 1, 2]], dtype=np.int32),
            "NaN or Inf",
        ),
        (
            np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]),
            np.array([[0, 1, 3]], dtype=np.int32),
            "outside the vertex array",
        ),
        (
            np.zeros((3, 3), dtype=np.float32),
            np.array([[0, 1, 2]], dtype=np.int32),
            "zero or invalid spatial extent",
        ),
        (
            np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]]),
            np.array([[0, 1, 2]], dtype=np.int32),
            "every triangle is degenerate",
        ),
        (
            np.array([[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]),
            np.array([[0, 1, 2]], dtype=np.int32),
            "hollow domain bounding box",
        ),
    ],
)
def test_rejects_invalid_geometry(vertices, faces, message):
    with pytest.raises(ValueError, match=message):
        validate_mesh_arrays(vertices, faces, stage="test")


def test_reports_partial_degeneracy_without_rejecting_valid_surface():
    vertices = np.array(
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [2.0, 0.0, 0.0]],
        dtype=np.float32,
    )
    faces = np.array([[0, 1, 2], [0, 1, 3]], dtype=np.int32)

    stats = validate_mesh_arrays(vertices, faces, stage="test")

    assert stats["face_count"] == 2
    assert stats["degenerate_faces"] == 1
