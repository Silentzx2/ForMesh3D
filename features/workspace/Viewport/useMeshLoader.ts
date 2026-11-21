import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { MeshRenderer, detectGpuAvailability, MeshStats } from './MeshRenderer';
import { meshLoader } from './MeshLoader';

export type MeshLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface UseMeshLoaderResult {
  status: MeshLoadStatus;
  error: string | null;
  stats: MeshStats;
  isGpu: boolean;
  loadTime: number;
  renderer: MeshRenderer | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  initRenderer: (container: HTMLDivElement) => void;
  loadModel: (url: string | null) => Promise<void>;
  unload: () => void;
}

/**
 * useMeshLoader — React hook for GPU-first mesh loading with caching.
 *
 * State machine: idle → loading → loaded | error.
 * - On URL change: abort previous load, load mesh via cache.
 * - Same URL reused → instant cache hit, no re-download/parse.
 * - Unmount / URL change → dispose renderer mesh + decrement loader refCount.
 */
export function useMeshLoader(): UseMeshLoaderResult {
  const [status, setStatus] = useState<MeshLoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MeshStats>({ vertices: 0, triangles: 0 });
  const [loadTime, setLoadTime] = useState(0);
  const [isGpu, setIsGpu] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MeshRenderer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cachedUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const unload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (cachedUrlRef.current) {
      meshLoader.unload(cachedUrlRef.current);
      cachedUrlRef.current = null;
    }
    rendererRef.current?.unload();
    // Keep the renderer instance alive so a later loadModel() call finds a
    // valid renderer. Only the unmount effect disposes it (see cleanup below).
    // Do NOT reset isGpu here — the renderer's GPU/CPU mode is fixed at init.
    setStatus('idle');
    setError(null);
    setStats({ vertices: 0, triangles: 0 });
    setLoadTime(0);
  }, []);

  const initRenderer = useCallback((container: HTMLDivElement) => {
    containerRef.current = container;
    const gpu = detectGpuAvailability();
    setIsGpu(gpu);
    rendererRef.current = new MeshRenderer(container, gpu);
  }, []);

  const loadModel = useCallback(async (url: string | null) => {
    // Abort any in-flight load
    abortRef.current?.abort();
    abortRef.current = null;

    // Unload previous mesh (keep renderer)
    if (cachedUrlRef.current) {
      meshLoader.unload(cachedUrlRef.current);
      cachedUrlRef.current = null;
    }
    rendererRef.current?.unload();

    setStatus('idle');
    setError(null);
    setStats({ vertices: 0, triangles: 0 });
    setLoadTime(0);

    if (!url) {
      return;
    }

    if (!rendererRef.current) {
      // Defensive: initRenderer may not have run yet (e.g. container ref not
      // ready on first mount). Initialize now so the load can proceed.
      if (containerRef.current) {
        initRenderer(containerRef.current);
      } else {
        setError('Renderer not initialized. Call initRenderer(container) first.');
        setStatus('error');
        return;
      }
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Hard load budget: abort and surface an error if the mesh doesn't
    // arrive within LOAD_TIMEOUT_MS so the UI never stays stuck on 'loading'.
    const LOAD_TIMEOUT_MS = 10_000;

    setStatus('loading');

    try {
      const start = performance.now();

      // Race the mesh load against a hard timeout. GLTFLoader can hang on a
      // stalled fetch (no abort response) — this guarantees a terminal state.
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Mesh load timed out')), LOAD_TIMEOUT_MS);
        abortController.signal.addEventListener('abort', () => clearTimeout(timeoutId!), {
          once: true,
        });
      });
      const cached = await Promise.race([
        meshLoader.load(url, abortController.signal),
        timeout,
      ]);
      clearTimeout(timeoutId!);

      if (!mountedRef.current || abortController.signal.aborted) {
        meshLoader.unload(url);
        return;
      }

      cachedUrlRef.current = url;

      // Clone the cached group so each viewer instance has its own scene node.
      // Deep-clone geometries and materials: a plain Group.clone() shares them
      // by reference with the cache, and renderer.unload() disposes them on
      // unload — which would poison the shared cache entry and break the next
      // load of the same URL.
      const group = cached.group.clone();
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.geometry) child.geometry = child.geometry.clone();
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) => m.clone());
        } else if (child.material) {
          child.material = child.material.clone();
        }
      });
      rendererRef.current!.load(group);

      setStatus('loaded');
      setStats(cached.stats);
      setLoadTime(performance.now() - start);
    } catch (err) {
      if (!mountedRef.current) return;
      // If the hard timeout fired, abort the in-flight load so it doesn't
      // keep holding the fetch/decoder in the background.
      if (err instanceof Error && err.message === 'Mesh load timed out') {
        abortController.abort();
      }
      if (abortController.signal.aborted && err instanceof Error && err.message !== 'Mesh load timed out') {
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load mesh';
      setError(message);
      setStatus('error');
      console.error('[MeshLoader] Load failed:', err);
    }
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (cachedUrlRef.current) {
        meshLoader.unload(cachedUrlRef.current);
      }
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  return {
    status,
    error,
    stats,
    isGpu,
    loadTime,
    renderer: rendererRef.current,
    containerRef,
    initRenderer,
    loadModel,
    unload,
  };
}
