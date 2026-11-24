"""Small, lossless helpers shared by neural mesh segmentation."""
from __future__ import annotations

import colorsys
from typing import List

import numpy as np


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
