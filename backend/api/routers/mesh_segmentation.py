"""
Mesh segmentation API endpoints.

Provides endpoints for partitioning 3D meshes into semantic parts.
"""

import logging
import os
import shutil
from pathlib import Path
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.dependencies import get_file_store, get_scheduler, sanitize_error_message
from api.routers.file_upload import resolve_file_id_async, resolve_input_reference_async
from core.file_store import FileStore
from core.scheduler.database_manager import DatabaseManager
from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.utils.file_utils import (
    MIME_TYPE_MAPPING,
    SUPPORTED_MESH_FORMATS,
    get_storage_base_dir,
    get_workspace_storage_manager,
    validate_base64_data,
    validate_mesh_file,
)

logger = logging.getLogger(__name__)
MAX_MESH_BASE64_BYTES = 200 * 1024 * 1024

router = APIRouter(prefix="/mesh-segmentation", tags=["mesh_segmentation"])


def validate_model_preference(
    model_preference: str, feature: str, scheduler: MultiprocessModelScheduler
) -> None:
    """
    Validate that the model preference is available for the given feature.

    Args:
        model_preference: The preferred model ID
        feature: The feature type for the job
        scheduler: The model scheduler instance

    Raises:
        HTTPException: If the model preference is invalid
    """
    if not scheduler.validate_model_preference(model_preference, feature):
        available_models = scheduler.get_available_models(feature)
        feature_models = available_models.get(feature, [])

        if not feature_models:
            raise HTTPException(
                status_code=400,
                detail=f"No models available for feature '{feature}'. Please check if models are registered.",
            )

        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_preference}' is not available for feature '{feature}'. "
            f"Available models: {feature_models}",
        )


# Request models
class MeshSegmentationRequest(BaseModel):
    """Request for mesh segmentation"""

    mesh_path: Optional[str] = Field(None, description="Path to mesh file")
    mesh_base64: Optional[str] = Field(None, description="Base64 encoded mesh data")
    mesh_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    num_parts: int = Field(8, description="Target number of parts", ge=2, le=32)
    output_format: str = Field("glb", description="Output format")
    model_preference: str = Field(
        "", description="Model name for mesh segmentation"
    )
    model_parameters: Optional[dict] = Field(
        None, 
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )

    workspace_id: Optional[str] = Field(None, description="Target workspace ID")

    @model_validator(mode="after")
    def validate_inputs(self):
        inputs_provided = sum(
            bool(x) for x in [self.mesh_path, self.mesh_base64, self.mesh_file_id]
        )

        if inputs_provided == 0 and not getattr(self, "workspace_id", None):
            raise ValueError(
                "One of mesh_path, mesh_base64, mesh_file_id, or workspace_id must be provided"
            )
        if inputs_provided > 1:
            raise ValueError(
                "Only one of mesh_path, mesh_base64, or mesh_file_id should be provided"
            )
        return self

    model_config = ConfigDict(protected_namespaces=("settings_",))


# Response models
class MeshSegmentationResponse(BaseModel):
    """Response for mesh segmentation requests"""

    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")
    workspace_id: Optional[str] = Field(None, description="Workspace ID")
    operation_id: Optional[str] = Field(None, description="Operation ID")


@router.post("/segment-mesh", response_model=MeshSegmentationResponse)
async def segment_mesh(
    request: MeshSegmentationRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Segment a 3D mesh into semantic parts.

    Args:
        request: Mesh segmentation parameters
        scheduler: Model scheduler dependency
        current_user: Current authenticated user (required if auth enabled)

    Returns:
        Job information for the segmentation task
    """
    temp_dir = None
    scheduled = False
    try:
        user_id = None

        # Validate model preference
        validate_model_preference(
            request.model_preference, "mesh_segmentation", scheduler
        )

        db = DatabaseManager()
        ws_storage = get_workspace_storage_manager()

        target_ws_id = getattr(request, "workspace_id", None)
        input_asset = None
        if request.mesh_file_id:
            input_asset = db.get_asset(request.mesh_file_id)
            if input_asset:
                if not target_ws_id:
                    target_ws_id = input_asset.workspace_id
                if input_asset.file_type != "mesh":
                    raise HTTPException(
                        status_code=400, detail="Prerequisite failed: Input asset must be a mesh file"
                    )

        # Validate input - either mesh_path, mesh_base64, or mesh_file_id must be provided
        if not any([request.mesh_path, request.mesh_base64, request.mesh_file_id, target_ws_id]):
            raise HTTPException(
                status_code=400,
                detail="One of mesh_path, mesh_base64, mesh_file_id, or workspace_id must be provided",
            )

        # Process mesh input
        mesh_file_path = None

        if request.mesh_file_id:
            # Handle file ID (uses Redis in multi-worker mode)
            mesh_file_path = await resolve_file_id_async(request.mesh_file_id, file_store)
            if not mesh_file_path:
                raise HTTPException(
                    status_code=404, detail="Mesh file not found or expired"
                )
        elif request.mesh_base64:
            valid, content_type, mesh_data = validate_base64_data(
                request.mesh_base64, MAX_MESH_BASE64_BYTES
            )
            if not valid or mesh_data is None:
                raise HTTPException(status_code=400, detail="Invalid or oversized mesh base64 data")

            extension = MIME_TYPE_MAPPING.get(content_type or "")
            if extension not in SUPPORTED_MESH_FORMATS:
                if mesh_data.startswith(b"glTF"):
                    extension = ".glb"
                else:
                    stripped = mesh_data.lstrip()
                    if stripped.startswith(b"{"):
                        extension = ".gltf"
                    elif any(line.startswith((b"v ", b"o ", b"#", b"mtllib ")) for line in mesh_data[:4096].splitlines()[:32]):
                        extension = ".obj"
                    else:
                        raise HTTPException(status_code=400, detail="Unsupported mesh base64 format")
            if extension not in SUPPORTED_MESH_FORMATS:
                raise HTTPException(status_code=400, detail="Unsupported mesh base64 format")

            temp_dir = Path(tempfile.mkdtemp(prefix="mesh_gen_"))
            register_temp_dir = getattr(scheduler, "_register_managed_input_dir", None)
            if callable(register_temp_dir):
                register_temp_dir(temp_dir)
            temp_file = temp_dir / f"uploaded_mesh{extension}"
            temp_file.write_bytes(mesh_data)
            validation_info = await run_in_threadpool(validate_mesh_file, str(temp_file))
            if not validation_info.get("valid"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid mesh data: {validation_info.get('error', 'mesh validation failed')}",
                )
            mesh_file_path = str(temp_file)
        else:
            # mesh_path may be a download URL or bare /{file_id} path from an upstream job
            mesh_file_path = await resolve_input_reference_async(
                request.mesh_path, file_store
            ) or request.mesh_path

        # Resolve server path if URL or relative path was provided
        if mesh_file_path and temp_dir is None:
            from core.utils.file_utils import resolve_server_file_path
            from core.utils.exceptions import FileUploadError
            try:
                mesh_file_path = resolve_server_file_path(mesh_file_path)
            except FileUploadError:
                # Unresolvable URL/path (asset deleted or never registered on disk)
                raise HTTPException(
                    status_code=404,
                    detail="Mesh file not found on the server. Re-import or regenerate the model, then retry.",
                )

        if target_ws_id and not mesh_file_path:
            ws = db.get_workspace(target_ws_id)
            if ws and ws.active_mesh_asset_id:
                active_asset = db.get_asset(ws.active_mesh_asset_id)
                if active_asset:
                    input_asset = active_asset
                    storage_base = get_storage_base_dir().resolve()
                    cand_path = (storage_base / ws.workspace_id / active_asset.relative_path).resolve()
                    if cand_path.is_file() and cand_path.is_relative_to(storage_base):
                        mesh_file_path = str(cand_path)

        # Validate mesh file exists and prerequisite format
        if not mesh_file_path:
            raise HTTPException(
                status_code=400, detail="Mesh path or file ID must be provided"
            )

        if not Path(mesh_file_path).exists():
            raise HTTPException(
                status_code=404, detail=f"Mesh file not found: {mesh_file_path}"
            )

        ext = Path(mesh_file_path).suffix.lower()
        if ext not in {".glb", ".gltf", ".obj", ".ply", ".stl"}:
            raise HTTPException(
                status_code=400, detail=f"Prerequisite failed: Unsupported mesh format {ext}"
            )

        operation_id = None
        if target_ws_id:
            op_row = db.enqueue_operation(
                workspace_id=target_ws_id,
                operation_type="segmentation",
                input_asset_id=input_asset.asset_id if input_asset else None,
                settings={
                    "num_parts": request.num_parts,
                    "output_format": request.output_format,
                },
            )
            operation_id = op_row.operation_id
            ws_storage.create_operation_temp(operation_id)

        # Create job request
        job_request = JobRequest(
            feature="mesh_segmentation",
            inputs={
                "mesh_path": mesh_file_path,
                "num_parts": request.num_parts,
                "output_format": request.output_format,
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
                **(request.model_parameters or {}),
            },
            model_preference=request.model_preference,
            priority=1,
            metadata={
                "postprocess_mode": "manual_mesh_tool",
                "feature_type": "mesh_segmentation",
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
            },
            user_id=user_id,
        )

        if temp_dir:
            job_request.metadata["temp_input_dirs"] = [str(temp_dir)]
        job_id = await scheduler.schedule_job(job_request)
        scheduled = True

        return MeshSegmentationResponse(
            job_id=job_id,
            status="queued",
            message="Mesh segmentation job queued successfully",
            workspace_id=target_ws_id,
            operation_id=operation_id,
        )

    except HTTPException:
        # Re-raise HTTP exceptions (including validation errors)
        raise
    except Exception as e:
        logger.error(f"Error scheduling mesh segmentation job: {str(e)}")
        raise HTTPException(status_code=500, detail=sanitize_error_message(f"Failed to schedule job: {str(e)}"))
    finally:
        if temp_dir and not scheduled:
            shutil.rmtree(temp_dir, ignore_errors=True)
            unregister_temp_dir = getattr(scheduler, "_unregister_managed_input_dir", None)
            if callable(unregister_temp_dir):
                unregister_temp_dir(temp_dir)


@router.get("/supported-formats")
async def get_supported_formats():
    """
    Get supported input and output formats for mesh segmentation.

    Returns:
        Dictionary of supported formats
    """
    return {"input_formats": ["glb"], "output_formats": ["glb"]}


@router.get("/available-models")
async def get_available_models(
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """
    Get available mesh segmentation models and their specifications.
    """
    try:
        available_models = scheduler.get_available_models("mesh_segmentation")
        models_info = available_models.get("mesh_segmentation", [])
        models_details = {
            m: {"description": "Semantic part segmentation model"} for m in models_info
        }
        return {
            "available_models": models_info,
            "models_details": models_details,
        }
    except Exception as e:
        logger.error(f"Error getting available models: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get available models: {str(e)}"
        )
