"""
Patcher for TripoSG: ensures the generated GLB mesh is saved to the canonical
ForMesh3D storage system so artifact downloads resolve correctly.

The TripoSG adapter writes the mesh to a temp directory (tempfile.mkdtemp()).
This patcher wraps _process_request so that, on success, the mesh file is also
copied into the canonical storage root (get_storage_base_dir()/models/meshes/)
and the result's output_mesh_path/mesh_path point at the canonical copy.
The scheduler then copies it into the per-job workspace
(storage_root/models/meshes/<job_id>/) for artifact download.

This patcher runs strictly inside the TripoSG worker process — it is imported
from triposg_adapter._load_model() and never affects other models.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)


def apply_patch() -> None:
    """Patch TripoSGImageToRawMeshAdapter._process_request in place.

    Safe to call multiple times; only patches if not already patched.
    """
    try:
        from backend.adapters.triposg_adapter import (
            TripoSGImageToRawMeshAdapter,
        )
        from backend.core.utils.file_utils import get_storage_base_dir
    except Exception as exc:  # pragma: no cover - import failure is non-fatal
        logger.warning(
            "TripoSG output-to-storage patcher could not import dependencies: %s",
            exc,
        )
        return

    # Already patched guard
    if getattr(TripoSGImageToRawMeshAdapter._process_request, "_triposg_storage_patched", False):
        return

    original_process_request = TripoSGImageToRawMeshAdapter._process_request

    def patched_process_request(
        self: Any, inputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        result = original_process_request(self, inputs)
        if not result.get("success"):
            return result

        mesh_path = (
            result.get("output_mesh_path")
            or result.get("mesh_path")
            or result.get("output_path")
            or result.get("file_path")
        )
        if not mesh_path:
            return result

        src = Path(mesh_path)
        if not src.is_file():
            logger.warning(
                "TripoSG output_mesh_path does not point to an existing file: %s",
                mesh_path,
            )
            return result

        try:
            storage_root = get_storage_base_dir()
            canonical_dir = (
                storage_root / "models" / "meshes" / "triposg_output"
            )
            canonical_dir.mkdir(parents=True, exist_ok=True)
            dst = canonical_dir / f"{uuid.uuid4().hex}_{src.name}"
            if not dst.exists():
                shutil.copy2(str(src), str(dst))
            result["output_mesh_path"] = str(dst)
            result["mesh_path"] = str(dst)
            logger.info(
                "TripoSG output mesh copied to canonical storage: %s", dst
            )
        except Exception as exc:  # pragma: no cover - storage failure is non-fatal
            logger.warning(
                "TripoSG output-to-storage patcher failed to copy mesh: %s", exc
            )

        return result

    patched_process_request._triposg_storage_patched = True  # type: ignore[attr-defined]
    TripoSGImageToRawMeshAdapter._process_request = patched_process_request  # type: ignore[method-assign]
    logger.info("TripoSG output-to-storage patcher applied.")
