"""Immutable workspace persistence for manually oriented mesh versions."""
from __future__ import annotations
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from core.scheduler.database_manager import ProcessFileLock
from core.scheduler.database_models import AssetModel, WorkspaceModel, generate_asset_id

logger = logging.getLogger(__name__)


def persist_oriented_workspace_mesh(
    db: Any, storage_manager: Any, workspace_id: str, source_asset_id: str,
    temp_mesh_path: Path, temp_thumbnail_path: Optional[Path], byte_size: int, sha256: str,
) -> Dict[str, Any]:
    """Publish an immutable orientation asset and atomically make it active."""
    storage_manager.assert_safe_id(workspace_id)
    storage_manager.assert_safe_id(source_asset_id)
    workspace_dir = storage_manager.get_workspace_dir(workspace_id)

    with ProcessFileLock(lock_path=storage_manager.storage_root / ".workspace_persistence.lock"):
        workspace = db.get_workspace(workspace_id)
        source = db.get_asset(source_asset_id)
        if not workspace or not source or source.workspace_id != workspace_id:
            raise ValueError("Source mesh does not belong to this workspace")
        if source.file_type != "mesh" or not source.is_retained or source.status != "available":
            raise ValueError("Only retained workspace meshes can be oriented")
        source_path = (workspace_dir / source.relative_path).resolve()
        if not source_path.is_relative_to(workspace_dir) or not source_path.is_file():
            raise FileNotFoundError("Source mesh file is missing or outside its workspace")

        published = storage_manager.publish_derived_mesh(
            workspace_id=workspace_id, operation_type="orientation",
            temp_mesh_path=Path(temp_mesh_path),
            temp_thumbnail_path=Path(temp_thumbnail_path) if temp_thumbnail_path else None,
        )
        asset_id = generate_asset_id()
        stem = Path(source.original_filename or "mesh").stem or "mesh"
        committed = False
        try:
            with db.get_session() as session:
                workspace_row = session.query(WorkspaceModel).filter_by(workspace_id=workspace_id).first()
                source_row = session.query(AssetModel).filter_by(
                    asset_id=source_asset_id, workspace_id=workspace_id
                ).first()
                if not workspace_row or not source_row:
                    raise ValueError("Workspace or source mesh changed while orientation was being saved")
                if source_row.file_type != "mesh" or not source_row.is_retained or source_row.status != "available":
                    raise ValueError("Source mesh is no longer available")
                asset = AssetModel(
                    asset_id=asset_id, workspace_id=workspace_id, operation_id=None,
                    operation_type="orientation", asset_type="oriented_mesh",
                    source_asset_id=source_asset_id, file_type="mesh",
                    relative_path=published["relative_mesh_path"],
                    original_filename=f"{stem}_oriented.glb", byte_size=int(byte_size),
                    sha256=sha256, thumbnail_path=published.get("relative_thumbnail_path"),
                    is_retained=1, status="available", created_at=datetime.utcnow(),
                )
                session.add(asset)
                workspace_row.active_mesh_asset_id = asset_id
                workspace_row.updated_at = datetime.utcnow()
                session.commit()
                committed = True
                session.refresh(asset)
                asset_data = asset.to_dict()

            try:
                storage_manager.build_manifest_projection(workspace_id, db)
            except Exception as exc:
                logger.warning("Could not refresh workspace manifest after orientation save: %s", exc)
            return {
                "success": True, "workspace_id": workspace_id, "active_mesh_asset_id": asset_id,
                "asset": asset_data,
                "url": f"/api/v1/system/jobs/{asset_id}/download",
                "thumbnail_url": (
                    f"/api/v1/system/jobs/{asset_id}/thumbnail"
                    if published.get("relative_thumbnail_path") else None
                ),
            }
        except Exception:
            if not committed:
                for key in ("mesh_path", "thumbnail_path"):
                    path = published.get(key)
                    if path:
                        try:
                            Path(path).unlink(missing_ok=True)
                        except OSError:
                            logger.warning("Could not clean failed orientation output %s", path)
            raise
