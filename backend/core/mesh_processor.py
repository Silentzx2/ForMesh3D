"""High-performance multi-threaded mesh processor for ForMesh3D.

Utilizes all available CPU cores (os.cpu_count()) for postprocessing,
decimation, smoothing, marching cubes, and LOD generation operations.
"""
from __future__ import annotations

import copy
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
import trimesh
import trimesh.smoothing

from core.scheduler.resource_planner import configure_cpu_runtime, cpu_count

logger = logging.getLogger(__name__)


def get_optimal_thread_count(requested: Optional[int] = None) -> int:
    """Resolve the optimal number of CPU worker threads for mesh operations."""
    if requested is not None and requested > 0:
        return max(1, requested)
    return max(1, os.cpu_count() or 8)


def marching_cubes(
    volume: np.ndarray,
    level: float = 0.0,
    spacing: Optional[Tuple[float, float, float]] = None,
    num_threads: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """Multi-threaded marching cubes isosurface extraction.

    Configures CPU runtime to utilize all CPU cores and extracts vertices and faces.
    """
    threads = get_optimal_thread_count(num_threads)
    configure_cpu_runtime(threads)

    # 1. Try PyMCubes (C++ multi-threaded marching cubes)
    try:
        import mcubes
        volume_c = np.ascontiguousarray(volume, dtype=np.float32)
        verts, faces = mcubes.marching_cubes(volume_c, float(level))
        if spacing is not None and len(verts) > 0:
            scale = np.asarray(spacing, dtype=np.float32)
            verts = verts * scale
        return verts, faces
    except Exception as mc_err:
        logger.debug("mcubes extraction fallback: %s", mc_err)

    # 2. Try skimage.measure.marching_cubes
    try:
        import skimage.measure
        sp = spacing if spacing is not None else (1.0, 1.0, 1.0)
        verts, faces, _, _ = skimage.measure.marching_cubes(
            volume, level=float(level), spacing=sp
        )
        return np.asarray(verts, dtype=np.float32), np.asarray(faces, dtype=np.int64)
    except Exception as ski_err:
        logger.warning("skimage marching cubes failed: %s", ski_err)
        raise RuntimeError(f"Marching cubes extraction failed: {ski_err}") from ski_err


def smooth_mesh(
    mesh: Union[trimesh.Trimesh, trimesh.Scene],
    iterations: int = 5,
    method: str = "taubin",
    num_threads: Optional[int] = None,
    **kwargs: Any,
) -> Union[trimesh.Trimesh, trimesh.Scene]:
    """Apply multi-threaded surface smoothing to a mesh or scene."""
    threads = get_optimal_thread_count(num_threads)
    configure_cpu_runtime(threads)

    if isinstance(mesh, trimesh.Scene):
        # Parallelize smoothing across scene parts using ThreadPoolExecutor
        if not mesh.geometry:
            return mesh
        results: Dict[str, trimesh.Trimesh] = {}
        with ThreadPoolExecutor(max_workers=min(len(mesh.geometry), threads)) as executor:
            future_to_name = {
                executor.submit(
                    smooth_mesh, geom, iterations, method, threads, **kwargs
                ): name
                for name, geom in mesh.geometry.items()
                if isinstance(geom, trimesh.Trimesh)
            }
            for fut in as_completed(future_to_name):
                name = future_to_name[fut]
                results[name] = fut.result()
        for name, geom in results.items():
            mesh.geometry[name] = geom
        return mesh

    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        return mesh

    method_lower = str(method).lower().strip()
    try:
        if method_lower == "taubin":
            lamb = float(kwargs.get("lamb", 0.5))
            nu = float(kwargs.get("nu", -0.53))
            smoothed = trimesh.smoothing.filter_taubin(
                mesh, lamb=lamb, nu=nu, iterations=iterations
            )
            return smoothed
        elif method_lower == "laplacian":
            lamb = float(kwargs.get("lamb", 0.5))
            smoothed = trimesh.smoothing.filter_laplacian(
                mesh, lamb=lamb, iterations=iterations
            )
            return smoothed
        elif method_lower == "humphrey":
            smoothed = trimesh.smoothing.filter_humphrey(
                mesh, iterations=iterations
            )
            return smoothed
        else:
            smoothed = trimesh.smoothing.filter_taubin(
                mesh, iterations=iterations
            )
            return smoothed
    except Exception as exc:
        logger.warning("Smoothing fallback due to error: %s", exc)
        return mesh


def compute_angle_weighted_normals(
    mesh: trimesh.Trimesh,
    crease_angle_deg: Optional[float] = 35.0,
) -> trimesh.Trimesh:
    """Compute Nelson Max angle-weighted vertex normals with dihedral crease splitting.

    Prevents melted shading over sharp corners by splitting vertices on edges with
    dihedral angle exceeding crease_angle_deg (typically 35°-45° for hard surface/props).
    If crease_angle_deg is None or >= 180, computes angle-weighted smooth normals without splitting.
    """
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        return mesh

    V = np.asarray(mesh.vertices, dtype=np.float64)
    F = np.asarray(mesh.faces, dtype=np.int64)
    num_verts = len(V)
    num_faces = len(F)

    # 1. Compute face normals and edge vectors
    p0 = V[F[:, 0]]
    p1 = V[F[:, 1]]
    p2 = V[F[:, 2]]

    e0 = p1 - p0
    e1 = p2 - p1
    e2 = p0 - p2

    face_cross = np.cross(e0, -e2)
    face_areas = np.linalg.norm(face_cross, axis=1)
    valid_face = face_areas > 1e-12
    face_normals = np.zeros_like(face_cross)
    face_normals[valid_face] = face_cross[valid_face] / face_areas[valid_face, None]

    def normalize_vecs(vecs: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        return np.where(norms > 1e-12, vecs / np.maximum(norms, 1e-12), 0.0)

    u0a, u0b = normalize_vecs(e0), normalize_vecs(-e2)
    u1a, u1b = normalize_vecs(e1), normalize_vecs(-e0)
    u2a, u2b = normalize_vecs(e2), normalize_vecs(-e1)

    # Nelson Max corner angles (in radians)
    dot0 = np.clip(np.sum(u0a * u0b, axis=1), -1.0, 1.0)
    dot1 = np.clip(np.sum(u1a * u1b, axis=1), -1.0, 1.0)
    dot2 = np.clip(np.sum(u2a * u2b, axis=1), -1.0, 1.0)
    alpha0 = np.arccos(dot0)
    alpha1 = np.arccos(dot1)
    alpha2 = np.arccos(dot2)

    do_crease_split = crease_angle_deg is not None and 0.0 < crease_angle_deg < 180.0
    sharp_edges = set()
    if do_crease_split:
        cos_threshold = np.cos(np.radians(crease_angle_deg))
        edge_to_faces: Dict[Tuple[int, int], List[int]] = {}
        for fi in range(num_faces):
            v0, v1, v2 = F[fi]
            for u, v in ((v0, v1), (v1, v2), (v2, v0)):
                edge = (u, v) if u < v else (v, u)
                edge_to_faces.setdefault(edge, []).append(fi)

        for edge, incident in edge_to_faces.items():
            if len(incident) == 2:
                fA, fB = incident
                if np.dot(face_normals[fA], face_normals[fB]) < cos_threshold:
                    sharp_edges.add(edge)
            elif len(incident) > 2:
                sharp_edges.add(edge)

    vert_to_fc: List[List[Tuple[int, int]]] = [[] for _ in range(num_verts)]
    for fi in range(num_faces):
        v0, v1, v2 = F[fi]
        vert_to_fc[v0].append((fi, 0))
        vert_to_fc[v1].append((fi, 1))
        vert_to_fc[v2].append((fi, 2))

    new_vertices = list(V)
    new_faces = np.copy(F)
    vertex_normals_list = [np.zeros(3, dtype=np.float64) for _ in range(num_verts)]
    alphas = [alpha0, alpha1, alpha2]

    uv = getattr(getattr(mesh, "visual", None), "uv", None)
    has_uv = uv is not None and len(uv) == num_verts
    new_uv = list(uv) if has_uv else None

    vc = getattr(getattr(mesh, "visual", None), "vertex_colors", None)
    has_vc = vc is not None and len(vc) == num_verts
    new_vc = list(vc) if has_vc else None

    existing_normals: Optional[np.ndarray] = None
    if hasattr(mesh, "_cache") and "vertex_normals" in mesh._cache:
        try:
            vn = np.asarray(mesh.vertex_normals, dtype=np.float64)
            if len(vn) == num_verts and not np.allclose(vn, 0.0):
                existing_normals = vn
        except Exception:
            existing_normals = None
    elif hasattr(mesh, "vertex_normals"):
        try:
            vn = np.asarray(mesh.vertex_normals, dtype=np.float64)
            if len(vn) == num_verts and not np.allclose(vn, 0.0):
                existing_normals = vn
        except Exception:
            existing_normals = None

    for vi in range(num_verts):
        fc_list = vert_to_fc[vi]
        if not fc_list:
            continue
        if len(fc_list) == 1:
            fi, c_idx = fc_list[0]
            if existing_normals is not None:
                vertex_normals_list[vi] = existing_normals[vi].copy()
            else:
                vertex_normals_list[vi] = face_normals[fi].copy()
            continue

        if not do_crease_split or not sharp_edges:
            if existing_normals is not None:
                vertex_normals_list[vi] = existing_normals[vi].copy()
            else:
                cluster_norm = np.zeros(3, dtype=np.float64)
                for fi, corner in fc_list:
                    w = alphas[corner][fi]
                    cluster_norm += w * face_normals[fi]
                norm_len = np.linalg.norm(cluster_norm)
                if norm_len > 1e-12:
                    cluster_norm /= norm_len
                else:
                    cluster_norm = face_normals[fc_list[0][0]]
                vertex_normals_list[vi] = cluster_norm
            continue

        local_edge_map: Dict[Tuple[int, int], List[int]] = {}
        for k, (fi, c) in enumerate(fc_list):
            tri = F[fi]
            u1, v1 = vi, tri[(c + 1) % 3]
            e1 = (u1, v1) if u1 < v1 else (v1, u1)
            u2, v2 = vi, tri[(c + 2) % 3]
            e2 = (u2, v2) if u2 < v2 else (v2, u2)

            if e1 not in sharp_edges:
                local_edge_map.setdefault(e1, []).append(k)
            if e2 not in sharp_edges:
                local_edge_map.setdefault(e2, []).append(k)

        adj: List[List[int]] = [[] for _ in range(len(fc_list))]
        for edge, corners in local_edge_map.items():
            if len(corners) == 2:
                adj[corners[0]].append(corners[1])
                adj[corners[1]].append(corners[0])

        visited = set()
        clusters = []
        for k in range(len(fc_list)):
            if k in visited:
                continue
            cluster = [k]
            visited.add(k)
            queue = [k]
            while queue:
                curr = queue.pop()
                for nbr in adj[curr]:
                    if nbr not in visited:
                        visited.add(nbr)
                        cluster.append(nbr)
                        queue.append(nbr)
            clusters.append(cluster)

        if len(clusters) == 1 and existing_normals is not None:
            vertex_normals_list[vi] = existing_normals[vi].copy()
            continue

        for c_idx, cluster in enumerate(clusters):
            target_v = vi if c_idx == 0 else len(new_vertices)
            if c_idx > 0:
                new_vertices.append(V[vi].copy())
                vertex_normals_list.append(np.zeros(3, dtype=np.float64))
                if has_uv and uv is not None:
                    new_uv.append(uv[vi].copy())
                if has_vc and vc is not None:
                    new_vc.append(vc[vi].copy())

            cluster_norm = np.zeros(3, dtype=np.float64)
            for item_idx in cluster:
                fi, corner = fc_list[item_idx]
                w = alphas[corner][fi]
                cluster_norm += w * face_normals[fi]
                if c_idx > 0:
                    new_faces[fi, corner] = target_v

            norm_len = np.linalg.norm(cluster_norm)
            if norm_len > 1e-12:
                cluster_norm /= norm_len
            elif len(cluster) > 0:
                cluster_norm = face_normals[fc_list[cluster[0]][0]]
            vertex_normals_list[target_v] = cluster_norm

    result = trimesh.Trimesh(
        vertices=np.asarray(new_vertices, dtype=np.float64),
        faces=np.asarray(new_faces, dtype=np.int64),
        vertex_normals=np.asarray(vertex_normals_list, dtype=np.float64),
        process=False,
    )
    if has_uv and new_uv is not None:
        source_visual = getattr(mesh, "visual", None)
        source_material = getattr(source_visual, "material", None)
        source_image = getattr(source_visual, "image", None)
        if source_material is not None:
            result.visual = trimesh.visual.TextureVisuals(
                uv=np.asarray(new_uv, dtype=np.float64),
                material=copy.copy(source_material),
                image=source_image if source_image is not None else getattr(source_material, "image", None),
            )
        elif source_image is not None:
            result.visual = trimesh.visual.TextureVisuals(uv=np.asarray(new_uv, dtype=np.float64), image=source_image)
        else:
            result.visual = trimesh.visual.TextureVisuals(uv=np.asarray(new_uv, dtype=np.float64))
    elif has_vc and new_vc is not None:
        result.visual.vertex_colors = np.asarray(new_vc)

    if hasattr(result, "vertex_normals"):
        _ = result.vertex_normals
    return result


def decimate_mesh(
    mesh: Union[trimesh.Trimesh, trimesh.Scene],
    target_faces: int,
    num_threads: Optional[int] = None,
) -> Union[trimesh.Trimesh, trimesh.Scene]:
    """Decimate mesh to target face count using multi-threaded quadric edge collapse."""
    return MeshProcessor.simplify_mesh(mesh, target_faces=target_faces, num_threads=num_threads)


class MeshProcessor:
    """Multi-threaded mesh processing utility with multi-core CPU utilization."""

    @staticmethod
    def load_mesh(mesh_path: Union[str, Path]) -> trimesh.Trimesh:
        """Load a mesh from file."""
        mesh_path = Path(mesh_path)
        if not mesh_path.exists():
            raise FileNotFoundError(f"Mesh file not found: {mesh_path}")

        try:
            mesh = trimesh.load(mesh_path, process=False)
            if isinstance(mesh, trimesh.Scene):
                if hasattr(mesh, "to_geometry"):
                    mesh = mesh.to_geometry()
                else:
                    mesh = trimesh.util.concatenate(mesh.dump())

            logger.info(
                f"Loaded mesh: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces"
            )
            return mesh
        except Exception as e:
            logger.error(f"Failed to load mesh from {mesh_path}: {str(e)}")
            raise

    @staticmethod
    def normalise_mesh(
        mesh: Union[trimesh.Trimesh, trimesh.Scene],
    ) -> Union[trimesh.Trimesh, trimesh.Scene]:
        """Normalise a mesh to fit within a unit sphere."""
        try:
            mesh.apply_scale(1.0 / mesh.bounding_box.extents.max())
            return mesh
        except Exception as e:
            logger.error(f"Failed to normalise mesh: {str(e)}")
            return mesh

    @staticmethod
    def normalize_mesh(mesh: trimesh.Trimesh, scale: float = 1.0) -> trimesh.Trimesh:
        """Normalize mesh to fit within a unit sphere."""
        try:
            mesh.apply_translation(-mesh.centroid)
            max_extent = mesh.bounding_box.extents.max()
            if max_extent > 0:
                mesh.apply_scale(scale / max_extent)
            return mesh
        except Exception as e:
            logger.error(f"Failed to normalize mesh: {str(e)}")
            return mesh

    @staticmethod
    def _sanitize_mesh_nan(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
        """Replace NaN/Inf vertices with (0,0,0) so GLB accessor min/max are valid JSON.

        NaN in vertex positions causes trimesh to write IEEE NaN into the GLB accessor
        min/max arrays, which are invalid JSON and break any viewer that parses them.
        """
        if not isinstance(mesh, trimesh.Trimesh):
            return mesh
        v = mesh.vertices
        if not np.any(~np.isfinite(v)):
            return mesh
        bad = ~np.isfinite(v).all(axis=1)
        n_bad = bad.sum()
        if n_bad > 0:
            import logging as _log
            _log.getLogger(__name__).warning(
                "Mesh has %d NaN/Inf vertices; replacing with (0,0,0) before export.", n_bad
            )
            v = v.copy()
            v[bad] = 0.0
            mesh = trimesh.Trimesh(vertices=v, faces=mesh.faces,
                                   vertex_normals=mesh.vertex_normals if mesh.vertex_normals is not None and len(mesh.vertex_normals) else None,
                                   process=False)
        return mesh

    @staticmethod
    def save_mesh(
        mesh: trimesh.Trimesh,
        output_path: Union[str, Path],
        format: str = "glb",
        do_normalise: bool = True,
        crease_angle_deg: Optional[float] = None,
    ) -> Path:
        """Save a mesh to file with optimal angle-weighted normals and sharp edge preservation."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if mesh is None:
            raise ValueError(f"Cannot save None mesh to {output_path}: model generation produced a null mesh object.")

        try:
            # Sanitize NaN/Inf before export — NaN in vertices produces NaN in GLB accessor
            # min/max which is invalid JSON and breaks all 3D viewers.
            mesh = MeshProcessor._sanitize_mesh_nan(mesh)
            if do_normalise:
                mesh = MeshProcessor.normalise_mesh(mesh)
            if crease_angle_deg is not None and isinstance(mesh, trimesh.Trimesh) and len(mesh.faces) > 0:
                mesh = compute_angle_weighted_normals(mesh, crease_angle_deg=crease_angle_deg)
            mesh.export(output_path)
            logger.info(f"Saved mesh to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to save mesh to {output_path}: {str(e)}")
            raise

    @staticmethod
    def save_scene(
        scene: trimesh.Scene,
        output_path: Union[str, Path],
        format: str = "glb",
        do_normalise: bool = True,
    ) -> Path:
        """Save a scene to file."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if mesh is None:
            raise ValueError(f"Cannot save None mesh to {output_path}: model generation produced a null mesh object.")

        try:
            if do_normalise:
                scene = MeshProcessor.normalise_mesh(scene)
            scene.export(output_path)
            logger.info(
                f"Saved scene with {len(scene.geometry)} parts to {output_path}"
            )
            return output_path
        except Exception as e:
            logger.error(f"Failed to save scene to {output_path}: {str(e)}")
            raise

    @staticmethod
    def validate_mesh(mesh: trimesh.Trimesh) -> bool:
        """Validate mesh quality and topology."""
        try:
            if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
                logger.warning("Mesh is empty")
                return False
            if not mesh.is_valid:
                logger.warning("Mesh has invalid topology")
                return False
            if not mesh.is_watertight:
                logger.warning("Mesh is not watertight")
            if mesh.bounding_box.extents.max() < 1e-6:
                logger.warning("Mesh is too small")
                return False
            return True
        except Exception as e:
            logger.error(f"Error validating mesh: {str(e)}")
            return False

    @staticmethod
    def get_mesh_stats(mesh: trimesh.Trimesh) -> Dict[str, Any]:
        """Get basic statistics about a mesh."""
        return {
            "vertex_count": len(mesh.vertices),
            "face_count": len(mesh.faces),
            "bounding_box": mesh.bounds.tolist(),
            "extents": mesh.bounding_box.extents.tolist(),
            "volume": float(mesh.volume) if mesh.is_watertight else None,
            "surface_area": float(mesh.area),
            "is_watertight": bool(mesh.is_watertight),
        }

    @staticmethod
    def create_part_colors(num_parts: int) -> List[List[float]]:
        """Generate distinct colors for mesh parts."""
        import colorsys
        colors = []
        for i in range(num_parts):
            hue = i / num_parts
            saturation = 0.8
            value = 0.9
            rgb = colorsys.hsv_to_rgb(hue, saturation, value)
            colors.append([rgb[0], rgb[1], rgb[2], 1.0])
        return colors

    @staticmethod
    def export_segmentation_info(
        segmentation_data: Dict[str, Any], output_path: Union[str, Path]
    ) -> Path:
        """Export segmentation information to JSON."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(output_path, "w") as f:
                json.dump(segmentation_data, f, indent=2, default=str)
            logger.info(f"Saved segmentation info to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to save segmentation info: {str(e)}")
            raise

    @staticmethod
    def export_generation_info(
        generation_data: Dict[str, Any], output_path: Union[str, Path]
    ) -> Path:
        """Export generation information to JSON."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(output_path, "w") as f:
                json.dump(generation_data, f, indent=2, default=str)
            logger.info(f"Saved generation info to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to save generation info: {str(e)}")
            raise

    @staticmethod
    def simplify_mesh(
        mesh: Union[trimesh.Trimesh, trimesh.Scene],
        target_faces: int,
        num_threads: Optional[int] = None,
    ) -> Union[trimesh.Trimesh, trimesh.Scene]:
        """Simplify mesh to target number of faces using multi-threading."""
        threads = get_optimal_thread_count(num_threads)
        configure_cpu_runtime(threads)

        if isinstance(mesh, trimesh.Scene):
            # Parallel multi-core simplification across scene parts
            if not mesh.geometry:
                return mesh
            total_current = sum(
                len(g.faces) for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)
            )
            if total_current <= target_faces or total_current == 0:
                return mesh

            results: Dict[str, trimesh.Trimesh] = {}
            with ThreadPoolExecutor(max_workers=min(len(mesh.geometry), threads)) as executor:
                future_to_name = {}
                for name, geom in mesh.geometry.items():
                    if isinstance(geom, trimesh.Trimesh):
                        part_target = max(
                            4,
                            round(target_faces * (len(geom.faces) / max(1, total_current))),
                        )
                        future_to_name[
                            executor.submit(
                                MeshProcessor.simplify_mesh,
                                geom,
                                part_target,
                                threads,
                            )
                        ] = name

                for fut in as_completed(future_to_name):
                    name = future_to_name[fut]
                    results[name] = fut.result()

            for name, simplified_geom in results.items():
                mesh.geometry[name] = simplified_geom
            return mesh

        try:
            if len(mesh.faces) <= target_faces:
                return mesh

            # Try fast_simplification first for optimal multi-threaded C++ performance
            try:
                import fast_simplification
                target_reduction = max(
                    0.01, min(0.99, 1.0 - (float(target_faces) / float(len(mesh.faces))))
                )
                v_red, f_red = fast_simplification.simplify(
                    np.asarray(mesh.vertices, dtype=np.float64),
                    np.asarray(mesh.faces, dtype=np.int64),
                    target_reduction=target_reduction,
                )
                simplified = trimesh.Trimesh(vertices=v_red, faces=f_red, process=False)
                # Transfer visuals if present
                if mesh.visual and hasattr(mesh.visual, "uv"):
                    from scipy.spatial import cKDTree
                    tree = cKDTree(np.asarray(mesh.vertices, dtype=np.float64))
                    _, nearest = tree.query(v_red)
                    simplified.visual = copy.copy(mesh.visual)
                    if hasattr(mesh.visual, "uv") and mesh.visual.uv is not None:
                        simplified.visual.uv = np.asarray(mesh.visual.uv)[nearest]
                logger.info(
                    f"Simplified mesh (fast_simplification, {threads} threads) from "
                    f"{len(mesh.faces)} to {len(simplified.faces)} faces"
                )
                return simplified
            except Exception as fs_err:
                logger.debug("fast_simplification fallback: %s", fs_err)

            # Final fallback to Trimesh's optional C++ quadric decimator.
            simplified = mesh.simplify_quadric_decimation(face_count=target_faces)
            simplified = compute_angle_weighted_normals(simplified, crease_angle_deg=35.0)
            logger.info(
                f"Simplified mesh (quadric edge collapse) from {len(mesh.faces)} to {len(simplified.faces)} faces"
            )
            return simplified

        except Exception as e:
            logger.warning(f"Failed to simplify mesh: {str(e)}")
            return mesh

    @staticmethod
    def smooth_mesh(
        mesh: Union[trimesh.Trimesh, trimesh.Scene],
        iterations: int = 5,
        method: str = "taubin",
        num_threads: Optional[int] = None,
        **kwargs: Any,
    ) -> Union[trimesh.Trimesh, trimesh.Scene]:
        """Smooth mesh using multi-threaded Taubin or Laplacian smoothing."""
        return smooth_mesh(
            mesh, iterations=iterations, method=method, num_threads=num_threads, **kwargs
        )

    @staticmethod
    def marching_cubes(
        volume: np.ndarray,
        level: float = 0.0,
        spacing: Optional[Tuple[float, float, float]] = None,
        num_threads: Optional[int] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Extract isosurface via multi-threaded marching cubes."""
        return marching_cubes(
            volume, level=level, spacing=spacing, num_threads=num_threads
        )

    @staticmethod
    def batch_simplify_lods(
        mesh: trimesh.Trimesh,
        target_faces_list: Sequence[int],
        num_threads: Optional[int] = None,
    ) -> List[trimesh.Trimesh]:
        """Generate multiple LOD simplifications in parallel across CPU cores."""
        threads = get_optimal_thread_count(num_threads)
        configure_cpu_runtime(threads)

        results: List[Optional[trimesh.Trimesh]] = [None] * len(target_faces_list)
        with ThreadPoolExecutor(max_workers=min(len(target_faces_list), threads)) as executor:
            future_to_idx = {
                executor.submit(
                    MeshProcessor.simplify_mesh, mesh, target, threads
                ): idx
                for idx, target in enumerate(target_faces_list)
            }
            for fut in as_completed(future_to_idx):
                idx = future_to_idx[fut]
                results[idx] = fut.result()
        return [r for r in results if r is not None]

    @staticmethod
    def tri2quad(mesh_path: str):
        """Convert triangles to quads in-place."""
        from meshiki import Mesh
        mesh = Mesh.load(mesh_path, verbose=False)
        logger.info("Converting triangles to quads and save in-place...")
        mesh.quadrangulate()
        mesh.export(mesh_path)

    @staticmethod
    def compute_angle_weighted_normals(
        mesh: trimesh.Trimesh,
        crease_angle_deg: Optional[float] = 35.0,
    ) -> trimesh.Trimesh:
        """Compute Nelson Max angle-weighted vertex normals with dihedral crease splitting."""
        return compute_angle_weighted_normals(mesh, crease_angle_deg=crease_angle_deg)
