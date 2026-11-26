from __future__ import annotations

from pathlib import Path

import yaml


def test_trellis_text_paint_alias_is_disabled_without_adding_text_to_3d():
    config_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    config = yaml.safe_load(config_path.read_text())
    text_paint = config["text_mesh_painting"]["trellis_text_mesh_painting"]

    assert text_paint["enabled"] is False
    assert "text-to-3D" in text_paint["description"]
    assert config["image_mesh_painting"]["trellis_image_mesh_painting"]["enabled"] is True
