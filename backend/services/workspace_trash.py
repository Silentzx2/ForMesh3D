"""Workspace and derived-asset trash operations with recoverable filesystem moves."""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.utils.file_utils import get_storage_base_dir
from backend.core.scheduler.database_models import AssetModel, JobModel, OperationModel, WorkspaceModel

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_BASE_OPERATION_TYPES = {"generate", "generation", "image_to_mesh", "upload", "import"}


def get_trash_root() -> Path:
    root = Path(tempfile.gettempdir()) / "formesh3d_trash"
    if root.is_symlink():
        raise ValueError("Trash root cannot be a symlink")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    return root


def _validate_safe_id(value: str, label: str) -> str:
    if not value or value in {".", ".."} or value.startswith(".") or not _SAFE_ID_RE.fullmatch(value) or ".." in value:
        raise ValueError(f"Invalid {label}: {value!r}")
    return value


def _ensure_contained(target: Path, root: Path) -> Path:
    root_path = Path(root).resolve()
    candidate = Path(target)
    try:
        relative = candidate.relative_to(Path(root))
    except ValueError:
        relative = candidate.resolve().relative_to(root_path)
    if any(part in {".", ".."} for part in relative.parts):
        raise ValueError("Path traversal is not allowed")
    current = Path(root)
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlink paths are not allowed")
    resolved_target = candidate.resolve()
    resolved_target.relative_to(root_path)
    return resolved_target


def _columns(model: Any) -> List[str]:
    return [column.name for column in model.__table__.columns]


def _serialize_row(row: Any, columns: List[str]) -> Dict[str, Any]:
    result = {}
    for column in columns:
        value = getattr(row, column, None)
        result[column] = value.isoformat() if isinstance(value, datetime) else value
    return result


def _parse_iso(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return value
    return value


def _workspace_jobs(session: Any, workspace_id: str) -> List[Any]:
    """JobModel has no operation foreign key; resolve ownership from its persisted payload."""
    matches = []
    for job in session.query(JobModel).all():
        metadata = job.job_metadata if isinstance(job.job_metadata, dict) else {}
        inputs = job.inputs if isinstance(job.inputs, dict) else {}
        if (
            job.job_id == workspace_id
            or metadata.get("workspace_id") == workspace_id
            or inputs.get("workspace_id") == workspace_id
        ):
            matches.append(job)
    return matches


def _operation_jobs(session: Any, operation_id: str) -> List[Any]:
    matches = []
    for job in session.query(JobModel).all():
        metadata = job.job_metadata if isinstance(job.job_metadata, dict) else {}
        inputs = job.inputs if isinstance(job.inputs, dict) else {}
        if metadata.get("operation_id") == operation_id or inputs.get("operation_id") == operation_id:
            matches.append(job)
    return matches


def _snapshot(workspace: Any, assets: List[Any], operations: List[Any], jobs: List[Any]) -> Dict[str, Any]:
    return {
        "workspace": _serialize_row(workspace, _columns(WorkspaceModel)) if workspace else None,
        "assets": [_serialize_row(row, _columns(AssetModel)) for row in assets],
        "operations": [_serialize_row(row, _columns(OperationModel)) for row in operations],
        "jobs": [_serialize_row(row, _columns(JobModel)) for row in jobs],
    }


def _write_manifest(trash_dir: Path, manifest: Dict[str, Any]) -> None:
    temporary = trash_dir / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    temporary.replace(trash_dir / "manifest.json")


def _stage_directory(permanent: bool) -> tuple[str, Path]:
    trash_id = f"tr_{uuid.uuid4().hex[:12]}"
    name = f".purge_{uuid.uuid4().hex[:12]}" if permanent else trash_id
    directory = get_trash_root() / name
    directory.mkdir(parents=True, exist_ok=False)
    return trash_id, directory


def _rollback_payload(stage_dir: Path, original_path: Path) -> None:
    payload = stage_dir / "payload"
    if payload.exists() and not original_path.exists():
        original_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(payload), str(original_path))
    shutil.rmtree(stage_dir, ignore_errors=True)


def trash_workspace(db_manager: Any, workspace_id: str, permanent: bool = False) -> Dict[str, Any]:
    """Remove a workspace from SQLite and storage, retaining a restorable snapshot unless permanent."""
    _validate_safe_id(workspace_id, "workspace_id")
    storage_root = get_storage_base_dir().resolve()
    workspace_dir = _ensure_contained(storage_root / workspace_id, storage_root)

    with db_manager.get_session() as session:
        workspace = session.query(WorkspaceModel).filter(
            WorkspaceModel.workspace_id == workspace_id
        ).first()
        assets = session.query(AssetModel).filter(AssetModel.workspace_id == workspace_id).all()
        operations = session.query(OperationModel).filter(
            OperationModel.workspace_id == workspace_id
        ).all()
        jobs = _workspace_jobs(session, workspace_id)
        if workspace is None and not assets and not operations and not jobs and not workspace_dir.exists():
            raise FileNotFoundError(f"Workspace not found: {workspace_id}")

        snapshot = _snapshot(workspace, assets, operations, jobs)
        trash_id, stage_dir = _stage_directory(permanent)
        payload_present = workspace_dir.exists()

        try:
            if payload_present:
                shutil.move(str(workspace_dir), str(stage_dir / "payload"))

            if not permanent:
                active_asset = next(
                    (asset for asset in assets if workspace and asset.asset_id == workspace.active_mesh_asset_id),
                    assets[0] if assets else None,
                )
                _write_manifest(
                    stage_dir,
                    {
                        "trash_id": trash_id,
                        "kind": "workspace",
                        "workspace_id": workspace_id,
                        "asset_id": active_asset.asset_id if active_asset else None,
                        "name": workspace.name if workspace and workspace.name else workspace_id,
                        "asset_type": "workspace",
                        "operation_type": "generate",
                        "trashed_at": datetime.now(timezone.utc).isoformat(),
                        "original_rel_path": workspace_id,
                        "payload_present": payload_present,
                        "db_snapshot": snapshot,
                    },
                )

            session.query(AssetModel).filter(
                AssetModel.workspace_id == workspace_id
            ).delete(synchronize_session=False)
            session.query(OperationModel).filter(
                OperationModel.workspace_id == workspace_id
            ).delete(synchronize_session=False)
            for job in jobs:
                session.delete(job)
            if workspace is not None:
                session.delete(workspace)
            session.commit()
        except Exception:
            session.rollback()
            _rollback_payload(stage_dir, workspace_dir)
            raise

    cleanup_pending = False
    if permanent:
        shutil.rmtree(stage_dir, ignore_errors=True)
        cleanup_pending = stage_dir.exists()
    return {
        "success": True,
        "kind": "workspace",
        "workspace_id": workspace_id,
        "permanent": permanent,
        "trash_id": None if permanent else trash_id,
        "cleanup_pending": cleanup_pending,
    }


def trash_workspace_asset(
    db_manager: Any, workspace_id: str, asset_id: str, permanent: bool = False
) -> Dict[str, Any]:
    """Remove one derived asset while preserving shared operation lineage."""
    _validate_safe_id(workspace_id, "workspace_id")
    _validate_safe_id(asset_id, "asset_id")
    storage_root = get_storage_base_dir().resolve()
    workspace_dir = _ensure_contained(storage_root / workspace_id, storage_root)

    with db_manager.get_session() as session:
        asset = session.query(AssetModel).filter(
            AssetModel.workspace_id == workspace_id,
            AssetModel.asset_id == asset_id,
        ).first()
        if asset is None:
            raise FileNotFoundError(f"Asset {asset_id} not found in workspace {workspace_id}")

        operation_type = (asset.operation_type or "").strip().lower()
        if (
            asset.asset_type in {"base_mesh", "source_mesh"}
            or operation_type in _BASE_OPERATION_TYPES
            or not operation_type
        ):
            raise ValueError("Base mesh cannot be deleted individually; delete the workspace instead.")

        relative_path = (asset.relative_path or "").lstrip("/")
        if not relative_path:
            raise ValueError("Asset has no retained relative path")
        target = _ensure_contained(workspace_dir / relative_path, workspace_dir)
        if not target.exists():
            raise FileNotFoundError(f"Asset file not found: {asset_id}")

        move_target = target
        parts = Path(relative_path).parts
        if asset.asset_type == "animated_mesh" and len(parts) >= 3 and parts[0] == "animation":
            move_target = _ensure_contained(workspace_dir / parts[0] / parts[1], workspace_dir)
        move_relative_path = str(move_target.relative_to(workspace_dir))

        operation = None
        delete_operation = False
        jobs: List[Any] = []
        if asset.operation_id:
            operation = session.query(OperationModel).filter(
                OperationModel.operation_id == asset.operation_id
            ).first()
            if operation is not None:
                sibling = session.query(AssetModel).filter(
                    AssetModel.operation_id == asset.operation_id,
                    AssetModel.asset_id != asset_id,
                ).first()
                child = session.query(OperationModel).filter(
                    OperationModel.parent_operation_id == asset.operation_id
                ).first()
                delete_operation = sibling is None and child is None
                if delete_operation:
                    jobs = _operation_jobs(session, asset.operation_id)

        snapshot = _snapshot(
            None,
            [asset],
            [operation] if operation is not None and delete_operation else [],
            jobs,
        )
        trash_id, stage_dir = _stage_directory(permanent)
        try:
            shutil.move(str(move_target), str(stage_dir / "payload"))
            if not permanent:
                _write_manifest(
                    stage_dir,
                    {
                        "trash_id": trash_id,
                        "kind": "asset",
                        "workspace_id": workspace_id,
                        "asset_id": asset_id,
                        "name": asset.original_filename or asset_id,
                        "asset_type": asset.asset_type,
                        "operation_type": asset.operation_type or (operation.operation_type if operation else None),
                        "trashed_at": datetime.now(timezone.utc).isoformat(),
                        "original_rel_path": move_relative_path,
                        "payload_present": True,
                        "db_snapshot": snapshot,
                    },
                )

            session.delete(asset)
            if operation is not None and delete_operation:
                session.delete(operation)
            for job in jobs:
                session.delete(job)
            session.commit()
        except Exception:
            session.rollback()
            _rollback_payload(stage_dir, move_target)
            raise

    cleanup_pending = False
    if permanent:
        shutil.rmtree(stage_dir, ignore_errors=True)
        cleanup_pending = stage_dir.exists()
    return {
        "success": True,
        "kind": "asset",
        "workspace_id": workspace_id,
        "asset_id": asset_id,
        "permanent": permanent,
        "trash_id": None if permanent else trash_id,
        "cleanup_pending": cleanup_pending,
    }


def list_trash() -> List[Dict[str, Any]]:
    root = get_trash_root()
    items: List[Dict[str, Any]] = []
    for entry in sorted(root.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True):
        if not entry.is_dir() or entry.is_symlink():
            continue
        manifest_path = entry / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            items.append(
                {
                    "trash_id": data.get("trash_id", entry.name),
                    "kind": data.get("kind", "workspace"),
                    "workspace_id": data.get("workspace_id"),
                    "asset_id": data.get("asset_id"),
                    "name": data.get("name", entry.name),
                    "asset_type": data.get("asset_type"),
                    "operation_type": data.get("operation_type"),
                    "trashed_at": data.get("trashed_at"),
                }
            )
        except (OSError, ValueError, TypeError):
            continue
    return items


def _assert_snapshot_ids_available(session: Any, snapshot: Dict[str, Any]) -> None:
    workspace_data = snapshot.get("workspace")
    if workspace_data and session.query(WorkspaceModel).filter(
        WorkspaceModel.workspace_id == workspace_data["workspace_id"]
    ).first():
        raise FileExistsError(f"Workspace already exists: {workspace_data['workspace_id']}")

    for model, key, collection in (
        (AssetModel, "asset_id", "assets"),
        (OperationModel, "operation_id", "operations"),
        (JobModel, "job_id", "jobs"),
    ):
        for row in snapshot.get(collection, []):
            if session.query(model).filter(getattr(model, key) == row[key]).first():
                raise FileExistsError(f"Cannot restore: {key} already exists: {row[key]}")


def _add_snapshot_rows(session: Any, snapshot: Dict[str, Any]) -> None:
    workspace_data = snapshot.get("workspace")
    if workspace_data:
        session.add(
            WorkspaceModel(
                **{
                    key: _parse_iso(value)
                    for key, value in workspace_data.items()
                    if key in _columns(WorkspaceModel)
                }
            )
        )
    for model, collection in (
        (JobModel, "jobs"),
        (OperationModel, "operations"),
        (AssetModel, "assets"),
    ):
        for row in snapshot.get(collection, []):
            session.add(
                model(
                    **{
                        key: _parse_iso(value)
                        for key, value in row.items()
                        if key in _columns(model)
                    }
                )
            )


def restore_trash_item(db_manager: Any, trash_id: str) -> Dict[str, Any]:
    _validate_safe_id(trash_id, "trash_id")
    root = get_trash_root().resolve()
    trash_dir = _ensure_contained(root / trash_id, root)
    if trash_dir.is_symlink() or not trash_dir.is_dir():
        raise FileNotFoundError(f"Trash item not found: {trash_id}")
    manifest_path = trash_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Trash item not found: {trash_id}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    workspace_id = _validate_safe_id(manifest.get("workspace_id"), "workspace_id")
    storage_root = get_storage_base_dir().resolve()
    workspace_dir = _ensure_contained(storage_root / workspace_id, storage_root)
    payload = trash_dir / "payload"
    if payload.is_symlink():
        raise ValueError("Trash payload cannot be a symlink")
    payload_present = bool(manifest.get("payload_present", payload.exists()))
    snapshot = manifest.get("db_snapshot") or {}
    kind = manifest.get("kind")

    if kind == "workspace":
        if workspace_dir.exists():
            raise FileExistsError(f"Workspace directory already exists: {workspace_id}")
        if payload_present and not payload.exists():
            raise FileNotFoundError(f"Workspace payload is missing: {workspace_id}")
    elif kind == "asset":
        if not snapshot.get("assets"):
            raise ValueError("Trash snapshot does not contain an asset")
        if not payload_present or not payload.exists():
            raise FileNotFoundError(f"Asset payload is missing: {trash_id}")
    else:
        raise ValueError("Unsupported trash item kind")

    moved_to: Optional[Path] = None
    try:
        with db_manager.get_session() as session:
            if kind == "asset":
                workspace = session.query(WorkspaceModel).filter(
                    WorkspaceModel.workspace_id == workspace_id
                ).first()
                if workspace is None:
                    raise FileNotFoundError(f"Workspace not found: {workspace_id}")
                workspace_dir.mkdir(parents=True, exist_ok=True)
                relative_path = (manifest.get("original_rel_path") or "").lstrip("/")
                if not relative_path:
                    raise ValueError("Trash manifest has no original asset path")
                destination = _ensure_contained(workspace_dir / relative_path, workspace_dir)
                if destination.exists():
                    raise FileExistsError(f"Asset destination already exists: {relative_path}")
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(payload), str(destination))
                moved_to = destination
            elif payload_present:
                shutil.move(str(payload), str(workspace_dir))
                moved_to = workspace_dir

            _assert_snapshot_ids_available(session, snapshot)
            _add_snapshot_rows(session, snapshot)
            session.commit()
    except Exception:
        if moved_to is not None and moved_to.exists() and not payload.exists():
            payload.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(moved_to), str(payload))
        raise

    shutil.rmtree(trash_dir, ignore_errors=True)
    return {
        "success": True,
        "trash_id": trash_id,
        "kind": kind,
        "workspace_id": workspace_id,
        "asset_id": manifest.get("asset_id"),
        "cleanup_pending": trash_dir.exists(),
    }


def purge_trash_item(trash_id: str) -> Dict[str, Any]:
    _validate_safe_id(trash_id, "trash_id")
    root = get_trash_root().resolve()
    trash_dir = _ensure_contained(root / trash_id, root)
    if trash_dir.is_symlink() or not trash_dir.is_dir():
        raise FileNotFoundError(f"Trash item not found: {trash_id}")
    shutil.rmtree(trash_dir)
    return {"success": True, "trash_id": trash_id}


def empty_trash() -> Dict[str, Any]:
    root = get_trash_root()
    removed = 0
    for entry in list(root.iterdir()):
        if entry.is_symlink():
            entry.unlink(missing_ok=True)
        elif entry.is_dir():
            shutil.rmtree(entry)
            removed += 1
    return {"success": True, "removed": removed}
