"""Point Cloud Placeholder Renderer.

Renders mesh vertices as points (fast, no face iteration) so a lightweight
placeholder shows the real mesh geometry shape instantly while the full
stream connects. Single responsibility: placeholder only, nothing else.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)


class PointCloudPlaceholder:
    """Draws mesh vertices as gold points on a dark canvas.

    Used as an instant placeholder before the real WebSocket stream connects.
    No face/polygon rendering — just points, so it is O(vertices) and fast
    even for million-vertex meshes.
    """

    def __init__(self, width: int = 800, height: int = 600):
        self.width = width
        self.height = height
        self.background_color = (18, 22, 29, 255)
        self.point_color = (249, 207, 0, 255)  # Studio Gold

    def render_jpeg(self, vertices: np.ndarray, quality: int = 80) -> bytes:
        """Render vertices as points to JPEG bytes."""
        img = Image.new("RGBA", (self.width, self.height), self.background_color)
        draw = ImageDraw.Draw(img)

        if len(vertices) == 0:
            draw.text(
                (self.width // 2 - 60, self.height // 2 - 10),
                "No Mesh Loaded",
                fill=(160, 160, 170, 200),
            )
        else:
            # Project 3D vertices to 2D screen space (simple orthographic + scale)
            v = np.asarray(vertices, dtype=np.float32)
            center = (v.min(axis=0) + v.max(axis=0)) * 0.5
            v = v - center
            max_ext = float(np.max(np.linalg.norm(v, axis=1)))
            scale = 0.35 * min(self.width, self.height) / max(max_ext, 1e-6)
            v = v * scale

            cx, cy = self.width // 2, self.height // 2
            for x, y, _ in v:
                px = int(cx + x)
                py = int(cy - y)  # flip Y for screen space
                if 0 <= px < self.width and 0 <= py < self.height:
                    draw.point((px, py), fill=self.point_color)

        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=quality)
        return buf.getvalue()
