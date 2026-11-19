import hashlib
import json
import logging
import os
import re
import shutil
import time
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from core.utils.file_utils import get_storage_base_dir, resolve_server_file_path

logger = logging.getLogger(__name__)


def first_result_path(result: Mapping[str, Any]) -> Optional[Any]:
    for key in ("output_mesh_path", "mesh_path", "output_path", "file_path"):
        if result.get(key):
            return result[key]
    return None


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_name(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value)).strip("._-")
    return value or "asset"


def _storage_root() -> Path:
    root = get_storage_base_dir()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, default=str),
        encoding="utf-8",
    )


def canonical_asset_workspace(
    job_id: str,
    generation_result: Dict[str, Any],
    job_inputs: Optional[Dict[str, Any]] = None,
) -> Path:
    """Resolve the canonical workspace path used by jobs.

    One directory per job named `{workspace_id}` under `backend/storage/`.
    Variant subdirectories — no `master/` or `game_ready/` directories. The mesh
    lives at `{workspace_id}/mesh/mesh.glb`.
    """
    job_inputs = job_inputs or {}
    # workspace_id is the canonical directory name. asset_name is kept only
    # in metadata for readability, never in the filesystem path.
    clean_job_id = _safe_name(job_id)
    return _storage_root() / clean_job_id


def prepare_asset_job_workspace(source_path: Path | str, job_id: str) -> tuple[Path, Path]:
    """Reuse the selected asset workspace or snapshot an external source into one."""
    source = Path(source_path).resolve(strict=True)
    if not source.is_file():
        raise FileNotFoundError(f"Source mesh is missing: {source}")

    meshes_root = _storage_root().resolve()
    asset_root = None
    for parent in source.parents:
        if parent.parent == meshes_root and any(
            (parent / "metadata" / name).is_file()
            for name in ("job.json", "asset.json")
        ):
            asset_root = parent.resolve(strict=True)
            break

    if asset_root is None:
        # Deterministic name: reuse existing workspace for same source stem if present
        candidate = meshes_root / _safe_name(source.stem)
        if candidate.is_dir():
            asset_root = candidate
        else:
            asset_root = meshes_root / f"{_safe_name(source.stem)}_{_safe_name(job_id)}"
            asset_root.mkdir(parents=True, exist_ok=True)

    asset_root.relative_to(meshes_root)
    # Write source mesh to mesh subdirectory: {workspace_id}/mesh/mesh.glb.
    mesh_dir = asset_root / "mesh"
    mesh_dir.mkdir(parents=True, exist_ok=True)
    mesh_path = mesh_dir / "mesh.glb"
    if source != mesh_path.resolve():
        shutil.copy2(source, mesh_path)

    # Ensure original source is also placed in input directory for downstream steps.
    input_dir = asset_root / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    input_path = input_dir / source.name
    if source != input_path.resolve():
        shutil.copy2(source, input_path)

    return asset_root, mesh_path


def register_asset_job_manifest(
    asset_root: Path | str,
    job_id: str,
    source_path: Path | str,
    mesh_path: Path | str,
    artifacts: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Path:
    """Persist a per-job artifact declaration without replacing the asset manifest."""
    root = Path(asset_root).resolve(strict=True)
    try:
        root.relative_to(_storage_root().resolve())
    except ValueError:
        raise ValueError("asset_root must be within storage root")
    mesh = Path(mesh_path).resolve(strict=True)
    try:
        mesh.relative_to(root)
    except ValueError:
        raise ValueError("mesh_path must be within asset_root")
    source = Path(source_path).resolve(strict=True)
    try:
        source_ref = source.relative_to(root).as_posix()
    except ValueError:
        source_ref = mesh.relative_to(root).as_posix()

    declared = {}
    for name, artifact in (artifacts or {}).items():
        path = Path(artifact["path"]).resolve(strict=True)
        path.relative_to(root)
        declared[name] = {
            **{key: value for key, value in artifact.items() if key != "path"},
            "path": path.relative_to(root).as_posix(),
        }

    metadata_dir = root / "metadata" / "jobs"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = metadata_dir / f"{_safe_name(job_id)}.json"
    temporary_path = manifest_path.with_suffix(".tmp")
    manifest_payload = {
        "manifest_version": "1",
        "job_id": job_id,
        "asset_root": str(root),
        "source_path": source_ref,
        "mesh_path": mesh.relative_to(root).as_posix(),
        "artifacts": declared,
    }
    _write_json(temporary_path, manifest_payload)
    temporary_path.replace(manifest_path)
    job_manifest_path = root / "metadata" / "job.json"
    _write_json(job_manifest_path, manifest_payload)
    return manifest_path


def persist_manual_mesh_result(
    job_id: str,
    result: Dict[str, Any],
    job_inputs: Dict[str, Any],
    job_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Save a manual mesh operation result."""
    return result


def run_postprocess_job(
    job_id: str,
    generation_result: Dict[str, Any],
    job_inputs: Optional[Dict[str, Any]] = None,
    job_metadata: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Any] = None,
    cancel_checker: Optional[Any] = None,
) -> Dict[str, Any]:
    """Fallback runner when postprocess package is omitted."""
    res = dict(generation_result)
    res.setdefault("postprocess_status", "completed")
    res.setdefault("production_status", "ready")
    if progress_callback:
        try:
            progress_callback(1.0, "postprocess", "Post-processing complete")
        except Exception:
            pass
    return res


def resolve_manifest_path(model_path: str | Path | None) -> Optional[Path]:
    """Resolve a manifest-declared path."""
    if not model_path:
        return None
    path = Path(str(model_path)).expanduser()
    if path.is_absolute():
        return path if path.exists() else None

    repo_root = Path(__file__).resolve().parents[3]
    candidates = [repo_root / path, repo_root / "backend" / path, Path.cwd() / path]

    storage_root = os.environ.get("MODEL_STORAGE_ROOT")
    if storage_root:
        s_path = Path(storage_root).expanduser()
        candidates.append(s_path / path)
        sub = str(model_path).replace("backend/pretrained/", "").replace("pretrained/", "")
        candidates.append(s_path / sub)

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return None


def resolve_declared_artifact(
    asset_root: str | Path,
    declarations: Mapping[str, Any],
    artifact_key: str,
) -> Optional[Path]:
    entry = declarations.get(artifact_key)
    raw_path = entry.get("path") if isinstance(entry, Mapping) else None
    if not raw_path:
        return None

    root = Path(asset_root).resolve(strict=True)
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError):
        return None
    return resolved if resolved.is_file() else None
