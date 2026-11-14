"""
Auto-rigging API endpoints.

Provides endpoints for automatically adding bone structures to 3D meshes.
"""

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.dependencies import get_file_store, get_scheduler, sanitize_error_message
from api.routers.file_upload import resolve_file_id_async, resolve_input_reference_async
from core.file_store import FileStore
from core.scheduler.database_manager import DatabaseManager
from core.scheduler.database_models import generate_operation_id
from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.utils.file_utils import get_storage_base_dir, get_workspace_storage_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auto-rigging", tags=["auto_rigging"])


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
class AutoRigRequest(BaseModel):
    """Request for auto-rigging"""

    mesh_path: Optional[str] = Field(None, description="Path to the input mesh file")
    mesh_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    rig_mode: str = Field("skeleton", description="Rig mode for auto-rigging")
    output_format: str = Field("fbx", description="Output format for rigged mesh")
    model_preference: str = Field(
        "skintokens_auto_rigging", description="Name of the auto-rigging model to use"
    )
    model_parameters: Optional[dict] = Field(
        None, 
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v):
        allowed_formats = ["fbx", "glb"]
        v_norm = str(v).lower().strip()
        if v_norm not in allowed_formats:
            raise ValueError(f"Output format must be one of: {allowed_formats}")
        return v_norm

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
class AutoRigResponse(BaseModel):
    """Response for auto-rigging requests"""

    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")
    workspace_id: Optional[str] = Field(None, description="Workspace ID")
    operation_id: Optional[str] = Field(None, description="Operation ID")


@router.post("/generate-rig", response_model=AutoRigResponse)
async def generate_rig(
    request: AutoRigRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Generate bone structure for a 3D mesh.

    Args:
        request: Auto-rigging parameters
        scheduler: Model scheduler dependency

    Returns:
        Job information for the auto-rigging task
    """
    user_id = None
    
    if request.rig_mode.lower() not in ["skeleton", "skin", "full", "humanoid", "quadruped", "generic"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid rig mode. Allowed: humanoid, quadruped, generic, skeleton, skin, full",
        )

    try:
        # Validate model preference
        validate_model_preference(request.model_preference, "auto_rig", scheduler)

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
            if not mesh_file_path and input_asset:
                storage_base = get_storage_base_dir().resolve()
                candidate = (storage_base / input_asset.workspace_id / input_asset.relative_path).resolve()
                if candidate.is_file() and candidate.is_relative_to(storage_base):
                    mesh_file_path = str(candidate)
            if not mesh_file_path:
                raise HTTPException(
                    status_code=404, detail="Mesh file not found or expired"
                )
        else:
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

        # Validate mesh file exists
        if not mesh_file_path:
            raise HTTPException(
                status_code=400, detail="Mesh path or file ID must be provided"
            )

        if not Path(mesh_file_path).exists():
            raise HTTPException(
                status_code=404, detail=f"Mesh file not found: {mesh_file_path}"
            )

        ext = Path(mesh_file_path).suffix.lower()
        if ext not in {".glb", ".gltf", ".obj", ".fbx"}:
            raise HTTPException(
                status_code=400, detail=f"Prerequisite failed: Unsupported mesh format {ext} for auto-rigging"
            )

        operation_id = None
        if target_ws_id:
            gen_op_id = generate_operation_id()
            op_res = db.enqueue_operation(
                operation_id=gen_op_id,
                workspace_id=target_ws_id,
                operation_type="rigging",
                input_asset_id=input_asset.asset_id if input_asset else None,
                settings={
                    "rig_mode": request.rig_mode.lower(),
                    "output_format": request.output_format.lower().strip(),
                },
            )
            op_row = op_res[0] if isinstance(op_res, tuple) else op_res
            operation_id = op_row.operation_id
            ws_storage.create_operation_temp(operation_id)

        # Validate rig type
        job_request = JobRequest(
            feature="auto_rig",
            inputs={
                "rig_mode": request.rig_mode.lower(),
                "mesh_path": mesh_file_path,
                "output_format": request.output_format.lower().strip(),
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
                **(request.model_parameters or {}),
            },
            model_preference=request.model_preference,
            priority=1,
            metadata={
                "feature_type": "auto_rig",
                "workspace_id": target_ws_id,
                "operation_id": operation_id,
            },
            user_id=user_id,
        )

        from core.utils.artifact_utils import sha256_file
        from postprocess.pipeline import prepare_asset_job_workspace

        asset_root, master_path = await run_in_threadpool(
            prepare_asset_job_workspace, mesh_file_path, job_request.job_id
        )
        job_request.inputs["output_dir"] = str(
            asset_root / "rigging" / job_request.job_id
        )
        job_request.metadata.update({
            "asset_root": str(asset_root),
            "source_path": str(Path(mesh_file_path).resolve()),
            "source_master_path": str(master_path),
            "source_sha256": await run_in_threadpool(sha256_file, mesh_file_path),
        })

        job_id = await scheduler.schedule_job(job_request)

        return AutoRigResponse(
            job_id=job_id,
            status="queued",
            message="Auto-rigging job queued successfully",
            workspace_id=target_ws_id,
            operation_id=operation_id,
        )
    except HTTPException as e:
        raise e

    except Exception as e:
        logger.error(f"Error scheduling auto-rig job: {str(e)}")
        raise HTTPException(status_code=500, detail=sanitize_error_message(f"Failed to schedule job: {str(e)}"))


@router.get("/supported-formats")
async def get_supported_formats():
    """
    Get supported input and output formats for auto-rigging.

    Returns:
        Dictionary of supported formats
    """
    return {"input_formats": ["obj", "glb", "fbx"], "output_formats": ["fbx", "glb"]}


@router.get("/available-models")
async def get_available_models(
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """
    Get available auto-rigging models and their specifications.
    """
    try:
        available_models = scheduler.get_available_models("auto_rig")
        models_info = available_models.get("auto_rig", [])
        models_details = {
            m: {"description": "Auto-rigging armature generation model"} for m in models_info
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
