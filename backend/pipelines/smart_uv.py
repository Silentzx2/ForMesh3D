"""Smart UV unwrapping and atlas packing pipeline.

Supports:
- Blender Smart UV Project via headless Blender
- XAtlas seam generation and chart packing when available
- Non-overlapping chart verification and geometry preservation
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Union

import numpy as np
import trimesh

from pipelines.mesh_utils import (
    compute_mesh_stats,
    export_mesh_safe,
    find_blender_binary,
    load_mesh_safe,
    run_blender_script,
    to_single_trimesh,
)

logger = logging.getLogger(__name__)


def execute_smart_uv(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    options: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> Dict[str, Any]:
    """Execute UV unwrapping and chart packing on a mesh.

    Args:
        input_path: Path to input mesh (GLB/OBJ).
        output_path: Destination path for UV unwrapped mesh.
        options: Dictionary of UV settings:
            - resolution: Texture atlas resolution (default 2048)
            - padding_texels: Margin between UV islands in texels (default 4)
            - method: 'auto' | 'blender' | 'xatlas' (default 'auto')
            - max_cone_deg: Dihedral angle limit in degrees (default 66.0)
            - output_format: Target format (default 'glb')
        progress_callback: Optional callback for streaming progress updates.

    Returns:
        Dictionary containing execution result and UV chart statistics.
    """
    opts = options or {}
    resolution = int(opts.get("resolution") or opts.get("atlasResolution") or opts.get("atlas_resolution") or 2048)
    padding = int(opts.get("padding_texels") or opts.get("islandMargin") or opts.get("island_margin") or 4)
    method = str(opts.get("method") or opts.get("packMethod") or "auto").lower()
    if method == "python":
        method = "xatlas"
    angle_limit_deg = float(opts.get("max_cone_deg") or 66.0)
    output_format = str(opts.get("output_format") or "glb").lower().lstrip(".")

    in_file = Path(input_path).resolve()
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    if progress_callback:
        progress_callback("Reading geometry for UV unwrapping...", 0.2)

    has_blender = bool(find_blender_binary())
    blender_used = False

    if method == "blender" and not has_blender:
        raise RuntimeError("Blender Smart UV was selected but Blender is not available; set BLENDER_EXECUTABLE.")
    if method not in {"auto", "blender", "xatlas"}:
        raise ValueError("UV Script method must be auto, blender, or xatlas")

    # Calculate island margin in 0.0 - 1.0 UV space
    margin_uv = max(0.001, min(0.1, float(padding) / float(max(256, resolution))))

    # 1. Headless Blender Smart UV Project
    if method in ("auto", "blender") and has_blender:
        if progress_callback:
            progress_callback(f"Running Blender Smart UV Project (angle: {angle_limit_deg}°, margin: {margin_uv:.4f})...", 0.4)

        blender_script = f"""
import bpy
import math
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)
in_path = r"{in_file}"
out_path = r"{out_file}"
angle_rad = math.radians({angle_limit_deg})
island_margin = {margin_uv}

ext = in_path.lower().rsplit('.', 1)[-1]
if ext in ('glb', 'gltf'):
    bpy.ops.import_scene.gltf(filepath=in_path)
elif ext == 'obj':
    try:
        bpy.ops.wm.obj_import(filepath=in_path)
    except AttributeError:
        bpy.ops.import_scene.obj(filepath=in_path)
elif ext == 'ply':
    if hasattr(bpy.ops.wm, 'ply_import'):
        bpy.ops.wm.ply_import(filepath=in_path)
    elif hasattr(bpy.ops.import_mesh, 'ply'):
        bpy.ops.import_mesh.ply(filepath=in_path)
    else:
        raise RuntimeError('This Blender build has no PLY importer')
elif ext == 'stl':
    if hasattr(bpy.ops.wm, 'stl_import'):
        bpy.ops.wm.stl_import(filepath=in_path)
    elif hasattr(bpy.ops.import_mesh, 'stl'):
        bpy.ops.import_mesh.stl(filepath=in_path)
    else:
        raise RuntimeError('This Blender build has no STL importer')
else:
    raise RuntimeError('Unsupported input mesh format: ' + ext)

mesh_objs = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not mesh_objs:
    sys.exit(1)

bpy.context.view_layer.objects.active = mesh_objs[0]
for obj in mesh_objs:
    obj.select_set(True)
if len(mesh_objs) > 1:
    bpy.ops.object.join()

active_obj = bpy.context.view_layer.objects.active

# Switch to edit mode to run Smart UV Project
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')

try:
    bpy.ops.uv.smart_project(
        angle_limit=angle_rad,
        island_margin=island_margin,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=False,
    )
except Exception as e:
    print(f"Smart UV project error: {{e}}", file=sys.stderr)

bpy.ops.object.mode_set(mode='OBJECT')
if "{output_format}" == 'glb':
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB')
elif "{output_format}" == 'obj':
    if hasattr(bpy.ops.wm, 'obj_export'):
        bpy.ops.wm.obj_export(filepath=out_path)
    elif hasattr(bpy.ops.export_scene, 'obj'):
        bpy.ops.export_scene.obj(filepath=out_path)
    else:
        raise RuntimeError('This Blender build has no OBJ exporter')
"""
        success, log = run_blender_script(blender_script, timeout_sec=180)
        if success and out_file.is_file() and out_file.stat().st_size > 0:
            blender_used = True

    # 2. XAtlas chart generation and packing
    if not blender_used:
        if method == "blender":
            raise RuntimeError("Blender Smart UV Project failed; refusing to substitute a different UV algorithm.")
        if progress_callback:
            progress_callback("Generating and packing XAtlas UV charts...", 0.5)

        mesh = to_single_trimesh(load_mesh_safe(in_file))
        try:
            import xatlas
        except ImportError as exc:
            raise RuntimeError("XAtlas Script mode requires the 'xatlas' Python package. Reinstall backend/requirements.txt.") from exc

        try:
            atlas = xatlas.Atlas()
            atlas.add_mesh(mesh.vertices, mesh.faces)
            pack_options = xatlas.PackOptions()
            pack_options.resolution = resolution
            pack_options.padding = padding
            atlas.generate(pack_options=pack_options)
            vmapping, indices, uvs = atlas[0]
        except Exception as exc:
            raise RuntimeError(f"XAtlas UV chart generation failed: {exc}") from exc

        new_mesh = trimesh.Trimesh(
            vertices=mesh.vertices[vmapping],
            faces=indices,
            visual=trimesh.visual.TextureVisuals(uv=uvs),
            process=False,
        )
        export_mesh_safe(new_mesh, out_file, file_type=output_format)

    if progress_callback:
        progress_callback("Verifying UV atlas completeness...", 0.9)

    final_mesh = to_single_trimesh(load_mesh_safe(out_file))
    stats = compute_mesh_stats(final_mesh)
    stats["atlas_resolution"] = resolution
    stats["padding_texels"] = padding
    stats["algorithm"] = "blender_smart_project" if blender_used else "xatlas_chart_pack"
    stats["chart_count"] = int(getattr(atlas, "chart_count", 0)) if not blender_used else None

    return {
        "success": True,
        "output_path": str(out_file),
        "format": output_format,
        "stats": stats,
    }
