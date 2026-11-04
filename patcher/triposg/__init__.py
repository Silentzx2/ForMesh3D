# TripoSG model-specific patcher package.
# Apply the output-to-storage patch when this package is imported.
from .output_to_storage import apply_patch  # noqa: F401

apply_patch()
