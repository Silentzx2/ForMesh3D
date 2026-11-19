"""
Patcher for TripoSG: ensures the generated GLB mesh is saved to the canonical
ForMesh3D workspace storage system.

TripoSG raw mesh generation adheres strictly to the canonical ForMesh3D
workspace storage architecture: the adapter exports to a managed temporary
file (tempfile.mkdtemp(prefix="triposg_")), and the multiprocess scheduler
persists and registers the output directly into the canonical workspace
directory (storage/<workspace_id>/mesh/mesh.glb).

This patcher module provides an idempotent apply_patch() function for
compatibility with the model patcher lifecycle without creating rogue
subdirectories.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def apply_patch() -> None:
    """Ensure TripoSG adheres to canonical workspace storage.

    TripoSG directly exports temporary GLBs that the multiprocess scheduler
    promotes into storage/<workspace_id>/mesh/mesh.glb. No monkeypatching or
    custom output directories are needed.
    """
    logger.debug("TripoSG output-to-storage: canonical workspace storage active.")
