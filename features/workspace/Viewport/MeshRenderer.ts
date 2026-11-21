import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ShadingMode = 'textured' | 'clay' | 'normals' | 'wireframe' | 'matcap-gold' | 'matcap-chrome' | 'uv-checker';

export interface MeshStats {
  vertices: number;
  triangles: number;
}

/** Shared UV checker texture so all meshes reuse one canvas texture (no per-mesh upload). */
let sharedUVChecker: THREE.Texture | null = null;
function getUVCheckerTexture(): THREE.Texture {
  if (!sharedUVChecker && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const squares = 16;
    const step = 512 / squares;
    for (let i = 0; i < squares; i++) {
      for (let j = 0; j < squares; j++) {
        const isDark = (i + j) % 2 === 1;
        ctx.fillStyle = isDark ? '#1a1c22' : '#e2e6ed';
        ctx.fillRect(i * step, j * step, step, step);
      }
    }
    sharedUVChecker = new THREE.CanvasTexture(canvas);
    sharedUVChecker.wrapS = THREE.RepeatWrapping;
    sharedUVChecker.wrapT = THREE.RepeatWrapping;
    sharedUVChecker.repeat.set(4, 4);
    sharedUVChecker.needsUpdate = true;
  }
  return sharedUVChecker!;
}

/** Probe whether the browser has a real GPU-accelerated WebGL context. */
export function detectGpuAvailability(): boolean {
  if (typeof window === 'undefined' || !document) return false;
  const canvas = document.createElement('canvas');
  // failIfMajorPerformanceCaveat: false lets software fallbacks still create
  // a context; we only use it to detect, not to block rendering.
  const gl =
    canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
    canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false });
  if (!gl) return false;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
      const software = /swiftshader|llvmpipe|llvm-pipe|softpipe/i;
      if (software.test(renderer)) return false;
    }
  } catch {
    // best-effort; assume GPU if we can't read the string
  }
  return true;
}

const TEXTURE_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'aoMap', 'emissiveMap', 'lightMap', 'alphaMap',
  'bumpMap', 'displacementMap',
];

function disposeMaterialTextures(m: any) {
  if (!m) return;
  for (const k of TEXTURE_KEYS) {
    const t = m[k];
    if (t && typeof t.dispose === 'function') t.dispose();
  }
}

/** Recursively dispose geometries, materials, textures and cached shading variants. */
export function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();

      const orig = child.userData?.__originalMaterial;
      if (orig) {
        if (Array.isArray(orig)) {
          orig.forEach((mat) => { disposeMaterialTextures(mat); mat?.dispose?.(); });
        } else {
          disposeMaterialTextures(orig);
          orig?.dispose?.();
        }
      }

      const variants = [
        child.userData?.__clayMaterial,
        child.userData?.__normalMaterial,
        child.userData?.__goldMaterial,
        child.userData?.__chromeMaterial,
        child.userData?.__wireMaterial,
        child.userData?.__uvCheckerMaterial,
      ];
      variants.forEach((mat) => { disposeMaterialTextures(mat); mat?.dispose?.(); });

      if (child.material && child.material !== orig) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => { disposeMaterialTextures(mat); mat?.dispose?.(); });
        } else {
          disposeMaterialTextures(child.material);
          child.material?.dispose?.();
        }
      }
    }
  });
}

/**
 * MeshRenderer — GPU-accelerated WebGL renderer with automatic CPU fallback.
 *
 * GPU path: antialiasing, ACES tone mapping, PCF soft shadows, pixelRatio up to 1.5.
 * CPU path: no antialiasing, no shadows, pixelRatio = 1, basic materials.
 *
 * Large meshes (>1M triangles) automatically lose shadows and drop to 1:1 pixels
 * on both paths so the main thread never blocks.
 */
export class MeshRenderer {
  readonly domElement: HTMLCanvasElement;
  readonly isGpu: boolean;

  private container: HTMLElement;
  private __scene: THREE.Scene;
  private __camera: THREE.PerspectiveCamera;
  private __renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private modelGroup: THREE.Group;
  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private gridHelper: THREE.GridHelper;

  private animationId = 0;
  private hasModel = false;
  private shadingMode: ShadingMode = 'textured';
  private wireframe = false;
  private stats: MeshStats = { vertices: 0, triangles: 0 };

  /** Public getters for snapshot support */
  get scene(): THREE.Scene { return this.__scene; }
  get camera(): THREE.PerspectiveCamera { return this.__camera; }
  getPixelRatio(): number { return this.__renderer.getPixelRatio(); }
  setSize(w: number, h: number) { this.__renderer.setSize(w, h); }
  render() { this.__renderer.render(this.__scene, this.__camera); }

  constructor(container: HTMLElement, isGpu: boolean) {
    this.container = container;
    this.isGpu = isGpu;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.__scene = new THREE.Scene();
    this.__camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 1.2, 3.2);

    const pixelRatio = isGpu ? Math.min(window.devicePixelRatio, 1.5) : 1;

    this.__renderer = new THREE.WebGLRenderer({
      antialias: isGpu,
      alpha: true,
      preserveDrawingBuffer: true,
      failIfMajorPerformanceCaveat: false,
    });
    this.__renderer.setSize(w, h);
    this.__renderer.setPixelRatio(pixelRatio);
    this.__renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.__renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.__renderer.toneMappingExposure = 1.0;

    if (isGpu) {
      this.__renderer.shadowMap.enabled = true;
      this.__renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.domElement = this.__renderer.domElement;
    container.appendChild(this.domElement);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);
    this.controls.maxDistance = 20;
    this.controls.minDistance = 0.5;

    // Lights (studio setup)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.position.set(3, 5, 4);
    if (isGpu) this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xd4d4d4, 0.7);
    this.fillLight.position.set(-4, 2, -2);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0xfff1d4, 1.2);
    this.rimLight.position.set(0, 4, -4);
    this.scene.add(this.rimLight);

    this.gridHelper = new THREE.GridHelper(10, 20, 0x8c9099, 0x383b43);
    this.gridHelper.position.y = -0.001;
    this.scene.add(this.gridHelper);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    this.clock = new THREE.Clock();
    this.startLoop();
  }

  private startLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      if (!this.hasModel) return;
      const delta = this.clock.getDelta();
      this.controls.update();
      this.__renderer.render(this.__scene, this.__camera);
    };
    animate();
  }

  private stopLoop() {
    cancelAnimationFrame(this.animationId);
  }

  /** Compute mesh stats and mark large meshes for shadow bypass. */
  private computeStats(group: THREE.Group): MeshStats {
    let vertices = 0;
    let triangles = 0;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry;
        const vCount = geo.attributes.position?.count || 0;
        const tCount = geo.index ? geo.index.count / 3 : vCount / 3;
        vertices += vCount;
        triangles += tCount;

        if (tCount > 800_000) {
          child.castShadow = false;
        }
        child.frustumCulled = true;
        child.matrixAutoUpdate = false;
        child.updateMatrix();
      }
    });
    return { vertices, triangles: Math.round(triangles) };
  }

  /** Lower quality settings for very heavy meshes so rendering stays fluid. */
  private maybeDowngradeForLargeMesh(triangles: number) {
    if (triangles > 1_000_000) {
      this.__renderer.shadowMap.enabled = false;
      this.__renderer.setPixelRatio(1);
    }
  }

  /** Add group to scene, fit camera, compute stats. Caller must have called unload() first if replacing. */
  load(group: THREE.Group) {
    this.stats = this.computeStats(group);
    this.maybeDowngradeForLargeMesh(this.stats.triangles);

    this.modelGroup.add(group);
    this.fitCamera();
    this.applyShadingToAll(this.shadingMode, this.wireframe);
    this.hasModel = true;
  }

  /** Remove all meshes from scene and free their GPU/RAM memory. */
  unload() {
    while (this.modelGroup.children.length) {
      const child = this.modelGroup.children[0];
      this.modelGroup.remove(child);
      disposeObject3D(child);
    }
    this.stats = { vertices: 0, triangles: 0 };
    this.hasModel = false;
  }

  private applyShadingToAll(mode: ShadingMode, wireframe: boolean) {
    this.modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) this.applyShading(child, mode, wireframe);
    });
  }

  private applyShading(mesh: THREE.Mesh, mode: ShadingMode, wireframe: boolean) {
    if (!mesh.userData.__originalMaterial && mesh.material) {
      mesh.userData.__originalMaterial = mesh.material;
    }
    const orig = mesh.userData.__originalMaterial;
    if (!orig) return;

    // Instant wireframe: pre-compiled unlit material — no shader recompile at 1M faces.
    if (wireframe || mode === 'wireframe') {
      let m = mesh.userData.__wireMaterial;
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true });
        mesh.userData.__wireMaterial = m;
      }
      mesh.material = m;
      return;
    }

    let m: THREE.Material;
    if (mode === 'normals') {
      m = mesh.userData.__normalMaterial || (mesh.userData.__normalMaterial = new THREE.MeshNormalMaterial());
    } else if (mode === 'clay') {
      m = mesh.userData.__clayMaterial || (mesh.userData.__clayMaterial = new THREE.MeshStandardMaterial({ color: 0xb0b3b8, roughness: 0.85, metalness: 0.05 }));
    } else if (mode === 'matcap-gold') {
      m = mesh.userData.__goldMaterial || (mesh.userData.__goldMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.25, metalness: 0.85 }));
    } else if (mode === 'matcap-chrome') {
      m = mesh.userData.__chromeMaterial || (mesh.userData.__chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.98 }));
    } else if (mode === 'uv-checker') {
      m = mesh.userData.__uvCheckerMaterial || (mesh.userData.__uvCheckerMaterial = new THREE.MeshStandardMaterial({ map: getUVCheckerTexture(), roughness: 0.4, metalness: 0.05 }));
    } else {
      m = orig; // textured / default — original PBR material, geometry untouched
    }
    mesh.material = m;
  }

  setShadingMode(mode: ShadingMode, wireframe: boolean) {
    this.shadingMode = mode;
    this.wireframe = wireframe;
    this.applyShadingToAll(mode, wireframe);
  }

  setWireframe(wireframe: boolean) {
    this.wireframe = wireframe;
    this.applyShadingToAll(this.shadingMode, wireframe);
  }

  fitCamera() {
    if (!this.modelGroup.children.length) return;
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
    cameraZ = Math.max(cameraZ, 2.0);
    this.camera.position.set(center.x, center.y + maxDim * 0.35, center.z + cameraZ);
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  resize(w: number, h: number) {
    if (w > 0 && h > 0) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.__renderer.setSize(w, h);
    }
  }

  setPixelRatio(ratio: number) {
    this.__renderer.setPixelRatio(ratio);
  }

  getStats(): MeshStats {
    return { ...this.stats };
  }

  /** Full teardown: stop loop, dispose scene, renderer, controls, DOM. */
  dispose() {
    this.stopLoop();
    this.unload();
    this.controls.dispose();
    this.__renderer.dispose();
    if (this.domElement.parentElement) {
      this.domElement.parentElement.removeChild(this.domElement);
    }
    (this.__scene as any) = null;
    (this.__camera as any) = null;
    (this.__renderer as any) = null;
    (this.controls as any) = null;
    (this.modelGroup as any) = null;
  }
}
