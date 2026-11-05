"""Model adapters package — fully wired thin integration layer.

Each model-specific adapter imports and calls the official ThirdParty inference
API (see Docs/TASKS.md Sec. 4). Adapters resolve their weights directory via
the shared ``backend.loader.get_model_weights_dir`` and fall back to
``DEFAULT_SEED = 42891`` (``quality.yaml seeds.base_seed``) when no seed is
supplied by the scheduler. The package exposes each adapter module for
``backend/core/scheduler/model_factory.py`` to import by module path.
"""

from __future__ import annotations
# Map of registered model ID -> adapter module path.
# Used by runtime_probe._get_installed_adapters() to report which adapters
# are installed, and by planner._is_adapter_registered() to admit candidates.
# Keys are the canonical model IDs from backend/config/models.yaml; values are
# the adapter module that implements that model.
_ADAPTER_MAP: dict[str, str] = {
    # ── image-to-raw-mesh ──────────────────────────────────────────────
    "hunyuan3d_shape_v21_image_to_raw_mesh": "backend.adapters.hunyuan3d_shape_v21",
    "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh": "backend.adapters.hunyuan3d_dit_v2_mini_turbo",
    "triposg_image_to_raw_mesh": "backend.adapters.triposg_adapter",
    "unique3d_image_to_raw_mesh": "backend.adapters.unique3d_adapter",
    "pixal3d_image_to_raw_mesh": "backend.adapters.pixal3d_adapter",
    "pixal3d_image_to_3d": "backend.adapters.pixal3d_adapter",
    "trellis_image_to_3d": "backend.adapters.trellis_adapter",
    "trellis_image_to_raw_mesh": "backend.adapters.trellis_adapter",
    "trellis2_image_to_3d": "backend.adapters.trellis2_adapter",
    "trellis2_image_to_raw_mesh": "backend.adapters.trellis2_adapter",
    "taoflowforge_image_to_raw_mesh": "backend.adapters.taoflowforge_adapter",
    "hi3d_image_to_raw_mesh": "backend.adapters.hi3d_adapter",
    # ── legacy textured-mesh aliases ───────────────────────────────────
    "trellis_image_to_textured_mesh": "backend.adapters.trellis_adapter",
    "trellis2_image_to_textured_mesh": "backend.adapters.trellis2_adapter",
    "hi3d_image_to_textured_mesh": "backend.adapters.hi3d_adapter",
    # ── image-mesh-painting ────────────────────────────────────────────
    "trellis_image_mesh_painting": "backend.adapters.trellis_adapter",
    "trellis2_image_mesh_painting": "backend.adapters.trellis2_adapter",
    "hunyuan3d_paint_v21_image_mesh_painting": "backend.adapters.hunyuan3d_paint_v21",
    "paint3d": "backend.adapters.paint3d_adapter",
    # ── mesh-retopology ────────────────────────────────────────────────
    "fastmesh_v1k_retopology": "backend.adapters.fastmesh_adapter",
    # ── uv-unwrapping ──────────────────────────────────────────────────
    "partuv_uv_unwrapping": "backend.adapters.partuv_adapter",
    # ── auto-rigging ───────────────────────────────────────────────────
    "unirig_auto_rig": "backend.adapters.unirig_adapter",
    # ── motion-generation ──────────────────────────────────────────────
    "ardy_motion_generation": "backend.adapters.ardy_adapter",
}
