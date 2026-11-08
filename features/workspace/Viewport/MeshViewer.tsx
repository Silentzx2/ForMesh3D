'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAnimationStore } from '@/stores/useAnimationStore';

import { HugeiconsIcon } from '@hugeicons/react';
import { SparklesIcon } from '@hugeicons/core-free-icons';

// Setup shared loaders with Draco and Meshopt decompression
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const sharedGLTFLoader = new GLTFLoader();
sharedGLTFLoader.setDRACOLoader(dracoLoader);
sharedGLTFLoader.setMeshoptDecoder(MeshoptDecoder);

const sharedOBJLoader = new OBJLoader();
const sharedFBXLoader = new FBXLoader();
const sharedSTLLoader = new STLLoader();
const sharedPLYLoader = new PLYLoader();

export type LightTone = 'studio' | 'warm' | 'cool' | 'neutral';

export interface EnvironmentPreset {
  id: string;
  label: string;
  settings: {
    ambientIntensity: number;
    keyLightIntensity: number;
    fillLightIntensity: number;
    rimLightIntensity: number;
    exposure: number;
    toneMapping?: 'neutral' | 'aces';
    lightTone: LightTone;
    backgroundColor: string;
    gridVisible: boolean;
    floorShadowOpacity: number;
    autoRotate: boolean;
  };
}

export const LIGHT_TONES: Record<LightTone, { label: string; key: number; fill: number; rim: number }> = {
  studio: { label: 'Studio', key: 0xffffff, fill: 0xedf2fa, rim: 0xfff1d4 },
  warm: { label: 'Warm Gold', key: 0xffe8cc, fill: 0xfff5ea, rim: 0xffcc00 },
  cool: { label: 'Cyber Cool', key: 0xffffff, fill: 0xd8e6ff, rim: 0xd0e0ff },
  neutral: { label: 'Neutral', key: 0xffffff, fill: 0xffffff, rim: 0xffffff },
};

export const BACKGROUND_OPTIONS = [
  {
    id: 'studio-vignette',
    label: 'Studio Vignette',
    value: 'radial-gradient(ellipse 75% 70% at 50% 50%, #3a3c40 0%, #2d2f33 30%, #1e1f22 60%, #121315 85%, #08090a 100%)',
    preview: 'radial-gradient(ellipse 75% 70% at 50% 50%, #3a3c40 0%, #2d2f33 30%, #1e1f22 60%, #121315 85%, #08090a 100%)',
  },
  { id: 'transparent', label: 'Studio Dark', value: 'transparent', preview: 'radial-gradient(circle, #16181d 0%, #08090a 100%)' },
  { id: 'dark-gray', label: 'Dark Charcoal', value: '#131519', preview: '#131519' },
  { id: 'slate', label: 'Dark Slate', value: '#181b22', preview: '#181b22' },
];

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'studio',
    label: 'Studio Gold',
    settings: {
      ambientIntensity: 0.75,
      keyLightIntensity: 1.6,
      fillLightIntensity: 0.9,
      rimLightIntensity: 1.1,
      exposure: 1.0,
      toneMapping: 'neutral',
      lightTone: 'studio',
      backgroundColor: 'radial-gradient(ellipse 75% 70% at 50% 50%, #3a3c40 0%, #2d2f33 30%, #1e1f22 60%, #121315 85%, #08090a 100%)',
      gridVisible: true,
      floorShadowOpacity: 0.2,
      autoRotate: false,
    },
  },
];

interface MeshViewerProps {
  className?: string;
}

const disposeObject3D = (obj: THREE.Object3D) => {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else if (child.material) {
        child.material.dispose();
      }
    }
  });
};

export const MeshViewer: React.FC<MeshViewerProps> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    currentAsset,
    shadingMode,
    showWireframe,
    showGrid,
    isTurntable,
    viewportResetTrigger,
    isExecuting,
    executionProgress,
    executionStep,
    environmentSettings,
  } = useWorkspace();

  const loadedModelUrl = useViewerStore((state) => state.loadedModelUrl);

  const [hasModel, setHasModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Three.js instances stored in refs to avoid React re-render overhead
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);

  // 1. Initialize Scene, Camera, Renderer, Lights, Controls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 3.2);
    cameraRef.current = camera;

    // Renderer with preserveDrawingBuffer enabled for high-res snapshot capture
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.maxDistance = 20;
    controls.minDistance = 0.5;
    controlsRef.current = controls;

    // Lights - Natural Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    ambientLightRef.current = ambientLight;
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0001;
    keyLightRef.current = keyLight;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xedf2fa, 0.9);
    fillLight.position.set(-4, 2, -2);
    fillLightRef.current = fillLight;
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfff1d4, 1.1);
    rimLight.position.set(0, 4, -4);
    rimLightRef.current = rimLight;
    scene.add(rimLight);

    // Ground Grid - Soft Studio Grid with Clean Axes
    const grid = new THREE.GridHelper(10, 20, 0x8c9099, 0x383b43);
    grid.position.y = -0.001;
    gridHelperRef.current = grid;
    scene.add(grid);

    // Model root group
    const modelGroup = new THREE.Group();
    modelGroupRef.current = modelGroup;
    scene.add(modelGroup);

    // Animation frame loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      if (modelGroupRef.current && isTurntable) {
        modelGroupRef.current.rotation.y += 0.008;
      }

      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      disposeObject3D(scene);
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
    };
  }, []);

  // 2. Camera Preset Event Listener
  useEffect(() => {
    const handleCameraPreset = (e: CustomEvent<string>) => {
      if (!cameraRef.current || !controlsRef.current) return;
      const cam = cameraRef.current;
      const ctrl = controlsRef.current;
      const target = ctrl.target;
      const dist = cam.position.distanceTo(target) || 3.0;

      switch (e.detail) {
        case 'front':
          cam.up.set(0, 1, 0);
          cam.position.set(target.x, target.y, target.z + dist);
          break;
        case 'top':
          cam.up.set(0, 0, -1);
          cam.position.set(target.x, target.y + dist, target.z + 0.0001);
          break;
        case 'side':
        case 'left':
          cam.up.set(0, 1, 0);
          cam.position.set(target.x - dist, target.y, target.z);
          break;
        case 'right':
          cam.up.set(0, 1, 0);
          cam.position.set(target.x + dist, target.y, target.z);
          break;
        default:
          cam.up.set(0, 1, 0);
          cam.position.set(target.x + dist * 0.7, target.y + dist * 0.5, target.z + dist * 0.7);
          break;
      }
      cam.lookAt(target);
      ctrl.update();
    };

    window.addEventListener('setCameraPreset', handleCameraPreset as EventListener);
    return () => window.removeEventListener('setCameraPreset', handleCameraPreset as EventListener);
  }, []);

  // 3. Viewport Lighting & Exposure Listeners
  useEffect(() => {
    const handleExposure = (e: CustomEvent<number>) => {
      if (rendererRef.current && typeof e.detail === 'number') {
        rendererRef.current.toneMappingExposure = e.detail;
      }
    };

    const handleLighting = (e: CustomEvent<{ tone?: LightTone }>) => {
      const tone = e.detail?.tone;
      if (tone && LIGHT_TONES[tone]) {
        const t = LIGHT_TONES[tone];
        if (keyLightRef.current) keyLightRef.current.color.setHex(t.key);
        if (fillLightRef.current) fillLightRef.current.color.setHex(t.fill);
        if (rimLightRef.current) rimLightRef.current.color.setHex(t.rim);
      }
    };

    window.addEventListener('setViewportExposure', handleExposure as EventListener);
    window.addEventListener('setViewportLighting', handleLighting as EventListener);
    return () => {
      window.removeEventListener('setViewportExposure', handleExposure as EventListener);
      window.removeEventListener('setViewportLighting', handleLighting as EventListener);
    };
  }, []);

  // Sync environment settings with Three.js scene lights & exposure
  useEffect(() => {
    if (!environmentSettings) return;
    if (ambientLightRef.current && typeof environmentSettings.ambientIntensity === 'number') {
      ambientLightRef.current.intensity = environmentSettings.ambientIntensity;
    }
    if (keyLightRef.current && typeof environmentSettings.keyLightIntensity === 'number') {
      keyLightRef.current.intensity = environmentSettings.keyLightIntensity;
    }
    if (fillLightRef.current && typeof environmentSettings.fillLightIntensity === 'number') {
      fillLightRef.current.intensity = environmentSettings.fillLightIntensity;
    }
    if (rimLightRef.current && typeof environmentSettings.rimLightIntensity === 'number') {
      rimLightRef.current.intensity = environmentSettings.rimLightIntensity;
    }
    if (rendererRef.current && typeof environmentSettings.exposure === 'number') {
      rendererRef.current.toneMappingExposure = environmentSettings.exposure;
    }
  }, [environmentSettings]);

  // 4. Grid, Wireframe & Shading Mode Toggle
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGrid !== false;
    }
  }, [showGrid]);

  useEffect(() => {
    if (!modelGroupRef.current) return;
    modelGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if ('wireframe' in m) {
            m.wireframe = Boolean(showWireframe || shadingMode === 'wireframe');
            m.needsUpdate = true;
          }
          if (m instanceof THREE.MeshStandardMaterial) {
            if (shadingMode === 'clay') {
              m.color.setHex(0xb0b3b8);
              m.roughness = 0.85;
              m.metalness = 0.05;
              m.needsUpdate = true;
            } else if (shadingMode === 'textured') {
              m.color.setHex(0xffffff);
              m.roughness = 0.5;
              m.metalness = 0.1;
              m.needsUpdate = true;
            }
          }
        });
      }
    });
  }, [showWireframe, shadingMode]);

  // 3. Reset Camera / Fit to screen helper
  const fitCameraToModel = useCallback((object: THREE.Object3D) => {
    if (!cameraRef.current || !controlsRef.current) return;

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
    cameraZ = Math.max(cameraZ, 2.0);

    cameraRef.current.position.set(center.x, center.y + maxDim * 0.35, center.z + cameraZ);
    cameraRef.current.lookAt(center);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  }, []);

  useEffect(() => {
    if (modelGroupRef.current && modelGroupRef.current.children.length > 0) {
      fitCameraToModel(modelGroupRef.current);
    }
  }, [viewportResetTrigger, fitCameraToModel]);

  // 4. Load 3D Model when URL changes
  const modelUrl =
    currentAsset?.source?.viewUrl ||
    currentAsset?.source?.localUrl ||
    loadedModelUrl ||
    null;

  useEffect(() => {
    if (!modelUrl || !modelGroupRef.current) {
      setHasModel(false);
      return;
    }

    let isCancelled = false;
    setLoadError(null);

    // Clear previous model from scene
    const group = modelGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject3D(child);
    }
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    const format = modelUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'glb';

    const handleObjectLoaded = (object: THREE.Object3D, animations?: THREE.AnimationClip[]) => {
      if (isCancelled || !modelGroupRef.current) {
        disposeObject3D(object);
        return;
      }

      // Center and normalize model dimensions to fit comfortably inside unit space
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? 2.0 / maxDim : 1.0;

      object.position.sub(center.clone().multiplyScalar(scale));
      // Sit on ground
      object.position.y += (size.y * scale) / 2;
      object.scale.setScalar(scale);

      // Enable shadows and apply materials
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (m instanceof THREE.MeshStandardMaterial) {
                if (shadingMode === 'clay') {
                  m.color.setHex(0xb0b3b8);
                  m.roughness = 0.85;
                  m.metalness = 0.05;
                }
                if (showWireframe || shadingMode === 'wireframe') {
                  m.wireframe = true;
                }
              }
            });
          }
        }
      });

      // Hook up animations if available
      if (animations && animations.length > 0) {
        try {
          const mixer = new THREE.AnimationMixer(object);
          mixerRef.current = mixer;
          const action = mixer.clipAction(animations[0]);
          action.play();
          useAnimationStore.setState({ isPlaying: true, duration: animations[0].duration });
        } catch {
          // Skip if animation mixer cannot bind
        }
      }

      group.add(object);
      fitCameraToModel(object);
      setHasModel(true);
    };

    // Load by format
    if (format === 'glb' || format === 'gltf') {
      sharedGLTFLoader.load(
        modelUrl,
        (gltf) => handleObjectLoaded(gltf.scene, gltf.animations),
        undefined,
        (err: unknown) => {
          if (!isCancelled) setLoadError(`Failed to load 3D model: ${(err as any)?.message || 'Network error'}`);
        }
      );
    } else if (format === 'obj') {
      sharedOBJLoader.load(
        modelUrl,
        (obj) => handleObjectLoaded(obj),
        undefined,
        (err: unknown) => {
          if (!isCancelled) setLoadError(`Failed to load OBJ: ${(err as any)?.message || 'Error'}`);
        }
      );
    } else if (format === 'fbx') {
      sharedFBXLoader.load(
        modelUrl,
        (fbx) => handleObjectLoaded(fbx, fbx.animations),
        undefined,
        (err: unknown) => {
          if (!isCancelled) setLoadError(`Failed to load FBX: ${(err as any)?.message || 'Error'}`);
        }
      );
    } else if (format === 'stl') {
      sharedSTLLoader.load(
        modelUrl,
        (geom) => {
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0xc8cdd5, roughness: 0.6 });
          const mesh = new THREE.Mesh(geom, mat);
          handleObjectLoaded(mesh);
        },
        undefined,
        (err: unknown) => {
          if (!isCancelled) setLoadError(`Failed to load STL: ${(err as any)?.message || 'Error'}`);
        }
      );
    } else if (format === 'ply') {
      sharedPLYLoader.load(
        modelUrl,
        (geom) => {
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0xc8cdd5, roughness: 0.6 });
          const mesh = new THREE.Mesh(geom, mat);
          handleObjectLoaded(mesh);
        },
        undefined,
        (err: unknown) => {
          if (!isCancelled) setLoadError(`Failed to load PLY: ${(err as any)?.message || 'Error'}`);
        }
      );
    }

    return () => {
      isCancelled = true;
    };
  }, [modelUrl, fitCameraToModel, shadingMode, showWireframe]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
      style={{
        background: environmentSettings?.backgroundColor && environmentSettings.backgroundColor !== 'transparent'
          ? environmentSettings.backgroundColor
          : 'radial-gradient(ellipse 75% 70% at 50% 50%, #3a3c40 0%, #2d2f33 30%, #1e1f22 60%, #121315 85%, #08090a 100%)',
      }}
    >
      {/* Sleek Empty State Watermark matching Reference */}
      {!hasModel && !isExecuting && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
          <div className="flex flex-col items-center text-center px-4 max-w-sm select-none">
            {/* ForMesh3D Electric Gold Brand Mark */}
            <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--surface-1))] border border-[#F9CF00]/40 flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_24px_rgba(249,207,0,0.25)] mb-4 ring-1 ring-white/10">
              <HugeiconsIcon icon={SparklesIcon} size={28} className="text-[#F9CF00] drop-shadow-[0_0_10px_rgba(249,207,0,0.6)]" />
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] mb-1.5">
              Ready For A New 3D Model?
            </h2>
            <p className="text-xs text-zinc-300 font-medium drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
              Instantly generate 3D from image or text
            </p>
          </div>
        </div>
      )}

      {/* Execution Progress Overlay */}
      {isExecuting && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-20 bg-black/40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-[#1A1A1E]/95 border border-white/[0.08] shadow-2xl">
            <div className="w-8 h-8 rounded-full border-2 border-[#F9CF00] border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="text-xs font-bold text-white uppercase tracking-wider">
                {executionStep || 'Processing 3D Stage...'}
              </p>
              {typeof executionProgress === 'number' && (
                <p className="text-[11px] text-[#F9CF00] font-mono mt-0.5">{Math.round(executionProgress)}%</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {loadError && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/30 text-red-200 text-xs shadow-xl backdrop-blur-md">
          {loadError}
        </div>
      )}
    </div>
  );
};
