"""Backend Pipelines Module.

Centralized engine pipelines for 3D processing (generation, retopology, UV, texturing, rigging, etc).
"""

from .mesh_guard import (
    GLOBAL_MAX_FACES,
    guard_mesh_density,
    process_generation_output,
)
from .mesh_utils import (
    compute_mesh_stats,
    export_mesh_safe,
    load_mesh_safe,
    to_single_trimesh,
)

__all__ = [
    "GLOBAL_MAX_FACES",
    "guard_mesh_density",
    "process_generation_output",
    "compute_mesh_stats",
    "export_mesh_safe",
    "load_mesh_safe",
    "to_single_trimesh",
]
