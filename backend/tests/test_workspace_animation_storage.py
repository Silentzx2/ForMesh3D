from pathlib import Path

import pytest

from core.utils.file_utils import WorkspaceStorageManager


def test_animation_exports_are_published_as_immutable_versions(tmp_path: Path) -> None:
    storage = WorkspaceStorageManager(tmp_path / "storage")
    storage.create_workspace_tree("fox_abc123")

    glb = tmp_path / "animated.glb"
    npz = tmp_path / "motion.npz"
    glb.write_bytes(b"glb-binary")
    npz.write_bytes(b"npz-source")

    first = storage.publish_animation_asset("fox_abc123", "Walking", glb, npz)
    second = storage.publish_animation_asset("fox_abc123", "Walking", glb, npz)

    assert first["relative_mesh_path"] == "animation/walking_v001/animated.glb"
    assert first["relative_motion_path"] == "animation/walking_v001/motion.npz"
    assert second["relative_mesh_path"] == "animation/walking_v002/animated.glb"
    assert first["mesh_path"].read_bytes() == b"glb-binary"
    assert first["motion_path"].read_bytes() == b"npz-source"
    assert second["mesh_path"].read_bytes() == b"glb-binary"


def test_animation_publication_rejects_workspace_escape_symlink(tmp_path: Path) -> None:
    storage = WorkspaceStorageManager(tmp_path / "storage")
    workspace = storage.create_workspace_tree("fox_abc123")
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspace / "animation").symlink_to(outside, target_is_directory=True)

    glb = tmp_path / "animated.glb"
    npz = tmp_path / "motion.npz"
    glb.write_bytes(b"glb-binary")
    npz.write_bytes(b"npz-source")

    with pytest.raises(ValueError, match="outside its workspace"):
        storage.publish_animation_asset("fox_abc123", "Walking", glb, npz)

    assert list(outside.iterdir()) == []
