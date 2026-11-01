"""Model adapters package — fully wired thin integration layer.

Each model-specific adapter imports and calls the official ThirdParty inference
API (see Docs/TASKS.md Sec. 4). Adapters resolve their weights directory via
the shared ``backend.loader.get_model_weights_dir`` and fall back to
``DEFAULT_SEED = 42891`` (``quality.yaml seeds.base_seed``) when no seed is
supplied by the scheduler. The package exposes each adapter module for
``backend/core/scheduler/model_factory.py`` to import by module path.
"""

from __future__ import annotations

# Adapter modules (imported by model_factory via their module path):
#   adapters.trellis_adapter
#   adapters.trellis2_adapter
#   adapters.trellis2_paint_adapter
#   adapters.hunyuan3d_shape_v21
#   adapters.hunyuan3d_paint_v21
#   adapters.hunyuan3d_dit_v2_mini_turbo
#   adapters.hunyuan3d_adapter_v21
#   adapters.hi3d_adapter
#   adapters.triposg_adapter
#   adapters.unique3d_adapter
#   adapters.paint3d_adapter
#   adapters.partuv_adapter
#   adapters.pixal3d_adapter
#   adapters.ardy_adapter
#   adapters.unirig_adapter
#   adapters.fastmesh_adapter
#   adapters.taoflowforge_adapter
