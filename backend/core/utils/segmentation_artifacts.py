"""Durable publication of PartField's optional per-part mesh exports."""
from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable


def persist_individual_parts(
    source_paths: Iterable[str],
    source_mesh_path: Path,
    published_mesh_path: Path,
    workspace_dir: Path,
) -> Dict[str, Any]:
    """Copy adapter-owned part files into a versioned workspace folder and ZIP them."""
    source_mesh = Path(source_mesh_path).resolve()
    published_mesh = Path(published_mesh_path).resolve()
    workspace_root = Path(workspace_dir).resolve()

    if not source_mesh.is_file():
        raise FileNotFoundError(f"Segmentation source mesh does not exist: {source_mesh}")
    if not published_mesh.is_file() or not published_mesh.is_relative_to(workspace_root):
        raise ValueError("Published segmentation mesh must be inside its workspace")

    expected_source_dir = (source_mesh.parent / f"{source_mesh.stem}_parts").resolve()
    destination_dir = published_mesh.parent / f"{published_mesh.stem}_parts"
    if not destination_dir.resolve().is_relative_to(workspace_root):
        raise ValueError("Individual part destination is outside its workspace")
    if destination_dir.exists():
        raise FileExistsError(f"Segmentation parts destination already exists: {destination_dir}")

    source_files = [Path(raw_path).resolve() for raw_path in source_paths]
    if not source_files:
        return {
            "individual_part_paths": [],
            "individual_part_relative_paths": [],
            "parts_archive_path": None,
            "parts_archive_relative_path": None,
            "individual_part_count": 0,
        }

    for source in source_files:
        if source.parent != expected_source_dir or not source.is_file():
            raise ValueError(f"Individual part path is missing or outside adapter output: {source}")
        if source.suffix.lower() not in {".glb", ".obj"}:
            raise ValueError(f"Unsupported individual part format: {source.suffix}")

    staging_archive = published_mesh.parent / f".{published_mesh.stem}_parts_{uuid.uuid4().hex}.tmp"
    persisted_paths = []
    try:
        destination_dir.mkdir(parents=True, exist_ok=False)
        for source in source_files:
            destination = destination_dir / source.name
            staging_file = destination_dir / f".{source.name}.{uuid.uuid4().hex}.tmp"
            shutil.copy2(source, staging_file)
            staging_file.replace(destination)
            persisted_paths.append(destination)

        archive_path = published_mesh.parent / f"{published_mesh.stem}_parts.zip"
        with zipfile.ZipFile(
            staging_archive,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            for part_path in persisted_paths:
                archive.write(part_path, arcname=f"{destination_dir.name}/{part_path.name}")
        staging_archive.replace(archive_path)

        return {
            "individual_part_paths": [str(path) for path in persisted_paths],
            "individual_part_relative_paths": [
                str(path.relative_to(workspace_root)) for path in persisted_paths
            ],
            "parts_archive_path": str(archive_path),
            "parts_archive_relative_path": str(archive_path.relative_to(workspace_root)),
            "individual_part_count": len(persisted_paths),
        }
    except Exception:
        staging_archive.unlink(missing_ok=True)
        shutil.rmtree(destination_dir, ignore_errors=True)
        raise
