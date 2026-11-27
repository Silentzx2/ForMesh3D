import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDownstreamToolState, type DownstreamToolPanelState } from './useToolPanelState';

const base = (overrides: Partial<Parameters<typeof deriveDownstreamToolState>[0]> = {}): ReturnType<typeof deriveDownstreamToolState> => {
  return deriveDownstreamToolState({
    hasValidMesh: true,
    isUploading: false,
    executionStatus: undefined,
    isExecuting: false,
    ...overrides,
  });
};

describe('deriveDownstreamToolState 7-state machine', () => {
  it('downstream_empty: no valid mesh, not uploading, not executing', () => {
    assert.equal(base({ hasValidMesh: false }), 'downstream_empty');
  });

  it('downstream_uploading: upload in progress', () => {
    assert.equal(base({ isUploading: true }), 'downstream_uploading');
  });

  it('downstream_ready: valid mesh, idle execution', () => {
    assert.equal(base({}), 'downstream_ready');
  });

  it('tool_executing: isExecuting flag', () => {
    assert.equal(base({ isExecuting: true }), 'tool_executing');
  });

  it('tool_executing: queued status', () => {
    assert.equal(base({ executionStatus: 'queued' }), 'tool_executing');
  });

  it('tool_executing: running status', () => {
    assert.equal(base({ executionStatus: 'running' }), 'tool_executing');
  });

  it('tool_completed: completed status with mesh', () => {
    assert.equal(base({ executionStatus: 'completed' }), 'tool_completed');
  });

  it('tool_failed: failed status', () => {
    assert.equal(base({ executionStatus: 'failed' }), 'tool_failed');
  });

  it('tool_failed: interrupted status', () => {
    assert.equal(base({ executionStatus: 'interrupted' }), 'tool_failed');
  });

  it('tool_cancelled: cancelled status', () => {
    assert.equal(base({ executionStatus: 'cancelled' }), 'tool_cancelled');
  });

  it('execution takes priority over uploading', () => {
    assert.equal(base({ isUploading: true, isExecuting: true }), 'tool_executing');
  });

  it('uploading takes priority over empty', () => {
    assert.equal(base({ hasValidMesh: false, isUploading: true }), 'downstream_uploading');
  });
});

describe('failed/cancelled does not stay busy', () => {
  const busyStates: DownstreamToolPanelState[] = ['tool_executing', 'downstream_uploading'];
  for (const status of ['failed', 'interrupted', 'cancelled'] as const) {
    it(`${status} is not a busy state`, () => {
      const state = base({ executionStatus: status });
      assert.ok(!busyStates.includes(state), `${status} should not map to a busy state, got ${state}`);
      assert.equal(state, status === 'cancelled' ? 'tool_cancelled' : 'tool_failed');
    });
  }
});
