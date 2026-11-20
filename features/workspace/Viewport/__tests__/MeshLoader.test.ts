import { MeshLoader, CachedMesh } from '../MeshLoader';
import { disposeObject3D } from '../MeshRenderer';

jest.mock('../MeshRenderer', () => ({
  disposeObject3D: jest.fn(),
}));

/** Describes the cache ref-count contract that must never break. */
describe('MeshLoader cache', () => {
  const loader = new MeshLoader();

  beforeEach(() => {
    loader.disposeAll();
    jest.clearAllMocks();
  });

  it('same URL returns cached entry and increments refCount', async () => {
    const group1 = await loader.load('http://test.example.com/mesh.glb');
    const group2 = await loader.load('http://test.example.com/mesh.glb');

    expect(group1.url).toBe(group2.url);
    expect(group1.refCount).toBe(2);
    expect(group2.refCount).toBe(2);
    expect(loader.size()).toBe(1);
  });

  it('unload decrements refCount and disposes at zero', async () => {
    await loader.load('http://test.example.com/mesh.glb');
    loader.unload('http://test.example.com/mesh.glb');
    expect(loader.size()).toBe(1); // refCount still 1

    loader.unload('http://test.example.com/mesh.glb');
    expect(loader.size()).toBe(0); // refCount hit 0, disposed
    expect(disposeObject3D).toHaveBeenCalled();
  });

  it('unload on missing URL is a no-op', () => {
    expect(() => loader.unload('http://test.example.com/missing.glb')).not.toThrow();
    expect(loader.size()).toBe(0);
  });

  it('disposeAll clears the entire cache', async () => {
    await loader.load('http://test.example.com/a.glb');
    await loader.load('http://test.example.com/b.glb');
    expect(loader.size()).toBe(2);

    loader.disposeAll();
    expect(loader.size()).toBe(0);
    expect(disposeObject3D).toHaveBeenCalledTimes(2);
  });

  it('normalize strips query/hash for cache key', async () => {
    const a = await loader.load('http://test.example.com/mesh.glb?token=1');
    const b = await loader.load('http://test.example.com/mesh.glb#section');
    expect(a.refCount).toBe(2);
    expect(b.refCount).toBe(2);
    expect(loader.size()).toBe(1);
  });
});
