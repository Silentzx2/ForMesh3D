import logging
import shutil
import tempfile
import time
from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

try:
    import torch
except ImportError:
    torch = None

logger = logging.getLogger(__name__)


class ModelStatus(Enum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    LOADED = "loaded"
    PROCESSING = "processing"
    ERROR = "error"


class BaseModel(ABC):
    """Base class for all AI models"""

    def __init__(
        self,
        vram_requirement: int,
        model_id: str = None,
        model_path: str = None,
        feature_type: str = "unknown",
        **kwargs,
    ):
        self.model_id = model_id
        self.model_path = Path(model_path) if model_path else None
        self.vram_requirement = vram_requirement  # MB
        self.feature_type = feature_type
        self.status = ModelStatus.UNLOADED
        self.gpu_id: Optional[int] = None
        self.gpu_ids: List[int] = []
        self.resource_plan: Optional[Dict[str, Any]] = None
        self.native_topology: bool = False
        self.model = None

    @abstractmethod
    def _load_model(self) -> Any:
        """Load the actual model. Override in subclasses."""
        pass

    @abstractmethod
    def _unload_model(self) -> None:
        """Unload the actual model. Override in subclasses."""
        pass

    @abstractmethod
    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process a single request.

        Returns a dict with at least:
            - "success": bool indicating whether processing succeeded
            - "output_mesh_path" or "mesh_path": path to the produced mesh file
            - "generation_info": dict of adapter-reported metadata (seed, steps, etc.)
        Adapters may include additional keys as needed.
        """
        pass

    def load(self, gpu_id: Optional[int], resource_plan: Optional[Dict[str, Any]] = None) -> bool:
        """Load model on the scheduler-selected CPU or GPU device."""
        if self.status == ModelStatus.LOADED:
            return True

        start_time = time.time()
        device_label = f"GPU {gpu_id}" if gpu_id is not None else "CPU"
        logger.info("[MODEL LOAD START] model=%s device=%s", self.model_id, device_label)
        try:
            self.status = ModelStatus.LOADING
            self.gpu_id = gpu_id
            self.resource_plan = dict(resource_plan or {})
            planned_gpu_ids = self.resource_plan.get("gpu_ids")
            if planned_gpu_ids is None:
                planned_gpu_ids = [] if gpu_id is None else [gpu_id]
            self.gpu_ids = [int(x) for x in planned_gpu_ids if x is not None]

            # Only GPU-backed plans initialize a CUDA context.
            if gpu_id is not None and torch is not None and torch.cuda.is_available():
                torch.cuda.set_device(gpu_id)

            # Load model
            self.model = self._load_model()
            self.status = ModelStatus.LOADED
            elapsed = time.time() - start_time
            memory = ""
            if gpu_id is not None and torch is not None and torch.cuda.is_available():
                try:
                    allocated = torch.cuda.memory_allocated(gpu_id) / (1024 ** 2)
                    reserved = torch.cuda.memory_reserved(gpu_id) / (1024 ** 2)
                    memory = f" allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}"
                except Exception:
                    pass
            logger.info(
                "[MODEL LOAD SUCCESS] model=%s device=%s elapsed=%.2fs%s",
                self.model_id, device_label, elapsed, memory,
            )
            return True

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.exception("[MODEL LOAD FAILED] model=%s device=%s", self.model_id, device_label)
            raise RuntimeError(f"Failed to load model {self.model_id}: {e}") from e

    def unload(self) -> bool:
        """Unload model and release device resources."""
        if self.status == ModelStatus.UNLOADED:
            return True

        start_time = time.time()
        logger.info(f"[MODEL UNLOAD START] model={self.model_id}")
        previous_gpu_ids = list(self.gpu_ids)
        try:
            self._unload_model()
            self.model = None
            self.status = ModelStatus.UNLOADED

            # Clear GPU cache before capturing final memory state.
            if previous_gpu_ids and torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()

            elapsed = time.time() - start_time
            memory = ""
            if previous_gpu_ids and torch is not None and torch.cuda.is_available():
                try:
                    samples = []
                    for gpu_id in previous_gpu_ids:
                        allocated = torch.cuda.memory_allocated(gpu_id) / (1024 ** 2)
                        reserved = torch.cuda.memory_reserved(gpu_id) / (1024 ** 2)
                        samples.append(f"gpu{gpu_id}:allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}")
                    memory = " " + " ".join(samples)
                except Exception:
                    pass

            self.gpu_id = None
            self.gpu_ids = []
            self.resource_plan = None
            logger.info(
                f"[MODEL UNLOAD SUCCESS] model={self.model_id} "
                f"elapsed={elapsed:.2f}s{memory}"
            )
            return True

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"[GPU UNLOAD FAILED] model={self.model_id}: {e}", exc_info=True)
            raise Exception(f"Failed to unload model {self.model_id}: {str(e)}")

    def _create_temporary_output_dir(self, model_prefix: str) -> Path:
        """Create a tracked, adapter-owned directory in the system temp root."""
        safe_prefix = "".join(
            char for char in str(model_prefix).lower()
            if char.isalnum() or char in {"_", "-"}
        ).strip("_-")
        if not safe_prefix:
            raise ValueError("A non-empty temporary output prefix is required")
        directory = Path(tempfile.mkdtemp(prefix=f"formesh3d_{safe_prefix}_")).resolve()
        active = getattr(self, "_active_temporary_output_dirs", None)
        if active is None:
            active = []
            self._active_temporary_output_dirs = active
        active.append(directory)
        return directory

    def _cleanup_active_temporary_output_dirs(self) -> None:
        """Delete only tracked Formesh3D temp directories created by this adapter call."""
        directories = list(getattr(self, "_active_temporary_output_dirs", []) or [])
        self._active_temporary_output_dirs = []
        temp_root = Path(tempfile.gettempdir()).resolve()
        for directory in directories:
            try:
                candidate = Path(directory)
                if candidate.is_symlink():
                    logger.warning("Refusing to clean symlinked adapter output: %s", candidate)
                    continue
                resolved = candidate.resolve(strict=True)
                if (
                    not resolved.is_dir()
                    or resolved.parent != temp_root
                    or not resolved.name.startswith("formesh3d_")
                ):
                    logger.warning("Refusing to clean untrusted adapter output directory: %s", directory)
                    continue
                shutil.rmtree(resolved)
            except FileNotFoundError:
                continue
            except Exception:
                logger.warning("Could not clean adapter output directory %s", directory, exc_info=True)

    def process(self, inputs: Dict[str, Any], progress_callback: Optional[Callable[[str, float, str], None]] = None) -> Dict[str, Any]:
        """Process one request and hand successful temporary outputs to the scheduler."""
        if self.status != ModelStatus.LOADED:
            raise Exception(
                f"Model {self.model_id} is not ready for processing, its status is {self.status}"
            )

        start_time = time.time()
        succeeded = False
        self._active_temporary_output_dirs = []
        logger.info(
            f"[MODEL INFERENCE START] model={self.model_id} "
            f"gpu={self.gpu_id if self.gpu_id is not None else 'cpu'}"
        )
        try:
            self.status = ModelStatus.PROCESSING
            if progress_callback:
                inputs = {**inputs, "progress_callback": progress_callback}
            result = self._process_request(inputs)

            if isinstance(result, dict) and result.get("success") is False:
                elapsed = time.time() - start_time
                error_msg = result.get("error", "Adapter returned failure without exception")
                self.status = ModelStatus.ERROR
                self._cleanup_active_temporary_output_dirs()
                logger.error(
                    f"[MODEL INFERENCE FAILED] model={self.model_id} "
                    f"elapsed={elapsed:.2f}s error={error_msg}"
                )
                return result

            if not isinstance(result, dict):
                self._cleanup_active_temporary_output_dirs()
                raise TypeError(f"Adapter {self.model_id} returned a non-dictionary result")

            directories = list(getattr(self, "_active_temporary_output_dirs", []) or [])
            self._active_temporary_output_dirs = []
            if directories:
                result["_temporary_output_dirs"] = [str(path) for path in directories]

            elapsed = time.time() - start_time
            memory = ""
            if self.gpu_id is not None and torch is not None and torch.cuda.is_available():
                try:
                    allocated = torch.cuda.memory_allocated(self.gpu_id) / (1024 ** 2)
                    reserved = torch.cuda.memory_reserved(self.gpu_id) / (1024 ** 2)
                    memory = f" allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}"
                except Exception:
                    pass
            logger.info(
                f"[MODEL INFERENCE SUCCESS] model={self.model_id} "
                f"elapsed={elapsed:.2f}s{memory}"
            )
            succeeded = True
            return result
        except Exception:
            self._cleanup_active_temporary_output_dirs()
            self.status = ModelStatus.ERROR
            logger.exception("[MODEL INFERENCE FAILED] model=%s", self.model_id)
            raise
        finally:
            if succeeded:
                self.status = ModelStatus.LOADED

    @abstractmethod
    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats"""
        pass
    
    @abstractmethod
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        This method should return a dictionary with parameter specifications including:
        - type: Parameter data type (integer, number, string, boolean)
        - description: Human-readable description
        - default: Default value
        - minimum/maximum: For numeric types
        - enum: List of allowed values
        - required: Whether the parameter is required
        
        Returns:
            Dictionary with "parameters" key containing parameter specifications
        
        Example:
            {
                "parameters": {
                    "seed": {
                        "type": "integer",
                        "description": "Random seed for reproducibility",
                        "default": 42,
                        "minimum": 0,
                        "required": False
                    }
                }
            }
        """
        pass

    def get_info(self) -> Dict[str, Any]:
        """Get model information"""
        return {
            "model_id": self.model_id,
            "feature_type": self.feature_type,
            "status": self.status.value,
            "gpu_id": self.gpu_id,
            "gpu_ids": list(self.gpu_ids),
            "resource_plan": dict(self.resource_plan or {}),
            "vram_requirement": self.vram_requirement,
            "supported_formats": self.get_supported_formats(),
        }
