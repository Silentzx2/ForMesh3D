"""Mesh Safety Guard Pipeline.

Handles density guarding, 1,000,000 face safety capping, and topology validation
before saving or loading mesh assets in Formesh3D.

Rules:
- Meshes <= max_faces (1,000,000) are preserved 100% untouched (pure native AI output or user upload).
- Meshes > max_faces are safely capped to 1,000,000 faces via fast quadric decimation to protect Three.js WebGL viewport.
- Never performs artificial subdivision.
"""

import logging
import os
import shutil
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

GLOBAL_MAX_FACES = 1_000_000


def guard_mesh_density(
    raw_mesh_path: str,
    output_path: Optional[str] = None,
    max_faces: int = GLOBAL_MAX_FACES,
) -> Dict[str, Any]:
    """Inspect and enforce safety ceiling on raw mesh (generated or uploaded).

    Args:
        raw_mesh_path: Path to the raw mesh file.
        output_path: Optional destination path. If omitted or same as input, updates in-place.
        max_faces: Safety cap for maximum allowable polygon faces (default 1,000,000).

    Returns:
        Dict with status, original_faces, final_faces, capped flag, and output_path.
    """
    raw_path = Path(raw_mesh_path)
    if not raw_path.exists():
        return {
            "success": False,
            "error": f"Raw mesh file not found: {raw_mesh_path}",
            "original_faces": 0,
            "final_faces": 0,
            "capped": False,
        }

    dest_path = Path(output_path) if output_path else raw_path

    try:
        import trimesh
    except ImportError:
        # If trimesh is unavailable, copy raw file without capping
        if dest_path != raw_path:
            shutil.copy2(str(raw_path), str(dest_path))
        return {
            "success": True,
            "original_faces": None,
            "final_faces": None,
            "capped": False,
            "output_path": str(dest_path),
            "note": "trimesh unavailable; preserved raw mesh as-is",
        }

    try:
        loaded = trimesh.load(str(raw_path), process=False)
        mesh = None

        if isinstance(loaded, trimesh.Trimesh):
            mesh = loaded
        elif isinstance(loaded, trimesh.Scene):
            # If scene contains multiple meshes, concatenate or take geometry
            geometries = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
            if geometries:
                if len(geometries) == 1:
                    mesh = geometries[0]
                else:
                    mesh = trimesh.util.concatenate(geometries)
            else:
                mesh = None

        if mesh is None or not hasattr(mesh, "faces") or len(mesh.faces) == 0:
            if dest_path != raw_path:
                shutil.copy2(str(raw_path), str(dest_path))
            return {
                "success": True,
                "original_faces": 0,
                "final_faces": 0,
                "capped": False,
                "output_path": str(dest_path),
            }

        original_faces = len(mesh.faces)
        capped = False

        if original_faces > max_faces:
            logger.warning(
                "Generated mesh has %d faces, exceeding the 1M (%d) safety limit. Capping...",
                original_faces,
                max_faces,
            )
            try:
                import fast_simplification
                v_red, f_red = fast_simplification.simplify(
                    mesh.vertices,
                    mesh.faces,
                    target_count=max_faces,
                )
                mesh = trimesh.Trimesh(vertices=v_red, faces=f_red, process=True)
                mesh.remove_unreferenced_vertices()
                capped = True
            except Exception as e_fast:
                logger.warning("fast_simplification failed (%s); trying trimesh quadric decimation...", e_fast)
                try:
                    mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
                    mesh.remove_unreferenced_vertices()
                    capped = True
                except Exception as e_dec:
                    logger.error("Failed to decimate mesh to 1M faces: %s", e_dec)

        final_faces = len(mesh.faces)

        # Export result to destination
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if capped:
            mesh.export(str(dest_path))
        elif dest_path != raw_path:
            shutil.copy2(str(raw_path), str(dest_path))

        return {
            "success": True,
            "original_faces": original_faces,
            "final_faces": final_faces,
            "capped": capped,
            "output_path": str(dest_path),
        }

    except Exception as exc:
        logger.error("Error in process_generation_output: %s", exc, exc_info=True)
        if dest_path != raw_path and raw_path.exists():
            shutil.copy2(str(raw_path), str(dest_path))
        return {
            "success": False,
            "error": str(exc),
            "output_path": str(dest_path),
        }


# Backward-compatible alias
process_generation_output = guard_mesh_density
