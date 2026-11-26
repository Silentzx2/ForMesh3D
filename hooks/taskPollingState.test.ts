import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canApplyPolledTaskUpdate, hasActiveBackendTasks, isPollableBackendTask } from './taskPollingState';

describe('adaptive task polling state', () => {
  it('only applies poll responses while a task is queued or running', () => {
    assert.equal(canApplyPolledTaskUpdate('queued'), true);
    assert.equal(canApplyPolledTaskUpdate('running'), true);
    assert.equal(canApplyPolledTaskUpdate('completed'), false);
    assert.equal(canApplyPolledTaskUpdate('failed'), false);
    assert.equal(canApplyPolledTaskUpdate('cancelled'), false);
    assert.equal(canApplyPolledTaskUpdate(undefined), false);
  });

  it('polls UUID and canonical workspace job IDs but not local task keys', () => {
    assert.equal(isPollableBackendTask({ id: '123e4567-e89b-12d3-a456-426614174000', status: 'running' }), true);
    assert.equal(isPollableBackendTask({ id: 'rabbit_a8f32c', status: 'queued' }), true);
    assert.equal(isPollableBackendTask({ id: 'queue_123', status: 'running' }), false);
    assert.equal(isPollableBackendTask({ id: 'rabbit_a8f32c', status: 'cancelled' }), false);
  });

  it('reports active backend work only when a pollable backend task remains', () => {
    assert.equal(hasActiveBackendTasks({
      local: { id: 'queue_123', status: 'running' },
      done: { id: 'rabbit_a8f32c', status: 'completed' },
    }), false);
    assert.equal(hasActiveBackendTasks({
      active: { id: 'rabbit_a8f32c', status: 'running' },
    }), true);
  });
});
