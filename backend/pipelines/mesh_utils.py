"""Mesh processing shared utilities.

Cohesive, operation-agnostic helpers for:
- Safe mesh and Scene loading
- Format conversion and output writing
- Geometric statistics
- Density guard enforcement
- Headless Blender script execution
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import numpy as np
import trimesh

from pipelines.mesh_guard import guard_mesh_density

logger = logging.getLogger(__name__)


def load_mesh_safe(file_path: Union[str, Path]) -> Union[trimesh.Trimesh, trimesh.Scene]:
    """Safely load a mesh or scene without executing unsafe dynamic scripts."""
    path = Path(file_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Mesh file not found: {path}")

    loaded = trimesh.load(str(path), process=False)
    return loaded


def to_single_trimesh(loaded: Union[trimesh.Trimesh, trimesh.Scene]) -> trimesh.Trimesh:
    """Flatten a Scene or Trimesh into a single unified Trimesh."""
    if isinstance(loaded, trimesh.Trimesh):
        return loaded
    elif isinstance(loaded, trimesh.Scene):
        geometries = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not geometries:
            raise ValueError("Scene contains no valid Trimesh geometry")
        if len(geometries) == 1:
            return geometries[0]
        return trimesh.util.concatenate(geometries)
    else:
        raise TypeError(f"Unsupported geometry type: {type(loaded)}")


def compute_mesh_stats(mesh: trimesh.Trimesh) -> Dict[str, Any]:
    """Compute truthful geometric statistics from a Trimesh instance."""
    face_count = int(len(mesh.faces)) if hasattr(mesh, "faces") and mesh.faces is not None else 0
    vertex_count = int(len(mesh.vertices)) if hasattr(mesh, "vertices") and mesh.vertices is not None else 0
    is_watertight = bool(mesh.is_watertight) if hasattr(mesh, "is_watertight") else False

    bounds = [float(x) for x in mesh.bounds.flatten()] if hasattr(mesh, "bounds") and mesh.bounds is not None else []
    extents = [float(x) for x in mesh.extents] if hasattr(mesh, "extents") and mesh.extents is not None else []

    return {
        "face_count": face_count,
        "vertex_count": vertex_count,
        "is_watertight": is_watertight,
        "bounds": bounds,
        "extents": extents,
    }


def export_mesh_safe(
    mesh: Union[trimesh.Trimesh, trimesh.Scene],
    output_path: Union[str, Path],
    file_type: str = "glb",
) -> Path:
    """Export a mesh or scene to disk with format validation and density guarding."""
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    fmt = file_type.lower().lstrip(".")
    if fmt not in {"glb", "gltf", "obj", "ply", "stl"}:
        fmt = "glb"

    if isinstance(mesh, trimesh.Trimesh) and len(mesh.faces) > 1_000_000:
        # Enforce safety ceiling
        temp_raw = out.parent / f"_raw_{out.name}"
        mesh.export(str(temp_raw), file_type=fmt)
        guard_mesh_density(str(temp_raw), str(out), max_faces=1_000_000)
        if temp_raw.exists():
            temp_raw.unlink(missing_ok=True)
    else:
        mesh.export(str(out), file_type=fmt)

    if not out.is_file():
        raise RuntimeError(f"Failed to export mesh to {out}")

    return out


def find_blender_binary() -> Optional[str]:
    """Find Blender, preferring the explicit deployment override."""
    configured = os.environ.get("BLENDER_EXECUTABLE")
    candidates = [
        configured,
        shutil.which("blender"),
        "/usr/bin/blender",
        "/usr/local/bin/blender",
        "/snap/bin/blender",
    ]
    for candidate in candidates:
        if candidate:
            resolved = shutil.which(candidate) if not Path(candidate).is_absolute() else candidate
            if resolved and os.path.isfile(resolved) and os.access(resolved, os.X_OK):
                return str(Path(resolved).resolve())
    return None


def run_blender_script(
    script_content: str,
    timeout_sec: int = 120,
) -> Tuple[bool, str]:
    """Execute a Python script inside headless Blender with bounded runtime."""
    blender_bin = find_blender_binary()
    if not blender_bin:
        return False, "Blender executable not found on system"

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as script_file:
        script_file.write(script_content)
        script_path = script_file.name

    try:
        cmd = [
            blender_bin,
            "-b",
            "-noaudio",
            "--python",
            script_path,
        ]
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_sec,
        )
        if res.returncode != 0:
            err_msg = res.stderr or res.stdout or f"Blender exited with code {res.returncode}"
            logger.error("Blender execution failed: %s", err_msg)
            return False, err_msg
        return True, res.stdout
    except subprocess.TimeoutExpired:
        logger.error("Blender execution timed out after %d seconds", timeout_sec)
        return False, f"Execution timed out after {timeout_sec}s"
    except Exception as exc:
        logger.error("Blender execution error: %s", exc)
        return False, str(exc)
    finally:
        if os.path.exists(script_path):
            os.remove(script_path)
