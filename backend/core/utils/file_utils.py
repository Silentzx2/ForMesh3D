"""File handling utilities"""

import base64
import hashlib
import json
import re
try:
    import imghdr
except ImportError:
    imghdr = None
import logging
import mimetypes
import os
import time
import shutil
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import aiofiles
from fastapi import UploadFile
from PIL import Image

from .exceptions import FileUploadError

logger = logging.getLogger(__name__)

# Supported file formats
SUPPORTED_IMAGE_FORMATS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tga"]
SUPPORTED_MESH_FORMATS = [".glb", ".obj", ".fbx", ".ply", ".stl", ".gltf", ".usdz"]
SUPPORTED_TEXTURE_FORMATS = [".jpg", ".jpeg", ".png", ".tga", ".exr", ".hdr"]

# Validation limits
MAX_IMAGE_RESOLUTION = (8192, 8192)  # Maximum accepted upload image resolution
MAX_MESH_VERTICES = int(os.environ.get("FORMASH_MAX_MESH_VERTICES", 10_000_000))  # Maximum number of vertices
MAX_MESH_FACES = int(os.environ.get("FORMASH_MAX_MESH_FACES", 10_000_000))  # Maximum number of faces

# MIME type mappings
MIME_TYPE_MAPPING = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "model/gltf-binary": ".glb",
    "model/gltf+json": ".gltf",
    "application/wavefront-obj": ".obj",
    "model/fbx": ".fbx",
    "model/ply": ".ply",
    "model/stl": ".stl",
    "model/vnd.usdz+zip": ".usdz",
    "model/usdz": ".usdz",
    "application/octet-stream": None,  # Generic binary
}


def generate_filename(original_filename: str, prefix: str = "") -> str:
    """Generate a unique filename with UUID"""
    file_ext = Path(original_filename).suffix
    unique_id = str(uuid.uuid4())
    if prefix:
        return f"{prefix}_{unique_id}{file_ext}"
    return f"{unique_id}{file_ext}"


def get_file_size_mb(file_path: str) -> float:
    """Get file size in MB"""
    return os.path.getsize(file_path) / (1024 * 1024)


def resolve_server_file_path(path_or_url: Optional[str]) -> Optional[str]:
    """Resolve a client path only inside configured local asset roots."""
    if not path_or_url:
        return path_or_url
    path_str = str(path_or_url).strip()
    if "://" in path_str:
        from urllib.parse import urlparse
        path_str = urlparse(path_str).path

    raw = Path(path_str)
    candidates = [raw] if raw.is_absolute() else [
        Path.cwd() / path_str.lstrip("/"),
        Path.cwd().parent / path_str.lstrip("/"),
        Path.cwd().parent / "backend" / path_str.lstrip("/"),
    ]
    roots_env = os.environ.get("ALLOWED_INPUT_ROOTS", "").strip()
    roots = (
        [Path(p).expanduser().resolve() for p in roots_env.split(os.pathsep) if p.strip()]
        if roots_env else [
            (Path.cwd() / "outputs").resolve(),
            (Path.cwd() / "uploads").resolve(),
            (Path.cwd().parent / "outputs").resolve(),
            (Path.cwd().parent / "uploads").resolve(),
            (Path.cwd().parent / "backend" / "outputs").resolve(),
            (Path.cwd().parent / "backend" / "uploads").resolve(),
            (Path.cwd() / "backend" / "storage").resolve(),
            (Path.cwd().parent / "backend" / "storage").resolve(),
            (Path(__file__).resolve().parents[2] / "storage").resolve(),
            get_storage_base_dir().resolve(),
        ]
    )
    unrestricted = os.environ.get("ALLOW_LOCAL_SERVER_PATH_INPUTS", "false").lower() in {"1","true","yes","on"}
    forbidden = (Path("/proc"), Path("/sys"), Path("/dev"), Path("/etc/shadow"), Path("/etc/passwd"))
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except (FileNotFoundError, OSError):
            continue
        if any(resolved == root or root in resolved.parents for root in forbidden):
            raise FileUploadError(path_str, "Access to protected server paths is not allowed")
        if unrestricted or any(resolved == root or root in resolved.parents for root in roots):
            return str(resolved)
    raise FileUploadError(path_str, "Server file path is outside configured input roots. Use file_id input instead.")


def detect_file_type_from_content(file_path: str) -> str:
    """Detect file type from content analysis"""
    try:
        # Try to detect if it's an image
        if imghdr is not None:
            img_type = imghdr.what(file_path)
            if img_type:
                return f"image/{img_type}"
        else:
            try:
                with Image.open(file_path) as img:
                    if img.format:
                        return f"image/{img.format.lower()}"
            except Exception:
                pass

        # Check MIME type
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type:
            return mime_type

        # Check file extension as fallback
        ext = Path(file_path).suffix.lower()
        if ext in SUPPORTED_IMAGE_FORMATS:
            return "image/generic"
        elif ext in SUPPORTED_MESH_FORMATS:
            return "model/generic"

        return "application/octet-stream"
    except Exception:
        return "application/octet-stream"


def validate_image_file(
    file_path: str,
    max_resolution: Tuple[int, int] = (8192, 8192),
    optimize_large: bool = True,
) -> Dict:
    """Validate and get info about an image file, auto-optimizing large camera photos if needed."""
    try:
        try:
            with Image.open(file_path) as img:
                width, height = img.size
                format_name = img.format or "PNG"
                mode = img.mode

                if width > max_resolution[0] or height > max_resolution[1]:
                    raise ValueError(
                        f"Image resolution {width}x{height} exceeds maximum {max_resolution[0]}x{max_resolution[1]}"
                    )

                TARGET_MAX = 2048
                if optimize_large and (width > TARGET_MAX or height > TARGET_MAX):
                    img_copy = img.copy()
                    img_copy.thumbnail((TARGET_MAX, TARGET_MAX), Image.Resampling.LANCZOS)
                    save_kwargs = {}
                    if format_name in ("JPEG", "JPG"):
                        save_kwargs["quality"] = 95
                    elif format_name == "PNG":
                        save_kwargs["optimize"] = True
                    img_copy.save(file_path, format=format_name, **save_kwargs)
                    width, height = img_copy.size

                return {
                    "valid": True,
                    "width": width,
                    "height": height,
                    "format": format_name,
                    "mode": mode,
                    "file_size_mb": get_file_size_mb(file_path),
                }
        except Exception as pil_err:
            # Fallback to OpenCV if PIL WebP decoder fails on specific WebP payloads
            import cv2
            cv_img = cv2.imread(file_path, cv2.IMREAD_UNCHANGED)
            if cv_img is not None:
                h, w = cv_img.shape[:2]
                return {
                    "valid": True,
                    "width": w,
                    "height": h,
                    "format": "WEBP",
                    "mode": "RGB",
                    "file_size_mb": get_file_size_mb(file_path),
                }
            return {"valid": False, "error": str(pil_err)}
    except Exception as e:
        return {"valid": False, "error": str(e)}


def validate_mesh_file(
    file_path: str,
    max_vertices: int = MAX_MESH_VERTICES,
    max_faces: int = MAX_MESH_FACES,
) -> Dict:
    """Validate and get info about a mesh file"""
    try:
        if Path(file_path).suffix.lower() == ".gltf":
            try:
                with open(file_path, "r", encoding="utf-8") as handle:
                    gltf_data = json.load(handle)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"Invalid GLTF JSON: {exc}") from exc

            if not isinstance(gltf_data, dict) or not isinstance(gltf_data.get("asset"), dict):
                raise ValueError('Invalid GLTF JSON: missing required "asset" object.')

            buffers = gltf_data.get("buffers", [])
            images = gltf_data.get("images", [])
            buffer_views = gltf_data.get("bufferViews", [])
            if not isinstance(buffers, list) or not isinstance(images, list) or not isinstance(buffer_views, list):
                raise ValueError("Invalid GLTF JSON: buffers, images, and bufferViews must be arrays.")

            for index, resource in enumerate(buffers):
                uri = resource.get("uri") if isinstance(resource, dict) else None
                if (
                    not isinstance(uri, str)
                    or not uri.strip().lower().startswith("data:")
                    or "," not in uri
                    or not uri.rsplit(",", 1)[1].strip()
                ):
                    raise ValueError(
                        f"GLTF buffer {index + 1} must be embedded as a data URI. "
                        "External GLTF dependencies are not supported; embed all resources or upload a self-contained GLB."
                    )

            for index, image in enumerate(images):
                if not isinstance(image, dict):
                    raise ValueError(f"Invalid GLTF JSON: image {index + 1} must be an object.")
                uri = image.get("uri")
                if isinstance(uri, str) and uri.strip():
                    if (
                        not uri.strip().lower().startswith("data:")
                        or "," not in uri
                        or not uri.rsplit(",", 1)[1].strip()
                    ):
                        raise ValueError(
                            "External GLTF dependencies are not supported. "
                            "Embed buffers and textures as data URIs or upload a self-contained GLB."
                        )
                else:
                    view_index = image.get("bufferView")
                    if isinstance(view_index, bool) or not isinstance(view_index, int) or not 0 <= view_index < len(buffer_views):
                        raise ValueError(
                            f"GLTF image {index + 1} must use an embedded data URI or a valid bufferView."
                        )

        import numpy as np
        import trimesh

        # Load mesh using trimesh with process=False to preserve sharp edges and normals
        mesh = trimesh.load(file_path, process=False)

        # Handle scene objects
        if isinstance(mesh, trimesh.Scene):
            # Get the combined mesh from scene
            mesh = mesh.dump(concatenate=True)

        if not isinstance(mesh, trimesh.Trimesh):
            return {
                "valid": False,
                "error": f"Loaded object is not a valid mesh: {type(mesh)}",
            }

        # Get mesh statistics
        vertex_count = len(mesh.vertices)
        face_count = len(mesh.faces)

        if not np.isfinite(mesh.vertices).all():
            raise ValueError("Mesh contains non-finite vertex coordinates")

        # Check vertex count
        if vertex_count > max_vertices:
            raise ValueError(
                f"Mesh has {vertex_count} vertices, which exceeds maximum {max_vertices}"
            )

        # Check face count
        if face_count > max_faces:
            raise ValueError(
                f"Mesh has {face_count} faces, which exceeds maximum {max_faces}"
            )

        # Basic mesh validation
        if vertex_count == 0 or face_count == 0:
            raise ValueError("Mesh is empty (no vertices or faces)")

        return {
            "valid": True,
            "vertex_count": vertex_count,
            "face_count": face_count,
            "file_size_mb": get_file_size_mb(file_path),
            "is_watertight": bool(mesh.is_watertight),
        }

    except Exception as e:
        return {"valid": False, "error": str(e)}


def validate_base64_data(
    base64_data: str,
    max_bytes: int = 100 * 1024 * 1024,
) -> Tuple[bool, Optional[str], Optional[bytes]]:
    """Validate base64 data and extract content type"""
    try:
        # Check if it has data URL prefix
        content_type = None
        if base64_data[:5].lower() == "data:":
            if "," not in base64_data:
                return False, None, None
            header, base64_data = base64_data.split(",", 1)

            # Extract content type from header
            content_type = header.split(":", 1)[1].split(";", 1)[0].strip().lower()

        if len(base64_data) > ((max_bytes + 2) // 3) * 4:
            return False, None, None
        missing_padding = (-len(base64_data)) % 4
        if len(base64_data) % 4 == 1:
            return False, None, None
        existing_padding = len(base64_data) - len(base64_data.rstrip("="))
        total_padding = existing_padding + missing_padding
        if total_padding > 2:
            return False, None, None
        decoded_size = ((len(base64_data) + missing_padding) // 4) * 3 - total_padding
        if decoded_size > max_bytes:
            return False, None, None
        try:
            # Handle missing base64 padding
            if missing_padding:
                base64_data += "=" * (4 - missing_padding)
            decoded_data = base64.b64decode(base64_data, validate=True)
        except Exception:
            return False, None, None

        # Validate it's not empty
        if len(decoded_data) == 0:
            return False, None, None
        if len(decoded_data) > max_bytes:
            return False, None, None

        return True, content_type, decoded_data
    except Exception:
        return False, None, None


async def save_upload_file(
    upload_file: UploadFile,
    destination_dir: str,
    max_size_mb: int = 100,
    validate_content: bool = True,
) -> Dict[str, Union[str, int, float, bool, Dict]]:
    """Save uploaded file to destination directory with enhanced validation"""
    try:
        # Create destination directory if it doesn't exist
        Path(destination_dir).mkdir(parents=True, exist_ok=True)

        # Validate file extension
        if upload_file.filename and not validate_file_extension(
            upload_file.filename, SUPPORTED_IMAGE_FORMATS + SUPPORTED_MESH_FORMATS
        ):
            raise FileUploadError(
                upload_file.filename,
                f"Unsupported file format. Supported: {SUPPORTED_IMAGE_FORMATS + SUPPORTED_MESH_FORMATS}",
            )

        # Generate unique filename
        filename = generate_filename(upload_file.filename or "upload.bin", "upload")
        file_path = Path(destination_dir) / filename

        max_size_bytes = max_size_mb * 1024 * 1024
        total_bytes = 0
        try:
            async with aiofiles.open(file_path, "wb") as f:
                while chunk := await upload_file.read(1024 * 1024):
                    total_bytes += len(chunk)
                    if total_bytes > max_size_bytes:
                        raise FileUploadError(upload_file.filename or "unknown", f"File size exceeds limit ({max_size_mb}MB)")
                    await f.write(chunk)
        except Exception:
            file_path.unlink(missing_ok=True)
            raise
        file_size_mb = total_bytes / (1024 * 1024)

        # Validate content if requested
        validation_info = {}
        if validate_content and upload_file.filename:
            file_type = get_file_type_from_extension(upload_file.filename)
            if file_type == "image":
                validation_info = validate_image_file(str(file_path))
                if not validation_info.get("valid", False):
                    os.remove(file_path)
                    raise FileUploadError(
                        upload_file.filename or "unknown",
                        validation_info.get("error", "Invalid image file"),
                    )
            elif file_type == "mesh":
                validation_info = validate_mesh_file(str(file_path))
                if not validation_info.get("valid", False):
                    os.remove(file_path)
                    raise FileUploadError(
                        upload_file.filename or "unknown",
                        validation_info.get("error", "Invalid mesh file"),
                    )

        logger.info(f"Saved uploaded file: {file_path} ({file_size_mb:.1f}MB)")

        return {
            "file_path": str(file_path),
            "original_filename": upload_file.filename or "unknown",
            "saved_filename": filename,
            "file_size_mb": file_size_mb,
            "content_type": upload_file.content_type or "application/octet-stream",
            "file_type": get_file_type_from_extension(upload_file.filename or filename),
            "validation_info": validation_info,
        }

    except Exception as e:
        if isinstance(e, FileUploadError):
            raise
        raise FileUploadError(upload_file.filename or "unknown", str(e))


async def save_base64_file(
    base64_data: str,
    filename: str,
    destination_dir: str,
    validate_content: bool = True,
    max_size_mb: int = 100,
) -> Dict[str, Union[str, int, float, bool, Dict]]:
    """Save base64 encoded data to file with enhanced validation"""
    try:
        # Create destination directory if it doesn't exist
        Path(destination_dir).mkdir(parents=True, exist_ok=True)

        # Validate base64 data
        is_valid, content_type, decoded_data = validate_base64_data(
            base64_data, max_size_mb * 1024 * 1024
        )
        if not is_valid:
            raise FileUploadError(filename, "Invalid base64 data")

        # Determine file extension from content type or filename
        file_ext = None
        if content_type and content_type in MIME_TYPE_MAPPING:
            file_ext = MIME_TYPE_MAPPING[content_type]

        if not file_ext:
            file_ext = Path(filename).suffix
            if not file_ext:
                # Try to detect from decoded data
                with tempfile.TemporaryDirectory() as temp_dir:
                    temp_path = Path(temp_dir) / "content_probe"
                    temp_path.write_bytes(decoded_data or b"")
                    detected_type = detect_file_type_from_content(str(temp_path))
                if detected_type.startswith("image/"):
                    file_ext = ".png"  # Default to PNG for images
                else:
                    file_ext = ".bin"  # Binary for others

        # Create filename with proper extension
        base_name = Path(filename).stem if filename else "base64_file"
        final_filename = f"{base_name}{file_ext}"

        # Validate file extension
        if not validate_file_extension(
            final_filename, SUPPORTED_IMAGE_FORMATS + SUPPORTED_MESH_FORMATS
        ):
            raise FileUploadError(
                filename,
                f"Unsupported file format. Supported: {SUPPORTED_IMAGE_FORMATS + SUPPORTED_MESH_FORMATS}",
            )

        # Generate unique filename
        unique_filename = generate_filename(final_filename, "b64")
        file_path = Path(destination_dir) / unique_filename

        # Save file
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(decoded_data or b"")

        file_size_mb = get_file_size_mb(str(file_path))

        # Validate content if requested
        validation_info = {}
        if validate_content:
            file_type = get_file_type_from_extension(final_filename)
            if file_type == "image":
                validation_info = validate_image_file(str(file_path))
                if not validation_info.get("valid", False):
                    os.remove(file_path)
                    raise FileUploadError(
                        filename, validation_info.get("error", "Invalid image file")
                    )
            elif file_type == "mesh":
                validation_info = validate_mesh_file(str(file_path))
                if not validation_info.get("valid", False):
                    os.remove(file_path)
                    raise FileUploadError(
                        filename, validation_info.get("error", "Invalid mesh file")
                    )

        logger.info(f"Saved base64 file: {file_path} ({file_size_mb:.1f}MB)")

        return {
            "file_path": str(file_path),
            "original_filename": filename,
            "saved_filename": unique_filename,
            "file_size_mb": file_size_mb,
            "content_type": content_type or "application/octet-stream",
            "file_type": get_file_type_from_extension(final_filename),
            "validation_info": validation_info,
        }

    except Exception as e:
        if isinstance(e, FileUploadError):
            raise
        raise FileUploadError(filename, f"Failed to save base64 data: {str(e)}")


async def process_mixed_input(
    file_upload: Optional[UploadFile] = None,
    base64_data: Optional[str] = None,
    file_path: Optional[str] = None,
    destination_dir: str = "",
    max_size_mb: int = 100,
) -> Dict[str, Union[str, int, float, bool, Dict]]:
    """Process input that can be upload, base64, or existing file path"""
    if sum(bool(x) for x in [file_upload, base64_data, file_path]) != 1:
        raise ValueError(
            "Exactly one of file_upload, base64_data, or file_path must be provided"
        )

    if file_upload:
        return await save_upload_file(file_upload, destination_dir, max_size_mb)
    elif base64_data:
        filename = "uploaded_file"
        return await save_base64_file(base64_data, filename, destination_dir)
    elif file_path:
        # Validate existing file path
        if not os.path.exists(file_path):
            raise FileUploadError(file_path, "File does not exist")

        file_size_mb = get_file_size_mb(file_path)
        file_type = get_file_type_from_extension(file_path)

        validation_info = {}
        if file_type == "image":
            validation_info = validate_image_file(file_path)
            if not validation_info.get("valid", False):
                raise FileUploadError(
                    file_path, validation_info.get("error", "Invalid image file")
                )
        elif file_type == "mesh":
            validation_info = validate_mesh_file(file_path)
            if not validation_info.get("valid", False):
                raise FileUploadError(
                    file_path, validation_info.get("error", "Invalid mesh file")
                )

        return {
            "file_path": file_path,
            "original_filename": os.path.basename(file_path),
            "saved_filename": os.path.basename(file_path),
            "file_size_mb": file_size_mb,
            "content_type": detect_file_type_from_content(file_path),
            "file_type": file_type,
            "validation_info": validation_info,
        }

    # This should never be reached due to the validation at the start
    raise ValueError("Invalid input combination")


def encode_file_to_base64(file_path: str) -> str:
    """Encode a file to base64 string with data URL format"""
    try:
        content_type = detect_file_type_from_content(file_path)

        with open(file_path, "rb") as f:
            encoded_data = base64.b64encode(f.read()).decode("utf-8")

        return f"data:{content_type};base64,{encoded_data}"
    except Exception as e:
        raise FileUploadError(file_path, f"Failed to encode file to base64: {str(e)}")


def cleanup_temp_files(file_paths: List[str]) -> None:
    """Clean up temporary files"""
    for file_path in file_paths:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.debug(f"Cleaned up file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to cleanup file {file_path}: {str(e)}")


async def cleanup_old_files(directory: str, max_age_hours: int = 24) -> int:
    """Clean up files older than specified hours"""
    cleanup_count = 0
    cutoff_time = datetime.now() - timedelta(hours=max_age_hours)

    try:
        for file_path in Path(directory).iterdir():
            if file_path.is_file():
                file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                if file_mtime < cutoff_time:
                    try:
                        file_path.unlink()
                        cleanup_count += 1
                        logger.debug(f"Cleaned up old file: {file_path}")
                    except Exception as e:
                        logger.warning(
                            f"Failed to cleanup old file {file_path}: {str(e)}"
                        )

    except Exception as e:
        logger.error(f"Error during cleanup of directory {directory}: {str(e)}")

    if cleanup_count > 0:
        logger.info(f"Cleaned up {cleanup_count} old files from {directory}")

    return cleanup_count


def ensure_directory(directory: str) -> None:
    """Ensure directory exists, create if it doesn't"""
    Path(directory).mkdir(parents=True, exist_ok=True)


def get_safe_filename(filename: str) -> str:
    """Get safe filename by removing/replacing problematic characters"""
    import re

    # Remove path separators and other problematic characters
    safe_name = re.sub(r'[<>:"/\\|?*]', "_", filename)

    # Limit length
    if len(safe_name) > 255:
        name, ext = os.path.splitext(safe_name)
        safe_name = name[: 255 - len(ext)] + ext

    return safe_name


def copy_file(src: str, dst: str) -> None:
    """Copy file from source to destination"""
    try:
        shutil.copy2(src, dst)
        logger.debug(f"Copied file from {src} to {dst}")
    except Exception as e:
        raise FileUploadError(src, f"Failed to copy file: {str(e)}")


def move_file(src: str, dst: str) -> None:
    """Move file from source to destination"""
    try:
        shutil.move(src, dst)
        logger.debug(f"Moved file from {src} to {dst}")
    except Exception as e:
        raise FileUploadError(src, f"Failed to move file: {str(e)}")


async def create_temp_directory() -> str:
    """Create a temporary directory"""
    temp_dir = tempfile.mkdtemp(prefix="p3d_")
    logger.debug(f"Created temporary directory: {temp_dir}")
    return temp_dir


def validate_file_extension(filename: str, allowed_extensions: List[str]) -> bool:
    """Validate file extension against allowed list"""
    file_ext = Path(filename).suffix.lower()
    return file_ext in [ext.lower() for ext in allowed_extensions]


def get_file_type_from_extension(filename: str) -> str:
    """Get file type based on extension"""
    ext = Path(filename).suffix.lower()

    if ext in SUPPORTED_IMAGE_FORMATS:
        return "image"
    elif ext in SUPPORTED_MESH_FORMATS:
        return "mesh"
    elif ext in SUPPORTED_TEXTURE_FORMATS:
        return "texture"
    else:
        return "unknown"

def get_storage_base_dir() -> Path:
    """Return canonical storage base directory (e.g. backend/storage)."""
    env_path = os.environ.get("STORAGE_LOCAL_PATH", "").strip()
    if env_path:
        base = Path(env_path)
        if not base.is_absolute():
            # Resolve relative paths from the project root, not from the backend dir.
            # changes made by user - fixed backend/backend/storage bug
            base = (Path(__file__).resolve().parents[3] / base).resolve()
    else:
        base = (Path(__file__).resolve().parents[2] / "storage").resolve()
    base.mkdir(parents=True, exist_ok=True)
    return base


class OutputPathGenerator:
    """Utility class for generating output file paths within canonical storage."""

    def __init__(self, base_output_dir: Optional[Union[str, Path]] = None):
        storage_base = get_storage_base_dir()
        if base_output_dir is None or str(base_output_dir).strip() in ("outputs", "./outputs", "storage", "./storage"):
            self.base_output_dir = storage_base / "models"
        else:
            p = Path(base_output_dir)
            if not p.is_absolute():
                self.base_output_dir = (storage_base / p).resolve()
            else:
                self.base_output_dir = p
        self.base_output_dir.mkdir(parents=True, exist_ok=True)

    def generate_mesh_path(
        self,
        model_id: str,
        base_name: str,
        output_format: str = "glb",
        subdirectory: str = "meshes",
    ) -> Path:
        """Generate output path for mesh files."""
        output_dir = self.base_output_dir / subdirectory
        output_dir.mkdir(parents=True, exist_ok=True)

        unique_id = uuid.uuid4().hex
        filename = f"{model_id}_{base_name}_{unique_id}.{output_format}"

        return output_dir / filename

    def generate_segmentation_path(
        self,
        model_id: str,
        base_name: str,
        output_format: str = "glb",
        subdirectory: str = "segmented",
    ) -> Path:
        """Generate output path for segmented mesh files."""
        output_dir = self.base_output_dir / subdirectory
        output_dir.mkdir(parents=True, exist_ok=True)

        unique_id = uuid.uuid4().hex
        filename = f"{model_id}_{base_name}_{unique_id}.{output_format}"

        return output_dir / filename

    def generate_rigged_path(
        self,
        model_id: str,
        base_name: str,
        output_format: str = "fbx",
        subdirectory: str = "rigged",
    ) -> Path:
        """Generate output path for rigged mesh files."""
        output_dir = self.base_output_dir / subdirectory
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = int(time.time())
        filename = f"{model_id}_{base_name}_{timestamp}.{output_format}"

        return output_dir / filename

    def generate_info_path(self, mesh_path: Path) -> Path:
        """Generate corresponding JSON info path for a mesh file."""
        return mesh_path.with_suffix(".json")

    def generate_temp_path(self, base_name: str, extension: str = "glb") -> Path:
        """Generate temporary file path."""
        temp_dir = self.base_output_dir / "temp"
        temp_dir.mkdir(parents=True, exist_ok=True)

        unique_id = uuid.uuid4().hex
        filename = f"temp_{base_name}_{unique_id}.{extension}"

        return temp_dir / filename

    def cleanup_temp_files(self, max_age_hours: int = 24):
        """Clean up temporary files older than specified hours."""
        temp_dir = self.base_output_dir / "temp"
        if not temp_dir.exists():
            return

        current_time = time.time()
        max_age_seconds = max_age_hours * 3600

        for temp_file in temp_dir.iterdir():
            if temp_file.is_file():
                file_age = current_time - temp_file.stat().st_mtime
                if file_age > max_age_seconds:
                    try:
                        temp_file.unlink()
                        logger.info(f"Cleaned up temp file: {temp_file}")
                    except Exception as e:
                        logger.warning(
                            f"Failed to cleanup temp file {temp_file}: {str(e)}"
                        )


# ==============================================================================
# Workspace Storage Manager & Manifest Projection (Docs/TASKS.md §21 & §22)
# ==============================================================================

class WorkspaceStorageManager:
    """Manages filesystem hierarchy strictly conforming to Section 21 & 22."""

    def __init__(self, storage_root: Optional[Union[str, Path]] = None):
        if storage_root is not None:
            self.storage_root = Path(storage_root).resolve()
        else:
            self.storage_root = get_storage_base_dir().resolve()
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.temp_root = self.storage_root / "temp"
        self.temp_root.mkdir(parents=True, exist_ok=True)

    def assert_safe_id(self, identifier: str) -> None:
        """Validate that an identifier contains no path traversal sequences."""
        if not identifier:
            raise ValueError("Identifier cannot be empty")
        if ".." in identifier or "/" in identifier or "\\" in identifier:
            raise ValueError(f"Path traversal detected in identifier: {identifier}")
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", identifier):
            raise ValueError(f"Invalid identifier contains illegal characters: {identifier}")

    def mint_workspace_id(self, stem: str, existing_ids: Optional[Set[str]] = None) -> str:
        """Generate collision-safe workspace identifier <name>_<short-hash>."""
        clean = re.sub(r"[^a-zA-Z0-9_-]", "_", stem).strip("_").lower()[:32] or "workspace"
        existing = existing_ids or set()
        while True:
            short_hash = hashlib.sha256(f"{clean}:{time.time_ns()}:{uuid.uuid4().hex}".encode()).hexdigest()[:6]
            candidate = f"{clean}_{short_hash}"
            if candidate not in existing:
                return candidate

    def get_workspace_dir(self, workspace_id: str) -> Path:
        """Resolve workspace directory and ensure no path traversal escaping storage root."""
        self.assert_safe_id(workspace_id)
        target = (self.storage_root / workspace_id).resolve()
        if not target.is_relative_to(self.storage_root):
            raise ValueError(f"Path traversal detected: {workspace_id}")
        return target

    def create_workspace_tree(self, workspace_id: str, create_subdirs: bool = True) -> Path:
        """Create Section 21 workspace directory structure."""
        ws_dir = self.get_workspace_dir(workspace_id)
        ws_dir.mkdir(parents=True, exist_ok=True)
        if create_subdirs:
            (ws_dir / "input").mkdir(exist_ok=True)
            (ws_dir / "mesh").mkdir(exist_ok=True)
        return ws_dir

    def create_operation_temp(self, operation_id: str) -> Path:
        """Stage temporary operation resources under storage/temp/<operation_id>/."""
        self.assert_safe_id(operation_id)
        op_temp = (self.temp_root / operation_id).resolve()
        if not op_temp.is_relative_to(self.temp_root):
            raise ValueError(f"Path traversal detected in operation_id: {operation_id}")
        op_temp.mkdir(parents=True, exist_ok=True)
        return op_temp

    def get_version_mesh_path(self, workspace_id: str, operation_type: str, ext: str, dest_dir: Path) -> Path:
        """Generate collision-safe/version-safe mesh filename (_v002, _v003, etc.)."""
        final_mesh_name = f"{workspace_id}_{operation_type}{ext}"
        final_mesh_path = dest_dir / final_mesh_name
        version = 2
        while final_mesh_path.exists():
            final_mesh_name = f"{workspace_id}_{operation_type}_v{version:03d}{ext}"
            final_mesh_path = dest_dir / final_mesh_name
            version += 1
        return final_mesh_path

    def publish_derived_mesh(
        self,
        workspace_id: str,
        operation_type: str,
        temp_mesh_path: Path,
        temp_thumbnail_path: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Atomic publication conforming to Section 21 & Section 22.7."""
        ws_dir = self.get_workspace_dir(workspace_id)
        tool_folder_map = {
            "texture": ws_dir / "texture" / "pbr",
            "segmentation": ws_dir / "segmentation",
            "retopology": ws_dir / "retopology",
            "uv": ws_dir / "uv",
            "rigging": ws_dir / "rigging",
            "animation": ws_dir / "animation",
        }
        dest_dir = tool_folder_map.get(operation_type, ws_dir / operation_type)
        dest_dir.mkdir(parents=True, exist_ok=True)

        ext = temp_mesh_path.suffix.lower()
        final_mesh_path = self.get_version_mesh_path(workspace_id, operation_type, ext, dest_dir)

        # Atomic publication: copy to staging path then replace
        staging_path = dest_dir / f".staging_{uuid.uuid4().hex}"
        shutil.copy2(temp_mesh_path, staging_path)
        staging_path.replace(final_mesh_path)

        # Thumbnail publication
        final_thumb_path = None
        if temp_thumbnail_path and Path(temp_thumbnail_path).exists():
            final_thumb_path = dest_dir / "thumbnail.png"
            thumb_staging = dest_dir / f".staging_thumb_{uuid.uuid4().hex}"
            shutil.copy2(temp_thumbnail_path, thumb_staging)
            thumb_staging.replace(final_thumb_path)

        relative_mesh_path = str(final_mesh_path.relative_to(ws_dir))
        relative_thumb_path = str(final_thumb_path.relative_to(ws_dir)) if final_thumb_path else None

        return {
            "mesh_path": final_mesh_path,
            "relative_mesh_path": relative_mesh_path,
            "thumbnail_path": final_thumb_path,
            "relative_thumbnail_path": relative_thumb_path,
        }

    def write_manifest(self, workspace_id: str, manifest_data: Dict[str, Any]) -> Path:
        """Atomic write of unified workspace metadata.json."""
        ws_dir = self.get_workspace_dir(workspace_id)
        manifest_path = ws_dir / "metadata.json"
        temp_manifest = ws_dir / f".metadata_{uuid.uuid4().hex}.tmp"
        temp_manifest.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")
        temp_manifest.replace(manifest_path)
        return manifest_path

    def read_manifest(self, workspace_id: str) -> Optional[Dict[str, Any]]:
        """Read unified workspace metadata.json."""
        ws_dir = self.get_workspace_dir(workspace_id)
        manifest_path = ws_dir / "metadata.json"
        if not manifest_path.is_file():
            return None
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def build_manifest_projection(self, workspace_id: str, db_manager: Any) -> Dict[str, Any]:
        """Project unified metadata.json from authoritative DB records + verified disk files."""
        ws_dir = self.get_workspace_dir(workspace_id)
        ws = db_manager.get_workspace(workspace_id)
        assets = db_manager.list_workspace_assets(workspace_id)
        now_iso = datetime.utcnow().isoformat()

        manifest_data = {
            "schema_version": "1.0",
            "workspace_id": workspace_id,
            "name": ws.name if ws else workspace_id,
            "active_mesh_asset_id": ws.active_mesh_asset_id if ws else None,
            "source_asset_id": ws.source_asset_id if ws else None,
            "status": ws.status if ws else "active",
            "created_at": ws.created_at.isoformat() if ws and ws.created_at else now_iso,
            "updated_at": ws.updated_at.isoformat() if ws and ws.updated_at else now_iso,
            "assets": [
                {
                    "asset_id": a.asset_id,
                    "relative_path": a.relative_path,
                    "file_type": a.file_type,
                    "original_filename": a.original_filename,
                    "byte_size": a.byte_size,
                    "sha256": a.sha256,
                    "thumbnail_path": a.thumbnail_path,
                    "is_retained": bool(a.is_retained),
                    "verified_on_disk": (ws_dir / a.relative_path).exists(),
                }
                for a in assets
            ],
            "projected_at": now_iso,
        }
        self.write_manifest(workspace_id, manifest_data)
        return manifest_data


_workspace_storage_instance: Optional[WorkspaceStorageManager] = None


def get_workspace_storage_manager(storage_root: Optional[Union[str, Path]] = None) -> WorkspaceStorageManager:
    """Get or create singleton instance of WorkspaceStorageManager."""
    global _workspace_storage_instance
    if _workspace_storage_instance is None or storage_root is not None:
        _workspace_storage_instance = WorkspaceStorageManager(storage_root=storage_root)
    return _workspace_storage_instance

