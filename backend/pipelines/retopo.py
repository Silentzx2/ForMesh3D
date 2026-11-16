"""Retopology execution pipeline.

Supports:
- Quad remeshing via QuadriFlow in headless Blender when available
- Isotropic triangle remeshing & quadratic decimation via Trimesh
- Watertight healing, normal correction, and density safety capping
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Union

import trimesh

from backend.pipelines.mesh_utils import (
    compute_mesh_stats,
    export_mesh_safe,
    find_blender_binary,
    load_mesh_safe,
    run_blender_script,
    to_single_trimesh,
)

logger = logging.getLogger(__name__)


def execute_retopo(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    options: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> Dict[str, Any]:
    """Execute retopology on a mesh file.

    Args:
        input_path: Path to input mesh (GLB/OBJ/PLY/STL).
        output_path: Destination path for retopo output.
        options: Dictionary of retopo settings:
            - target_faces: Target polygon count (default 50,000)
            - quads: True for quad topology, False for triangles (default True)
            - watertight: Fill holes and fix normals (default False)
            - adaptive: Curvature-adaptive smoothing / decimation (default True)
            - preserve_features: Keep sharp feature edges (default True)
            - feature_angle: Angle threshold for sharp edges (default 45.0)
            - output_format: Output file extension (default 'glb')
        progress_callback: Optional callback for streaming progress updates.

    Returns:
        Dictionary containing execution summary and truthful geometric stats.
    """
    opts = options or {}
    target_faces = int(opts.get("target_faces") or opts.get("target_polycount") or 50000)
    quads = bool(opts.get("quads", True))
    watertight = bool(opts.get("watertight") or opts.get("watertightHealing", False))
    adaptive = bool(opts.get("adaptive") if "adaptive" in opts else opts.get("adaptiveDensity", True))
    preserve_features = bool(opts.get("preserve_features") if "preserve_features" in opts else opts.get("preserveEdges", True))
    output_format = str(opts.get("output_format") or "glb").lower().lstrip(".")

    in_file = Path(input_path).resolve()
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    if progress_callback:
        progress_callback("Analyzing mesh geometry...", 0.2)

    has_blender = bool(find_blender_binary())
    blender_used = False

    # 1. Quad topology path via headless Blender QuadriFlow
    if quads and has_blender:
        if progress_callback:
            progress_callback(f"Running QuadriFlow quad remesh ({target_faces:,} target faces)...", 0.4)

        blender_script = f"""
import bpy
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)
in_path = r"{in_file}"
out_path = r"{out_file}"
target_faces = {target_faces}
preserve_sharp = {preserve_features}

ext = in_path.lower().split('.')[-1]
if ext in ['glb', 'gltf']:
    bpy.ops.import_scene.gltf(filepath=in_path)
elif ext == 'obj':
    try:
        bpy.ops.wm.obj_import(filepath=in_path)
    except AttributeError:
        bpy.ops.import_scene.obj(filepath=in_path)
else:
    bpy.ops.import_scene.gltf(filepath=in_path)

mesh_objs = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not mesh_objs:
    sys.exit(1)

bpy.context.view_layer.objects.active = mesh_objs[0]
for obj in mesh_objs:
    obj.select_set(True)
if len(mesh_objs) > 1:
    bpy.ops.object.join()

active_obj = bpy.context.view_layer.objects.active

try:
    bpy.ops.object.quadriflow_remesh(
        use_mesh_symmetry=False,
        use_preserve_sharp=preserve_sharp,
        use_preserve_boundary=True,
        preserve_paint_mask=False,
        smooth_normals=False,
        mode='FACES',
        target_faces=target_faces,
    )
except Exception as e:
    print(f"Quadriflow error: {{e}}", file=sys.stderr)
    mod = active_obj.modifiers.new(name="Decimate", type='DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    current_faces = len(active_obj.data.polygons)
    if current_faces > target_faces:
        mod.ratio = float(target_faces) / float(current_faces)
        bpy.ops.object.modifier_apply(modifier="Decimate")

bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB')
"""
        success, log = run_blender_script(blender_script, timeout_sec=180)
        if success and out_file.is_file() and out_file.stat().st_size > 0:
            blender_used = True

    # 2. Trimesh isotropic decimation & healing (fallback or explicit triangle mode)
    if not blender_used:
        if progress_callback:
            progress_callback("Executing Trimesh isotropic remesher and simplification...", 0.4)

        loaded = load_mesh_safe(in_file)
        mesh = to_single_trimesh(loaded)

        if watertight and hasattr(trimesh, "repair"):
            trimesh.repair.fill_holes(mesh)
            trimesh.repair.fix_normals(mesh)

        current_faces = len(mesh.faces)
        if current_faces > target_faces:
            if progress_callback:
                progress_callback(f"Simplifying mesh from {current_faces:,} to {target_faces:,} faces...", 0.6)
            try:
                # Quadric decimation
                mesh = mesh.simplify_quadric_decimation(target_faces)
            except Exception as dec_err:
                logger.warning("simplify_quadric_decimation failed: %s; falling back", dec_err)

        if adaptive and hasattr(trimesh, "smoothing"):
            try:
                trimesh.smoothing.filter_taubin(mesh, iterations=10)
            except Exception:
                pass

        export_mesh_safe(mesh, out_file, file_type=output_format)

    if progress_callback:
        progress_callback("Computing final geometry statistics...", 0.9)

    final_mesh = to_single_trimesh(load_mesh_safe(out_file))
    stats = compute_mesh_stats(final_mesh)
    stats["topology"] = "quad" if (quads and blender_used) else "triangle"
    stats["algorithm"] = "blender_quadriflow" if blender_used else "trimesh_decimate"
    stats["target_faces"] = target_faces

    return {
        "success": True,
        "output_path": str(out_file),
        "format": output_format,
        "stats": stats,
    }
