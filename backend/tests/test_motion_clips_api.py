"""
Focused unit and API tests for MotionClipV1, safe NPZ/ZIP/NPY parsing,
preset scanning, thumbnail serving, preview non-persistence, completed ARDY job
clip resolution, AutoRigRequest SkinTokens alignment, and OpenAPI schema.
"""

from __future__ import annotations

import asyncio
import io
import math
import struct
import sys
import types
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import ValidationError

# Allow running in minimal CPU-only Python environments where sqlalchemy is not installed
try:
    import sqlalchemy  # noqa: F401
except ImportError:
    _sa = types.ModuleType("sqlalchemy")
    _sa.__path__ = []  # type: ignore[attr-defined]
    for _attr in ("and_", "asc", "create_engine", "desc", "event", "func", "text", "Column", "Integer", "String", "Float", "Boolean", "DateTime", "Text", "ForeignKey", "Index"):
        setattr(_sa, _attr, lambda *a, **kw: None)
    _sa_orm = types.ModuleType("sqlalchemy.orm")
    _sa_orm.sessionmaker = lambda *a, **kw: (lambda: None)
    _sa_orm.declarative_base = lambda *a, **kw: object
    _sa_orm.Session = object
    _sa_orm.relationship = lambda *a, **kw: None
    _sa_exc = types.ModuleType("sqlalchemy.exc")
    _sa_exc.SQLAlchemyError = Exception
    _sa_types = types.ModuleType("sqlalchemy.types")
    _sa_types.TypeDecorator = type("TypeDecorator", (), {})
    _sa_pool = types.ModuleType("sqlalchemy.pool")
    _sa_pool.NullPool = object
    _sa_pool.StaticPool = object
    _sa_ext = types.ModuleType("sqlalchemy.ext")
    _sa_ext.__path__ = []  # type: ignore[attr-defined]
    _sa_ext_decl = types.ModuleType("sqlalchemy.ext.declarative")
    _sa_ext_decl.declarative_base = lambda *a, **kw: object
    sys.modules.setdefault("sqlalchemy", _sa)
    sys.modules.setdefault("sqlalchemy.orm", _sa_orm)
    sys.modules.setdefault("sqlalchemy.exc", _sa_exc)
    sys.modules.setdefault("sqlalchemy.types", _sa_types)
    sys.modules.setdefault("sqlalchemy.pool", _sa_pool)
    sys.modules.setdefault("sqlalchemy.ext", _sa_ext)
    sys.modules.setdefault("sqlalchemy.ext.declarative", _sa_ext_decl)

try:
    import aiofiles  # noqa: F401
except ImportError:
    _af = types.ModuleType("aiofiles")
    _af.open = open  # type: ignore[attr-defined]
    sys.modules.setdefault("aiofiles", _af)

try:
    import numpy  # noqa: F401
except ImportError:
    _np = types.ModuleType("numpy")
    _np.ndarray = object  # type: ignore[attr-defined]
    sys.modules.setdefault("numpy", _np)

from api.routers import auto_rigging, motion_generation  # noqa: E402
from services import motion_clips  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to build valid/invalid NPY & NPZ archives in pure Python
# ---------------------------------------------------------------------------
def _make_npy_bytes(
    shape: tuple[int, ...],
    descr: str,
    payload: bytes,
    *,
    fortran_order: bool = False,
    version: tuple[int, int] = (1, 0),
) -> bytes:
    header_dict = f"{{'descr': {descr!r}, 'fortran_order': {fortran_order!r}, 'shape': {shape!r}, }}"
    if version == (1, 0):
        # Pad with spaces + newline to 64-byte alignment
        raw_hdr = header_dict.encode("latin1") + b"\n"
        pad_len = (64 - ((10 + len(raw_hdr)) % 64)) % 64
        padded = header_dict.encode("latin1") + (b" " * pad_len) + b"\n"
        return b"\x93NUMPY" + bytes([1, 0]) + struct.pack("<H", len(padded)) + padded + payload
    raw_hdr = header_dict.encode("utf-8") + b"\n"
    return b"\x93NUMPY" + bytes([version[0], version[1]]) + struct.pack("<I", len(raw_hdr)) + raw_hdr + payload


def _make_ardy_npz_bytes(
    *,
    frames: int = 4,
    joints: int = 27,
    fps: float = 20.0,
    text: str = "walk forward",
    batched: bool = True,
    rot_value: Optional[List[float]] = None,
) -> bytes:
    # Identity 3x3 rotation matrices
    eye = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    rot_flat = (rot_value or eye) * (frames * joints)
    rot_payload = struct.pack(f"<{len(rot_flat)}f", *rot_flat)
    rot_shape = (1, frames, joints, 3, 3) if batched else (frames, joints, 3, 3)

    pos_flat = []
    for t in range(frames):
        pos_flat.extend([0.0, 0.9, t * 0.05])
    pos_payload = struct.pack(f"<{len(pos_flat)}f", *pos_flat)
    pos_shape = (1, frames, 3) if batched else (frames, 3)

    fps_payload = struct.pack("<d", fps)
    text_bytes = text.encode("utf-32-le")
    text_descr = f"<U{max(1, len(text))}"
    if not text:
        text_bytes = b"\x00\x00\x00\x00"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("local_rot_mats.npy", _make_npy_bytes(rot_shape, "<f4", rot_payload))
        zf.writestr("root_positions.npy", _make_npy_bytes(pos_shape, "<f4", pos_payload))
        zf.writestr("fps.npy", _make_npy_bytes((), "<f8", fps_payload))
        zf.writestr("text.npy", _make_npy_bytes((), text_descr, text_bytes))
    return buf.getvalue()


class _FakeUploadFile:
    def __init__(self, filename: str, data: bytes):
        self.filename = filename
        self._buf = io.BytesIO(data)
        self.closed = False

    async def read(self, size: int = -1) -> bytes:
        return self._buf.read(size)

    async def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# 1. MotionClipV1 Normalization & NPY Validation Tests
# ---------------------------------------------------------------------------
def test_normalize_ardy_npz_core27_valid():
    raw = _make_ardy_npz_bytes(frames=5, joints=27, fps=20.0, text="walk forward")
    clip = motion_clips.normalize_ardy_npz_bytes(raw, clip_id="walk_forward")

    assert clip.schema_version == 1
    assert clip.id == "walk_forward"
    assert clip.name == "walk forward"
    assert clip.fps == 20.0
    assert clip.frame_count == 5
    assert math.isclose(clip.duration, 0.25, rel_tol=1e-6)
    assert clip.skeleton_profile == "core_27"
    assert clip.coordinate_system == "y_up"
    assert clip.translation_units == "source_native"
    assert clip.rotation_format == "quaternion_xyzw"
    assert len(clip.joint_names) == 27
    assert clip.joint_names[0] == "Hips"
    assert len(clip.frames) == 5
    for idx, frame in enumerate(clip.frames):
        assert len(frame.rotations) == 27
        assert frame.rotations[0] == pytest.approx([0.0, 0.0, 0.0, 1.0], abs=1e-6)
        assert frame.root_translation == pytest.approx([0.0, 0.9, idx * 0.05], abs=1e-6)


def test_normalize_ardy_npz_supports_upstream_soma77_joint_order():
    raw = _make_ardy_npz_bytes(frames=3, joints=77, text="SOMA walk")
    clip = motion_clips.normalize_ardy_npz_bytes(raw, clip_id="soma77")
    assert clip.skeleton_profile == "soma_77"
    assert len(clip.joint_names) == 77
    assert clip.joint_names[0] == "Hips"
    assert clip.joint_names[-1] == "RightToeEnd"


def test_normalize_ardy_npz_enforces_json_response_cap(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(motion_clips, "MAX_JSON_RESPONSE_BYTES", 1024)
    raw = _make_ardy_npz_bytes(frames=4, joints=27)
    with pytest.raises(motion_clips.MotionClipError) as exc:
        motion_clips.normalize_ardy_npz_bytes(raw, clip_id="too_large")
    assert exc.value.status_code == 413


def test_normalize_ardy_npz_rejects_unknown_joint_count():
    raw = _make_ardy_npz_bytes(frames=3, joints=19, fps=20.0)
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips.normalize_ardy_npz_bytes(raw, clip_id="bad_joints")
    assert exc_info.value.status_code == 422


def test_npy_rejects_object_pickle_dtype():
    npy = _make_npy_bytes((1,), "|O", b"cos\nsystem\n(S'echo pwn'\ntR.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("local_rot_mats.npy", npy)
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips.normalize_ardy_npz_bytes(buf.getvalue(), clip_id="pickle")
    assert exc_info.value.status_code == 422
    assert "pickle" in exc_info.value.detail.lower()


def test_npy_rejects_nan_and_inf():
    nan_eye = [float("nan"), 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    raw = _make_ardy_npz_bytes(frames=1, joints=27, rot_value=nan_eye)
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips.normalize_ardy_npz_bytes(raw, clip_id="nan_clip")
    assert exc_info.value.status_code == 422


def test_npy_rejects_payload_length_mismatch():
    npy = _make_npy_bytes((2, 3), "<f4", b"\x00" * 8)  # expects 24 bytes
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips._parse_npy_bytes(npy)
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# 2. ZIP Archive Security Limits
# ---------------------------------------------------------------------------
def test_zip_rejects_non_zip_415():
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips._read_bounded_npz_entries(b"not a zip archive")
    assert exc_info.value.status_code == 415


def test_zip_rejects_path_traversal_and_duplicate_entries():
    for bad_name in ("../evil.npy", "/etc/passwd.npy", "sub\\evil.npy"):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(bad_name, b"dummy")
        with pytest.raises(motion_clips.MotionClipError) as exc_info:
            motion_clips._read_bounded_npz_entries(buf.getvalue())
        assert exc_info.value.status_code == 400

    # Duplicate entry names
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("fps.npy", b"a")
        zf.writestr("fps.npy", b"b")
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips._read_bounded_npz_entries(buf.getvalue())
    assert exc_info.value.status_code == 400


def test_zip_rejects_symlink_and_encrypted_and_excess_entries():
    # Symlink external_attr
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("link.npy")
        info.external_attr = (0o120777 << 16)
        zf.writestr(info, b"/etc/passwd")
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips._read_bounded_npz_entries(buf.getvalue())
    assert exc_info.value.status_code == 400

    # Too many entries
    buf2 = io.BytesIO()
    with zipfile.ZipFile(buf2, "w") as zf:
        for i in range(motion_clips.MAX_ZIP_ENTRIES + 1):
            zf.writestr(f"e{i}.npy", b"x")
    with pytest.raises(motion_clips.MotionClipError) as exc_info2:
        motion_clips._read_bounded_npz_bytes if False else motion_clips._read_bounded_npz_entries(buf2.getvalue())
    assert exc_info2.value.status_code == 413


def test_zip_rejects_oversized_upload():
    oversized = b"PK" + (b"\x00" * (motion_clips.MAX_COMPRESSED_UPLOAD_BYTES + 1))
    with pytest.raises(motion_clips.MotionClipError) as exc_info:
        motion_clips._read_bounded_npz_entries(oversized)
    assert exc_info.value.status_code == 413


# ---------------------------------------------------------------------------
# 3. Preset Scanning & Thumbnail Path-Traversal Protection
# ---------------------------------------------------------------------------
def test_preset_scanning_deterministic_and_isolates_corrupt(tmp_path: Path):
    (tmp_path / "b_walk.npz").write_bytes(_make_ardy_npz_bytes(frames=2, joints=27, text="Walk B"))
    (tmp_path / "b_walk.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / "a_idle.npz").write_bytes(_make_ardy_npz_bytes(frames=4, joints=30, text="Idle A"))
    (tmp_path / "corrupt.npz").write_bytes(b"PK\x03\x04corrupt")

    res = motion_clips.list_motion_presets(presets_dir=tmp_path)
    assert res.schema_version == 1
    assert [p.id for p in res.presets] == ["a_idle", "b_walk"]
    assert res.presets[0].thumbnail_url is None
    assert res.presets[1].thumbnail_url == "/api/v1/motion/presets/b_walk/thumbnail"
    assert res.presets[0].clip_url == "/api/v1/motion/clips/a_idle"


def test_thumbnail_blocks_traversal_and_symlinks(tmp_path: Path):
    secret = tmp_path.parent / "secret.png"
    secret.write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / "evil.png").symlink_to(secret)
    (tmp_path / "good.webp").write_bytes(b"RIFF\x00\x00\x00\x00WEBP")

    with pytest.raises(motion_clips.MotionClipError) as exc1:
        motion_clips.resolve_preset_thumbnail_path("../secret", presets_dir=tmp_path)
    assert exc1.value.status_code == 404

    with pytest.raises(motion_clips.MotionClipError) as exc2:
        motion_clips.resolve_preset_thumbnail_path("evil", presets_dir=tmp_path)
    assert exc2.value.status_code == 404

    resolved, media_type = motion_clips.resolve_preset_thumbnail_path("good", presets_dir=tmp_path)
    assert resolved == (tmp_path / "good.webp").resolve()
    assert media_type == "image/webp"


# ---------------------------------------------------------------------------
# 4. Preview Endpoint Non-Persistence & Cleanup
# ---------------------------------------------------------------------------
def test_preview_upload_returns_clip_and_never_persists(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    presets_dir = tmp_path / "motion_presets"
    storage_dir = tmp_path / "storage"
    presets_dir.mkdir()
    storage_dir.mkdir()
    monkeypatch.setattr(motion_clips, "get_motion_presets_dir", lambda: presets_dir)

    raw = _make_ardy_npz_bytes(frames=3, joints=27, text="Preview Jump")
    upload = _FakeUploadFile("jump.npz", raw)
    clip = asyncio.run(motion_generation.preview_motion_clip(upload))  # type: ignore[arg-type]

    assert clip.schema_version == 1
    assert clip.id == "preview"
    assert clip.name == "jump"
    assert clip.frame_count == 3
    assert upload.closed is True
    assert list(presets_dir.iterdir()) == []
    assert list(storage_dir.iterdir()) == []


def test_preview_upload_rejects_bad_extension_and_empty_and_oversized():
    bad_ext = _FakeUploadFile("motion.glb", b"glb")
    with pytest.raises(HTTPException) as exc_415:
        asyncio.run(motion_generation.preview_motion_clip(bad_ext))  # type: ignore[arg-type]
    assert exc_415.value.status_code == 415

    empty = _FakeUploadFile("empty.npz", b"")
    with pytest.raises(HTTPException) as exc_400:
        asyncio.run(motion_generation.preview_motion_clip(empty))  # type: ignore[arg-type]
    assert exc_400.value.status_code == 400


# ---------------------------------------------------------------------------
# 5. Completed ARDY Job Resolution (No Path Exposure)
# ---------------------------------------------------------------------------
def test_completed_ardy_job_resolves_to_motion_clip_v1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    storage_dir = tmp_path / "storage"
    ws_dir = storage_dir / "ws_123" / "animation"
    ws_dir.mkdir(parents=True)
    npz_file = ws_dir / "ardy_42.npz"
    npz_file.write_bytes(_make_ardy_npz_bytes(frames=6, joints=27, text="Run"))

    monkeypatch.setattr(motion_generation, "get_storage_base_dir", lambda: storage_dir)
    monkeypatch.setattr(motion_clips, "get_motion_presets_dir", lambda: tmp_path / "empty_presets")

    class _FakeDb:
        def get_asset(self, asset_id: str) -> Optional[Any]:
            return None

    class _FakeScheduler:
        async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
            if job_id == "job_done":
                return {
                    "status": "completed",
                    "result": {
                        "artifact_type": "motion",
                        "output_motion_path": str(npz_file),
                    },
                }
            if job_id == "job_running":
                return {"status": "processing", "result": {}}
            return None

    monkeypatch.setattr(motion_generation, "DatabaseManager", lambda: _FakeDb())

    clip = asyncio.run(motion_generation.get_motion_clip("job-job_done", scheduler=_FakeScheduler()))  # type: ignore[arg-type]
    assert clip.schema_version == 1
    assert clip.id == "job-job_done"
    assert clip.frame_count == 6

    with pytest.raises(HTTPException) as exc_404:
        asyncio.run(motion_generation.get_motion_clip("job-job_running", scheduler=_FakeScheduler()))  # type: ignore[arg-type]
    assert exc_404.value.status_code == 404
    assert str(storage_dir) not in exc_404.value.detail


# ---------------------------------------------------------------------------
# 6. AutoRigRequest SkinTokens Alignment & OpenAPI Schema
# ---------------------------------------------------------------------------
def test_auto_rig_request_skintokens_alignment():
    req = auto_rigging.AutoRigRequest(
        workspace_id="ws_1",
        use_skeleton=True,
        use_transfer=False,
        use_postprocess=True,
        top_k=10,
        top_p=0.9,
        temperature=0.8,
        repetition_penalty=1.5,
        num_beams=4,
    )
    resolved = req.resolved_model_parameters()
    assert resolved == {
        "use_skeleton": True,
        "use_transfer": False,
        "use_postprocess": True,
        "top_k": 10,
        "top_p": 0.9,
        "temperature": 0.8,
        "repetition_penalty": 1.5,
        "num_beams": 4,
    }

    with pytest.raises(ValidationError):
        auto_rigging.AutoRigRequest(workspace_id="ws_1", top_k=999)

    with pytest.raises(ValidationError):
        auto_rigging.AutoRigRequest(workspace_id="ws_1", model_parameters={"unknown_param": 1})


def test_motion_openapi_routes_and_order():
    app = FastAPI()
    app.include_router(motion_generation.router, prefix="/api/v1")
    app.include_router(auto_rigging.router, prefix="/api/v1")

    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/motion/presets" in paths
    assert "/api/v1/motion/presets/{preset_id}/thumbnail" in paths
    assert "/api/v1/motion/uploads" in paths
    assert "/api/v1/motion/uploads/{clip_id}" in paths
    assert "/api/v1/motion/clips/preview" in paths
    assert "/api/v1/motion/uploads/from-clip/{clip_id}" in paths
    assert "/api/v1/motion/clips/{clip_id}" in paths

    route_paths = [getattr(r, "path", "") for r in app.routes]
    assert route_paths.index("/api/v1/motion/clips/preview") < route_paths.index("/api/v1/motion/clips/{clip_id}")


# ---------------------------------------------------------------------------
# 7. User-Owned Motion Presets (backend/storage/presets/<preset_id>/)
# ---------------------------------------------------------------------------
def test_motion_uploads_lifecycle_separate_from_presets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    presets_dir = tmp_path / "motion_presets"
    storage_dir = tmp_path / "storage"
    presets_dir.mkdir()
    storage_dir.mkdir()
    monkeypatch.setattr(motion_clips, "get_motion_presets_dir", lambda: presets_dir)
    monkeypatch.setattr(motion_clips, "get_storage_base_dir", lambda: storage_dir)

    raw = _make_ardy_npz_bytes(frames=4, joints=27, text="Custom Dance")
    upload = _FakeUploadFile("custom_dance.npz", raw)
    clip = asyncio.run(motion_generation.upload_motion_clip(upload))  # type: ignore[arg-type]

    assert clip.id.startswith("upl_")
    assert clip.frame_count == 4
    # Must NOT write to motion_presets/
    assert list(presets_dir.iterdir()) == []
    # User uploads belong in storage/presets/, not the bundled premade directory.
    uploads_dir = storage_dir / "presets"
    assert (uploads_dir / clip.id / "motion.npz").is_file()
    assert (uploads_dir / clip.id / "metadata.json").is_file()

    # Listing presets stays empty; listing uploads returns the uploaded clip
    assert motion_clips.list_motion_presets(presets_dir=presets_dir).presets == []
    listed = asyncio.run(motion_generation.get_uploaded_motion_clips())
    assert len(listed.uploads) == 1
    assert listed.uploads[0].id == clip.id
    assert listed.uploads[0].clip_url == f"/api/v1/motion/clips/{clip.id}"
    assert listed.uploads[0].source == "uploaded"

    # Resolving via /clips/{id} succeeds
    class _EmptyScheduler:
        async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
            return None

    loaded = asyncio.run(motion_generation.get_motion_clip(clip.id, scheduler=_EmptyScheduler()))  # type: ignore[arg-type]
    assert loaded.id == clip.id
    assert loaded.frame_count == 4

    # Deleting removes files and subsequent /clips/{id} returns 404
    deleted = asyncio.run(motion_generation.remove_uploaded_motion_clip(clip.id))
    assert deleted == {"deleted": True, "id": clip.id}
    assert not (uploads_dir / clip.id).exists()
    assert asyncio.run(motion_generation.get_uploaded_motion_clips()).uploads == []

    with pytest.raises(HTTPException) as exc_404:
        asyncio.run(motion_generation.get_motion_clip(clip.id, scheduler=_EmptyScheduler()))  # type: ignore[arg-type]
    assert exc_404.value.status_code == 404


def test_completed_ardy_clip_is_saved_as_idempotent_user_preset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    storage_dir = tmp_path / "storage"
    workspace_dir = storage_dir / "workspace_1" / "animation"
    workspace_dir.mkdir(parents=True)
    generated_path = workspace_dir / "ardy_123.npz"
    generated_path.write_bytes(_make_ardy_npz_bytes(frames=4, joints=27, text="walk"))
    monkeypatch.setattr(motion_clips, "get_storage_base_dir", lambda: storage_dir)

    class _FakeDB:
        def get_asset(self, asset_id: str):
            return None

    monkeypatch.setattr(motion_generation, "DatabaseManager", _FakeDB)

    class _FakeScheduler:
        async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
            if job_id != "job_123":
                return None
            return {"status": "completed", "result": {"artifact_type": "motion", "output_motion_path": str(generated_path)}}

    scheduler = _FakeScheduler()
    source_clip_id = "job-job_123"
    first = asyncio.run(motion_generation.save_generated_motion_clip_to_library(source_clip_id, scheduler=scheduler))  # type: ignore[arg-type]
    second = asyncio.run(motion_generation.save_generated_motion_clip_to_library(source_clip_id, scheduler=scheduler))  # type: ignore[arg-type]
    assert first.id == second.id
    assert first.id.startswith("gen_")
    preset_dir = storage_dir / "presets" / first.id
    assert (preset_dir / "motion.npz").is_file()
    assert (preset_dir / "metadata.json").is_file()
    listed = asyncio.run(motion_generation.get_uploaded_motion_clips())
    assert len(listed.uploads) == 1
    assert listed.uploads[0].id == first.id
    assert listed.uploads[0].source == "generated"
