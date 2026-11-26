from __future__ import annotations

import subprocess

from backend.adapters.skintokens_adapter import SkinTokensAdapter


class _FakeProcess:
    def __init__(self, *, timeout_first_wait: bool = False):
        self.terminated = False
        self.killed = False
        self.wait_calls = 0
        self.timeout_first_wait = timeout_first_wait

    def poll(self):
        return None if not self.terminated and not self.killed else 0

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        self.wait_calls += 1
        if self.timeout_first_wait and self.wait_calls == 1:
            raise subprocess.TimeoutExpired("bpy_server", timeout)
        return 0


def test_skin_tokens_server_is_terminated_and_reaped():
    adapter = SkinTokensAdapter.__new__(SkinTokensAdapter)
    process = _FakeProcess()
    adapter._server_proc = process

    adapter._stop_bpy_server()

    assert process.terminated
    assert process.wait_calls == 1
    assert adapter._server_proc is None


def test_skin_tokens_server_is_killed_after_terminate_timeout():
    adapter = SkinTokensAdapter.__new__(SkinTokensAdapter)
    process = _FakeProcess(timeout_first_wait=True)
    adapter._server_proc = process

    adapter._stop_bpy_server()

    assert process.terminated
    assert process.killed
    assert process.wait_calls == 2
    assert adapter._server_proc is None
