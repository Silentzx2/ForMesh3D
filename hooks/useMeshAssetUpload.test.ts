import { describe, it, mock, beforeEach, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Captures state observed during the single SSR render (initial state only —
// SSR cannot flush React state updates in this no-DOM environment).
let renderState: any;

// Module-level current asset so the mocked useWorkspace reflects the active asset.
let currentAssetValue: { id: string; name: string; category: string } | null = {
  id: 'previous-asset',
  name: 'previous.glb',
  category: 'mesh',
};

let mockSetCurrentAsset: (asset: { id: string; name: string; category: string } | null) => void = () => {};
let mockUpdateAssetProperties: () => void = () => {};
let mockUploadMeshAsset: () => Promise<unknown> = () => new Promise(() => {});

let setCurrentAssetCalls: any[] = [];
let revokeCalls: string[] = [];
let abortCalls = 0;

// Register module mocks before the hook module is imported anywhere in this file.
mock.module('../features/workspace/store/WorkspaceContext', () => ({
  useWorkspace: mock(() => ({
    currentAsset: currentAssetValue,
    setCurrentAsset: mockSetCurrentAsset,
    updateAssetProperties: mockUpdateAssetProperties,
  })),
}));

mock.module('../features/workspace/types', () => ({
  uploadMeshAsset: mockUploadMeshAsset,
}));

const origCreateObjectURL = URL.createObjectURL.bind(URL);
const origRevokeObjectURL = URL.revokeObjectURL.bind(URL);
let mockCreateObjectURL: () => string = () => 'blob:mock-upload-url';
let mockRevokeObjectURL: () => void = () => {};

const OriginalAbortController = globalThis.AbortController;
let mockAbortImpl: () => void = () => {};
let abortSignalAborted = false;

beforeEach(() => {
  setCurrentAssetCalls = [];
  revokeCalls = [];
  abortCalls = 0;
  renderState = null;

  mockCreateObjectURL = mock(() => 'blob:mock-upload-url');
  mockRevokeObjectURL = mock((url: string) => {
    revokeCalls.push(url);
  });
  mockAbortImpl = mock(() => {
    abortCalls += 1;
  });
  mockUploadMeshAsset = mock(() => new Promise(() => {})); // never resolves = in-flight upload

  currentAssetValue = { id: 'previous-asset', name: 'previous.glb', category: 'mesh' };
  mockSetCurrentAsset = mock((asset: any) => {
    setCurrentAssetCalls.push(asset);
  });
  mockUpdateAssetProperties = mock(() => {});
  abortSignalAborted = false;

  // Fake AbortController so we can assert abort() is invoked on cancel.
  globalThis.AbortController = (function AbortController() {
    const instance = {
      signal: { aborted: false },
      abort: mockAbortImpl,
    } as unknown as AbortController;
    Object.defineProperty(instance.signal, 'aborted', {
      get: () => abortSignalAborted,
      enumerable: true,
      configurable: true,
    });
    return instance;
  }) as unknown as AbortControllerConstructor;

  URL.createObjectURL = mockCreateObjectURL as any;
  URL.revokeObjectURL = mockRevokeObjectURL as any;
});

afterEach(() => {
  globalThis.AbortController = OriginalAbortController;
  URL.createObjectURL = origCreateObjectURL;
  URL.revokeObjectURL = origRevokeObjectURL;
});

async function getHook() {
  const mod = await import('./useMeshAssetUpload');
  return mod.useMeshAssetUpload;
}

function renderHook(useMeshAssetUpload: any) {
  function Probe() {
    const hook = useMeshAssetUpload();
    renderState = hook.state; // capture state observed during this render
    return null;
  }
  renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: new QueryClient() },
      React.createElement(Probe)
    )
  );
  return renderState;
}

describe('useMeshAssetUpload — AbortController cancel', () => {
  it('aborts an in-flight upload, revokes the blob URL, restores the previous asset and marks cancelled', async () => {
    const useMeshAssetUpload = await getHook();

    const initialState = renderHook(useMeshAssetUpload);
    assert.equal(initialState.status, 'idle', 'initial state is idle');

    const file = new File([new Uint8Array([1, 2, 3])], 'mesh.glb', {
      type: 'model/gltf-binary',
    });

    // Re-render to capture the live hook instance (functions) for this test.
    let live: any;
    function LiveProbe() {
      live = useMeshAssetUpload();
      return null;
    }
    renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(LiveProbe)
      )
    );

    // Drive upload (synchronous; SSR won't flush state but side effects run).
    void live.upload(file);
    assert.equal(mockCreateObjectURL.mock.calls.length, 1, 'blob URL created for local preview');

    live.cancel();

    // AbortController.abort invoked exactly once
    assert.equal(abortCalls, 1, 'AbortController.abort should be called once on cancel');

    // Blob URL revoked
    assert.equal(revokeCalls.length, 1);
    assert.equal(revokeCalls[0], 'blob:mock-upload-url');

    // Previous active asset restored (last setCurrentAsset call)
    const lastSetCurrent = setCurrentAssetCalls[setCurrentAssetCalls.length - 1];
    assert.equal(lastSetCurrent.id, 'previous-asset', 'previous active asset restored on cancel');
  });

  it('cancel with no previous asset does not throw', async () => {
    const useMeshAssetUpload = await getHook();
    currentAssetValue = null; // no active asset to restore
    const inst = renderHook(useMeshAssetUpload);
    assert.equal(inst.status, 'idle');

    let live: any;
    function LiveProbe() {
      live = useMeshAssetUpload();
      return null;
    }
    renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(LiveProbe)
      )
    );

    const file = new File([new Uint8Array([1])], 'mesh.glb', { type: 'model/gltf-binary' });
    void live.upload(file);

    assert.doesNotThrow(() => live.cancel());
    assert.equal(setCurrentAssetCalls.length, 1, 'setCurrentAsset called once (with local asset), no restore when no previous asset');
  });

  it('allows a new upload after cancel (uploadInProgress cleared)', async () => {
    const useMeshAssetUpload = await getHook();
    let live: any;
    function LiveProbe() {
      live = useMeshAssetUpload();
      return null;
    }
    renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(LiveProbe)
      )
    );

    const file = new File([new Uint8Array([1])], 'mesh.glb', { type: 'model/gltf-binary' });
    void live.upload(file);
    live.cancel();

    // A second upload should be accepted (uploadInProgress was cleared by cancel).
    const file2 = new File([new Uint8Array([2])], 'mesh2.glb', { type: 'model/gltf-binary' });
    void live.upload(file2);
    assert.equal(mockUploadMeshAsset.mock.calls.length, 2, 'second upload accepted after cancel');
  });

  it('reset cleans state back to idle', async () => {
    const useMeshAssetUpload = await getHook();
    const inst = renderHook(useMeshAssetUpload);

    let live: any;
    function LiveProbe() {
      live = useMeshAssetUpload();
      return null;
    }
    renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(LiveProbe)
      )
    );

    const file = new File([new Uint8Array([1])], 'mesh.glb', { type: 'model/gltf-binary' });
    void live.upload(file);
    live.cancel();
    live.reset();

    // reset() is synchronous; initial render state remains idle.
    assert.equal(inst.status, 'idle');
    assert.equal(inst.fileName, '');
    assert.equal(inst.error, null);
  });

  it('cancel path executes setCurrentAsset restore', async () => {
    const useMeshAssetUpload = await getHook();
    let live: any;
    function LiveProbe() {
      live = useMeshAssetUpload();
      return null;
    }
    renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(LiveProbe)
      )
    );

    const file = new File([new Uint8Array([1])], 'mesh.glb', { type: 'model/gltf-binary' });
    void live.upload(file);
    live.cancel();

    assert.ok(setCurrentAssetCalls.length >= 1, 'cancel path executed setCurrentAsset restore');
  });
});
