"""
Proxy module for multiview_utils forwarding to the vendored Hunyuan3D-2.1 hy3dpaint utils.
Prevents 'No module named utils.multiview_utils' when backend/utils shadows hy3dpaint.
"""
import importlib.util
from pathlib import Path

_target = (
    Path(__file__).resolve().parents[1]
    / "thirdparty" / "Hunyuan3D-2.1" / "hy3dpaint" / "utils" / "multiview_utils.py"
)
if not _target.is_file():
    raise FileNotFoundError(f"Vendored hy3dpaint utils module missing: {_target}")

_spec = importlib.util.spec_from_file_location("_hy3d_multiview_utils_impl", str(_target))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
for _k, _v in _mod.__dict__.items():
    if not _k.startswith("__"):
        globals()[_k] = _v
