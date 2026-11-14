import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRegenerationRequest } from './workspaceRegeneration';

describe('workspace regeneration request', () => {
  it('clones the original request and adds the same workspace plus parent lineage', () => {
    const original: { endpoint: string; body: Record<string, unknown> } = {
      endpoint: '/api/v1/mesh-generation/image-to-raw-mesh',
      body: { image_file_id: 'img_123', model_preference: 'model-a' },
    };
    const request = createWorkspaceRegenerationRequest(original, 'rabbit_a82f31', 'op_123456789abc');
    assert.equal(request.endpoint, original.endpoint);
    assert.equal(request.body.workspace_id, 'rabbit_a82f31');
    assert.equal(request.body.parent_operation_id, 'op_123456789abc');
    assert.equal(request.body.image_file_id, 'img_123');
    assert.equal(original.body.workspace_id, undefined);
    assert.equal(original.body.parent_operation_id, undefined);
  });

  it('rejects missing identities and unsupported endpoint types', () => {
    const snapshot = {
      endpoint: '/api/v1/mesh-generation/image-to-raw-mesh',
      body: { image_file_id: 'img_123' },
    };
    assert.throws(() => createWorkspaceRegenerationRequest(snapshot, '', 'op_123'), /identities/);
    assert.throws(() => createWorkspaceRegenerationRequest({
      ...snapshot, endpoint: '/api/v1/mesh-tools/remesh',
    }, 'rabbit_a82f31', 'op_123'), /does not support/);
  });
});
