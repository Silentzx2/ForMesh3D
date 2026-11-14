"""
Mesh retopology API endpoints.

Provides endpoints for optimizing mesh topology through retopology operations.
"""

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.dependencies import get_file_store, get_scheduler, sanitize_error_message
from api.routers.file_upload import resolve_file_id_async, resolve_input_reference_async
from core.file_store import FileStore
from core.scheduler.database_manager import DatabaseManager
from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.utils.file_utils import get_storage_base_dir, get_workspace_storage_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mesh-retopology", tags=["mesh_retopology"])


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
class MeshRetopologyRequest(BaseModel):
    """Request for mesh retopology"""

    mesh_path: Optional[str] = Field(None, description="Path to the input mesh file")
    mesh_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    target_vertex_count: Optional[int] = Field(
        None, description="Deprecated compatibility field; the V1K checkpoint fixes output resolution and ignores this value", ge=100, le=20000
    )
    target_polycount: Optional[int] = Field(
        50000, description="Final production triangle budget applied after FastMesh retopology", ge=5000, le=200000
    )
    poly_type: Optional[str] = Field(
        "tri", description="Specification of the polygon type"
    )
    output_format: str = Field("obj", description="Output format for retopologized mesh")
    seed: Optional[int] = Field(None, description="Random seed for reproducibility")
    model_preference: str = Field(
        "fastmesh_v1k_retopology",
        description="Retopology model preference; currently only fastmesh_v1k_retopology is registered",
    )
    model_parameters: Optional[dict] = Field(
        None, 
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v):
        allowed_formats = ["obj", "glb", "ply"]
        if v not in allowed_formats:
            raise ValueError(f"Output format must be one of: {allowed_formats}")
        return v

    @field_validator("poly_type")
    @classmethod
    def validate_poly_type(cls, v):
        allowed_poly_types = ["tri", "quad"]
        if v not in allowed_poly_types:
            raise ValueError(f"Polygon type must be one of: {allowed_poly_types}")
        return v

    workspace_id: Optional[str] = Field(None, description="Target workspace ID")

    @model_validator(mode="after")
    def validate_inputs(self):
        inputs_provided = sum(bool(x) for x in [self.mesh_path, self.mesh_file_id])

        if inputs_provided == 0 and not getattr(self, "workspace_id", None):
            raise ValueError("One of mesh_path, mesh_file_id, or workspace_id must be provided")
        if inputs_provided > 1:
            raise ValueError("Only one of mesh_path or mesh_file_id should be provided")
        return self

    model_config = ConfigDict(protected_namespaces=("settings_",))


# Response models
class MeshRetopologyResponse(BaseModel):
    """Response for mesh retopology requests"""

    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")
    workspace_id: Optional[str] = Field(None, description="Workspace ID")
    operation_id: Optional[str] = Field(None, description="Operation ID")


@router.post("/retopologize-mesh", response_model=MeshRetopologyResponse)
async def retopologize_mesh(
    request: MeshRetopologyRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Retopologize a 3D mesh to optimize its topology.

    This endpoint optimizes mesh topology by converting high-resolution meshes
    to lower-polygon versions while preserving shape and features.

    Args:
        request: Mesh retopology parameters
        scheduler: Model scheduler dependency

    Returns:
        Job information for the retopology task
    """
    try:
        # Validate model preference
        validate_model_preference(
            request.model_preference, "mesh_retopology", scheduler
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

        # Process mesh input
        mesh_file_path = None

        if request.mesh_file_id:
            # Handle file ID (uses Redis in multi-worker mode)
            mesh_file_path = await resolve_file_id_async(request.mesh_file_id, file_store)
            if not mesh_file_path:
                raise HTTPException(
                    status_code=404, detail="Mesh file not found or expired"
                )
        elif request.mesh_path:
            # mesh_path may be a download URL or bare /{file_id} path from an upstream job
            mesh_file_path = await resolve_input_reference_async(
                request.mesh_path, file_store
            ) or request.mesh_path

        # Resolve server path if URL or relative path was provided
        if mesh_file_path:
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

        # Validate tool prerequisites
        if not mesh_file_path:
            raise HTTPException(
                status_code=400, detail="Mesh path or file ID must be provided"
            )

        if not Path(mesh_file_path).exists():
            raise HTTPException(
                status_code=404, detail="Mesh file not found"
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
                operation_type="retopology",
                input_asset_id=input_asset.asset_id if input_asset else None,
                settings={
                    "target_polycount": request.target_polycount,
                    "poly_type": request.poly_type,
                    "output_format": request.output_format,
                },
            )
            operation_id = op_row.operation_id
            ws_storage.create_operation_temp(operation_id)

        # Create job request
        user_id = None
        job_request = JobRequest(
            feature="mesh_retopology",
            inputs={
                "mesh_path": mesh_file_path,
                "target_polycount": request.target_polycount,
                "poly_type": request.poly_type,
                "output_format": request.output_format,
                "seed": request.seed,
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
                **(request.model_parameters or {}),
            },
            model_preference=request.model_preference,
            priority=1,
            metadata={
                "postprocess_mode": "manual_mesh_tool",
                "feature_type": "mesh_retopology",
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshRetopologyResponse(
            job_id=job_id,
            status="queued",
            message="Mesh retopology job queued successfully",
            workspace_id=target_ws_id,
            operation_id=operation_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scheduling mesh retopology job: {str(e)}")
        raise HTTPException(
            status_code=500, detail=sanitize_error_message(f"Failed to schedule job: {str(e)}")
        )


@router.get("/supported-formats")
async def get_supported_formats():
    """
    Get supported input and output formats for mesh retopology.

    Returns:
        Dictionary of supported formats
    """
    return {
        "input_formats": ["obj", "glb", "ply", "stl"],
        "output_formats": ["obj", "glb", "ply"],
    }


@router.get("/available-models")
async def get_available_models(
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """
    Get available retopology models and their specifications.

    Args:
        scheduler: Model scheduler dependency

    Returns:
        Dictionary of available models with their details
    """
    try:
        available_models = scheduler.get_available_models("mesh_retopology")
        models_info = available_models.get("mesh_retopology", [])

        # Add additional model descriptions
        models_details = {}
        for model_id in models_info:
            if "v1k" in model_id.lower():
                models_details[model_id] = {
                    "description": "FastMesh V1K - Generates meshes with ~1000 vertices",
                    "target_vertices": 1000,
                }
            else:
                models_details[model_id] = {
                    "description": "Mesh retopology model",
                    "target_vertices": None,
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
