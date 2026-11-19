import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureWorkspacePreviewBaseline,
  createWorkspacePreviewRestorePlan,
} from './workspacePreviewSnapshot';

const baselineInput = () => ({
  capturedAt: 1234,
  workspaceId: 'rabbit_a82f31',
  selectedAssetId: 'ast_123456789abc',
  selectedAsset: {
    id: 'ast_123456789abc',
    name: 'Rabbit Base',
    category: 'mesh' as const,
    thumbnail: '/thumb.png',
    meshType: 'custom' as const,
    faces: 1200,
    vertices: 800,
    triangles: 1200,
    topology: 'Triangle' as const,
    format: 'GLB' as const,
    dateCreated: '2026-11-14',
    tags: ['base'],
  },
  activeMeshAssetId: 'ast_123456789abc',
  workspaceVersions: [{
    asset_id: 'ast_123456789abc',
    name: 'Rabbit Base',
    version_label: 'v001',
    url: '/mesh.glb',
  }],
  executionState: 'idle' as const,
  persistenceState: 'saved' as const,
  viewer: {
    loadedModelUrl: '/mesh.glb',
    loadedModelName: 'Rabbit Base',
    selectedAsset: {
      id: 'ast_123456789abc',
      name: 'Rabbit Base',
      prompt: '',
      format: 'glb',
      timestamp: '2026-11-14',
      modelUrl: '/mesh.glb',
      type: 'model' as const,
    },
    modelStats: {
      vertices: 800,
      triangles: 1200,
      dimensions: { x: 1, y: 2, z: 1 },
    },
    shadingMode: 'default' as const,
    wireframeOverlay: false,
    activeContextTab: 'assets' as const,
    viewport: {
      cameraPosition: [1, 2, 3] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
    },
    compareMode: false,
    compareSyncCamera: false,
    compareLeftAssetId: null,
    compareRightAssetId: null,
    workspaceId: 'rabbit_a82f31',
    activeMeshAssetId: 'ast_123456789abc',
  },
});

describe('workspace preview baseline snapshot', () => {
  it('captures an immutable copy of the pre-operation workspace and viewer state', () => {
    const input = baselineInput();
    const snapshot = captureWorkspacePreviewBaseline(input);

    input.selectedAsset!.tags.push('mutated');
    input.workspaceVersions[0].name = 'Mutated';
    input.viewer.viewport!.cameraPosition[0] = 99;

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.capturedAt, 1234);
    assert.deepEqual(snapshot.selectedAsset?.tags, ['base']);
    assert.equal(snapshot.workspaceVersions[0].name, 'Rabbit Base');
    assert.deepEqual(snapshot.viewer.viewport?.cameraPosition, [1, 2, 3]);
  });

  it('builds an exact detached restore plan for the same workspace', () => {
    const snapshot = captureWorkspacePreviewBaseline(baselineInput());
    const plan = createWorkspacePreviewRestorePlan(snapshot, 'rabbit_a82f31');

    assert.equal(plan.workspaceId, 'rabbit_a82f31');
    assert.equal(plan.selectedAssetId, 'ast_123456789abc');
    assert.equal(plan.activeMeshAssetId, 'ast_123456789abc');
    assert.equal(plan.viewer.loadedModelUrl, '/mesh.glb');
    assert.deepEqual(plan.viewer.viewport?.cameraPosition, [1, 2, 3]);
    assert.notEqual(plan.workspaceVersions, snapshot.workspaceVersions);
    assert.notEqual(plan.viewer, snapshot.viewer);
  });

  it('rejects restoring a baseline into a different workspace', () => {
    const snapshot = captureWorkspacePreviewBaseline(baselineInput());
    assert.throws(
      () => createWorkspacePreviewRestorePlan(snapshot, 'fox_123456'),
      /different workspace/,
    );
  });

  it('rejects snapshots from an unsupported schema version', () => {
    const snapshot = {
      ...captureWorkspacePreviewBaseline(baselineInput()),
      schemaVersion: 2,
    } as unknown as ReturnType<typeof captureWorkspacePreviewBaseline>;

    assert.throws(
      () => createWorkspacePreviewRestorePlan(snapshot, 'rabbit_a82f31'),
      /Unsupported/,
    );
  });
});
