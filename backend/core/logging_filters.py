"""Job-context logging filter.

Injects ``job_id``, ``stage`` and ``duration_ms`` fields into every log record
so that ``logs/master.log`` lines are greppable by job id across the full
pipeline (API -> scheduler -> adapter -> postprocess -> SSE).

Records that do not supply these fields get safe defaults so the formatter
never raises on missing keys.
"""

from __future__ import annotations

import logging


class JobContextFilter(logging.Filter):
    """Add default job_id/stage/duration_ms to log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "job_id"):
            record.job_id = "-"
        if not hasattr(record, "stage"):
            record.stage = "-"
        if not hasattr(record, "duration_ms"):
            record.duration_ms = "-"
        return True
