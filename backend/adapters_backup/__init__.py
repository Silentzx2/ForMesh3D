"""Model adapters package — derives _ADAPTER_MAP from ModelFactory.ADAPTER_REGISTRY."""

from __future__ import annotations

try:
    from backend.core.scheduler.model_factory import ModelFactory
except ImportError:  # pragma: no cover - when PYTHONPATH=backend
    from core.scheduler.model_factory import ModelFactory

_ADAPTER_MAP: dict[str, str] = {
    model_id: entry["module"]
    for model_id, entry in ModelFactory.ADAPTER_REGISTRY.items()
}
