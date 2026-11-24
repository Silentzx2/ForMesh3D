import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelAsset } from '../types';
import { getAssetComparisonPair, resolveComparisonSourceAssetId } from './assetComparison';

function makeAsset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    id: 'asset_after',
    name: 'Retopologized mesh',
    category: 'edit',
    format: 'GLB',
    thumbnail: '',
    meshType: 'custom',
    faces: 0,
    vertices: 0,
    triangles: 0,
    topology: 'Triangle',
    dateCreated: '2026-11-22',
    tags: [],
    source: {
      filename: 'after.glb',
      subfolder: 'retopology',
      type: 'output',
      viewUrl: '/after.glb',
    },
    artifacts: { source: '/before.glb' },
    ...overrides,
  } as ModelAsset;
}

describe('viewport before/after comparison eligibility', () => {
  it('returns the captured source and completed output URLs', () => {
    assert.deepEqual(getAssetComparisonPair(makeAsset()), {
      beforeUrl: '/before.glb',
      afterUrl: '/after.glb',
    });
  });

  it('does not expose comparison while an operation is executing', () => {
    assert.equal(getAssetComparisonPair(makeAsset(), true), null);
  });

  it('requires both sides and rejects identical URLs', () => {
    assert.equal(getAssetComparisonPair(makeAsset({ artifacts: undefined })), null);
    assert.equal(getAssetComparisonPair(makeAsset({
      artifacts: { source: '/after.glb' },
    })), null);
  });

  it('rejects non-mesh assets and failed production outputs', () => {
    assert.equal(getAssetComparisonPair(makeAsset({ category: 'texture' })), null);
    assert.equal(getAssetComparisonPair(makeAsset({ format: 'IMAGE' })), null);
    assert.equal(getAssetComparisonPair(makeAsset({ productionStatus: 'failed' })), null);
    assert.equal(getAssetComparisonPair(makeAsset({ postprocessStatus: 'failed' })), null);
  });

  it('allows a completed textured mesh with a distinct source mesh', () => {
    assert.deepEqual(getAssetComparisonPair(makeAsset({
      category: 'generation',
      productionStatus: 'ready',
      source: {
        filename: 'textured.glb',
        subfolder: 'texture',
        type: 'output',
        viewUrl: '/textured.glb',
      },
    })), {
      beforeUrl: '/before.glb',
      afterUrl: '/textured.glb',
    });
  });
});

describe('comparison source asset identity', () => {
  it('prefers the mesh identity captured with the submitted task', () => {
    assert.equal(resolveComparisonSourceAssetId({
      taskSourceAssetId: 'upload_ast_mesh',
      operationInputAssetId: 'ast_other',
      operationInputFileType: 'mesh',
    }), 'upload_ast_mesh');
  });

  it('reconstructs a persisted predecessor only when the DB says it is a mesh', () => {
    assert.equal(resolveComparisonSourceAssetId({
      operationInputAssetId: 'ast_mesh',
      operationInputFileType: 'mesh',
    }), 'ast_mesh');
    assert.equal(resolveComparisonSourceAssetId({
      operationInputAssetId: 'ast_image',
      operationInputFileType: 'image',
    }), undefined);
    assert.equal(resolveComparisonSourceAssetId({
      operationInputAssetId: 'ast_unknown',
    }), undefined);
  });
});
