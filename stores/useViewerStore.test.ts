import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore, type AssetItem } from './useViewerStore';
const asset = (id: string): AssetItem => ({ id, name: id, prompt: '', format: 'GLB', timestamp: '' });
beforeEach(() => useViewerStore.setState({
  selectedAsset: null, loadedModelUrl: null, loadedModelName: null, modelStats: null,
  assetSelectionState: 'idle', assetLoadError: null, selectionRequestId: 0,
}));
describe('viewer asset-selection state machine', () => {
  it('moves through selecting, verifying, loading and ready', () => {
    const id = useViewerStore.getState().requestAssetSelection(asset('mesh-a'));
    assert.equal(useViewerStore.getState().selectedAsset?.id, 'mesh-a');
    assert.equal(useViewerStore.getState().assetSelectionState, 'selecting');
    useViewerStore.getState().verifyAsset(id);
    assert.equal(useViewerStore.getState().assetSelectionState, 'verifying');
    useViewerStore.getState().beginAssetLoad(id);
    assert.equal(useViewerStore.getState().assetSelectionState, 'loading');
    useViewerStore.getState().completeAssetLoad(id, '/mesh-a.glb', 'mesh-a', null);
    assert.equal(useViewerStore.getState().assetSelectionState, 'ready');
    assert.equal(useViewerStore.getState().loadedModelUrl, '/mesh-a.glb');
  });
  it('ignores stale completion/failure after a newer selection', () => {
    const stale = useViewerStore.getState().requestAssetSelection(asset('old'));
    useViewerStore.getState().verifyAsset(stale);
    useViewerStore.getState().beginAssetLoad(stale);
    const current = useViewerStore.getState().requestAssetSelection(asset('new'));
    useViewerStore.getState().verifyAsset(current);
    useViewerStore.getState().beginAssetLoad(current);
    useViewerStore.getState().completeAssetLoad(stale, '/old.glb', 'old', null);
    useViewerStore.getState().failAssetLoad(stale, 'stale');
    assert.equal(useViewerStore.getState().assetSelectionState, 'loading');
    assert.equal(useViewerStore.getState().selectedAsset?.id, 'new');
    useViewerStore.getState().completeAssetLoad(current, '/new.glb', 'new', null);
    assert.equal(useViewerStore.getState().loadedModelUrl, '/new.glb');
  });
  it('records failure only from loading', () => {
    const id = useViewerStore.getState().requestAssetSelection(asset('mesh-error'));
    useViewerStore.getState().verifyAsset(id);
    useViewerStore.getState().failAssetLoad(id, 'too early');
    assert.equal(useViewerStore.getState().assetSelectionState, 'verifying');
    useViewerStore.getState().beginAssetLoad(id);
    useViewerStore.getState().failAssetLoad(id, 'network error');
    assert.equal(useViewerStore.getState().assetSelectionState, 'error');
  });
});
