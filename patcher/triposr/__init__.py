"""TripoSR-only runtime compatibility patcher."""
from .texture_bake import patch_texture_baker

__all__ = ["patch_texture_baker"]
