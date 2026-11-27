"""Workspace and asset trash/deletion service backed by temp storage (/tmp/formesh3d_trash)."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.config import get_storage_base_dir
from backend.core.scheduler.database_models import (
    AssetModel,
    JobModel,
    OperationModel,
    WorkspaceModel,
)

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def get_trash_root() -> Path:
    root = Path(tempfile.gettempdir()) / "formesh3d_trash"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _validate_safe_id(value: str, label: str) -> str:
    if not value or not _SAFE_ID_RE.match(value) or ".." in value:
        raise ValueError(f"Invalid {label}: {value!r}")
    return value


def _ensure_contained(target: Path, root: Path) -> Path:
    resolved_root = root.resolve()
    resolved_target = target.resolve()
    resolved_target.relative_to(resolved_root)
    return resolved_target


def _serialize_row(row: Any, columns: List[str]) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    for col in columns:
        val = getattr(row, col, None)
        if isinstance(val, datetime):
            data[col] = val.isoformat()
        else:
            data[col] = val
    return data


def _parse_iso(val: Any) -> Any:
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val)
        except ValueError:
            return val
    return val


def _workspace_columns() -> List[str]:
    return [c.name for c in WorkspaceModel.__table__.columns]


def _asset_columns() -> List[str]:
    return [c.name for c in AssetModel.__table__.columns]


def _operation_columns() -> List[str]:
    return [c.name for c in OperationModel.__table__.columns]


def _job_columns() -> List[str]:
    return [c.name for c in JobModel.__table__.columns]


def trash_workspace(
    db_manager: Any,
    workspace_id: str,
    permanent: bool = False,
) -> Dict[str, Any]:
    """Delete or soft-trash an entire workspace (SQLite rows + backend/storage/<workspace_id>/)."""
    _validate_safe_id(workspace_id, "workspace_id")
    storage_root = get_storage_base_dir().resolve()
    ws_dir = _ensure_contained(storage_root / workspace_id, storage_root)

    with db_manager.get_session() as session:
        ws = session.query(WorkspaceModel).filter(WorkspaceModel.workspace_id == workspace_id).first()
        assets = session.query(AssetModel).filter(AssetModel.workspace_id == workspace_id).all()
        ops = session.query(OperationModel).filter(OperationModel.workspace_id == workspace_id).all()
        job_ids = {op.backend_job_id for op in ops if op.backend_job_id}
        job_ids.add(workspace_id)
        jobs = session.query(JobModel).filter(JobModel.job_id.in_(list(job_ids))).all()

        if ws is None and not assets and not ops and not ws_dir.exists():
            raise FileNotFoundError(f"Workspace not found: {workspace_id}")

        snapshot = {
            "workspace": _serialize_row(ws, _workspace_columns()) if ws else None,
            "assets": [_serialize_row(a, _asset_columns()) for a in assets],
            "operations": [_serialize_row(o, _operation_columns()) for o in ops],
            "jobs": [_serialize_row(j, _job_columns()) for j in jobs],
        }

        trash_id: Optional[str] = None
        if not permanent:
            trash_id = f"tr_{uuid.uuid4().hex[:12]}"
            trash_dir = get_trash_root() / trash_id
            trash_dir.mkdir(parents=True, exist_ok=True)
            payload_dir = trash_dir / "payload"
            if ws_dir.exists():
                shutil.move(str(ws_dir), str(payload_dir))

            base_asset = next((a for a in assets if a.is_base), assets[0] if assets else None)
            manifest = {
                "trash_id": trash_id,
                "kind": "workspace",
                "workspace_id": workspace_id,
                "asset_id": base_asset.asset_id if base_asset else None,
                "name": (ws.prompt if ws and ws.prompt else None) or workspace_id,
                "asset_type": "workspace",
                "operation_type": "generate",
                "trashed_at": datetime.now(timezone.utc).isoformat(),
                "original_rel_path": workspace_id,
                "db_snapshot": snapshot,
            }
            (trash_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        else:
            if ws_dir.exists():
                shutil.rmtree(ws_dir, ignore_errors=True)

        # Remove DB records so workspace vanishes from Assets, History, and Mesh Version selector
        session.query(AssetModel).filter(AssetModel.workspace_id == workspace_id).delete(synchronize_session=False)
        session.query(OperationModel).filter(OperationModel.workspace_id == workspace_id).delete(synchronize_session=False)
        session.query(JobModel).filter(JobModel.job_id.in_(list(job_ids))).delete(synchronize_session=False)
        if ws is not None:
            session.delete(ws)
        session.commit()

    return {
        "success": True,
        "kind": "workspace",
        "workspace_id": workspace_id,
        "permanent": permanent,
        "trash_id": trash_id,
    }


def trash_workspace_asset(
    db_manager: Any,
    workspace_id: str,
    asset_id: str,
    permanent: bool = False,
) -> Dict[str, Any]:
    """Delete or soft-trash a single derived asset/version inside a workspace."""
    _validate_safe_id(workspace_id, "workspace_id")
    _validate_safe_id(asset_id, "asset_id")
    storage_root = get_storage_base_dir().resolve()
    ws_dir = _ensure_contained(storage_root / workspace_id, storage_root)

    with db_manager.get_session() as session:
        asset = (
            session.query(AssetModel)
            .filter(AssetModel.workspace_id == workspace_id, AssetModel.asset_id == asset_id)
            .first()
        )
        if asset is None:
            raise FileNotFoundError(f"Asset {asset_id} not found in workspace {workspace_id}")
        if asset.is_base:
            raise ValueError("Base mesh cannot be deleted individually; delete the workspace instead.")

        op = None
        if asset.operation_id:
            op = (
                session.query(OperationModel)
                .filter(OperationModel.operation_id == asset.operation_id)
                .first()
            )
        job = None
        if op and op.backend_job_id:
            job = session.query(JobModel).filter(JobModel.job_id == op.backend_job_id).first()

        rel_path = (asset.relative_path or "").lstrip("/")
        target_path = _ensure_contained(ws_dir / rel_path, ws_dir) if rel_path else None

        # For animated_mesh folders (animation/<clip>_vNNN/animated.glb), move/remove the version folder
        move_target = target_path
        move_rel = rel_path
        if target_path and asset.asset_type == "animated_mesh" and target_path.parent.parent.name == "animation":
            move_target = target_path.parent
            move_rel = str(move_target.relative_to(ws_dir))

        snapshot = {
            "workspace": None,
            "assets": [_serialize_row(asset, _asset_columns())],
            "operations": [_serialize_row(op, _operation_columns())] if op else [],
            "jobs": [_serialize_row(job, _job_columns())] if job else [],
        }

        trash_id: Optional[str] = None
        if not permanent:
            trash_id = f"tr_{uuid.uuid4().hex[:12]}"
            trash_dir = get_trash_root() / trash_id
            trash_dir.mkdir(parents=True, exist_ok=True)
            if move_target and move_target.exists():
                dest = trash_dir / "payload"
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(move_target), str(dest))

            manifest = {
                "trash_id": trash_id,
                "kind": "asset",
                "workspace_id": workspace_id,
                "asset_id": asset_id,
                "name": asset.name or asset.version_label or asset_id,
                "asset_type": asset.asset_type,
                "operation_type": asset.operation_type or (op.operation_type if op else None),
                "trashed_at": datetime.now(timezone.utc).isoformat(),
                "original_rel_path": move_rel,
                "db_snapshot": snapshot,
            }
            (trash_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        else:
            if move_target and move_target.exists():
                if move_target.is_dir():
                    shutil.rmtree(move_target, ignore_errors=True)
                else:
                    move_target.unlink(missing_ok=True)

        session.delete(asset)
        if op is not None:
            session.delete(op)
        if job is not None:
            session.delete(job)
        session.commit()

    return {
        "success": True,
        "kind": "asset",
        "workspace_id": workspace_id,
        "asset_id": asset_id,
        "permanent": permanent,
        "trash_id": trash_id,
    }


def list_trash() -> List[Dict[str, Any]]:
    root = get_trash_root()
    items: List[Dict[str, Any]] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not entry.is_dir():
            continue
        manifest_path = entry / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            items.append({
                "trash_id": data.get("trash_id", entry.name),
                "kind": data.get("kind", "workspace"),
                "workspace_id": data.get("workspace_id"),
                "asset_id": data.get("asset_id"),
                "name": data.get("name", entry.name),
                "asset_type": data.get("asset_type"),
                "operation_type": data.get("operation_type"),
                "trashed_at": data.get("trashed_at"),
            })
        except Exception:
            continue
    return items


def restore_trash_item(db_manager: Any, trash_id: str) -> Dict[str, Any]:
    _validate_safe_id(trash_id, "trash_id")
    root = get_trash_root().resolve()
    trash_dir = _ensure_contained(root / trash_id, root)
    manifest_path = trash_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Trash item not found: {trash_id}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    storage_root = get_storage_base_dir().resolve()
    workspace_id = _validate_safe_id(manifest["workspace_id"], "workspace_id")
    ws_dir = _ensure_contained(storage_root / workspace_id, storage_root)
    payload_path = trash_dir / "payload"

    if manifest.get("kind") == "workspace":
        if ws_dir.exists():
            raise FileExistsError(f"Workspace directory already exists: {workspace_id}")
        if payload_path.exists():
            shutil.move(str(payload_path), str(ws_dir))
    else:
        rel = (manifest.get("original_rel_path") or "").lstrip("/")
        if rel and payload_path.exists():
            ws_dir.mkdir(parents=True, exist_ok=True)
            dest = _ensure_contained(ws_dir / rel, ws_dir)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(payload_path), str(dest))

    snapshot = manifest.get("db_snapshot") or {}
    with db_manager.get_session() as session:
        ws_data = snapshot.get("workspace")
        if ws_data and not session.query(WorkspaceModel).filter(WorkspaceModel.workspace_id == workspace_id).first():
            ws_kwargs = {k: _parse_iso(v) for k, v in ws_data.items() if k in _workspace_columns()}
            session.add(WorkspaceModel(**ws_kwargs))

        for job_data in snapshot.get("jobs", []):
            jid = job_data.get("job_id")
            if jid and not session.query(JobModel).filter(JobModel.job_id == jid).first():
                session.add(JobModel(**{k: _parse_iso(v) for k, v in job_data.items() if k in _job_columns()}))

        for op_data in snapshot.get("operations", []):
            oid = op_data.get("operation_id")
            if oid and not session.query(OperationModel).filter(OperationModel.operation_id == oid).first():
                session.add(OperationModel(**{k: _parse_iso(v) for k, v in op_data.items() if k in _operation_columns()}))

        for asset_data in snapshot.get("assets", []):
            aid = asset_data.get("asset_id")
            if aid and not session.query(AssetModel).filter(AssetModel.asset_id == aid).first():
                session.add(AssetModel(**{k: _parse_iso(v) for k, v in asset_data.items() if k in _asset_columns()}))

        session.commit()

    shutil.rmtree(trash_dir, ignore_errors=True)
    return {
        "success": True,
        "trash_id": trash_id,
        "kind": manifest.get("kind"),
        "workspace_id": workspace_id,
        "asset_id": manifest.get("asset_id"),
    }


def purge_trash_item(trash_id: str) -> Dict[str, Any]:
    _validate_safe_id(trash_id, "trash_id")
    root = get_trash_root().resolve()
    trash_dir = _ensure_contained(root / trash_id, root)
    if not trash_dir.exists():
        raise FileNotFoundError(f"Trash item not found: {trash_id}")
    shutil.rmtree(trash_dir, ignore_errors=True)
    return {"success": True, "trash_id": trash_id}


def empty_trash() -> Dict[str, Any]:
    root = get_trash_root()
    removed = 0
    for entry in list(root.iterdir()):
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return {"success": True, "removed": removed}
