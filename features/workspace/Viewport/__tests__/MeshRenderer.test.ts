import { MeshRenderer, detectGpuAvailability, disposeObject3D } from '../MeshRenderer';

describe('MeshRenderer', () => {
  const container = document.createElement('div');

  afterEach(() => {
    container.innerHTML = '';
  });

  it('detectGpuAvailability returns boolean without throwing', () => {
    expect(typeof detectGpuAvailability()).toBe('boolean');
  });

  it('dispose() does not throw even when renderer has no model', () => {
    const r = new MeshRenderer(container, true);
    expect(() => r.dispose()).not.toThrow();
  });

  it('dispose() does not throw when called twice', () => {
    const r = new MeshRenderer(container, true);
    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });

  it('setShadingMode accepts all valid ShadingMode values', () => {
    const r = new MeshRenderer(container, true);
    const modes: Array<Parameters<MeshRenderer['setShadingMode']>[0]> = [
      'textured', 'clay', 'normals', 'wireframe',
      'matcap-gold', 'matcap-chrome', 'uv-checker',
    ];
    for (const mode of modes) {
      expect(() => r.setShadingMode(mode, false)).not.toThrow();
    }
    r.dispose();
  });

  it('disposeObject3D handles null/undefined gracefully', () => {
    expect(() => disposeObject3D(null as any)).not.toThrow();
  });
});
