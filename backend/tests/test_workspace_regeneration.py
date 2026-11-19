from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.routers.mesh_generation import _validate_regeneration_parent


class FakeDatabase:
    def __init__(self, operation):
        self.operation = operation

    def get_operation(self, operation_id):
        assert operation_id == "op_parent123456"
        return self.operation


def make_operation(**overrides):
    values = {
        "workspace_id": "rabbit_a82f31",
        "execution_status": "completed",
        "operation_type": "generate_raw_mesh",
        "input_asset_id": "ast_source_123456",
        "settings_snapshot": '{"quality_mode": "high"}',
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_regeneration_parent_accepts_completed_same_workspace_operation():
    _validate_regeneration_parent(
        FakeDatabase(make_operation()),
        "op_parent123456",
        "rabbit_a82f31",
        "generate_raw_mesh",
        "ast_source_123456",
        {"quality_mode": "high"},
    )


def test_regeneration_parent_rejects_missing_parent():
    with pytest.raises(HTTPException) as error:
        _validate_regeneration_parent(
            FakeDatabase(None), "op_parent123456", "rabbit_a82f31",
            "generate_raw_mesh", "ast_source_123456", {"quality_mode": "high"}
        )
    assert error.value.status_code == 404


@pytest.mark.parametrize(
    "operation,workspace,operation_type",
    [
        (make_operation(workspace_id="fox_123456"), "rabbit_a82f31", "generate_raw_mesh"),
        (make_operation(execution_status="failed"), "rabbit_a82f31", "generate_raw_mesh"),
        (make_operation(operation_type="generate_textured_mesh"), "rabbit_a82f31", "generate_raw_mesh"),
    ],
)
def test_regeneration_parent_rejects_workspace_status_or_type_mismatch(operation, workspace, operation_type):
    with pytest.raises(HTTPException) as error:
        _validate_regeneration_parent(
            FakeDatabase(operation), "op_parent123456", workspace, operation_type,
            "ast_source_123456", {"quality_mode": "high"}
        )
    assert error.value.status_code == 409


@pytest.mark.parametrize(
    "input_asset_id,settings",
    [
        ("ast_different_123", {"quality_mode": "high"}),
        ("ast_source_123456", {"quality_mode": "low"}),
    ],
)
def test_regeneration_parent_rejects_changed_input_or_settings(input_asset_id, settings):
    with pytest.raises(HTTPException) as error:
        _validate_regeneration_parent(
            FakeDatabase(make_operation()),
            "op_parent123456",
            "rabbit_a82f31",
            "generate_raw_mesh",
            input_asset_id,
            settings,
        )
    assert error.value.status_code == 409
