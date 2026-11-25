"""TripoSR-only fallback when the prebuilt torchmcubes wheel fails to load (e.g. CUDA 11 vs 12)."""
from __future__ import annotations

import logging
import sys
import types

logger = logging.getLogger(__name__)


def ensure_torchmcubes() -> None:
    """Use native torchmcubes when loadable; otherwise shim with skimage.measure.marching_cubes."""
    try:
        import torchmcubes  # noqa: F401
        return
    except (ImportError, OSError) as exc:
        logger.warning("torchmcubes unavailable (%s); using skimage marching_cubes fallback for TripoSR.", exc)

    import numpy as np
    import torch
    from skimage.measure import marching_cubes as _skimage_mcubes

    def _marching_cubes(volume: torch.Tensor, threshold: float = 0.0):
        arr = volume.detach().cpu().numpy().astype(np.float32, copy=False)
        if not np.any(arr > threshold) or not np.any(arr < threshold):
            return torch.zeros((0, 3), dtype=torch.float32), torch.zeros((0, 3), dtype=torch.long)
        verts, faces, _, _ = _skimage_mcubes(arr, level=float(threshold))
        # Match torchmcubes (z, y, x) output order expected by tsr/models/isosurface.py:50
        verts_zyx = np.ascontiguousarray(verts[:, [2, 1, 0]], dtype=np.float32)
        faces_i64 = np.ascontiguousarray(faces, dtype=np.int64)
        return torch.from_numpy(verts_zyx), torch.from_numpy(faces_i64)

    shim = types.ModuleType("torchmcubes")
    shim.marching_cubes = _marching_cubes  # type: ignore[attr-defined]
    sys.modules["torchmcubes"] = shim
