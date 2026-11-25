"""Verify models.yaml default_parameters loading and UI-override preservation."""

import sys
import unittest
from pathlib import Path

_BACKEND_ROOT = str(Path(__file__).resolve().parents[1])
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from core.config import load_models_config  # noqa: E402


UI_OWNED_KEYS = {
    "seed",
    "texture_resolution",
    "poly_type",
    "target_polycount",
    "target_vertex_count",
    "remesh_option",
}


class DefaultParametersTest(unittest.TestCase):
    def test_load_models_config_and_ui_owned_keys(self) -> None:
        manifest = Path(_BACKEND_ROOT) / "config" / "models.yaml"
        parsed = load_models_config(str(manifest))
        hy21 = parsed["image_to_raw_mesh"]["hunyuan3d_shape_v21_image_to_raw_mesh"]
        self.assertEqual(hy21.default_parameters["octree_resolution"], 512)
        self.assertEqual(hy21.default_parameters["num_inference_steps"], 50)

        for models in parsed.values():
            for model_id, cfg in models.items():
                if not cfg.enabled:
                    continue
                dp = cfg.default_parameters or {}
                overlap = UI_OWNED_KEYS.intersection(dp.keys())
                self.assertEqual(overlap, set(), f"{model_id} has UI-owned keys: {overlap}")

        # Mirrors multiprocess_scheduler.py injection semantics
        dp = parsed["auto_rig"]["skintokens_auto_rigging"].default_parameters
        model_inputs = {"num_beams": 0, "use_transfer": False, "top_k": None}
        for k, v in dp.items():
            if model_inputs.get(k) is None:
                model_inputs[k] = v
        self.assertEqual(model_inputs["num_beams"], 0)
        self.assertFalse(model_inputs["use_transfer"])
        self.assertEqual(model_inputs["top_k"], dp["top_k"])


if __name__ == "__main__":
    unittest.main()
