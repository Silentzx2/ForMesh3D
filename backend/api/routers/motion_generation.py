"""
Motion Generation API endpoints (ARDY and future motion models).

Provides endpoints for text-to-motion generation and interactive animation synthesis.
"""

import logging
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies import get_scheduler, sanitize_error_message
from core.scheduler.database_manager import DatabaseManager
from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.utils.file_utils import get_storage_base_dir, get_workspace_storage_manager
from services.motion_clips import (
    MAX_COMPRESSED_UPLOAD_BYTES,
    MotionClipError,
    MotionClipV1,
    MotionPresetListResponse,
    MotionUploadListResponse,
    delete_uploaded_motion_clip,
    list_motion_presets,
    list_uploaded_motion_clips,
    normalize_ardy_npz_bytes,
    resolve_preset_npz_path,
    resolve_preset_thumbnail_path,
    resolve_upload_npz_path,
    save_uploaded_motion_clip,
    save_generated_motion_clip,
)

logger = logging.getLogger(__name__)

LEGACY_MODEL_PREFERENCES = {
    "ardy-core": "ardy_motion_generation",
    "ardy-g1": "ardy_motion_generation",
}

router = APIRouter(prefix="/motion", tags=["motion"])


class MotionGenerationRequest(BaseModel):
    """Request for motion generation"""

    prompt: str = Field(..., description="Text description of the desired motion")
    duration: float = Field(5.0, description="Duration in seconds", ge=0.5, le=30.0)
    seed: Optional[int] = Field(None, description="Random seed for reproducibility")
    checkpoint: Optional[str] = Field(
        "ARDY-Core-RP-20FPS-Horizon40",
        description="ARDY model checkpoint variant (e.g. core40, core8, g1_52, g1_8)",
    )
    post_process: bool = Field(True, description="Apply motion post-processing/foot skating cleanup")
    target_skeleton: Optional[str] = Field("core", description="Target skeleton ('core' or 'g1')")
    target_bones: Optional[List[str]] = Field(
        None, description="Optional target armature bone names for compatibility check"
    )
    constraints: Optional[Any] = Field(None, description="Kinematic or waypoint constraints")
    model_preference: str = Field(
        "ardy_motion_generation", description="Name of the motion generation model to use"
    )
    workspace_id: Optional[str] = Field(None, description="Workspace ID")
    input_asset_id: Optional[str] = Field(None, description="Input rigged mesh asset ID")
    model_parameters: Optional[Dict[str, Any]] = Field(
        None, description="Model-specific parameters"
    )

    model_config = ConfigDict(protected_namespaces=("settings_",))


class MotionGenerationResponse(BaseModel):
    """Response for motion generation request"""

    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")
    workspace_id: Optional[str] = Field(None, description="Workspace ID")
    operation_id: Optional[str] = Field(None, description="Operation ID")


@router.post("", response_model=MotionGenerationResponse)
async def generate_motion(
    request: MotionGenerationRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """
    Generate character animation / motion from a text prompt using ARDY.
    """
    user_id = None

    # Old clients used skeleton labels as model IDs; ARDY variants are checkpoints
    # of one registered model, not separately registered scheduler models.
    feature = "motion_generation"
    model_preference = LEGACY_MODEL_PREFERENCES.get(request.model_preference, request.model_preference)
    if not scheduler.validate_model_preference(model_preference, feature):
        available_models = scheduler.get_available_models(feature)
        feature_models = available_models.get(feature, [])
        if not feature_models:
            raise HTTPException(
                status_code=400,
                detail=f"No models available for feature '{feature}'. Please ensure ARDY is enabled in models.yaml.",
            )
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_preference}' is not available for feature '{feature}'. "
            f"Available models: {feature_models}",
        )

    try:
        db = DatabaseManager()
        ws_storage = get_workspace_storage_manager()

        target_ws_id = request.workspace_id
        input_asset = None
        if request.input_asset_id:
            input_asset = db.get_asset(request.input_asset_id)
            if input_asset and not target_ws_id:
                target_ws_id = input_asset.workspace_id

        operation_id = None
        if target_ws_id:
            from backend.core.scheduler.database_manager import generate_operation_id
            op_row, _ = db.enqueue_operation(
                operation_id=generate_operation_id(),
                workspace_id=target_ws_id,
                operation_type="animation",
                input_asset_id=input_asset.asset_id if input_asset else None,
                settings={
                    "prompt": request.prompt.strip(),
                    "duration": float(request.duration),
                    "checkpoint": request.checkpoint,
                    "target_skeleton": request.target_skeleton,
                },
            )
            operation_id = op_row.operation_id

        job_inputs = {
            "prompt": request.prompt.strip(),
            "duration": float(request.duration),
            "seed": request.seed,
            "checkpoint": request.checkpoint,
            "post_process": request.post_process,
            "target_skeleton": request.target_skeleton,
            "target_bones": request.target_bones,
            "constraints": request.constraints,
            "workspace_id": target_ws_id,
            "input_asset_id": request.input_asset_id,
            "operation_id": operation_id,
            **(request.model_parameters or {}),
        }

        job_request = JobRequest(
            feature=feature,
            inputs=job_inputs,
            model_preference=model_preference,
            priority=1,
            metadata={
                "feature_type": feature,
                "prompt": request.prompt,
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MotionGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Motion generation job queued successfully",
            workspace_id=target_ws_id,
            operation_id=operation_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scheduling motion generation job: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_message(f"Failed to schedule job: {e}"))


@router.get("/checkpoints")
async def get_checkpoints():
    """Get available ARDY checkpoint variants."""
    return {
        "checkpoints": [
            "ARDY-Core-RP-20FPS-Horizon40",
            "ARDY-Core-RP-20FPS-Horizon8",
            "ARDY-G1-RP-25FPS-Horizon52",
            "ARDY-G1-RP-25FPS-Horizon8",
            "ardy_lite",
            "ardy_full",
        ],
        "default": "ARDY-Core-RP-20FPS-Horizon40",
        "checkpoint_details": [
            {
                "id": "ARDY-Core-RP-20FPS-Horizon40",
                "nickname": "core40",
                "skeleton": "core",
                "fps": 20,
                "horizon": 40,
                "description": "Core human skeleton, 20 FPS, 40-step horizon (recommended for standard characters)",
            },
            {
                "id": "ARDY-Core-RP-20FPS-Horizon8",
                "nickname": "core8",
                "skeleton": "core",
                "fps": 20,
                "horizon": 8,
                "description": "Core human skeleton, 20 FPS, 8-step horizon (faster reactive transitions)",
            },
            {
                "id": "ARDY-G1-RP-25FPS-Horizon52",
                "nickname": "g1_52",
                "skeleton": "g1",
                "fps": 25,
                "horizon": 52,
                "description": "Unitree G1 humanoid skeleton, 25 FPS, 52-step horizon",
            },
            {
                "id": "ARDY-G1-RP-25FPS-Horizon8",
                "nickname": "g1_8",
                "skeleton": "g1",
                "fps": 25,
                "horizon": 8,
                "description": "Unitree G1 humanoid skeleton, 25 FPS, 8-step horizon",
            },
            {
                "id": "ardy_lite",
                "nickname": "ardy_lite",
                "skeleton": "core",
                "fps": 20,
                "horizon": 8,
                "description": "ARDY Lite (Fast inference, ~6GB VRAM)",
            },
            {
                "id": "ardy_full",
                "nickname": "ardy_full",
                "skeleton": "core",
                "fps": 20,
                "horizon": 40,
                "description": "ARDY Full (High fidelity, ~8GB VRAM)",
            },
        ],
    }


@router.get("/available-models")
async def get_available_models(
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """Get available motion generation models."""
    try:
        available_models = scheduler.get_available_models("motion_generation")
        models_info = available_models.get("motion_generation", [])
        return {
            "available_models": models_info,
            "models": [
                {
                    "id": m,
                    "name": "ARDY Motion Generation",
                    "description": "NVIDIA ARDY Autoregressive Motion Generation",
                    "supported_formats": ["json", "npz", "bvh"],
                }
                for m in models_info
            ],
            "models_details": {
                m: {"description": "NVIDIA ARDY Autoregressive Motion Generation"}
                for m in models_info
            },
        }
    except Exception as e:
        logger.error(f"Error getting available motion models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/supported-formats")
async def get_supported_formats():
    """Get supported input and output formats."""
    return {
        "input_formats": {
            "text": ["prompt", "text"],
        },
        "output_formats": {
            "mesh": ["json", "npz", "bvh"],
        },
        "artifact_type": "motion",
    }


_SAFE_CLIP_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


async def _resolve_job_or_asset_motion_npz(
    clip_id: str,
    scheduler: MultiprocessModelScheduler,
) -> tuple[Path, str]:
    """
    Resolve a completed ARDY job or motion asset ID to a contained .npz path
    inside backend/storage/ without exposing filesystem paths.
    """
    if not _SAFE_CLIP_ID_RE.fullmatch(clip_id):
        raise HTTPException(status_code=404, detail="Motion clip not found")

    storage_base = get_storage_base_dir().resolve()
    db = DatabaseManager()

    # 1. Try asset_id directly (e.g. ast_...)
    asset = db.get_asset(clip_id)
    if asset is not None:
        if asset.file_type != "motion":
            raise HTTPException(status_code=404, detail="Motion clip not found")
        candidate = (storage_base / asset.workspace_id / asset.relative_path)
        if candidate.is_symlink():
            raise HTTPException(status_code=404, detail="Motion clip not found")
        resolved = candidate.resolve()
        if not resolved.is_relative_to(storage_base) or not resolved.is_file():
            raise HTTPException(status_code=404, detail="Motion clip not found")
        return resolved, asset.original_filename or clip_id

    # 2. Try job_id (accepting either raw job_id or "job-<job_id>")
    raw_job_id = clip_id[4:] if clip_id.startswith("job-") else clip_id
    job_status = await scheduler.get_job_status(raw_job_id)
    if job_status is None:
        raise HTTPException(status_code=404, detail="Motion clip not found")
    if job_status.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Motion clip not ready")

    result = job_status.get("result") or {}
    if result.get("artifact_type") != "motion":
        raise HTTPException(status_code=404, detail="Motion clip not found")

    if result.get("asset_id"):
        asset = db.get_asset(str(result["asset_id"]))
        if asset is not None and asset.file_type == "motion":
            candidate = storage_base / asset.workspace_id / asset.relative_path
            if not candidate.is_symlink():
                resolved = candidate.resolve()
                if resolved.is_relative_to(storage_base) and resolved.is_file():
                    return resolved, asset.original_filename or clip_id

    for path_key in ("output_motion_path", "output_path", "file_path"):
        raw_path = result.get(path_key)
        if not raw_path:
            continue
        candidate = Path(str(raw_path))
        if candidate.is_symlink():
            continue
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if resolved.is_relative_to(storage_base) and resolved.is_file():
            return resolved, resolved.stem

    raise HTTPException(status_code=404, detail="Motion clip not found")


@router.get("/presets", response_model=MotionPresetListResponse)
async def get_motion_presets():
    """List only bundled, read-only premade motion presets from backend/motion_presets/."""
    return list_motion_presets()


@router.get("/presets/{preset_id}/thumbnail")
async def get_motion_preset_thumbnail(preset_id: str):
    """Serve sibling PNG/WEBP thumbnail for a validated preset ID."""
    try:
        thumb_path, media_type = resolve_preset_thumbnail_path(preset_id)
    except MotionClipError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    return FileResponse(path=str(thumb_path), media_type=media_type)


async def _read_bounded_npz_upload(file: UploadFile) -> tuple[bytes, str]:
    """Read a multipart .npz upload with strict size bounds and guaranteed close."""
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".npz"):
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="Unsupported media type: expected a .npz motion archive",
        )

    with tempfile.TemporaryDirectory(prefix="formesh_motion_upload_") as tmp_dir:
        tmp_path = Path(tmp_dir) / "upload.npz"
        total_read = 0
        try:
            with tmp_path.open("wb") as out_handle:
                while True:
                    chunk = await file.read(65536)
                    if not chunk:
                        break
                    total_read += len(chunk)
                    if total_read > MAX_COMPRESSED_UPLOAD_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="NPZ upload exceeds maximum compressed size limit",
                        )
                    out_handle.write(chunk)
        finally:
            await file.close()

        if total_read == 0:
            raise HTTPException(status_code=400, detail="Uploaded NPZ file is empty")

        return tmp_path.read_bytes(), filename


@router.get("/uploads", response_model=MotionUploadListResponse)
async def get_uploaded_motion_clips():
    """List user-uploaded and generated presets from backend/storage/presets/."""
    return list_uploaded_motion_clips()


@router.post("/uploads", response_model=MotionClipV1)
async def upload_motion_clip(file: UploadFile = File(...)):
    """
    Validate and permanently save an uploaded NPZ in backend/storage/presets/.
    This is separate from bundled premade presets and workspace asset directories.
    """
    raw_bytes, filename = await _read_bounded_npz_upload(file)
    try:
        return save_uploaded_motion_clip(raw_bytes, filename=filename)
    except MotionClipError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.post("/uploads/from-clip/{clip_id}", response_model=MotionClipV1)
async def save_generated_motion_clip_to_library(
    clip_id: str,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """Copy a completed ARDY job/asset artifact into the persistent user preset library."""
    npz_path, source_name = await _resolve_job_or_asset_motion_npz(clip_id, scheduler)
    try:
        if npz_path.stat().st_size > MAX_COMPRESSED_UPLOAD_BYTES:
            raise MotionClipError(413, "Generated NPZ exceeds maximum compressed size limit")
        return save_generated_motion_clip(npz_path.read_bytes(), source_clip_id=clip_id, name=source_name)
    except MotionClipError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    except OSError:
        raise HTTPException(status_code=404, detail="Generated motion clip not found") from None


@router.delete("/uploads/{clip_id}")
async def remove_uploaded_motion_clip(clip_id: str):
    """Delete a user-owned preset directory from backend/storage/presets/."""
    try:
        delete_uploaded_motion_clip(clip_id)
    except MotionClipError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    return {"deleted": True, "id": clip_id}


@router.post("/clips/preview", response_model=MotionClipV1)
async def preview_motion_clip(file: UploadFile = File(...)):
    """
    Validate and normalize an uploaded NPZ motion clip without persisting it
    to backend/storage/ or backend/motion_presets/.
    """
    raw_bytes, filename = await _read_bounded_npz_upload(file)
    clip_name = Path(filename).stem or "Preview Motion"
    try:
        return normalize_ardy_npz_bytes(
            raw_bytes,
            clip_id="preview",
            name_override=clip_name,
        )
    except MotionClipError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.get("/clips/{clip_id}", response_model=MotionClipV1)
async def get_motion_clip(
    clip_id: str,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """
    Return normalized MotionClipV1 for:
    (a) a bundled preset ID in backend/motion_presets/,
    (b) a user-owned preset ID in backend/storage/presets/ (including legacy uploads), or
    (c) a completed ARDY job/asset ID (motion_clip_id).
    """
    # 1. Check presets directory
    try:
        preset_path = resolve_preset_npz_path(clip_id)
        return normalize_ardy_npz_bytes(preset_path.read_bytes(), clip_id=clip_id)
    except MotionClipError as exc:
        if exc.status_code != 404:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None

    # 2. Check user-uploaded clips directory
    try:
        upload_path, name_override = resolve_upload_npz_path(clip_id)
        return normalize_ardy_npz_bytes(
            upload_path.read_bytes(), clip_id=clip_id, name_override=name_override
        )
    except MotionClipError as exc:
        if exc.status_code != 404:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None

    # 3. Check completed ARDY job / motion asset
    npz_path, _ = await _resolve_job_or_asset_motion_npz(clip_id, scheduler)
    try:
        return normalize_ardy_npz_bytes(npz_path.read_bytes(), clip_id=clip_id)
    except MotionClipError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
