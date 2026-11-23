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
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple, Union

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
    on_output: Optional[Callable[[str], None]] = None,
) -> Tuple[bool, str]:
    """Run headless Blender with bounded runtime and line-by-line output streaming."""
    blender_bin = find_blender_binary()
    if not blender_bin:
        return False, "Blender executable not found on system"

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as script_file:
        script_file.write(script_content)
        script_path = script_file.name

    try:
        cmd = [blender_bin, "-b", "-noaudio", "--python", script_path]
        logger.info("[SCRIPT] Launching Blender: executable=%s timeout=%ss", blender_bin, timeout_sec)
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_queue: queue.Queue = queue.Queue()

        def read_output() -> None:
            try:
                if process.stdout is not None:
                    for line in process.stdout:
                        output_queue.put(line.rstrip("\r\n"))
            finally:
                output_queue.put(None)

        reader = threading.Thread(target=read_output, name="blender-output-reader", daemon=True)
        reader.start()
        output_lines = []
        started = time.monotonic()
        timed_out = False

        while True:
            if process.poll() is None and time.monotonic() - started > timeout_sec:
                timed_out = True
                process.kill()
                break
            try:
                line = output_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            if line is None:
                break
            output_lines.append(line)
            logger.debug("[BLENDER] %s", line)
            if on_output:
                try:
                    on_output(line)
                except Exception:
                    logger.debug("Blender output callback failed", exc_info=True)

        if timed_out:
            process.wait()
            reader.join(timeout=1)
            while not output_queue.empty():
                line = output_queue.get_nowait()
                if line is not None:
                    output_lines.append(line)
            message = "\n".join(output_lines)
            logger.error("Blender execution timed out after %d seconds", timeout_sec)
            return False, f"Execution timed out after {timeout_sec}s\n{message[-6000:]}"

        return_code = process.wait()
        reader.join(timeout=1)
        output = "\n".join(output_lines)
        if return_code != 0:
            logger.error("Blender execution failed (exit=%d): %s", return_code, output[-6000:])
            return False, output or f"Blender exited with code {return_code}"
        logger.info("[SCRIPT] Blender exited successfully (elapsed=%.2fs)", time.monotonic() - started)
        return True, output
    except Exception as exc:
        logger.exception("Blender execution error")
        return False, str(exc)
    finally:
        if os.path.exists(script_path):
            os.remove(script_path)
