import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAppStore } from '@/stores/useAppStore';

describe('Batch 5: Workspace State & Identity Alignment', () => {
  beforeEach(() => {
    useViewerStore.setState({
      workspaceId: null,
      activeMeshAssetId: null,
      executionState: 'idle',
      persistenceState: 'not_saved',
    });
    useAppStore.setState({
      activeWorkspaceId: null,
      executionState: 'idle',
      persistenceState: 'not_saved',
    });
  });

  it('models executionState across allowed lifecycle states', () => {
    const viewer = useViewerStore.getState();
    assert.equal(viewer.executionState, 'idle');

    useViewerStore.getState().setExecutionState('queued');
    assert.equal(useViewerStore.getState().executionState, 'queued');

    useViewerStore.getState().setExecutionState('running');
    assert.equal(useViewerStore.getState().executionState, 'running');

    useViewerStore.getState().setExecutionState('completed');
    assert.equal(useViewerStore.getState().executionState, 'completed');

    useViewerStore.getState().setExecutionState('failed');
    assert.equal(useViewerStore.getState().executionState, 'failed');

    useViewerStore.getState().setExecutionState('interrupted');
    assert.equal(useViewerStore.getState().executionState, 'interrupted');
  });

  it('models persistenceState across retention and discard paths', () => {
    const viewer = useViewerStore.getState();
    assert.equal(viewer.persistenceState, 'not_saved');

    useViewerStore.getState().setPersistenceState('saving');
    assert.equal(useViewerStore.getState().persistenceState, 'saving');

    useViewerStore.getState().setPersistenceState('saved');
    assert.equal(useViewerStore.getState().persistenceState, 'saved');

    useViewerStore.getState().setPersistenceState('save_failed');
    assert.equal(useViewerStore.getState().persistenceState, 'save_failed');

    useViewerStore.getState().setPersistenceState('discarded');
    assert.equal(useViewerStore.getState().persistenceState, 'discarded');
  });

  it('sets and updates backend workspace_id and active_mesh_asset_id', () => {
    const wsId = 'rabbit_a8f32c';
    const assetId = 'ast_001_raw';

    useViewerStore.getState().setWorkspaceId(wsId);
    useViewerStore.getState().setActiveMeshAssetId(assetId);

    assert.equal(useViewerStore.getState().workspaceId, wsId);
    assert.equal(useViewerStore.getState().activeMeshAssetId, assetId);

    useAppStore.getState().setActiveWorkspaceId(wsId);
    assert.equal(useAppStore.getState().activeWorkspaceId, wsId);
  });

  it('hides versions when only a single base mesh exists and displays when derived assets exist', () => {
    const wsId = 'bunny_123456';
    const singleBaseAsset = [
      { id: 'ast_base', name: 'Bunny Base', workspace_id: wsId, is_base_mesh: true, format: 'GLB', category: 'generation' },
    ];

    // Helper logic mirroring ViewportToolOverlay
    const computeVersions = (assets: any[], currentWsId: string | null) => {
      if (!currentWsId) return [];
      const wsAssets = assets.filter(
        (a) =>
          a.category !== 'texture' &&
          a.format !== 'IMAGE' &&
          a.format !== 'FILE' &&
          (a.workspace_id === currentWsId || a.id === `local_${currentWsId}`)
      );
      if (wsAssets.length <= 1) return []; // Hidden when raw base mesh only!
      return wsAssets.map((a, idx) => ({
        id: a.id,
        label: idx === 0 ? 'Base Mesh (v001)' : `Mesh (v${String(idx + 1).padStart(3, '0')})`,
      }));
    };

    assert.deepEqual(computeVersions(singleBaseAsset, wsId), []);

    const multipleAssets = [
      ...singleBaseAsset,
      { id: 'ast_tex', name: 'Bunny Textured', workspace_id: wsId, format: 'GLB', category: 'mesh' },
      { id: 'ast_remesh', name: 'Bunny Quad', workspace_id: wsId, format: 'GLB', category: 'mesh' },
    ];

    const versions = computeVersions(multipleAssets, wsId);
    assert.equal(versions.length, 3);
    assert.equal(versions[0].label, 'Base Mesh (v001)');
    assert.equal(versions[1].label, 'Mesh (v002)');
    assert.equal(versions[2].label, 'Mesh (v003)');
  });
});
