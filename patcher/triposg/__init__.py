# TripoSG model-specific patcher package.
# The patcher is applied explicitly from triposg_adapter._load_model()
# (see backend/adapters/triposg_adapter.py). Do not auto-apply on import
# to avoid a circular import with the adapter module.
from .output_to_storage import apply_patch  # noqa: F401
