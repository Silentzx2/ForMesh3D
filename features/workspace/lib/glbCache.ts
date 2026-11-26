/**
 * High-performance multi-tier cache for 3D model files (GLB, GLTF, OBJ, PLY).
 *
 * Tier 1 (L1): In-memory ArrayBuffer cache (instant 0ms RAM lookup).
 * Tier 2 (L2): Persistent browser CacheStorage (disk-backed across page refreshes/tabs).
 * Tier 3 (L3): Chunked streaming network fetch with real-time download progress.
 */

const CACHE_NAME = 'formash-3d-models-v1';
const glbBufferCache = new Map<string, ArrayBuffer>();
const MAX_CACHE_BYTES = 150 * 1024 * 1024; // 150MB maximum in-memory budget
const MAX_CACHE_ITEMS = 12; // Cap item count
let currentCacheBytes = 0;

export function getCachedGLB(url: string): ArrayBuffer | undefined {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return undefined;
  const value = glbBufferCache.get(url);
  if (value) {
    // Map insertion order provides the LRU queue; touching a key moves it to MRU.
    glbBufferCache.delete(url);
    glbBufferCache.set(url, value);
  }
  return value;
}

export function setCachedGLB(url: string, buffer: ArrayBuffer): void {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;

  const itemBytes = buffer.byteLength;
  // If a single model exceeds the budget, don't keep it in L1 RAM (it can still live in L2 disk cache)
  if (itemBytes > MAX_CACHE_BYTES) return;

  const existing = glbBufferCache.get(url);
  if (existing) {
    currentCacheBytes -= existing.byteLength;
    glbBufferCache.delete(url);
  }

  // Evict oldest items if item count or memory budget exceeded
  while (
    (glbBufferCache.size >= MAX_CACHE_ITEMS || currentCacheBytes + itemBytes > MAX_CACHE_BYTES) &&
    glbBufferCache.size > 0
  ) {
    const firstKey = glbBufferCache.keys().next().value;
    if (!firstKey) break;
    const oldBuf = glbBufferCache.get(firstKey);
    if (oldBuf) currentCacheBytes -= oldBuf.byteLength;
    glbBufferCache.delete(firstKey);
  }

  glbBufferCache.set(url, buffer);
  currentCacheBytes += itemBytes;

  // Asynchronously persist into L2 disk CacheStorage (HTTP/HTTPS/origin paths only)
  if (typeof window !== 'undefined' && 'caches' in window && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/'))) {
    try {
      caches.open(CACHE_NAME).then((cache) => {
        const headers = new Headers({
          'Content-Type': 'model/gltf-binary',
          'Content-Length': buffer.byteLength.toString(),
        });
        // Avoid buffer.slice(0) memory copy; Response accepts ArrayBufferView/ArrayBuffer directly
        const response = new Response(buffer, { headers });
        cache.put(url, response).catch(() => {});
      }).catch(() => {});
    } catch {}
  }
}

export interface StreamProgressCallback {
  (loaded: number, total: number, percent: number): void;
}

interface InFlightRequest {
  controller: AbortController;
  promise: Promise<ArrayBuffer>;
  consumers: Set<symbol>;
  progressListeners: Set<StreamProgressCallback>;
}
const inFlightRequests = new Map<string, InFlightRequest>();
function createAbortError(): DOMException { return new DOMException('Aborted', 'AbortError'); }
function subscribeToRequest(url: string, request: InFlightRequest, onProgress?: StreamProgressCallback, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  const consumerId = Symbol(url);
  const listener = onProgress ? ((loaded: number, total: number, percent: number) => onProgress(loaded, total, percent)) : undefined;
  request.consumers.add(consumerId);
  if (listener) request.progressListeners.add(listener);
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = (abortIfUnused: boolean) => {
      signal?.removeEventListener('abort', handleAbort);
      request.consumers.delete(consumerId);
      if (listener) request.progressListeners.delete(listener);
      if (abortIfUnused && request.consumers.size === 0 && inFlightRequests.get(url) === request) {
        inFlightRequests.delete(url);
        request.controller.abort();
      }
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      release(true);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) { handleAbort(); return; }
    request.promise.then(
      (buffer) => { if (!settled) { settled = true; release(false); resolve(buffer); } },
      (error: unknown) => { if (!settled) { settled = true; release(false); reject(error); } },
    );
  });
}
async function fetchWithRetry(url: string, sharedSignal: AbortSignal, request: InFlightRequest, attempt = 1, maxAttempts = 3): Promise<ArrayBuffer> {
  if (sharedSignal.aborted) throw createAbortError();
  const attemptController = new AbortController();
  const abortFromShared = () => attemptController.abort();
  sharedSignal.addEventListener('abort', abortFromShared, { once: true });
  const timeoutId = setTimeout(() => attemptController.abort(), 120000);
  try {
    const response = await fetch(url, { signal: attemptController.signal });
    if (!response.ok) {
      const error = new Error('HTTP ' + response.status);
      if (![502, 503, 504].includes(response.status) || attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      return fetchWithRetry(url, sharedSignal, request, attempt + 1, maxAttempts);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      const text = await response.clone().text();
      if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) throw new Error('Model file served as HTML — possible token/auth failure.');
    }
    const rawLength = Number(response.headers.get('content-length') || 0);
    const total = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : 0;
    let arrayBuffer: ArrayBuffer;
    if (response.body && typeof ReadableStream !== 'undefined' && total > 0) {
      const reader = response.body.getReader();
      let buffer = new Uint8Array(total);
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (loaded + value.byteLength > buffer.byteLength) {
          const next = new Uint8Array(Math.max(loaded + value.byteLength, buffer.byteLength * 2));
          next.set(buffer.subarray(0, loaded));
          buffer = next;
        }
        buffer.set(value, loaded);
        loaded += value.byteLength;
        const percent = Math.min(99, Math.round((loaded / total) * 100));
        for (const progressListener of request.progressListeners) { try { progressListener(loaded, total, percent); } catch {} }
      }
      arrayBuffer = buffer.buffer.slice(0, loaded);
    } else {
      arrayBuffer = await response.arrayBuffer();
    }
    for (const progressListener of request.progressListeners) { try { progressListener(arrayBuffer.byteLength, arrayBuffer.byteLength, 100); } catch {} }
    setCachedGLB(url, arrayBuffer);
    return arrayBuffer;
  } catch (error) {
    if (sharedSignal.aborted) throw createAbortError();
    const message = error instanceof Error ? error.message : String(error);
    const retryable = attemptController.signal.aborted || error instanceof TypeError || /network|fetch|HTTP 502|HTTP 503|HTTP 504/i.test(message);
    if (retryable && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      return fetchWithRetry(url, sharedSignal, request, attempt + 1, maxAttempts);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    sharedSignal.removeEventListener('abort', abortFromShared);
  }
}
/** Each caller owns an independent cancellation subscription to the shared network request. */
export async function loadGLBWithProgress(url: string, onProgress?: StreamProgressCallback, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!url) throw new Error('Model URL is required');
  if (signal?.aborted) throw createAbortError();
  const isCacheableUrl = !url.startsWith('blob:') && !url.startsWith('data:');
  if (isCacheableUrl) {
    const memCached = getCachedGLB(url);
    if (memCached) { onProgress?.(memCached.byteLength, memCached.byteLength, 100); return memCached; }
  }
  if (isCacheableUrl && typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const matched = await cache.match(url);
      if (signal?.aborted) throw createAbortError();
      if (matched) {
        const buffer = await matched.arrayBuffer();
        if (buffer.byteLength > 0) { setCachedGLB(url, buffer); onProgress?.(buffer.byteLength, buffer.byteLength, 100); return buffer; }
      }
    } catch {
      if (signal?.aborted) throw createAbortError();
      // CacheStorage is an optimization; network remains the source of truth.
    }
  }
  const existing = inFlightRequests.get(url);
  if (existing) return subscribeToRequest(url, existing, onProgress, signal);
  const request: InFlightRequest = {
    controller: new AbortController(),
    promise: Promise.resolve(new ArrayBuffer(0)),
    consumers: new Set(),
    progressListeners: new Set(),
  };
  request.promise = fetchWithRetry(url, request.controller.signal, request).finally(() => {
    if (inFlightRequests.get(url) === request) inFlightRequests.delete(url);
  });
  inFlightRequests.set(url, request);
  return subscribeToRequest(url, request, onProgress, signal);
}

export async function prefetchGLB(url: string): Promise<ArrayBuffer | null> {
  if (!url) return null;
  try {
    return await loadGLBWithProgress(url);
  } catch {
    return null;
  }
}

