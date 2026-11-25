"""Device-safe chunking for VAST-AI-Research/TripoSR's official color-query helper."""
from __future__ import annotations

from typing import Any


def patch_texture_baker(bake_module: Any, *, torch_module: Any, chunk_size: int = 8192) -> None:
    """Patch only positions_to_colors; official bake_texture/atlas/rasterization remain unchanged."""
    if getattr(bake_module, "_formesh_device_safe", False):
        return
    import numpy as np

    chunk_size = max(1, int(chunk_size))

    def positions_to_colors(model, scene_code, positions_texture, texture_resolution):
        pixels = np.asarray(positions_texture, dtype=np.float32)
        flat = pixels.reshape(-1, 4)
        valid = np.flatnonzero(flat[:, 3] > 0.0)
        rgb = np.zeros((len(flat), 3), dtype=np.float32)
        coordinates = flat[valid, :3]
        with torch_module.no_grad():
            for start in range(0, len(valid), chunk_size):
                stop = min(start + chunk_size, len(valid))
                positions = torch_module.from_numpy(np.ascontiguousarray(coordinates[start:stop])).to(
                    device=scene_code.device, dtype=scene_code.dtype
                )
                colors = model.renderer.query_triplane(model.decoder, positions, scene_code)["color"]
                rgb[valid[start:stop]] = colors.detach().to(
                    device="cpu", dtype=torch_module.float32
                ).numpy().reshape(-1, 3)
        rgba = np.zeros((len(flat), 4), dtype=np.float32)
        rgba[:, :3], rgba[:, 3] = rgb, flat[:, 3]
        rgba[flat[:, 3] == 0.0] = 0.0
        return rgba.reshape(int(texture_resolution), int(texture_resolution), 4)

    bake_module.positions_to_colors = positions_to_colors
    bake_module._formesh_device_safe = True
