"""
Safe motion preset discovery, bounded NPZ/NPY parsing, and MotionClipV1 normalization.

Supports:
- Read-only enumeration of approved NPZ presets in backend/motion_presets/
- Sibling PNG/WEBP thumbnail resolution with strict path-traversal protection
- Bounded pure-Python ZIP + NPY parsing (no pickle, no numpy.load)
- ARDY NPZ -> MotionClipV1 conversion (quaternion_xyzw, source-supported y_up axis, source_native translation units)
"""

from __future__ import annotations

import ast
import hashlib
import io
import json
import os
import logging
import math
import re
import struct
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from core.utils.file_utils import get_storage_base_dir

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Security & Resource Limits
# ---------------------------------------------------------------------------
MAX_COMPRESSED_UPLOAD_BYTES = 32 * 1024 * 1024   # 32 MiB
MAX_UNCOMPRESSED_TOTAL_BYTES = 128 * 1024 * 1024  # 128 MiB
MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024   # 64 MiB
MAX_ZIP_ENTRIES = 32
MAX_ARRAY_ELEMENTS = 1_000_000
MAX_FRAMES = 36_000
MAX_JOINTS = 256
MAX_NPY_HEADER_BYTES = 16 * 1024
MAX_JSON_RESPONSE_BYTES = 32 * 1024 * 1024

SUPPORTED_ZIP_COMPRESSIONS = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})
PRESET_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
UPLOAD_ID_RE = re.compile(r"^(?:upl|gen)_[0-9a-f]{12}$")

# ---------------------------------------------------------------------------
# Verified ARDY Skeleton Joint Orders
# (from backend/thirdparty/ardy/ardy/skeleton/definitions.py)
# ---------------------------------------------------------------------------
CORE_SKELETON_27_JOINTS: Tuple[str, ...] = (
    "Hips",
    "Spine",
    "Spine1",
    "Spine2",
    "Spine3",
    "Neck",
    "Head",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "RightHandEnd",
    "RightHandThumb1",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "LeftHandEnd",
    "LeftHandThumb1",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToeBase",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToeBase",
)

SOMA_SKELETON_30_JOINTS: Tuple[str, ...] = (
    "Hips",
    "Spine1",
    "Spine2",
    "Chest",
    "Neck1",
    "Neck2",
    "Head",
    "Jaw",
    "LeftEye",
    "RightEye",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "LeftHandThumbEnd",
    "LeftHandMiddleEnd",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "RightHandThumbEnd",
    "RightHandMiddleEnd",
    "LeftLeg",
    "LeftShin",
    "LeftFoot",
    "LeftToeBase",
    "RightLeg",
    "RightShin",
    "RightFoot",
    "RightToeBase",
)

G1_SKELETON_34_JOINTS: Tuple[str, ...] = (
    "pelvis_skel",
    "left_hip_pitch_skel",
    "left_hip_roll_skel",
    "left_hip_yaw_skel",
    "left_knee_skel",
    "left_ankle_pitch_skel",
    "left_ankle_roll_skel",
    "left_toe_base",
    "right_hip_pitch_skel",
    "right_hip_roll_skel",
    "right_hip_yaw_skel",
    "right_knee_skel",
    "right_ankle_pitch_skel",
    "right_ankle_roll_skel",
    "right_toe_base",
    "waist_yaw_skel",
    "waist_roll_skel",
    "waist_pitch_skel",
    "left_shoulder_pitch_skel",
    "left_shoulder_roll_skel",
    "left_shoulder_yaw_skel",
    "left_elbow_skel",
    "left_wrist_roll_skel",
    "left_wrist_pitch_skel",
    "left_wrist_yaw_skel",
    "left_hand_roll_skel",
    "right_shoulder_pitch_skel",
    "right_shoulder_roll_skel",
    "right_shoulder_yaw_skel",
    "right_elbow_skel",
    "right_wrist_roll_skel",
    "right_wrist_pitch_skel",
    "right_wrist_yaw_skel",
    "right_hand_roll_skel",
)

SOMA_SKELETON_77_JOINTS: Tuple[str, ...] = (
    "Hips", "Spine1", "Spine2", "Chest", "Neck1", "Neck2", "Head", "HeadEnd",
    "Jaw", "LeftEye", "RightEye", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftHandThumb1", "LeftHandThumb2", "LeftHandThumb3", "LeftHandThumbEnd",
    "LeftHandIndex1", "LeftHandIndex2", "LeftHandIndex3", "LeftHandIndex4", "LeftHandIndexEnd",
    "LeftHandMiddle1", "LeftHandMiddle2", "LeftHandMiddle3", "LeftHandMiddle4", "LeftHandMiddleEnd",
    "LeftHandRing1", "LeftHandRing2", "LeftHandRing3", "LeftHandRing4", "LeftHandRingEnd",
    "LeftHandPinky1", "LeftHandPinky2", "LeftHandPinky3", "LeftHandPinky4", "LeftHandPinkyEnd",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "RightHandThumb1", "RightHandThumb2", "RightHandThumb3", "RightHandThumbEnd",
    "RightHandIndex1", "RightHandIndex2", "RightHandIndex3", "RightHandIndex4", "RightHandIndexEnd",
    "RightHandMiddle1", "RightHandMiddle2", "RightHandMiddle3", "RightHandMiddle4", "RightHandMiddleEnd",
    "RightHandRing1", "RightHandRing2", "RightHandRing3", "RightHandRing4", "RightHandRingEnd",
    "RightHandPinky1", "RightHandPinky2", "RightHandPinky3", "RightHandPinky4", "RightHandPinkyEnd",
    "LeftLeg", "LeftShin", "LeftFoot", "LeftToeBase", "LeftToeEnd",
    "RightLeg", "RightShin", "RightFoot", "RightToeBase", "RightToeEnd",
)

ARDY_SKELETONS_BY_COUNT: Dict[int, Tuple[str, Tuple[str, ...]]] = {
    27: ("core_27", CORE_SKELETON_27_JOINTS),
    77: ("soma_77", SOMA_SKELETON_77_JOINTS),
    30: ("soma_30", SOMA_SKELETON_30_JOINTS),
    34: ("g1_34", G1_SKELETON_34_JOINTS),
}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class MotionClipError(Exception):
    """Base error mapped to an explicit HTTP status code."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# ---------------------------------------------------------------------------
# Frozen API Response Models (Schema Version 1)
# ---------------------------------------------------------------------------
class MotionPresetSummary(BaseModel):
    id: str
    name: str
    duration: Optional[float] = None
    fps: Optional[float] = None
    frame_count: Optional[int] = None
    thumbnail_url: Optional[str] = None
    clip_url: str


class MotionPresetListResponse(BaseModel):
    schema_version: Literal[1] = 1
    presets: List[MotionPresetSummary]


class MotionUploadSummary(BaseModel):
    id: str
    name: str
    duration: float
    fps: float
    frame_count: int
    created_at: str
    clip_url: str
    source: Literal["uploaded", "generated"] = "uploaded"


class MotionUploadListResponse(BaseModel):
    schema_version: Literal[1] = 1
    uploads: List[MotionUploadSummary]


class MotionClipFrame(BaseModel):
    rotations: List[List[float]]
    root_translation: List[float]


class MotionClipV1(BaseModel):
    schema_version: Literal[1] = 1
    id: str
    name: str
    fps: float = Field(..., gt=0)
    frame_count: int = Field(..., ge=1)
    duration: float = Field(..., gt=0)
    skeleton_profile: str
    coordinate_system: str = "y_up"
    translation_units: str = "source_native"
    rotation_format: Literal["quaternion_xyzw"] = "quaternion_xyzw"
    joint_names: List[str]
    frames: List[MotionClipFrame]


# ---------------------------------------------------------------------------
# Path & Preset Directory Helpers
# ---------------------------------------------------------------------------
def get_motion_presets_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "motion_presets"


def _validate_preset_id(preset_id: str) -> str:
    if not isinstance(preset_id, str) or not PRESET_ID_RE.fullmatch(preset_id):
        raise MotionClipError(404, "Motion preset not found")
    return preset_id


def _resolve_contained_file(root: Path, candidate: Path) -> Path:
    """Resolve a non-symlink regular file strictly contained inside root."""
    if candidate.is_symlink():
        raise MotionClipError(404, "Motion resource not found")
    try:
        resolved_root = root.resolve(strict=True)
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(resolved_root)
    except (OSError, RuntimeError, ValueError):
        raise MotionClipError(404, "Motion resource not found") from None
    if not resolved.is_file():
        raise MotionClipError(404, "Motion resource not found")
    return resolved


def resolve_preset_npz_path(preset_id: str, presets_dir: Optional[Path] = None) -> Path:
    clean_id = _validate_preset_id(preset_id)
    root = presets_dir or get_motion_presets_dir()
    if not root.is_dir():
        raise MotionClipError(404, "Motion preset not found")
    return _resolve_contained_file(root, root / f"{clean_id}.npz")


def resolve_preset_thumbnail_path(
    preset_id: str, presets_dir: Optional[Path] = None
) -> Tuple[Path, str]:
    """Return (resolved_path, media_type) for a sibling PNG/WEBP thumbnail."""
    clean_id = _validate_preset_id(preset_id)
    root = presets_dir or get_motion_presets_dir()
    if not root.is_dir():
        raise MotionClipError(404, "Thumbnail not found")
    for ext, media_type in ((".png", "image/png"), (".webp", "image/webp")):
        candidate = root / f"{clean_id}{ext}"
        if candidate.exists() and not candidate.is_symlink():
            try:
                resolved = _resolve_contained_file(root, candidate)
                return resolved, media_type
            except MotionClipError:
                continue
    raise MotionClipError(404, "Thumbnail not found")


def _display_name_from_id(preset_id: str, text_hint: Optional[str] = None) -> str:
    if text_hint:
        cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", str(text_hint)).strip()
        if cleaned:
            return cleaned[:120]
    words = re.sub(r"[._-]+", " ", preset_id).strip()
    return words.title() if words else preset_id


# ---------------------------------------------------------------------------
# Pure-Python Bounded ZIP + NPY Parser (Zero Pickle)
# ---------------------------------------------------------------------------
_STRUCT_TYPE_MAP: Dict[str, str] = {
    "f2": "e",
    "f4": "f",
    "f8": "d",
    "i1": "b",
    "i2": "h",
    "i4": "i",
    "i8": "q",
    "u1": "B",
    "u2": "H",
    "u4": "I",
    "u8": "Q",
    "b1": "?",
}


def _parse_npy_bytes(data: bytes) -> Tuple[Tuple[int, ...], str, List[Any]]:
    """
    Parse a single .npy buffer without numpy.load or pickle.
    Returns (shape, descr, flat_values).
    """
    if len(data) < 10 or data[:6] != b"\x93NUMPY":
        raise MotionClipError(400, "Invalid NPY header magic")

    major, minor = data[6], data[7]
    if (major, minor) == (1, 0):
        header_len = struct.unpack_from("<H", data, 8)[0]
        header_start = 10
    elif (major, minor) in ((2, 0), (3, 0)):
        if len(data) < 12:
            raise MotionClipError(400, "Truncated NPY v2/v3 header")
        header_len = struct.unpack_from("<I", data, 8)[0]
        header_start = 12
    else:
        raise MotionClipError(422, f"Unsupported NPY format version {major}.{minor}")

    if header_len == 0 or header_len > MAX_NPY_HEADER_BYTES:
        raise MotionClipError(422, "Invalid NPY header length")
    payload_start = header_start + header_len
    if payload_start > len(data):
        raise MotionClipError(400, "Truncated NPY header")

    encoding = "utf-8" if major >= 3 else "latin1"
    try:
        header_str = data[header_start:payload_start].decode(encoding).strip()
        header = ast.literal_eval(header_str)
    except Exception as exc:
        raise MotionClipError(400, "Malformed NPY header dictionary") from exc

    if not isinstance(header, dict):
        raise MotionClipError(400, "NPY header must be a dictionary")

    descr = header.get("descr")
    fortran_order = header.get("fortran_order")
    shape = header.get("shape")

    if not isinstance(descr, str) or not isinstance(fortran_order, bool) or not isinstance(shape, tuple):
        raise MotionClipError(400, "Incomplete NPY header metadata")
    if any(not isinstance(d, int) or d < 0 for d in shape):
        raise MotionClipError(422, "Invalid NPY array shape")

    # Reject object/pickle/void dtypes unconditionally
    if not descr or descr[0] not in "<>=|" or len(descr) < 3:
        raise MotionClipError(422, f"Unsupported NPY dtype '{descr}'")
    kind_char = descr[1]
    if kind_char in ("O", "V"):
        raise MotionClipError(422, "Object/pickle NPY arrays are forbidden")

    num_elements = 1
    for dim in shape:
        num_elements *= dim
        if num_elements > MAX_ARRAY_ELEMENTS:
            raise MotionClipError(413, "NPY array exceeds maximum allowed element count")

    if fortran_order and len(shape) > 1:
        raise MotionClipError(422, "Fortran-ordered multi-dimensional NPY arrays are not supported")

    payload = memoryview(data)[payload_start:]

    # String scalars (<U... or |S...) used for ARDY's 'text' entry
    if kind_char in ("U", "S"):
        try:
            char_count = int(descr[2:])
        except ValueError as exc:
            raise MotionClipError(422, f"Invalid NPY string dtype '{descr}'") from exc
        if kind_char == "U":
            endian = "<" if descr[0] in ("<", "|", "=") else ">"
            itemsize = char_count * 4
            expected_bytes = num_elements * itemsize
            if len(payload) != expected_bytes:
                raise MotionClipError(400, "NPY payload byte count mismatch")
            raw_bytes = bytes(payload)
            encoding_u = "utf-32-le" if endian == "<" else "utf-32-be"
            values = [
                raw_bytes[i * itemsize : (i + 1) * itemsize].decode(encoding_u, errors="replace").rstrip("\x00")
                for i in range(num_elements)
            ]
            return shape, descr, values
        else:
            itemsize = char_count
            expected_bytes = num_elements * itemsize
            if len(payload) != expected_bytes:
                raise MotionClipError(400, "NPY payload byte count mismatch")
            raw_bytes = bytes(payload)
            values = [
                raw_bytes[i * itemsize : (i + 1) * itemsize].decode("utf-8", errors="replace").rstrip("\x00")
                for i in range(num_elements)
            ]
            return shape, descr, values

    type_key = descr[1:]
    struct_code = _STRUCT_TYPE_MAP.get(type_key)
    if struct_code is None:
        raise MotionClipError(422, f"Unsupported NPY numeric dtype '{descr}'")

    endian_prefix = "<" if descr[0] in ("<", "|", "=") else ">"
    fmt = f"{endian_prefix}{struct_code}"
    itemsize = struct.calcsize(fmt)
    expected_bytes = num_elements * itemsize
    if len(payload) != expected_bytes:
        raise MotionClipError(400, "NPY payload byte count mismatch")

    if num_elements == 0:
        return shape, descr, []

    values = [item[0] for item in struct.iter_unpack(fmt, payload)]
    if kind_char == "f":
        for val in values:
            if not math.isfinite(val):
                raise MotionClipError(422, "Motion array contains non-finite (NaN/Inf) values")

    return shape, descr, values


def _read_bounded_npz_entries(
    raw_bytes: bytes,
    required_keys: Optional[frozenset[str]] = None,
) -> Dict[str, Tuple[Tuple[int, ...], str, List[Any]]]:
    """Validate ZIP container limits and parse NPY entries safely."""
    if len(raw_bytes) > MAX_COMPRESSED_UPLOAD_BYTES:
        raise MotionClipError(413, "NPZ upload exceeds maximum compressed size limit")

    if not raw_bytes.startswith(b"PK"):
        raise MotionClipError(415, "Unsupported file format: expected an NPZ (ZIP) archive")

    try:
        zf = zipfile.ZipFile(io.BytesIO(raw_bytes), mode="r")
    except zipfile.BadZipFile as exc:
        raise MotionClipError(400, "Invalid or corrupt NPZ archive") from exc

    parsed: Dict[str, Tuple[Tuple[int, ...], str, List[Any]]] = {}
    with zf:
        infos = zf.infolist()
        if len(infos) == 0:
            raise MotionClipError(400, "NPZ archive is empty")
        if len(infos) > MAX_ZIP_ENTRIES:
            raise MotionClipError(413, "NPZ archive exceeds maximum entry count")

        seen_names: set[str] = set()
        total_uncompressed = 0
        declared_uncompressed = 0

        for info in infos:
            name = info.filename
            if name in seen_names:
                raise MotionClipError(400, "NPZ archive contains duplicate entries")
            seen_names.add(name)

            # Reject absolute paths, traversal, backslashes, or directories
            if (
                not name
                or name.startswith("/")
                or name.startswith("\\")
                or "\\" in name
                or ".." in name.split("/")
                or (len(name) >= 2 and name[1] == ":")
            ):
                raise MotionClipError(400, "NPZ archive contains unsafe entry path")

            if info.is_dir():
                raise MotionClipError(400, "NPZ archive must not contain directory entries")

            # Reject symlinks in Unix external_attr
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise MotionClipError(400, "NPZ archive must not contain symlinks")

            # Reject encrypted entries
            if info.flag_bits & 0x1:
                raise MotionClipError(415, "Encrypted NPZ archives are not supported")

            if info.compress_type not in SUPPORTED_ZIP_COMPRESSIONS:
                raise MotionClipError(415, "Unsupported ZIP compression method in NPZ archive")

            if info.file_size > MAX_ENTRY_UNCOMPRESSED_BYTES:
                raise MotionClipError(413, "NPZ entry exceeds maximum uncompressed size")
            declared_uncompressed += info.file_size
            if declared_uncompressed > MAX_UNCOMPRESSED_TOTAL_BYTES:
                raise MotionClipError(413, "NPZ archive exceeds total uncompressed size limit")

            if not name.endswith(".npy"):
                continue

            key = name[:-4]
            if required_keys is not None and key not in required_keys:
                continue
            if key == "text" and info.file_size > 16 * 1024:
                raise MotionClipError(413, "ARDY text metadata exceeds maximum size")

            # Stream entry in chunks to enforce limits even if header file_size is spoofed
            entry_buf = io.BytesIO()
            entry_bytes = 0
            try:
                with zf.open(info, mode="r") as member:
                    while True:
                        chunk = member.read(65536)
                        if not chunk:
                            break
                        entry_bytes += len(chunk)
                        total_uncompressed += len(chunk)
                        if entry_bytes > MAX_ENTRY_UNCOMPRESSED_BYTES:
                            raise MotionClipError(413, "NPZ entry exceeds maximum uncompressed size")
                        if total_uncompressed > MAX_UNCOMPRESSED_TOTAL_BYTES:
                            raise MotionClipError(413, "NPZ archive exceeds total uncompressed size limit")
                        entry_buf.write(chunk)
            except MotionClipError:
                raise
            except (zipfile.BadZipFile, RuntimeError, EOFError, OSError) as exc:
                raise MotionClipError(400, "Corrupt compressed entry in NPZ archive") from exc

            parsed[key] = _parse_npy_bytes(entry_buf.getvalue())

    return parsed


# ---------------------------------------------------------------------------
# Rotation Matrix -> Quaternion (XYZW) Conversion
# ---------------------------------------------------------------------------
def _rot_matrix_to_quat_xyzw(m: List[float]) -> List[float]:
    """
    Convert row-major 3x3 rotation matrix (9 floats) to normalized [x, y, z, w] quaternion.
    """
    m00, m01, m02, m10, m11, m12, m20, m21, m22 = m
    trace = m00 + m11 + m22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        w = 0.25 * s
        x = (m21 - m12) / s
        y = (m02 - m20) / s
        z = (m10 - m01) / s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2.0
        w = (m21 - m12) / s
        x = 0.25 * s
        y = (m01 + m10) / s
        z = (m02 + m20) / s
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2.0
        w = (m02 - m20) / s
        x = (m01 + m10) / s
        y = 0.25 * s
        z = (m12 + m21) / s
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2.0
        w = (m10 - m01) / s
        x = (m02 + m20) / s
        y = (m12 + m21) / s
        z = 0.25 * s

    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if not math.isfinite(norm) or norm < 1e-12:
        raise MotionClipError(422, "Degenerate rotation matrix in motion clip")
    inv = 1.0 / norm
    return [float(x * inv), float(y * inv), float(z * inv), float(w * inv)]


# ---------------------------------------------------------------------------
# ARDY NPZ -> MotionClipV1 Normalization
# ---------------------------------------------------------------------------
def _extract_fps(entries: Dict[str, Tuple[Tuple[int, ...], str, List[Any]]]) -> float:
    if "fps" not in entries:
        raise MotionClipError(422, "NPZ clip is missing required 'fps' metadata")
    shape, descr, vals = entries["fps"]
    if descr[1] not in ("f", "i", "u") or len(vals) != 1 or len(shape) > 1:
        raise MotionClipError(422, "Invalid 'fps' metadata in NPZ clip")
    fps = float(vals[0])
    if not math.isfinite(fps) or fps <= 0.0 or fps > 240.0:
        raise MotionClipError(422, "Invalid 'fps' value in NPZ clip")
    return fps


def _extract_text_hint(entries: Dict[str, Tuple[Tuple[int, ...], str, List[Any]]]) -> Optional[str]:
    if "text" not in entries:
        return None
    _, descr, vals = entries["text"]
    if descr[1] in ("U", "S") and vals:
        return str(vals[0])
    return None


def normalize_ardy_npz_bytes(
    raw_bytes: bytes,
    clip_id: str,
    name_override: Optional[str] = None,
) -> MotionClipV1:
    """Parse an ARDY NPZ archive from bytes into a validated MotionClipV1."""
    entries = _read_bounded_npz_entries(
        raw_bytes,
        required_keys=frozenset({"local_rot_mats", "root_positions", "fps", "text"}),
    )

    if "local_rot_mats" not in entries or "root_positions" not in entries:
        raise MotionClipError(
            422,
            "Unsupported motion archive: missing required ARDY 'local_rot_mats' or 'root_positions' arrays",
        )

    fps = _extract_fps(entries)
    text_hint = _extract_text_hint(entries)

    rot_shape, rot_descr, rot_vals = entries["local_rot_mats"]
    pos_shape, pos_descr, pos_vals = entries["root_positions"]

    if rot_descr[1] != "f" or pos_descr[1] != "f":
        raise MotionClipError(422, "Motion rotation and translation arrays must be floating-point")

    # ARDY inverse() produces [B, T, J, 3, 3] with B=1 (or unbatched [T, J, 3, 3])
    if len(rot_shape) == 5:
        if rot_shape[0] != 1:
            raise MotionClipError(422, "Batched motion clips with batch_size != 1 are not supported")
        _, frame_count, joint_count, r_rows, r_cols = rot_shape
    elif len(rot_shape) == 4:
        frame_count, joint_count, r_rows, r_cols = rot_shape
    else:
        raise MotionClipError(422, f"Unsupported 'local_rot_mats' shape {rot_shape}")

    if r_rows != 3 or r_cols != 3:
        raise MotionClipError(422, "Expected 3x3 rotation matrices in 'local_rot_mats'")

    if len(pos_shape) == 3:
        if pos_shape[0] != 1:
            raise MotionClipError(422, "Batched root_positions with batch_size != 1 are not supported")
        pos_frames, pos_dims = pos_shape[1], pos_shape[2]
    elif len(pos_shape) == 2:
        pos_frames, pos_dims = pos_shape
    else:
        raise MotionClipError(422, f"Unsupported 'root_positions' shape {pos_shape}")

    if pos_dims != 3:
        raise MotionClipError(422, "Expected 3D root_positions vectors")
    if frame_count <= 0 or frame_count > MAX_FRAMES:
        raise MotionClipError(422, "Invalid frame count in motion clip")
    if pos_frames != frame_count:
        raise MotionClipError(422, "Frame count mismatch between rotations and root_positions")
    if joint_count <= 0 or joint_count > MAX_JOINTS:
        raise MotionClipError(422, "Invalid joint count in motion clip")

    skeleton_info = ARDY_SKELETONS_BY_COUNT.get(joint_count)
    if skeleton_info is None:
        raise MotionClipError(
            422,
            f"Unsupported ARDY skeleton joint count ({joint_count}); cannot map joint names safely",
        )
    skeleton_profile, joint_names = skeleton_info

    duration = float(frame_count) / fps
    if not math.isfinite(duration) or duration <= 0.0:
        raise MotionClipError(422, "Invalid computed motion duration")

    # Reject oversized normalized JSON before allocating per-frame Pydantic objects.
    estimated_response_bytes = frame_count * (joint_count * (4 * 24 + 4) + (3 * 24 + 8) + 128) + 4096
    if estimated_response_bytes > MAX_JSON_RESPONSE_BYTES:
        raise MotionClipError(413, "Normalized motion clip exceeds maximum JSON response size")

    frames: List[MotionClipFrame] = []
    stride_frame_rot = joint_count * 9
    for t in range(frame_count):
        rot_base = t * stride_frame_rot
        frame_quats: List[List[float]] = []
        for j in range(joint_count):
            mat_start = rot_base + j * 9
            frame_quats.append(_rot_matrix_to_quat_xyzw(rot_vals[mat_start : mat_start + 9]))
        pos_base = t * 3
        root_t = [
            float(pos_vals[pos_base]),
            float(pos_vals[pos_base + 1]),
            float(pos_vals[pos_base + 2]),
        ]
        frames.append(MotionClipFrame(rotations=frame_quats, root_translation=root_t))

    clip_name = name_override or _display_name_from_id(clip_id, text_hint=text_hint)
    clip = MotionClipV1(
        schema_version=1,
        id=clip_id,
        name=clip_name,
        fps=fps,
        frame_count=frame_count,
        duration=duration,
        skeleton_profile=skeleton_profile,
        coordinate_system="y_up",
        translation_units="source_native",
        rotation_format="quaternion_xyzw",
        joint_names=list(joint_names),
        frames=frames,
    )
    return clip


def list_motion_presets(presets_dir: Optional[Path] = None) -> MotionPresetListResponse:
    """
    Scan backend/motion_presets/ deterministically without crashing on corrupt entries.
    Does not fabricate missing FPS or duration.
    """
    root = presets_dir or get_motion_presets_dir()
    if not root.is_dir():
        return MotionPresetListResponse(schema_version=1, presets=[])

    summaries: List[MotionPresetSummary] = []
    candidates = sorted(root.iterdir(), key=lambda p: p.name)
    for entry in candidates:
        if entry.suffix.lower() != ".npz":
            continue
        preset_id = entry.stem
        if not PRESET_ID_RE.fullmatch(preset_id):
            logger.warning("Skipping motion preset with invalid ID format: %s", entry.name)
            continue
        try:
            resolved = _resolve_contained_file(root, entry)
            raw_bytes = resolved.read_bytes()
            # Validate full clip metadata safely without fabricating values
            clip = normalize_ardy_npz_bytes(raw_bytes, clip_id=preset_id)
            thumb_url: Optional[str] = None
            try:
                resolve_preset_thumbnail_path(preset_id, presets_dir=root)
                thumb_url = f"/api/v1/motion/presets/{preset_id}/thumbnail"
            except MotionClipError:
                thumb_url = None

            summaries.append(
                MotionPresetSummary(
                    id=preset_id,
                    name=clip.name,
                    duration=clip.duration,
                    fps=clip.fps,
                    frame_count=clip.frame_count,
                    thumbnail_url=thumb_url,
                    clip_url=f"/api/v1/motion/clips/{preset_id}",
                )
            )
        except Exception as exc:
            logger.warning("Skipping corrupt/unsupported motion preset '%s': %s", preset_id, exc)
            continue

    return MotionPresetListResponse(schema_version=1, presets=summaries)


# ---------------------------------------------------------------------------
# User-Owned Motion Presets (backend/storage/presets/<preset_id>/)
# ---------------------------------------------------------------------------
def get_motion_uploads_dir() -> Path:
    """Directory for user-owned uploaded and generated motion presets."""
    return get_storage_base_dir() / "presets"


def get_legacy_motion_uploads_dir() -> Path:
    """Read-only compatibility path for legacy flat uploads."""
    return get_storage_base_dir() / "motion_uploads"


def _user_preset_roots(uploads_dir: Optional[Path] = None) -> List[Path]:
    if uploads_dir is not None:
        return [uploads_dir]
    roots = [get_motion_uploads_dir(), get_legacy_motion_uploads_dir()]
    unique: List[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root.resolve())
        if key not in seen:
            unique.append(root)
            seen.add(key)
    return unique


def _resolve_user_preset_directory(root: Path, preset_id: str) -> Path:
    candidate = root / preset_id
    if candidate.is_symlink():
        raise MotionClipError(404, "User motion preset not found")
    try:
        resolved_root = root.resolve(strict=True)
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(resolved_root)
    except (OSError, RuntimeError, ValueError):
        raise MotionClipError(404, "User motion preset not found") from None
    if not resolved.is_dir():
        raise MotionClipError(404, "User motion preset not found")
    return resolved


def resolve_upload_npz_path(clip_id: str, uploads_dir: Optional[Path] = None) -> Tuple[Path, Optional[str]]:
    """Resolve new per-preset directories and legacy flat uploads."""
    if not isinstance(clip_id, str) or not UPLOAD_ID_RE.fullmatch(clip_id):
        raise MotionClipError(404, "User motion preset not found")
    for root in _user_preset_roots(uploads_dir):
        if not root.is_dir():
            continue
        preset_dir = root / clip_id
        if preset_dir.exists() or preset_dir.is_symlink():
            resolved_dir = _resolve_user_preset_directory(root, clip_id)
            npz_path = _resolve_contained_file(resolved_dir, resolved_dir / "motion.npz")
            name_override = None
            meta_candidate = resolved_dir / "metadata.json"
            if meta_candidate.exists() and not meta_candidate.is_symlink():
                try:
                    meta = json.loads(_resolve_contained_file(resolved_dir, meta_candidate).read_text(encoding="utf-8"))
                    if isinstance(meta, dict) and isinstance(meta.get("name"), str):
                        name_override = _display_name_from_id(clip_id, meta["name"])
                except Exception:
                    logger.warning("Ignoring invalid metadata for motion preset %s", clip_id)
            return npz_path, name_override
        legacy_npz = root / f"{clip_id}.npz"
        if legacy_npz.exists():
            npz_path = _resolve_contained_file(root, legacy_npz)
            name_override = None
            meta_candidate = root / f"{clip_id}.json"
            if meta_candidate.exists() and not meta_candidate.is_symlink():
                try:
                    meta = json.loads(_resolve_contained_file(root, meta_candidate).read_text(encoding="utf-8"))
                    if isinstance(meta, dict) and isinstance(meta.get("name"), str):
                        name_override = _display_name_from_id(clip_id, meta["name"])
                except Exception:
                    logger.warning("Ignoring invalid legacy metadata for motion preset %s", clip_id)
            return npz_path, name_override
    raise MotionClipError(404, "User motion preset not found")


def _atomic_write_user_preset(root: Path, preset_id: str, raw_bytes: bytes, metadata: Dict[str, Any]) -> None:
    """Atomically publish one preset folder with motion.npz and one metadata.json."""
    root.mkdir(parents=True, exist_ok=True)
    preset_dir = root / preset_id
    if preset_dir.exists() or preset_dir.is_symlink():
        raise MotionClipError(409, "A user motion preset with this ID already exists")
    temp_dir = root / f".{preset_id}.{uuid.uuid4().hex}.tmp"
    try:
        temp_dir.mkdir()
        (temp_dir / "motion.npz").write_bytes(raw_bytes)
        (temp_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        os.replace(temp_dir, preset_dir)
    except Exception as exc:
        if temp_dir.exists() and not temp_dir.is_symlink():
            for child in temp_dir.iterdir():
                if child.is_file() and not child.is_symlink():
                    child.unlink(missing_ok=True)
            try:
                temp_dir.rmdir()
            except OSError:
                pass
        raise MotionClipError(500, "Failed to persist user motion preset") from exc


def save_uploaded_motion_clip(raw_bytes: bytes, filename: str, uploads_dir: Optional[Path] = None) -> MotionClipV1:
    """Validate and permanently save an uploaded NPZ under backend/storage/presets/."""
    upload_id = f"upl_{uuid.uuid4().hex[:12]}"
    clip_name = _display_name_from_id(upload_id, text_hint=Path(filename).stem)
    clip = normalize_ardy_npz_bytes(raw_bytes, clip_id=upload_id, name_override=clip_name)
    root = uploads_dir or get_motion_uploads_dir()
    _atomic_write_user_preset(root, upload_id, raw_bytes, {
        "id": upload_id, "name": clip.name, "duration": clip.duration, "fps": clip.fps,
        "frame_count": clip.frame_count, "created_at": datetime.now(timezone.utc).isoformat(), "source": "uploaded",
    })
    return clip


def save_generated_motion_clip(raw_bytes: bytes, source_clip_id: str, name: str, uploads_dir: Optional[Path] = None) -> MotionClipV1:
    """Persist a completed ARDY artifact as a deterministic, idempotent user preset."""
    if not isinstance(source_clip_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", source_clip_id):
        raise MotionClipError(404, "Generated motion clip not found")
    if len(raw_bytes) > MAX_COMPRESSED_UPLOAD_BYTES:
        raise MotionClipError(413, "Generated NPZ exceeds maximum compressed size limit")
    preset_id = f"gen_{hashlib.sha256(source_clip_id.encode('utf-8')).hexdigest()[:12]}"
    digest = hashlib.sha256(raw_bytes).hexdigest()
    clip = normalize_ardy_npz_bytes(raw_bytes, clip_id=preset_id, name_override=_display_name_from_id(preset_id, text_hint=Path(name).stem))
    root = uploads_dir or get_motion_uploads_dir()
    preset_dir = root / preset_id
    def existing_matches() -> bool:
        try:
            resolved = _resolve_user_preset_directory(root, preset_id)
            meta_path = _resolve_contained_file(resolved, resolved / "metadata.json")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            return bool(isinstance(meta, dict) and meta.get("source") == "generated" and meta.get("source_clip_id") == source_clip_id and meta.get("sha256") == digest)
        except Exception:
            return False
    if preset_dir.exists() or preset_dir.is_symlink():
        if existing_matches():
            return clip
        raise MotionClipError(409, "Generated preset ID conflicts with existing stored data")
    try:
        _atomic_write_user_preset(root, preset_id, raw_bytes, {
            "id": preset_id, "name": clip.name, "duration": clip.duration, "fps": clip.fps,
            "frame_count": clip.frame_count, "created_at": datetime.now(timezone.utc).isoformat(),
            "source": "generated", "source_clip_id": source_clip_id, "sha256": digest,
        })
    except MotionClipError:
        if existing_matches():
            return clip
        raise
    return clip


def list_uploaded_motion_clips(uploads_dir: Optional[Path] = None) -> MotionUploadListResponse:
    """List user-owned uploaded/generated presets and legacy flat uploads."""
    uploads: List[MotionUploadSummary] = []
    seen_ids: set[str] = set()
    for root in _user_preset_roots(uploads_dir):
        if not root.is_dir():
            continue
        for entry in sorted(root.iterdir(), key=lambda p: p.name):
            preset_id = None
            npz_path = None
            meta_path = None
            if entry.is_dir() and not entry.is_symlink():
                preset_id = entry.name
                if not UPLOAD_ID_RE.fullmatch(preset_id):
                    continue
                try:
                    folder = _resolve_user_preset_directory(root, preset_id)
                    npz_path = _resolve_contained_file(folder, folder / "motion.npz")
                    meta_candidate = folder / "metadata.json"
                    if meta_candidate.exists() and not meta_candidate.is_symlink():
                        meta_path = _resolve_contained_file(folder, meta_candidate)
                except MotionClipError:
                    continue
            elif entry.suffix.lower() == ".npz" and entry.is_file() and not entry.is_symlink():
                preset_id = entry.stem
                if not UPLOAD_ID_RE.fullmatch(preset_id):
                    continue
                try:
                    npz_path = _resolve_contained_file(root, entry)
                    meta_candidate = root / f"{preset_id}.json"
                    if meta_candidate.exists() and not meta_candidate.is_symlink():
                        meta_path = _resolve_contained_file(root, meta_candidate)
                except MotionClipError:
                    continue
            else:
                continue
            if preset_id in seen_ids or npz_path is None:
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path else {}
                if not isinstance(meta, dict):
                    meta = {}
                source = meta.get("source") if meta.get("source") in ("uploaded", "generated") else "uploaded"
                if all(k in meta for k in ("name", "duration", "fps", "frame_count", "created_at")):
                    name = _display_name_from_id(preset_id, str(meta["name"]))
                    duration, fps, frame_count = float(meta["duration"]), float(meta["fps"]), int(meta["frame_count"])
                    created_at = str(meta["created_at"])
                else:
                    clip = normalize_ardy_npz_bytes(npz_path.read_bytes(), clip_id=preset_id)
                    name, duration, fps, frame_count = clip.name, clip.duration, clip.fps, clip.frame_count
                    created_at = datetime.fromtimestamp(npz_path.stat().st_mtime, tz=timezone.utc).isoformat()
                uploads.append(MotionUploadSummary(id=preset_id, name=name, duration=duration, fps=fps,
                    frame_count=frame_count, created_at=created_at, clip_url=f"/api/v1/motion/clips/{preset_id}", source=source))
                seen_ids.add(preset_id)
            except Exception as exc:
                logger.warning("Skipping corrupt user motion preset '%s': %s", preset_id, exc)
    uploads.sort(key=lambda item: (item.created_at, item.id), reverse=True)
    return MotionUploadListResponse(schema_version=1, uploads=uploads)


def delete_uploaded_motion_clip(clip_id: str, uploads_dir: Optional[Path] = None) -> None:
    """Delete a user-owned motion preset and its metadata."""
    npz_path, _ = resolve_upload_npz_path(clip_id, uploads_dir=uploads_dir)
    if npz_path.name == "motion.npz":
        folder = npz_path.parent
        for name in ("motion.npz", "metadata.json", "thumbnail.png", "thumbnail.webp"):
            candidate = folder / name
            if candidate.exists() and not candidate.is_symlink():
                try:
                    _resolve_contained_file(folder, candidate).unlink(missing_ok=True)
                except MotionClipError:
                    continue
        try:
            folder.rmdir()
        except OSError:
            pass
        return
    npz_path.unlink(missing_ok=True)
    root = npz_path.parent
    for suffix in (".json", ".png", ".webp"):
        candidate = root / f"{clip_id}{suffix}"
        if candidate.exists() and not candidate.is_symlink():
            try:
                _resolve_contained_file(root, candidate).unlink(missing_ok=True)
            except MotionClipError:
                continue
