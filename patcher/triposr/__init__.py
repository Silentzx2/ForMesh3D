"""TripoSR-only runtime compatibility patcher."""
from .mcubes_fallback import ensure_torchmcubes
from .texture_bake import patch_texture_baker

__all__ = ["ensure_torchmcubes", "patch_texture_baker"]
