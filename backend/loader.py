"""Shared model weights directory resolver.

Narrow responsibility: take a model key and return that model's weights
directory under the configured shared storage root.

Does NOT load models, download weights, locate ThirdParty source code,
select a model, configure inference parameters, or handle output
directories. Output paths continue to come from the existing ForMesh3D
job/output contract.
"""

from __future__ import annotations

import os
from pathlib import Path

_DEFAULT_WEIGHTS_ROOT = "backend/pretrained"


def _resolve_repo_root() -> Path:
    """Resolve the stable ForMesh3D repository root.

    Resolves relative to this file (backend/loader.py -> backend/ -> repo
    root), not the incidental process working directory, so the result is
    stable regardless of how the backend or worker was launched.
    """
    return Path(__file__).resolve().parents[1]


def get_model_weights_dir(model_key: str) -> Path:
    """Return the weights directory for a model key.

    Resolves to <MODEL_STORAGE_ROOT>/<model_key>, where MODEL_STORAGE_ROOT
    defaults to ``backend/pretrained``. Relative roots are resolved against
    the repository root (not CWD).

    Args:
        model_key: Canonical model key/name. Appended as a single directory
            component under MODEL_STORAGE_ROOT.

    Returns:
        Absolute path to ``<MODEL_STORAGE_ROOT>/<model_key>``.

    Raises:
        ValueError: If ``model_key`` is unsafe (empty, absolute, or contains
            path traversal).
        FileNotFoundError: If the resolved weights directory does not exist.
    """
    if not model_key or not isinstance(model_key, str):
        raise ValueError("model_key must be a non-empty string")

    # Reject absolute paths and any ".." segment so a key cannot escape the
    # weights root. Nested components (e.g. "tencent/Hunyuan3D-2.1",
    # "Taobao3D/TaoFlowForge") are allowed and match models.yaml model_path
    # suffixes and download_models.sh's $PRETRAINED_DIR/<subpath> layout.
    parts = model_key.replace("\\", "/").split("/")
    if Path(model_key).is_absolute() or ".." in parts:
        raise ValueError(f"unsafe model_key (no absolute or '..' segments): {model_key!r}")

    root = os.environ.get("MODEL_STORAGE_ROOT", _DEFAULT_WEIGHTS_ROOT)
    root_path = Path(root).expanduser()
    if not root_path.is_absolute():
        root_path = _resolve_repo_root() / root_path

    weights_dir = (root_path / Path(model_key)).resolve()

    if not weights_dir.is_dir():
        raise FileNotFoundError(
            "Model weights directory not found: "
            f"{weights_dir} (MODEL_STORAGE_ROOT={root}, model_key={model_key})"
        )

    return weights_dir
