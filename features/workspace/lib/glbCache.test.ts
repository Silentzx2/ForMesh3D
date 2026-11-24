import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGLBWithProgress } from './glbCache';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
describe('shared GLB request cancellation', () => {
  it('keeps a shared request alive while another consumer remains', async () => {
    let resolveResponse!: (response: Response) => void;
    let count = 0;
    let networkSignal: AbortSignal | undefined;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      count += 1; networkSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    }) as typeof fetch;
    const controller = new AbortController();
    const first = loadGLBWithProgress('https://example.test/shared.glb', undefined, controller.signal);
    const second = loadGLBWithProgress('https://example.test/shared.glb');
    controller.abort();
    await assert.rejects(first, { name: 'AbortError' });
    assert.equal(networkSignal?.aborted, false);
    resolveResponse(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }));
    assert.deepEqual(Array.from(new Uint8Array(await second)), [1, 2, 3]);
    assert.equal(count, 1);
  });
  it('aborts the network request when the last consumer leaves', async () => {
    let rejectFetch!: (error: Error) => void;
    let networkSignal: AbortSignal | undefined;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      networkSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => { rejectFetch = reject; });
    }) as typeof fetch;
    const controller = new AbortController();
    const pending = loadGLBWithProgress('https://example.test/solo.glb', undefined, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(networkSignal?.aborted, true);
    rejectFetch(new DOMException('Aborted', 'AbortError'));
  });
});
