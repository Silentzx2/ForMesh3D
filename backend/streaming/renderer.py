"""Headless 3D Mesh Renderer for Server-Side Viewport Streaming.

Supports offscreen rendering of 3D meshes (GLB, OBJ, STL, PLY) with
interactive camera controls (orbit, pan, zoom, view presets, shading modes).
Operates headlessly without an X11 server.
"""

from __future__ import annotations

import io
import math
import time
import logging
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw

try:
    import trimesh
except ImportError:
    trimesh = None

logger = logging.getLogger(__name__)


class HeadlessRenderer:
    """Headless 3D Offscreen Renderer for real-time viewport streaming."""

    def __init__(
        self,
        mesh_path: Optional[str] = None,
        width: int = 800,
        height: int = 600,
        fov: float = 45.0,
    ):
        self.width = max(128, min(1920, int(width)))
        self.height = max(128, min(1080, int(height)))
        self.fov = float(fov)

        # Camera spherical coordinates
        self.azimuth = 45.0  # degrees
        self.elevation = 30.0  # degrees
        self.distance = 2.4
        self.target = np.array([0.0, 0.0, 0.0], dtype=np.float32)

        # Rendering options
        self.shading_mode = "clay"  # "clay" | "wireframe" | "normal" | "textured"
        self.show_wireframe = False
        self.background_color = (22, 24, 29, 255)  # Dark studio background matching UI

        # Mesh data
        self.mesh_path: Optional[str] = mesh_path
        self.vertices: np.ndarray = np.empty((0, 3), dtype=np.float32)
        self.faces: np.ndarray = np.empty((0, 3), dtype=np.int32)
        self.normals: np.ndarray = np.empty((0, 3), dtype=np.float32)
        self.vertex_colors: Optional[np.ndarray] = None
        self.dimensions: np.ndarray = np.array([1.0, 1.0, 1.0], dtype=np.float32)

        # Interactive proxy (decimated mesh for instant fluid rotation on heavy assets)
        self.proxy_vertices: np.ndarray = np.empty((0, 3), dtype=np.float32)
        self.proxy_faces: np.ndarray = np.empty((0, 3), dtype=np.int32)
        self.proxy_normals: np.ndarray = np.empty((0, 3), dtype=np.float32)
        self.is_dragging = False

        # State & caching
        self.dirty = True
        self.last_activity = time.time()
        self.last_rendered_image: Optional[Image.Image] = None
        self.last_rendered_jpeg: Optional[bytes] = None

        # Point cloud placeholder mode: renders vertices as points (fast)
        # instead of faces (slow PIL face-by-face). Used for instant first frame.
        self.use_point_cloud = False

        if mesh_path:
            self.load_mesh(mesh_path)

    def load_mesh(self, mesh_or_path: Any) -> bool:
        """Load and normalize a 3D mesh."""
        if trimesh is None:
            logger.error("trimesh is not installed")
            return False

        try:
            if isinstance(mesh_or_path, (str, Path)):
                self.mesh_path = str(mesh_or_path)
                loaded = trimesh.load(self.mesh_path, force="mesh")
            elif isinstance(mesh_or_path, trimesh.Trimesh):
                loaded = mesh_or_path
            elif isinstance(mesh_or_path, trimesh.Scene):
                loaded = loaded.dump(concatenate=True) if hasattr(loaded, "dump") else trimesh.util.concatenate(loaded.dump())
            else:
                logger.error("Unsupported mesh input type: %s", type(mesh_or_path))
                return False

            if not hasattr(loaded, "vertices") or len(loaded.vertices) == 0:
                logger.error("Loaded mesh has no vertices")
                return False

            # Extract raw coordinates
            v = np.asarray(loaded.vertices, dtype=np.float32)
            f = np.asarray(loaded.faces, dtype=np.int32)

            if hasattr(loaded, "extents") and loaded.extents is not None:
                self.dimensions = np.asarray(loaded.extents, dtype=np.float32)
            else:
                self.dimensions = np.asarray(v.max(axis=0) - v.min(axis=0), dtype=np.float32)

            # Center and scale to fit unit sphere [-0.9, 0.9]
            center = (v.min(axis=0) + v.max(axis=0)) * 0.5
            v = v - center
            max_ext = float(np.max(np.linalg.norm(v, axis=1)))
            scale = 0.9 / max(max_ext, 1e-6)
            v = v * scale

            self.vertices = v
            self.faces = f

            # Compute face normals
            v0 = v[f[:, 0]]
            v1 = v[f[:, 1]]
            v2 = v[f[:, 2]]
            fn = np.cross(v1 - v0, v2 - v0)
            norm = np.linalg.norm(fn, axis=1, keepdims=True)
            self.normals = fn / np.maximum(norm, 1e-8)

            # Extract vertex colors if present
            if hasattr(loaded.visual, "vertex_colors") and loaded.visual.vertex_colors is not None:
                colors = np.asarray(loaded.visual.vertex_colors)
                if colors.shape[0] == len(v):
                    self.vertex_colors = colors[:, :3] / 255.0
            else:
                self.vertex_colors = None

            # Generate interactive proxy for very heavy meshes (>12,000 faces)
            if len(f) > 12000:
                step = max(2, len(f) // 8000)
                sub_f = f[::step]
                self.proxy_vertices = v
                self.proxy_faces = sub_f
                self.proxy_normals = self.normals[::step]
            else:
                self.proxy_vertices = v
                self.proxy_faces = f
                self.proxy_normals = self.normals

            self.dirty = True
            self.last_activity = time.time()
            self.use_point_cloud = True  # instant point cloud first frame
            logger.info("Loaded mesh: %d vertices, %d faces", len(v), len(f))
            return True
        except Exception as exc:
            logger.exception("Failed to load mesh: %s", exc)
            return False

    def orbit(self, dx: float, dy: float) -> None:
        """Orbit camera around target with mouse delta."""
        sensitivity = 0.4
        self.azimuth = (self.azimuth + dx * sensitivity) % 360.0
        self.elevation = max(-89.0, min(89.0, self.elevation - dy * sensitivity))
        self.is_dragging = True
        self.dirty = True
        self.last_activity = time.time()

    def pan(self, dx: float, dy: float) -> None:
        """Pan camera parallel to view plane."""
        sensitivity = 0.003 * self.distance
        # Compute camera right and up in world space
        az_rad = math.radians(self.azimuth)
        el_rad = math.radians(self.elevation)

        eye = np.array([
            self.distance * math.cos(el_rad) * math.sin(az_rad),
            self.distance * math.sin(el_rad),
            self.distance * math.cos(el_rad) * math.cos(az_rad),
        ], dtype=np.float32)

        forward = -eye / np.linalg.norm(eye)
        world_up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        right = np.cross(forward, world_up)
        r_norm = np.linalg.norm(right)
        if r_norm > 1e-6:
            right /= r_norm
        up = np.cross(right, forward)

        self.target = self.target - right * (dx * sensitivity) + up * (dy * sensitivity)
        self.is_dragging = True
        self.dirty = True
        self.last_activity = time.time()

    def zoom(self, delta: float) -> None:
        """Zoom camera toward or away from target."""
        factor = 1.0 + delta * 0.0015
        self.distance = max(0.5, min(12.0, self.distance * factor))
        self.dirty = True
        self.last_activity = time.time()

    def end_drag(self) -> None:
        """Signal that interactive drag ended (prompts full-res re-render)."""
        self.is_dragging = False
        self.dirty = True
        self.last_activity = time.time()

    def set_preset(self, preset: str) -> None:
        """Apply canonical view camera preset."""
        preset = preset.lower()
        if preset == "front":
            self.azimuth, self.elevation = 0.0, 0.0
        elif preset == "back":
            self.azimuth, self.elevation = 180.0, 0.0
        elif preset == "top":
            self.azimuth, self.elevation = 0.0, 89.0
        elif preset == "bottom":
            self.azimuth, self.elevation = 0.0, -89.0
        elif preset == "side" or preset == "right":
            self.azimuth, self.elevation = 90.0, 0.0
        elif preset == "left":
            self.azimuth, self.elevation = 270.0, 0.0
        elif preset == "iso":
            self.azimuth, self.elevation = 45.0, 30.0
        self.dirty = True
        self.last_activity = time.time()

    def set_shading(self, mode: str) -> None:
        """Set shading mode ('clay', 'wireframe', 'normal', 'textured')."""
        if mode in ("clay", "wireframe", "normal", "textured"):
            self.shading_mode = mode
            self.dirty = True
            self.last_activity = time.time()

    def set_wireframe(self, enabled: bool) -> None:
        """Toggle wireframe overlay."""
        self.show_wireframe = bool(enabled)
        self.dirty = True
        self.last_activity = time.time()

    def resize(self, width: int, height: int) -> None:
        """Update viewport dimensions."""
        nw = max(128, min(1920, int(width)))
        nh = max(128, min(1080, int(height)))
        if nw != self.width or nh != self.height:
            self.width = nw
            self.height = nh
            self.dirty = True
            self.last_activity = time.time()

    def render_image(self) -> Image.Image:
        """Render the 3D scene to a PIL Image."""
        # Check idle and cached frame
        if not self.dirty and self.last_rendered_image is not None:
            return self.last_rendered_image

        w, h = self.width, self.height
        img = Image.new("RGBA", (w, h), self.background_color)
        draw = ImageDraw.Draw(img)

        # Draw subtle studio floor grid
        self._draw_floor_grid(draw, w, h)

        if len(self.vertices) == 0:
            # Draw placeholder watermark
            draw.text((w // 2 - 60, h // 2 - 10), "No 3D Model Loaded", fill=(160, 160, 170, 200))
            self.last_rendered_image = img
            self.dirty = False
            return img

        # Point cloud mode: render vertices as points (fast, instant first frame)
        if self.use_point_cloud:
            v = self.vertices
            center = (v.min(axis=0) + v.max(axis=0)) * 0.5
            v = v - center
            max_ext = float(np.max(np.linalg.norm(v, axis=1)))
            scale = 0.35 * min(w, h) / max(max_ext, 1e-6)
            v = v * scale
            cx, cy = w // 2, h // 2
            for x, y, _ in v:
                px = int(cx + x)
                py = int(cy - y)
                if 0 <= px < w and 0 <= py < h:
                    draw.point((px, py), fill=(249, 207, 0, 255))  # Studio Gold
            self.last_rendered_image = img
            self.dirty = False
            return img

        # Select full or interactive proxy mesh
        use_proxy = self.is_dragging and len(self.proxy_faces) < len(self.faces)
        v = self.proxy_vertices if use_proxy else self.vertices
        f = self.proxy_faces if use_proxy else self.faces
        fn = self.proxy_normals if use_proxy else self.normals

        # Compute Camera View Matrix (LookAt)
        az_rad = math.radians(self.azimuth)
        el_rad = math.radians(self.elevation)

        eye = self.target + np.array([
            self.distance * math.cos(el_rad) * math.sin(az_rad),
            self.distance * math.sin(el_rad),
            self.distance * math.cos(el_rad) * math.cos(az_rad),
        ], dtype=np.float32)

        forward = self.target - eye
        dist = np.linalg.norm(forward)
        if dist > 1e-6:
            forward /= dist
        else:
            forward = np.array([0.0, 0.0, -1.0], dtype=np.float32)

        world_up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        right = np.cross(forward, world_up)
        r_norm = np.linalg.norm(right)
        if r_norm > 1e-6:
            right /= r_norm
        else:
            right = np.array([1.0, 0.0, 0.0], dtype=np.float32)

        up = np.cross(right, forward)

        # Transform vertices into camera space
        R = np.vstack([right, up, -forward])
        v_cam = (v - eye) @ R.T

        # Perspective Projection
        z_cam = -v_cam[:, 2]
        # Near clip plane guard
        z_safe = np.maximum(z_cam, 0.1)

        aspect = float(w) / float(h)
        f_len = 1.0 / math.tan(math.radians(self.fov) / 2.0)

        x_ndc = (v_cam[:, 0] * f_len / aspect) / z_safe
        y_ndc = (v_cam[:, 1] * f_len) / z_safe

        # Screen coordinates
        screen_x = (x_ndc * 0.5 + 0.5) * w
        screen_y = (1.0 - (y_ndc * 0.5 + 0.5)) * h
        screen_pts = np.column_stack([screen_x, screen_y])

        # Backface culling: test signed area in screen space
        p0 = screen_pts[f[:, 0]]
        p1 = screen_pts[f[:, 1]]
        p2 = screen_pts[f[:, 2]]
        signed_area = (p1[:, 0] - p0[:, 0]) * (p2[:, 1] - p0[:, 1]) - (p1[:, 1] - p0[:, 1]) * (p2[:, 0] - p0[:, 0])
        visible_mask = (signed_area > 0) & (z_cam[f[:, 0]] > 0.1)

        if not np.any(visible_mask):
            self.last_rendered_image = img
            self.dirty = False
            return img

        vis_indices = np.flatnonzero(visible_mask)
        vis_f = f[vis_indices]
        vis_fn = fn[vis_indices]

        # Depth sorting (painter's algorithm)
        vis_depths = z_cam[vis_f].mean(axis=1)
        sort_order = np.argsort(-vis_depths)
        sorted_indices = vis_indices[sort_order]
        sorted_f = f[sorted_indices]
        sorted_fn = fn[sorted_indices]

        # Lighting setup (Electric Gold / Studio palette)
        key_light = np.array([0.5, 0.8, 1.0], dtype=np.float32)
        key_light /= np.linalg.norm(key_light)
        fill_light = np.array([-0.5, -0.3, -0.5], dtype=np.float32)
        fill_light /= np.linalg.norm(fill_light)

        diffuse_key = np.clip(sorted_fn @ key_light, 0.0, 1.0)
        diffuse_fill = np.clip(sorted_fn @ fill_light, 0.0, 1.0)
        ambient = 0.22

        # Draw shaded faces
        is_wireframe_only = self.shading_mode == "wireframe"
        show_wire = self.show_wireframe or is_wireframe_only

        for i, face in enumerate(sorted_f):
            poly = [
                (float(screen_pts[face[0], 0]), float(screen_pts[face[0], 1])),
                (float(screen_pts[face[1], 0]), float(screen_pts[face[1], 1])),
                (float(screen_pts[face[2], 0]), float(screen_pts[face[2], 1])),
            ]

            if not is_wireframe_only:
                # Compute face color based on shading mode
                if self.shading_mode == "normal":
                    n = sorted_fn[i]
                    r = int(np.clip((n[0] * 0.5 + 0.5) * 255, 0, 255))
                    g = int(np.clip((n[1] * 0.5 + 0.5) * 255, 0, 255))
                    b = int(np.clip((n[2] * 0.5 + 0.5) * 255, 0, 255))
                elif self.shading_mode == "textured" and self.vertex_colors is not None:
                    base_c = self.vertex_colors[face].mean(axis=0)
                    intensity = float(ambient + 0.65 * diffuse_key[i] + 0.25 * diffuse_fill[i])
                    r = int(np.clip(base_c[0] * intensity * 255, 0, 255))
                    g = int(np.clip(base_c[1] * intensity * 255, 0, 255))
                    b = int(np.clip(base_c[2] * intensity * 255, 0, 255))
                else:
                    # Clay Shading (Warm Grey / Studio Gold undertone)
                    intensity = float(ambient + 0.68 * diffuse_key[i] + 0.22 * diffuse_fill[i])
                    r = int(np.clip(210 * intensity, 15, 245))
                    g = int(np.clip(210 * intensity, 15, 245))
                    b = int(np.clip(215 * intensity, 20, 250))

                fill_color = (r, g, b, 255)
                outline_color = (120, 120, 130, 90) if show_wire else fill_color
                draw.polygon(poly, fill=fill_color, outline=outline_color)
            else:
                draw.polygon(poly, outline=(249, 207, 0, 220))  # ForMesh3D Gold wireframe

        self.last_rendered_image = img
        self.last_rendered_jpeg = None
        self.dirty = False
        return img

    def render_jpeg(self, quality: int = 80) -> bytes:
        """Render frame directly to compressed JPEG bytes."""
        if not self.dirty and self.last_rendered_jpeg is not None:
            return self.last_rendered_jpeg

        img = self.render_image()
        # Convert RGBA to RGB for JPEG encoding
        rgb = img.convert("RGB")
        buf = io.BytesIO()
        rgb.save(buf, format="JPEG", quality=quality, optimize=False)
        data = buf.getvalue()
        self.last_rendered_jpeg = data
        return data

    def render_ndarray(self) -> np.ndarray:
        """Render to RGB numpy array for WebRTC/PyAV encoding."""
        img = self.render_image()
        rgb = img.convert("RGB")
        return np.asarray(rgb)

    def _draw_floor_grid(self, draw: ImageDraw.ImageDraw, w: int, h: int) -> None:
        """Draw an orienting ground grid in the bottom half of the viewport."""
        horizon_y = int(h * 0.72)
        grid_color = (40, 44, 52, 120)
        # Perspective lines converging toward center
        cx = w // 2
        for offset in range(-cx, cx + 1, max(30, w // 14)):
            draw.line([(cx + offset // 4, horizon_y), (cx + offset * 2, h)], fill=grid_color, width=1)
        # Horizontal depth rungs
        for y in range(horizon_y, h, max(15, (h - horizon_y) // 6)):
            draw.line([(0, y), (w, y)], fill=grid_color, width=1)
