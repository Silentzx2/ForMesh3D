import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelAsset } from '../types';
import { resolveAssetDeletionTarget } from './assetDeletion';
const baseAsset = (updates: Partial<ModelAsset>): ModelAsset => ({
  id: 'local_preview', name: 'mesh', category: 'mesh', thumbnail: '', meshType: 'custom',
  faces: 0, vertices: 0, triangles: 0, topology: 'Triangle', format: 'GLB', dateCreated: '', tags: [], ...updates,
});
describe('asset deletion ownership', () => {
  it('keeps shared files when deleting a local duplicate', () => {
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({
      id: 'asset-copy', isLocalDuplicate: true,
      source: { filename: 'mesh.glb', subfolder: 'models', type: 'upload', fileId: '123e4567-e89b-12d3-a456-426614174000' },
    })), { kind: 'local' });
  });
  it('unwraps history aliases and explicit workspace job IDs', () => {
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({
      id: 'hist_123e4567-e89b-12d3-a456-426614174000', sourceType: 'history',
    })), { kind: 'job', id: '123e4567-e89b-12d3-a456-426614174000' });
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({
      id: 'local_base_mesh', category: 'generation', workspace_id: 'rabbit_a8f32c',
    })), { kind: 'job', id: 'rabbit_a8f32c' });
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({
      id: 'mesh-local', source: { filename: 'mesh.glb', subfolder: 'models', type: 'mesh', fileId: 'job-rabbit_a8f32c' },
    })), { kind: 'job', id: 'rabbit_a8f32c' });
  });
  it('uses the actual uploaded file ID for uploaded assets', () => {
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({
      id: 'upload_123e4567-e89b-12d3-a456-426614174000', sourceType: 'upload',
      source: { filename: 'mesh.glb', subfolder: 'models', type: 'upload', fileId: '123e4567-e89b-12d3-a456-426614174000' },
    })), { kind: 'upload', id: '123e4567-e89b-12d3-a456-426614174000' });
  });
  it('keeps local-prefixed UUIDs local unless upload ownership is explicit', () => {
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({ id: 'local_123e4567-e89b-12d3-a456-426614174000' })), { kind: 'local' });
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({
      id: 'local_123e4567-e89b-12d3-a456-426614174000',
      source: { filename: 'mesh.glb', subfolder: 'models', type: 'upload', fileId: '123e4567-e89b-12d3-a456-426614174000' },
    })), { kind: 'upload', id: '123e4567-e89b-12d3-a456-426614174000' });
    assert.deepEqual(resolveAssetDeletionTarget(baseAsset({ id: 'ast_123456789abc' })), { kind: 'upload', id: 'ast_123456789abc' });
  });
});
