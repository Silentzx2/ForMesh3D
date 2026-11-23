"""Retopology execution pipeline.

Quad output is produced only by Blender's bundled QuadriFlow operator. Triangle
output uses Trimesh decimation. Explicit quad requests never silently degrade
to triangles.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Union

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


def execute_retopo(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    options: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> Dict[str, Any]:
    opts = options or {}
    target_faces = int(opts.get("target_faces") or opts.get("target_polycount") or 50000)
    quads = bool(opts.get("quads", True))
    watertight = bool(opts.get("watertight") or opts.get("watertightHealing", False))
    adaptive = bool(opts.get("adaptive") if "adaptive" in opts else opts.get("adaptiveDensity", True))
    preserve_features = bool(opts.get("preserve_features") if "preserve_features" in opts else opts.get("preserveEdges", True))
    feature_angle = max(0.0, min(180.0, float(opts.get("feature_angle", 45.0))))
    output_format = str(opts.get("output_format") or "glb").lower().lstrip(".")
    if output_format not in {"glb", "obj"}:
        raise ValueError("Retopology Script output format must be GLB or OBJ")

    in_file = Path(input_path).resolve()
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    if progress_callback:
        progress_callback("Validating input mesh and retopology settings...", 0.25)
    blender_bin = find_blender_binary()
    input_mesh = None
    if not quads:
        input_mesh = to_single_trimesh(load_mesh_safe(in_file))
        logger.info(
            "[RETOPO] Input mesh loaded: vertices=%d faces=%d topology=triangle target_faces=%d",
            len(input_mesh.vertices), len(input_mesh.faces), target_faces,
        )
    if quads:
        if not blender_bin:
            raise RuntimeError(
                "QuadriFlow requires Blender with bpy.ops.object.quadriflow_remesh. "
                "Install Blender or set BLENDER_EXECUTABLE, or choose Triangle topology."
            )
        if progress_callback:
            progress_callback(f"Starting Blender QuadriFlow ({target_faces:,} target quads)...", 0.4)
            progress_callback(
                "QuadriFlow is running; Blender does not expose operator-level percentage.",
                None,
            )

        blender_script = f"""
import bpy
import bmesh
import math
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)
print("[SCRIPT] Blender scene initialized")
in_path = r"{in_file}"
out_path = r"{out_file}"
target_faces = {target_faces}
preserve_sharp = {preserve_features}
feature_angle = math.radians({feature_angle})
heal_mesh = {watertight}
smooth_normals = {adaptive}
output_format = "{output_format}"

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
    raise RuntimeError('Unsupported QuadriFlow input format: ' + ext)

mesh_objs = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
print(f"[SCRIPT] Imported {len(mesh_objs)} mesh object(s)")
if not mesh_objs:
    raise RuntimeError('Input file did not contain a mesh')

bpy.ops.object.select_all(action='DESELECT')
for obj in mesh_objs:
    obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_objs[0]
if len(mesh_objs) > 1:
    bpy.ops.object.join()
active_obj = bpy.context.view_layer.objects.active

if heal_mesh:
    print("[SCRIPT] Repairing holes and normals")
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.fill_holes(sides=0)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

if preserve_sharp:
    print("[SCRIPT] Preserving sharp feature edges")
    bm = bmesh.new()
    bm.from_mesh(active_obj.data)
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            try:
                if edge.calc_face_angle(0.0) >= feature_angle:
                    edge.smooth = False
            except ValueError:
                pass
    bm.to_mesh(active_obj.data)
    bm.free()
    active_obj.data.update()

quadflow = getattr(bpy.ops.object, 'quadriflow_remesh', None)
if quadflow is None:
    raise RuntimeError('Blender was found but bpy.ops.object.quadriflow_remesh is unavailable')
quad_properties = quadflow.get_rna_type().properties.keys()
quad_kwargs = dict(
    use_mesh_symmetry=False,
    use_preserve_sharp=preserve_sharp,
    use_preserve_boundary=True,
    smooth_normals=smooth_normals,
    mode='FACES',
    target_faces=target_faces,
)
if 'preserve_attributes' in quad_properties:
    quad_kwargs['preserve_attributes'] = True
print("[SCRIPT] QuadriFlow remesh started; Blender does not expose operator-level percentage")
result = quadflow(**quad_kwargs)
print(f"[SCRIPT] QuadriFlow remesh finished: {len(active_obj.data.polygons)} faces")
if 'CANCELLED' in result or not active_obj.data.polygons:
    raise RuntimeError('QuadriFlow cancelled or produced an empty mesh')

print(f"[SCRIPT] Exporting retopology result as {output_format.upper()}")
if output_format == 'glb':
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB')
elif output_format == 'obj':
    if hasattr(bpy.ops.wm, 'obj_export'):
        bpy.ops.wm.obj_export(filepath=out_path)
    elif hasattr(bpy.ops.export_scene, 'obj'):
        bpy.ops.export_scene.obj(filepath=out_path)
    else:
        raise RuntimeError('This Blender build has no OBJ exporter')
"""
        def _blender_log(line: str) -> None:
            lowered = line.lower()
            if "[script]" in lowered or "error" in lowered or "warning" in lowered or "traceback" in lowered:
                if progress_callback:
                    progress_callback(f"Blender debug: {line}", None)

        success, log = run_blender_script(blender_script, timeout_sec=240, on_output=_blender_log)
        if not success or not out_file.is_file() or out_file.stat().st_size <= 0:
            raise RuntimeError(
                "QuadriFlow failed; no triangle fallback was produced. "
                + (log[-1800:] if log else "Check the Blender executable and QuadriFlow support.")
            )
        blender_used = True
        if progress_callback:
            progress_callback("QuadriFlow completed; validating exported topology...", 0.86)
    else:
        if progress_callback:
            progress_callback("Loading geometry for Trimesh triangle decimation...", 0.35)
        mesh = input_mesh or to_single_trimesh(load_mesh_safe(in_file))
        original_faces = len(mesh.faces)
        logger.info("[RETOPO] Triangle path loaded: vertices=%d faces=%d", len(mesh.vertices), original_faces)

        if watertight and hasattr(trimesh, "repair"):
            if progress_callback:
                progress_callback("Repairing mesh holes and face normals...", 0.48)
            trimesh.repair.fill_holes(mesh)
            trimesh.repair.fix_normals(mesh)

        if original_faces > target_faces:
            if progress_callback:
                progress_callback(
                    f"Reducing triangle count from {original_faces:,} to {target_faces:,}...",
                    0.6,
                )
                progress_callback(
                    "Quadric decimation is running; Trimesh does not expose operator-level percentage.",
                    None,
                )
            logger.info("[RETOPO] Quadric decimation starting: faces=%d target=%d", original_faces, target_faces)
            try:
                mesh = mesh.simplify_quadric_decimation(face_count=target_faces)
            except TypeError:
                mesh = mesh.simplify_quadric_decimation(target_faces)
            except Exception as decimation_error:
                raise RuntimeError(
                    f"Could not meet target face budget ({target_faces:,}): {decimation_error}"
                ) from decimation_error
            logger.info("[RETOPO] Quadric decimation finished: output_faces=%d", len(mesh.faces))
            if len(mesh.faces) > target_faces:
                raise RuntimeError(
                    f"Decimator returned {len(mesh.faces):,} faces, above the requested budget of {target_faces:,}"
                )

        if adaptive and hasattr(trimesh, "smoothing"):
            if progress_callback:
                progress_callback("Applying optional Taubin surface smoothing...", 0.78)
            try:
                trimesh.smoothing.filter_taubin(mesh, iterations=10)
            except Exception as smoothing_error:
                logger.warning("Optional Taubin smoothing was skipped: %s", smoothing_error)

        if progress_callback:
            progress_callback(f"Exporting triangle retopology as {output_format.upper()}...", 0.86)
        export_mesh_safe(mesh, out_file, file_type=output_format)

    if progress_callback:
        progress_callback("Verifying output mesh and computing geometry statistics...", 0.94)

    final_mesh = to_single_trimesh(load_mesh_safe(out_file))
    stats = compute_mesh_stats(final_mesh)
    stats["topology"] = "quad" if blender_used else "triangle"
    stats["algorithm"] = "blender_quadriflow" if blender_used else "trimesh_quadric_decimation"
    stats["target_faces"] = target_faces
    stats["feature_angle"] = feature_angle if preserve_features else None
    stats["preserve_features"] = preserve_features
    stats["watertight_repair_requested"] = watertight
    stats["adaptive_smoothing"] = adaptive

    return {
        "success": True,
        "output_path": str(out_file),
        "format": output_format,
        "stats": stats,
    }
