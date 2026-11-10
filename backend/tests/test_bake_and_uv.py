"""Tests for UV unwrapping and pure-Python high-to-low normal baking."""
from __future__ import annotations

import io
import numpy as np
import pytest
import trimesh
from PIL import Image

from backend.postprocess.schemas import BakeOptions
from backend.postprocess.services.bake import (
    bake_high_to_low_pure_python,
    sample_high_normals,
)
from backend.postprocess.services.uv_backend_resolver import (
    _unwrap_massive_mesh_safe,
    _unwrap_xatlas,
    load_uv_config,
)


def test_sample_high_normals_sphere_angle_error_under_half_degree():
    """Verify inward raycasting normal sampling achieves < 0.5 deg error on sphere."""
    # High-poly target sphere and low-poly base sphere
    high = trimesh.creation.icosphere(subdivisions=4, radius=1.0)
    low = trimesh.creation.icosphere(subdivisions=2, radius=1.0)

    # Sample query points on the low-poly surface
    pts, face_indices = low.sample(1000, return_index=True)
    analytic_normals = pts / np.linalg.norm(pts, axis=1, keepdims=True)

    # Low-poly interpolated normals
    bary = trimesh.triangles.points_to_barycentric(low.triangles[face_indices], pts)
    n_low = np.einsum("ij,ijk->ik", bary, low.vertex_normals[low.faces[face_indices]])
    n_low /= np.linalg.norm(n_low, axis=1, keepdims=True)

    # Scale-aware cage and max_ray
    diagonal = float(np.linalg.norm(low.bounds[1] - low.bounds[0]))
    cage = 0.02 * diagonal
    max_ray = 2.5 * cage

    sampled_normals, hit = sample_high_normals(high, pts, n_low, cage, max_ray)

    assert hit.all(), "All rays on the unit sphere should intersect the high-poly surface"

    # Angle error vs high/analytic sphere normal
    dot_analytic = np.clip(np.sum(sampled_normals * analytic_normals, axis=1), -1.0, 1.0)
    angle_err_analytic_deg = np.degrees(np.arccos(dot_analytic))
    mean_analytic_err = float(np.mean(angle_err_analytic_deg))
    assert mean_analytic_err < 0.5, f"Mean error vs analytic ({mean_analytic_err:.4f} deg) must be < 0.5 deg"

    # Angle error vs low-poly normal
    dot_low = np.clip(np.sum(sampled_normals * n_low, axis=1), -1.0, 1.0)
    angle_err_low_deg = np.degrees(np.arccos(dot_low))
    mean_low_err = float(np.mean(angle_err_low_deg))
    assert mean_low_err < 0.5, f"High vs low normal angle error ({mean_low_err:.4f} deg) must be < 0.5 deg"


def test_unwrap_xatlas_valid_seams_and_uv_range():
    """Verify xatlas produces valid seams and strictly normalized UVs in [0, 1]."""
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    unwrapped = _unwrap_xatlas(mesh)

    assert hasattr(unwrapped, "visual") and unwrapped.visual is not None
    uvs = np.asarray(unwrapped.visual.uv, dtype=np.float32)

    assert len(uvs) > 0, "Unwrapped mesh must have UV coordinates"
    assert uvs.ndim == 2 and uvs.shape[1] == 2
    # Verify strict [0, 1] range
    assert uvs.min() >= -1e-6, f"UV coordinates below 0: min={uvs.min()}"
    assert uvs.max() <= 1.0 + 1e-6, f"UV coordinates above 1: max={uvs.max()}"

    # Seams require duplicating vertices along boundaries: unwrapped vert count >= original
    assert len(unwrapped.vertices) >= len(mesh.vertices)
    assert len(unwrapped.faces) == len(mesh.faces)


def test_unwrap_max_safe_triangles_guard_raises_clean_value_error():
    """Verify exceeding max_safe_triangles raises clean ValueError instructing decimation."""
    mesh = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    face_count = len(mesh.faces)
    assert face_count == 1280

    # Test explicit override in runtime
    with pytest.raises(ValueError) as excinfo:
        _unwrap_xatlas(mesh, runtime={"max_safe_triangles": 500})
    assert f"UV unwrap needs <= 500 triangles (got {face_count}). Decimate first." in str(excinfo.value)

    # Test _unwrap_massive_mesh_safe
    with pytest.raises(ValueError) as excinfo_massive:
        _unwrap_massive_mesh_safe(mesh, max_safe_faces=500)
    assert f"UV unwrap needs <= 500 triangles (got {face_count}). Decimate first." in str(excinfo_massive.value)

    # Verify quality.yaml owns the default configuration (100000)
    cfg = load_uv_config()
    assert cfg.get("max_safe_triangles") == 100000


def test_pure_python_bake_no_fake_white_ao():
    """Verify pure-Python baker does not emit fake white AO and reports 'ao' as unsupported."""
    sphere = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    low_unwrapped = _unwrap_xatlas(sphere)
    high = trimesh.creation.icosphere(subdivisions=3, radius=1.0)

    low_glb = low_unwrapped.export(file_type="glb")
    high_glb = high.export(file_type="glb")

    # Request both normal and ao maps
    opts = BakeOptions(resolution=64, maps=["normal", "ao"], pack_orm=False)
    images, stats = bake_high_to_low_pure_python(low_glb, high_glb, opts)

    # Normal map must be present
    assert "normal" in images, "Normal map must be generated"
    normal_img = Image.open(io.BytesIO(images["normal"]))
    assert normal_img.size == (64, 64)

    # AO map must NOT be returned as fake white image
    assert "ao" not in images, "Pure-Python fallback must not return a fake white AO map"
    assert "ao" in stats.get("unsupported_maps", []), "AO must be reported under unsupported_maps"


def test_pure_python_bake_half_pixel_alignment():
    """Verify raster vs sample alignment maps UV (0.5, 0.5) to pixel center without drift."""
    res = 128
    # Low mesh: 2 triangles covering [0, 1] x [0, 1]
    v = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ], dtype=np.float64)
    f = np.array([
        [0, 1, 2],
        [0, 2, 3],
    ], dtype=np.int64)
    uv = np.array([
        [0.0, 0.0],
        [1.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
    ], dtype=np.float64)

    low = trimesh.Trimesh(vertices=v, faces=f, process=False)
    low.visual = trimesh.visual.TextureVisuals(uv=uv)
    high = low.copy()

    low_glb = low.export(file_type="glb")
    high_glb = high.export(file_type="glb")

    opts = BakeOptions(resolution=res, maps=["normal"], pack_orm=False)
    images, stats = bake_high_to_low_pure_python(low_glb, high_glb, opts)

    assert "normal" in images
    assert stats["covered_texels"] == res * res, "Full quad should cover all texels"
