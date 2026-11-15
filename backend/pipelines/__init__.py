"""Backend Pipelines Module.

Centralized engine pipelines for 3D processing (generation, retopology, UV, texturing, rigging, etc).
"""

from .mesh_guard import (
    GLOBAL_MAX_FACES,
    guard_mesh_density,
    process_generation_output,
)

__all__ = [
    "GLOBAL_MAX_FACES",
    "guard_mesh_density",
    "process_generation_output",
]
