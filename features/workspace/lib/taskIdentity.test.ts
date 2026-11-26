import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findTaskKeyForBackendJob } from './taskIdentity';

describe('workspace task identity mapping', () => {
  it('resolves a backend job ID to its local task key', () => {
    assert.equal(findTaskKeyForBackendJob({
      'local-task-1': { id: 'local-task-1', backendJobId: 'rabbit_a8f32c' },
    }, 'rabbit_a8f32c'), 'local-task-1');
  });

  it('also accepts a direct backend task key and safely handles missing jobs', () => {
    assert.equal(findTaskKeyForBackendJob({
      'rabbit_a8f32c': { id: 'rabbit_a8f32c' },
    }, 'rabbit_a8f32c'), 'rabbit_a8f32c');
    assert.equal(findTaskKeyForBackendJob({}, 'missing_job'), null);
  });
});
