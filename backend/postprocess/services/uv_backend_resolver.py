"""UV Backend Resolver and Unwrap Driver.

Provides single-point-of-truth backend resolution between PartUV (high-poly, GPU)
and xatlas (low-poly / fallback, CPU/GPU) along with unified execution.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import trimesh
import yaml

try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config

logger = logging.getLogger(__name__)


def load_uv_config(config_path: Optional[str | Path] = None) -> Dict[str, Any]:
    """Load UV configuration from canonical quality config."""
    path_str = str(config_path) if config_path is not None else None
    return dict(get_quality_config(path_str)["uv"])


def resolve_uv_backend(
    triangle_count: int,
    requested_backend: str = "auto",
    has_cuda: bool = False,
    free_vram_gb: float = 0.0,
    config_path: Optional[str] = None,
) -> Tuple[str, str]:
    """Resolve which UV unwrapping backend to use.

    Returns:
        tuple[str, str]: (selected_backend, reason)
    """
    cfg = load_uv_config(config_path)
    threshold = int(cfg.get("partuv_triangle_threshold", 500000))
    vram_req = float(cfg.get("partuv_vram_requirement_gb", 7.0))
    fallback = str(cfg.get("fallback_backend", "xatlas"))

    requested = (requested_backend or "auto").strip().lower()

    if requested == "partuv":
        if not has_cuda:
            logger.warning("PartUV requested but CUDA is not available; falling back to %s.", fallback)
            return fallback, f"partuv requested but CUDA is not available; falling back to {fallback}"
        if free_vram_gb < vram_req:
            logger.warning(
                "PartUV requested but free VRAM (%.1fGB) is below required (%.1fGB); falling back to %s.",
                free_vram_gb,
                vram_req,
                fallback,
            )
            return (
                fallback,
                f"partuv requested but insufficient VRAM ({free_vram_gb:.1f}GB < {vram_req:.1f}GB); falling back to {fallback}",
            )
        return "partuv", f"partuv explicitly requested with sufficient CUDA VRAM ({free_vram_gb:.1f}GB >= {vram_req:.1f}GB)"

    if requested in ("ministudio", "autouv"):
        return "ministudio", f"{requested} explicitly requested"

    if requested in ("blender_smart", "blender"):
        return "blender_smart", f"{requested} explicitly requested"

    if requested == "xatlas":
        return "xatlas", "xatlas explicitly requested"

    if requested == "auto":
        if triangle_count >= threshold and has_cuda and free_vram_gb >= vram_req:
            return (
                "partuv",
                f"auto selected partuv: triangle count ({triangle_count}) >= {threshold} and sufficient CUDA VRAM ({free_vram_gb:.1f}GB >= {vram_req:.1f}GB)",
            )
        if triangle_count < threshold:
            reason = f"auto selected {fallback}: triangle count ({triangle_count}) < {threshold}"
        elif not has_cuda:
            reason = f"auto selected {fallback}: triangle count ({triangle_count}) >= {threshold} but CUDA not available"
        else:
            reason = f"auto selected {fallback}: triangle count ({triangle_count}) >= {threshold} but insufficient VRAM ({free_vram_gb:.1f}GB < {vram_req:.1f}GB)"
        return fallback, reason

    logger.warning("Unknown UV backend '%s' requested; falling back to %s.", requested_backend, fallback)
    return fallback, f"unknown backend '{requested_backend}'; falling back to {fallback}"


def _unwrap_massive_mesh_safe(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
    max_safe_faces: int = 100000,
    max_chart_size: int = 4096,
) -> trimesh.Trimesh:
    """Validate mesh face count and unwrap with xatlas.

    The previous proxy-transfer KDTree branch assigned vertex UVs across different
    triangles without creating seams, producing invalid stretched UVs.
    If mesh faces exceed max_safe_faces, raises ValueError.
    """
    f = np.asarray(mesh.faces, dtype=np.int32)
    if len(f) > max_safe_faces:
        raise ValueError(
            f"UV unwrap needs <= {max_safe_faces} triangles (got {len(f)}). Decimate first."
        )
    return _unwrap_xatlas(mesh, runtime=runtime, max_chart_size=max_chart_size)


def _unwrap_ministudio(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
) -> trimesh.Trimesh:
    """Unwrap mesh using ministudio/autouv package."""
    from postprocess.services.auto_uv import run_auto_uv
    from postprocess.schemas import AutoUvOptions

    runtime_dict = runtime or {}
    opts = AutoUvOptions(
        resolution=int(runtime_dict.get("resolution", 2048)),
        padding_texels=int(runtime_dict.get("padding", runtime_dict.get("padding_texels", 4))),
    )
    unwrapped, _, _ = run_auto_uv(mesh, opts)
    return unwrapped


def _unwrap_blender_smart(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
) -> trimesh.Trimesh:
    """Unwrap mesh using Blender Smart UV Project."""
    import shutil
    import subprocess
    from uuid import uuid4
    from postprocess.config import WORK_DIR, blender_runtime_available, blender_worker_argv

    if not blender_runtime_available():
        raise RuntimeError("Blender runtime not available for blender_smart UV unwrap.")

    job_dir = WORK_DIR / f"blender_uv-{uuid4().hex}"
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        in_glb = job_dir / "input.glb"
        out_glb = job_dir / "output.glb"
        in_glb.write_bytes(mesh.export(file_type="glb"))
        angle_limit = float((runtime or {}).get("angle_limit", 66.0))
        island_margin = float((runtime or {}).get("island_margin", 0.01))

        script = job_dir / "smart_uv.py"
        script.write_text(
            f'import bpy\n'
            f'bpy.ops.wm.read_factory_settings(use_empty=True)\n'
            f'bpy.ops.import_scene.gltf(filepath=r"{in_glb}")\n'
            f'for obj in bpy.context.scene.objects:\n'
            f'    if obj.type == "MESH":\n'
            f'        bpy.context.view_layer.objects.active = obj\n'
            f'        bpy.ops.object.mode_set(mode="EDIT")\n'
            f'        bpy.ops.mesh.select_all(action="SELECT")\n'
            f'        bpy.ops.uv.smart_project(angle_limit={angle_limit}, island_margin={island_margin})\n'
            f'        bpy.ops.object.mode_set(mode="OBJECT")\n'
            f'bpy.ops.export_scene.gltf(filepath=r"{out_glb}", export_format="GLB")\n',
            encoding="utf-8",
        )
        cmd = blender_worker_argv(script, [])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0 or not out_glb.exists():
            raise RuntimeError(f"Blender smart UV unwrap failed: {proc.stderr or proc.stdout}")

        from postprocess.meshio import load_mesh
        return load_mesh(out_glb.read_bytes(), "output.glb")
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def _unwrap_xatlas(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
    max_chart_size: int = 4096,
) -> trimesh.Trimesh:
    """Unwrap mesh using xatlas numpy vertex/face API with safety limits."""
    import xatlas

    v = np.asarray(mesh.vertices, dtype=np.float64)
    f = np.asarray(mesh.faces, dtype=np.int32)

    if len(v) == 0 or len(f) == 0:
        return mesh.copy()

    runtime_dict = runtime or {}
    config_path = runtime_dict.get("config_path", None)
    default_max_safe = 100000
    try:
        cfg = load_uv_config(config_path)
        default_max_safe = int(cfg.get("max_safe_triangles", 100000))
    except Exception:
        pass
    max_safe_faces = int(
        runtime_dict.get("xatlas_max_safe_triangles", runtime_dict.get("max_safe_triangles", default_max_safe))
    )
    if len(f) > max_safe_faces:
        raise ValueError(
            f"UV unwrap needs <= {max_safe_faces} triangles (got {len(f)}). Decimate first."
        )

    atlas = xatlas.Atlas()
    chart_opts = xatlas.ChartOptions()
    chart_opts.normal_seam_weight = float(runtime_dict.get("normal_seam_weight", 2.0))
    chart_opts.max_iterations = int(runtime_dict.get("max_iterations", 4))

    pack_opts = xatlas.PackOptions()
    pack_opts.max_chart_size = int(max_chart_size)
    if len(f) < 20000:
        pack_opts.bruteForce = True
    if "bruteForce" in runtime_dict:
        pack_opts.bruteForce = bool(runtime_dict["bruteForce"])
    elif "brute_force" in runtime_dict:
        pack_opts.bruteForce = bool(runtime_dict["brute_force"])

    if "resolution" in runtime_dict:
        pack_opts.resolution = int(runtime_dict["resolution"])
    if "padding" in runtime_dict:
        pack_opts.padding = int(runtime_dict["padding"])
    elif "padding_texels" in runtime_dict:
        pack_opts.padding = int(runtime_dict["padding_texels"])

    atlas.add_mesh(v, f)
    atlas.generate(chart_options=chart_opts, pack_options=pack_opts)
    vmapping, indices, uvs = atlas.get_mesh(0)

    out_v = v[vmapping]
    out_f = indices
    out_uv = np.asarray(uvs, dtype=np.float32)

    out_normals = None
    if hasattr(mesh, "vertex_normals") and mesh.vertex_normals is not None and len(mesh.vertex_normals) == len(v):
        out_normals = np.asarray(mesh.vertex_normals, dtype=np.float64)[vmapping]

    unwrapped = trimesh.Trimesh(
        vertices=out_v,
        faces=out_f,
        vertex_normals=out_normals,
        process=False,
    )

    source_visual = getattr(mesh, "visual", None)
    source_material = getattr(source_visual, "material", None)
    source_image = getattr(source_visual, "image", None)
    source_vertex_colors = getattr(source_visual, "vertex_colors", None)

    unwrapped.visual = trimesh.visual.TextureVisuals(
        uv=out_uv,
        material=source_material if source_material is not None else trimesh.visual.material.PBRMaterial(name="xatlas"),
        image=source_image if source_image is not None else None,
    )

    if source_vertex_colors is not None:
        try:
            if len(source_vertex_colors) == len(out_v):
                unwrapped.visual.vertex_colors = source_vertex_colors
            elif len(source_vertex_colors) == len(v):
                unwrapped.visual.vertex_colors = np.asarray(source_vertex_colors)[vmapping]
        except Exception:
            pass

    return unwrapped


def _unwrap_partuv(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
) -> trimesh.Trimesh:
    """Unwrap mesh using PartUV runner."""
    import tempfile

    try:
        from utils.partuv_utils import PartUVRunner
    except ImportError:
        try:
            from backend.utils.partuv_utils import PartUVRunner
        except ImportError as e:
            raise RuntimeError(f"PartUV utilities not available: {e}") from e

    runtime_dict = runtime or {}
    distortion_threshold = runtime_dict.get("distortion_threshold", 1.25)
    config_path = runtime_dict.get("partuv_config_path", None)

    runner = PartUVRunner(
        config_path=config_path,
        distortion_threshold=distortion_threshold,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        input_mesh_path = Path(tmp_dir) / "input.obj"
        mesh.export(str(input_mesh_path))

        output_dir = Path(tmp_dir) / "output"
        runner.generate_uv_from_mesh(
            mesh_path=input_mesh_path,
            output_path=output_dir,
            save_individual_parts=False,
            save_visuals=False,
        )

        final_mesh_path = output_dir / "final_components.obj"
        if not final_mesh_path.exists():
            raise RuntimeError(f"PartUV did not produce expected output at {final_mesh_path}")

        unwrapped = trimesh.load(str(final_mesh_path), force="mesh", process=False)
        return unwrapped


def execute_uv_unwrap(
    mesh: trimesh.Trimesh,
    backend: str = "auto",
    runtime: Optional[Dict[str, Any]] = None,
) -> Tuple[trimesh.Trimesh, Dict[str, Any]]:
    """Execute UV unwrapping with automatic backend resolution and fallback.

    Never mutates input in-place: works on mesh.copy().
    Returns:
        tuple[trimesh.Trimesh, dict]:
            unwrapped_mesh,
            {"backend_used": str, "resolved_backend": str, "triangle_count": int, "success": bool}
    """
    if mesh is None:
        raise ValueError("Input mesh cannot be None")

    mesh_copy = mesh.copy()
    triangle_count = int(len(mesh.faces))

    runtime_dict: Dict[str, Any] = dict(runtime) if runtime else {}

    if "has_cuda" in runtime_dict:
        has_cuda = bool(runtime_dict["has_cuda"])
    else:
        try:
            import torch
            has_cuda = bool(torch.cuda.is_available())
        except Exception:
            has_cuda = False

    if "free_vram_gb" in runtime_dict:
        free_vram_gb = float(runtime_dict["free_vram_gb"])
    else:
        free_vram_gb = 0.0
        if has_cuda:
            try:
                import torch
                free_bytes = torch.cuda.mem_get_info()[0]
                free_vram_gb = float(free_bytes) / (1024.0 ** 3)
            except Exception:
                free_vram_gb = 0.0

    config_path = runtime_dict.get("config_path", None)
    resolved_backend, _ = resolve_uv_backend(
        triangle_count=triangle_count,
        requested_backend=backend,
        has_cuda=has_cuda,
        free_vram_gb=free_vram_gb,
        config_path=config_path,
    )

    cfg = load_uv_config(config_path)
    max_chart_size = runtime_dict.get("max_chart_size", cfg.get("max_chart_size", 4096))

    backend_used = resolved_backend
    success = True
    unwrapped_mesh = mesh_copy

    if resolved_backend == "partuv":
        try:
            unwrapped_mesh = _unwrap_partuv(mesh_copy, runtime_dict)
            backend_used = "partuv"
            success = True
        except Exception as exc:
            logger.warning("PartUV unwrap failed (%s); gracefully falling back to xatlas", exc)
            try:
                unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
                backend_used = "xatlas"
                success = True
            except ValueError:
                raise
            except Exception as inner_exc:
                logger.error("Fallback xatlas unwrap also failed: %s", inner_exc)
                unwrapped_mesh = mesh_copy
                backend_used = "xatlas"
                success = False
    elif resolved_backend == "ministudio":
        try:
            unwrapped_mesh = _unwrap_ministudio(mesh_copy, runtime_dict)
            backend_used = "ministudio"
            success = True
        except Exception as exc:
            logger.warning("ministudio unwrap failed (%s); gracefully falling back to xatlas", exc)
            try:
                unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
                backend_used = "xatlas"
                success = True
            except ValueError:
                raise
            except Exception as inner_exc:
                logger.error("Fallback xatlas unwrap also failed: %s", inner_exc)
                unwrapped_mesh = mesh_copy
                backend_used = "xatlas"
                success = False
    elif resolved_backend == "blender_smart":
        try:
            unwrapped_mesh = _unwrap_blender_smart(mesh_copy, runtime_dict)
            backend_used = "blender_smart"
            success = True
        except Exception as exc:
            logger.warning("blender_smart unwrap failed (%s); gracefully falling back to xatlas", exc)
            try:
                unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
                backend_used = "xatlas"
                success = True
            except ValueError:
                raise
            except Exception as inner_exc:
                logger.error("Fallback xatlas unwrap also failed: %s", inner_exc)
                unwrapped_mesh = mesh_copy
                backend_used = "xatlas"
                success = False
    else:
        try:
            unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
            backend_used = "xatlas"
            success = True
        except ValueError:
            raise
        except Exception as exc:
            logger.error("xatlas unwrap failed: %s", exc)
            unwrapped_mesh = mesh_copy
            backend_used = "xatlas"
            success = False

    stats = {
        "backend_used": backend_used,
        "resolved_backend": resolved_backend,
        "triangle_count": triangle_count,
        "success": success,
    }
    return unwrapped_mesh, stats
