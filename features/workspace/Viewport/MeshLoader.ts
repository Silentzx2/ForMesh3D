import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { disposeObject3D } from './MeshRenderer';

export interface CachedMesh {
  url: string;
  group: THREE.Group;
  stats: { vertices: number; triangles: number };
  loadTime: number;
  refCount: number;
}

/**
 * MeshLoader — URL-keyed mesh cache + loader.
 *
 * Parses each URL once (DRACO + meshopt decoded GLTF, OBJ, FBX, STL, PLY).
 * Subsequent loads of the same URL return the cached Group instantly —
 * no re-download, no re-parse. refCount tracks active viewers so memory
 * is released only when the last viewer unloads.
 */
export class MeshLoader {
  private cache = new Map<string, CachedMesh>();
  private readonly maxCachedSize = 8; // cap cached meshes to bound memory
  private lru: string[] = []; // least recently used first

  private gltfLoader: GLTFLoader;
  private objLoader: OBJLoader;
  private fbxLoader: FBXLoader;
  private stlLoader: STLLoader;
  private plyLoader: PLYLoader;

  constructor() {
    // Shared DRACO + meshopt decoders (created once, reused for every GLTF).
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(draco);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    this.objLoader = new OBJLoader();
    this.fbxLoader = new FBXLoader();
    this.stlLoader = new STLLoader();
    this.plyLoader = new PLYLoader();
  }

  /** Normalise a URL so the same resource always hits the same cache key. */
  private normalize(url: string): string {
    try {
      const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      return u.origin + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  private getLoader(ext: string) {
    switch (ext.toLowerCase()) {
      case 'gltf':
      case 'glb': return this.gltfLoader;
      case 'obj': return this.objLoader;
      case 'fbx': return this.fbxLoader;
      case 'stl': return this.stlLoader;
      case 'ply': return this.plyLoader;
      default: return this.gltfLoader;
    }
  }

  private async loadRaw(url: string, signal?: AbortSignal): Promise<THREE.Group> {
    const ext = url.split('?')[0].split('.').pop() || 'glb';
    const loader = this.getLoader(ext);

    return new Promise<THREE.Group>((resolve, reject) => {
      const onAbort = () => reject(new Error('Load cancelled'));
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      loader.load(
        url,
        (gltf) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          const group = gltf.scene || gltf;
          const root = group instanceof THREE.Group ? group : new THREE.Group().add(group);
          resolve(root);
        },
        undefined,
        (err) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  /**
   * Load (or return cached) a mesh Group for the given URL.
   * Returns the cached CachedMesh with refCount incremented.
   */
  async load(url: string, signal?: AbortSignal): Promise<CachedMesh> {
    const key = this.normalize(url);
    const cached = this.cache.get(key);
    if (cached) {
      cached.refCount++;
      this.touch(key);
      return cached;
    }

    const start = performance.now();
    const group = await this.loadRaw(url, signal);

    // Compute stats once at parse time.
    let vertices = 0;
    let triangles = 0;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry;
        vertices += geo.attributes.position?.count || 0;
        triangles += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
        child.frustumCulled = true;
        child.matrixAutoUpdate = false;
        child.updateMatrix();
      }
    });

    const entry: CachedMesh = {
      url: key,
      group,
      stats: { vertices, triangles: Math.round(triangles) },
      loadTime: performance.now() - start,
      refCount: 1,
    };
    this.cache.set(key, entry);
    this.touch(key);
    this.evictIfNeeded();
    return entry;
  }

  /** Mark a cache key as most recently used. */
  private touch(key: string) {
    this.lru = this.lru.filter((k) => k !== key);
    this.lru.push(key);
  }

  /** Evict least-recently-used entries when over the cap. */
  private evictIfNeeded() {
    while (this.cache.size > this.maxCachedSize) {
      const victim = this.lru.shift();
      if (!victim) break;
      const entry = this.cache.get(victim);
      if (!entry) continue;
      // Only evict entries with no active viewers
      if (entry.refCount > 0) {
        this.lru.push(victim); // put back, try next
        break;
      }
      disposeObject3D(entry.group);
      this.cache.delete(victim);
    }
  }

  /** Decrement refCount; when it hits 0, dispose the Group and remove from cache. */
  unload(url: string) {
    const key = this.normalize(url);
    const cached = this.cache.get(key);
    if (!cached) return;
    cached.refCount--;
    this.lru = this.lru.filter((k) => k !== key);
    if (cached.refCount <= 0) {
      disposeObject3D(cached.group);
      this.cache.delete(key);
    }
  }

  /** Return cached entry without touching refCount. */
  get(url: string): CachedMesh | undefined {
    return this.cache.get(this.normalize(url));
  }

  /** Dispose every cached mesh and clear the cache. */
  disposeAll() {
    for (const entry of this.cache.values()) {
      disposeObject3D(entry.group);
    }
    this.cache.clear();
  }

  /** Number of cached meshes (diagnostics). */
  size() {
    return this.cache.size;
  }
}

export const meshLoader = new MeshLoader();
