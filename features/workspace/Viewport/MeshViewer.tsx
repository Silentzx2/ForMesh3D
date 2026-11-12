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
import type { ShadingMode } from '../types';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { getApiClient } from '@/services/apiClient';
import { collectMeshStats } from './meshStats';

import { toast } from 'sonner';
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
  studio: { label: 'Studio', key: 0xffffff, fill: 0xd4d4d4, rim: 0xfff1d4 },
  warm: { label: 'Warm Gold', key: 0xffe8cc, fill: 0xfff5ea, rim: 0xffcc00 },
  cool: { label: 'Cyber Cool', key: 0xffffff, fill: 0xd8e6ff, rim: 0xd0e0ff },
  neutral: { label: 'Neutral', key: 0xffffff, fill: 0xe6e6e6, rim: 0xffffff },
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
      ambientIntensity: 0.65,
      keyLightIntensity: 1.5,
      fillLightIntensity: 0.7,
      rimLightIntensity: 1.2,
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

let sharedUVCheckerTexture: THREE.CanvasTexture | null = null;
function getUVCheckerTexture(): THREE.CanvasTexture {
  if (!sharedUVCheckerTexture && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const squares = 16;
      const step = 512 / squares;
      for (let i = 0; i < squares; i++) {
        for (let j = 0; j < squares; j++) {
          const isDark = (i + j) % 2 === 1;
          ctx.fillStyle = isDark ? '#1a1c22' : '#e2e6ed';
          ctx.fillRect(i * step, j * step, step, step);

          // Grid coordinates indicator: accent corner dot for orientation
          if (i === 0 && j === 0) {
            ctx.fillStyle = '#ef4444'; // Red origin marker (0,0)
            ctx.fillRect(i * step, j * step, step * 0.35, step * 0.35);
          } else if ((i + j) % 4 === 0) {
            ctx.fillStyle = isDark ? '#3b82f6' : '#60a5fa'; // Blue coordinate accent
            ctx.fillRect(i * step + step * 0.35, j * step + step * 0.35, step * 0.3, step * 0.3);
          }

          // Subtle inner tile borders
          ctx.strokeStyle = isDark ? '#2b2f38' : '#cbd2de';
          ctx.lineWidth = 1;
          ctx.strokeRect(i * step, j * step, step, step);
        }
      }
    }
    sharedUVCheckerTexture = new THREE.CanvasTexture(canvas);
    sharedUVCheckerTexture.wrapS = THREE.RepeatWrapping;
    sharedUVCheckerTexture.wrapT = THREE.RepeatWrapping;
    sharedUVCheckerTexture.repeat.set(4, 4);
    sharedUVCheckerTexture.needsUpdate = true;
  }
  return sharedUVCheckerTexture!;
}

const disposeObject3D = (obj: THREE.Object3D) => {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const orig = child.userData?.__originalMaterial;
      if (orig) {
        if (Array.isArray(orig)) orig.forEach((m) => m?.dispose?.());
        else orig?.dispose?.();
      }
      const helperMats = [
        child.userData?.__clayMaterial,
        child.userData?.__normalMaterial,
        child.userData?.__goldMaterial,
        child.userData?.__chromeMaterial,
        child.userData?.__wireMaterial,
        child.userData?.__uvCheckerMaterial,
      ];
      helperMats.forEach((m) => m?.dispose?.());
      if (child.material && child.material !== orig && !helperMats.includes(child.material)) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m?.dispose?.());
        } else {
          child.material?.dispose?.();
        }
      }
    }
  });
};

export const MeshViewer: React.FC<MeshViewerProps> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    currentAsset,
    activeTool,
    isComparing,
    setIsComparing,
    shadingMode,
    showWireframe,
    showGrid,
    isTurntable,
    viewportResetTrigger,
    isExecuting,
    executionProgress,
    executionStep,
    environmentSettings,
    hoveredPartId,
    setHoveredPartId,
    updateAssetProperties,
  } = useWorkspace();

  const emptyStateCopy = (() => {
    switch (activeTool) {
      case 'texture':
      case 'pbr':
        return { title: 'Ready to Texture a Model?', description: 'Load a model or image to prepare its materials.' };
      case 'remesh':
        return { title: 'Ready to Optimize Topology?', description: 'Load a mesh to refine its topology and polygon density.' };
      case 'uv':
        return { title: 'Ready to Unwrap UVs?', description: 'Load a mesh to inspect UVs or create an atlas.' };
      case 'segment':
        return { title: 'Ready to Segment a Model?', description: 'Load a mesh to inspect and separate its parts.' };
      case 'rigging':
        return { title: 'Ready to Rig a Model?', description: 'Load a character mesh to prepare its skeleton.' };
      case 'animation':
        return { title: 'Ready to Animate a Model?', description: 'Load a rigged mesh to preview or generate motion.' };
      default:
        return { title: 'Ready For A New 3D Model?', description: 'Generate a model from an image or prompt, or load an existing mesh.' };
    }
  })();

  const loadedModelUrl = useViewerStore((state) => state.loadedModelUrl);

  const [hasModel, setHasModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isComparisonLoading, setIsComparisonLoading] = useState(false);
  const comparisonOpenRef = useRef(false);
  const comparisonPositionRef = useRef(50);
  const comparisonBeforeGroupRef = useRef<THREE.Group | null>(null);
  const comparisonDividerRef = useRef<HTMLDivElement | null>(null);
  const comparisonHandleRef = useRef<HTMLDivElement | null>(null);
  const shadingModeRef = useRef(shadingMode);
  const showWireframeRef = useRef(showWireframe);
  shadingModeRef.current = shadingMode;
  showWireframeRef.current = showWireframe;

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

    // Lights - Natural Studio Lighting (balanced old + new for crisp details, no dark left side)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    ambientLightRef.current = ambientLight;
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    keyLightRef.current = keyLight;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd4d4d4, 0.7);
    fillLight.position.set(-4, 2, -2);
    fillLight.castShadow = false;
    fillLightRef.current = fillLight;
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfff1d4, 1.2);
    rimLight.position.set(0, 4, -4);
    rimLight.castShadow = false;
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

    const comparisonBeforeGroup = new THREE.Group();
    comparisonBeforeGroup.name = 'comparison-before';
    comparisonBeforeGroup.visible = false;
    comparisonBeforeGroupRef.current = comparisonBeforeGroup;
    scene.add(comparisonBeforeGroup);

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
        if (comparisonBeforeGroupRef.current) {
          comparisonBeforeGroupRef.current.rotation.y = modelGroupRef.current.rotation.y;
        }
      }

      const beforeGroup = comparisonBeforeGroupRef.current;
      const afterGroup = modelGroupRef.current;
      if (comparisonOpenRef.current && beforeGroup?.children.length && afterGroup?.children.length) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        const split = Math.max(1, Math.min(width - 1, Math.round(width * comparisonPositionRef.current / 100)));
        renderer.setScissorTest(true);
        beforeGroup.visible = true;
        afterGroup.visible = false;
        renderer.setScissor(0, 0, split, height);
        renderer.render(scene, camera);
        beforeGroup.visible = false;
        afterGroup.visible = true;
        renderer.setScissor(split, 0, width - split, height);
        renderer.render(scene, camera);
        renderer.setScissorTest(false);
      } else {
        if (beforeGroup) beforeGroup.visible = false;
        if (afterGroup) afterGroup.visible = true;
        renderer.setScissorTest(false);
        renderer.render(scene, camera);
      }
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
      comparisonBeforeGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!currentAsset || currentAsset.category !== 'generation' || currentAsset.fileSize) return;

    const jobId = currentAsset.id.startsWith('local_')
      ? currentAsset.id.slice('local_'.length)
      : currentAsset.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return;

    let cancelled = false;
    void getApiClient().getJobResultInfo(jobId).then((result) => {
      const fileSizeMb = Number(result.file_info?.file_size_mb);
      if (!cancelled && Number.isFinite(fileSizeMb) && fileSizeMb > 0) {
        updateAssetProperties(currentAsset.id, { fileSize: `${fileSizeMb.toFixed(1)} MB` });
      }
    }).catch((error) => {
      if (!cancelled) console.warn('[MeshViewer] Could not read generated mesh file size:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [currentAsset?.id, currentAsset?.category, currentAsset?.fileSize, updateAssetProperties]);

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
        case 'back':
          cam.up.set(0, 1, 0);
          cam.position.set(target.x, target.y, target.z - dist);
          break;
        case 'top':
          cam.up.set(0, 0, -1);
          cam.position.set(target.x, target.y + dist, target.z + 0.0001);
          break;
        case 'bottom':
          cam.up.set(0, 0, 1);
          cam.position.set(target.x, target.y - dist, target.z - 0.0001);
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

  // 4a. Camera Button — capture mesh only (hides grid/axes helpers)
  const captureSnapshot = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) {
      toast.error('3D Viewport is not ready for snapshot');
      return;
    }

    requestAnimationFrame(() => {
      try {
        const currentRenderer = rendererRef.current;
        const currentScene = sceneRef.current;
        const currentCamera = cameraRef.current;
        if (!currentRenderer || !currentScene || !currentCamera) return;

        const dom = currentRenderer.domElement;
        const origWidth = dom.width;
        const origHeight = dom.height;
        const origPixelRatio = currentRenderer.getPixelRatio();
        currentRenderer.setSize(1920, 1080, false);
        currentRenderer.setPixelRatio(1);

        const helpersToHide: THREE.Object3D[] = [];
        currentScene.traverse((child) => {
          if (
            (child as any).isGridHelper ||
            (child as any).isAxesHelper ||
            (child as any).isHelper
          ) {
            child.visible = false;
            helpersToHide.push(child);
          }
        });

        currentRenderer.render(currentScene, currentCamera);
        helpersToHide.forEach((h) => (h.visible = true));

        currentRenderer.domElement.toBlob(
          (blob) => {
            currentRenderer.setSize(origWidth, origHeight, false);
            currentRenderer.setPixelRatio(origPixelRatio);

            if (!blob) {
              toast.error('Failed to create snapshot image');
              return;
            }
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;

            const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
            const parts = pathname.replace('/workspace/', '').split('/');
            const routeName = parts.length > 1 && parts[parts.length - 1]
              ? parts[parts.length - 1]
              : 'mesh';
            a.download = `${routeName}-mesh.png`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
            toast.success(`Snapshot saved as ${routeName}-mesh.png`);
          },
          'image/png',
          1.0
        );
      } catch (err: any) {
        console.error('Failed to capture snapshot:', err);
        toast.error('Failed to capture snapshot');
      }
    });
  }, [rendererRef, sceneRef, cameraRef, toast]);

  // 4b. Listen for camera button click from tool rail — capture mesh only
  useEffect(() => {
    const handleSnapshotEvent = () => {
      captureSnapshot();
    };

    window.addEventListener('takeViewportSnapshot', handleSnapshotEvent as EventListener);
    return () => window.removeEventListener('takeViewportSnapshot', handleSnapshotEvent as EventListener);
  }, [captureSnapshot]);

  // 4c. Header Snapshot Button — capture entire workspace as-is (no hiding helpers)
  const captureWorkspace = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) {
      toast.error('3D Viewport is not ready for snapshot');
      return;
    }

    requestAnimationFrame(() => {
      try {
        const currentRenderer = rendererRef.current;
        const currentScene = sceneRef.current;
        const currentCamera = cameraRef.current;
        if (!currentRenderer || !currentScene || !currentCamera) return;

        const dom = currentRenderer.domElement;
        const origWidth = dom.width;
        const origHeight = dom.height;
        const origPixelRatio = currentRenderer.getPixelRatio();
        currentRenderer.setSize(1920, 1080, false);
        currentRenderer.setPixelRatio(1);

        currentRenderer.render(currentScene, currentCamera);

        currentRenderer.domElement.toBlob(
          (blob) => {
            currentRenderer.setSize(origWidth, origHeight, false);
            currentRenderer.setPixelRatio(origPixelRatio);

            if (!blob) {
              toast.error('Failed to create snapshot image');
              return;
            }
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;

            const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
            const parts = pathname.replace('/workspace/', '').split('/');
            const routeName = parts.length > 1 && parts[parts.length - 1]
              ? parts[parts.length - 1]
              : 'workspace';
            a.download = `${routeName}-workspace.png`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
            toast.success(`Snapshot saved as ${routeName}-workspace.png`);
          },
          'image/png',
          1.0
        );
      } catch (err: any) {
        console.error('Failed to capture snapshot:', err);
        toast.error('Failed to capture snapshot');
      }
    });
  }, [rendererRef, sceneRef, cameraRef, toast]);

  // 5. Preload all shading materials at model load time for butter-smooth switching
  const preloadShadingMaterials = useCallback((meshes: THREE.Mesh[]) => {
    meshes.forEach((mesh) => {
      if (!mesh.userData.__originalMaterial && mesh.material) {
        mesh.userData.__originalMaterial = mesh.material;
      }
      const orig = mesh.userData.__originalMaterial;
      if (!orig) return;

      // Pre-create ALL shading variants so switching is instant (no disappear/reappear)
      mesh.userData.__normalMaterial = new THREE.MeshNormalMaterial({ wireframe: false });
      mesh.userData.__clayMaterial = new THREE.MeshStandardMaterial({
        color: 0xb0b3b8,
        roughness: 0.85,
        metalness: 0.05,
      });
      mesh.userData.__goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.25,
        metalness: 0.85,
      });
      mesh.userData.__chromeMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.05,
        metalness: 0.98,
      });
      mesh.userData.__uvCheckerMaterial = new THREE.MeshStandardMaterial({
        map: getUVCheckerTexture(),
        roughness: 0.4,
        metalness: 0.05,
      });
      mesh.userData.__wireMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        wireframe: true,
      });
    });
  }, [getUVCheckerTexture]);

  // Call preload right after model is loaded and added to group
  useEffect(() => {
    if (!modelGroupRef.current) return;
    const meshes: THREE.Mesh[] = [];
    modelGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    if (meshes.length > 0) preloadShadingMaterials(meshes);
  }, [modelGroupRef.current, preloadShadingMaterials]);

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

  // Helper to cleanly apply shading mode to a mesh without corrupting original materials
  const applyShadingToMesh = useCallback((mesh: THREE.Mesh, mode: ShadingMode, wireframe: boolean) => {
    if (!mesh.userData.__originalMaterial && mesh.material) {
      mesh.userData.__originalMaterial = mesh.material;
    }
    const orig = mesh.userData.__originalMaterial;
    if (!orig) return;

    if (mode === 'normals' || mode === 'matcap-normal') {
      if (!mesh.userData.__normalMaterial) {
        mesh.userData.__normalMaterial = new THREE.MeshNormalMaterial({
          wireframe: Boolean(wireframe),
        });
      }
      mesh.userData.__normalMaterial.wireframe = Boolean(wireframe);
      mesh.material = mesh.userData.__normalMaterial;
    } else if (mode === 'clay') {
      if (!mesh.userData.__clayMaterial) {
        mesh.userData.__clayMaterial = new THREE.MeshStandardMaterial({
          color: 0xb0b3b8,
          roughness: 0.85,
          metalness: 0.05,
          wireframe: Boolean(wireframe),
        });
      }
      mesh.userData.__clayMaterial.wireframe = Boolean(wireframe);
      mesh.material = mesh.userData.__clayMaterial;
    } else if (mode === 'matcap-gold') {
      if (!mesh.userData.__goldMaterial) {
        mesh.userData.__goldMaterial = new THREE.MeshStandardMaterial({
          color: 0xffd700,
          roughness: 0.25,
          metalness: 0.85,
          wireframe: Boolean(wireframe),
        });
      }
      mesh.userData.__goldMaterial.wireframe = Boolean(wireframe);
      mesh.material = mesh.userData.__goldMaterial;
    } else if (mode === 'matcap-chrome') {
      if (!mesh.userData.__chromeMaterial) {
        mesh.userData.__chromeMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.05,
          metalness: 0.98,
          wireframe: Boolean(wireframe),
        });
      }
      mesh.userData.__chromeMaterial.wireframe = Boolean(wireframe);
      mesh.material = mesh.userData.__chromeMaterial;
    } else if (mode === 'uv-checker') {
      if (!mesh.userData.__uvCheckerMaterial) {
        mesh.userData.__uvCheckerMaterial = new THREE.MeshStandardMaterial({
          map: getUVCheckerTexture(),
          roughness: 0.4,
          metalness: 0.05,
          wireframe: Boolean(wireframe),
        });
      }
      mesh.userData.__uvCheckerMaterial.wireframe = Boolean(wireframe);
      mesh.material = mesh.userData.__uvCheckerMaterial;
    } else if (mode === 'wireframe') {
      if (!mesh.userData.__wireMaterial) {
        mesh.userData.__wireMaterial = new THREE.MeshBasicMaterial({
          color: 0x00ffcc,
          wireframe: true,
        });
      }
      mesh.material = mesh.userData.__wireMaterial;
    } else {
      // 'textured' or default
      mesh.material = orig;
      const mats = Array.isArray(orig) ? orig : [orig];
      mats.forEach((m) => {
        if ('wireframe' in m) {
          m.wireframe = Boolean(wireframe);
          m.needsUpdate = true;
        }
      });
    }
  }, []);

  const effectiveShadingMode: ShadingMode =
    shadingMode === 'uv-checker' || (activeTool === 'uv' && (shadingMode === 'textured' || !shadingMode))
      ? 'uv-checker'
      : shadingMode;

  useEffect(() => {
    [modelGroupRef.current, comparisonBeforeGroupRef.current].forEach((group) => {
      group?.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          applyShadingToMesh(child, effectiveShadingMode, Boolean(showWireframe));
        }
      });
    });
  }, [showWireframe, effectiveShadingMode, applyShadingToMesh]);

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
  const comparisonBeforeUrl = currentAsset?.artifacts?.source || null;
  const comparisonAfterUrl = currentAsset?.source?.viewUrl || currentAsset?.source?.localUrl || currentAsset?.artifacts?.gameReady || null;
  const canCompareModels = Boolean(comparisonBeforeUrl && comparisonAfterUrl && comparisonBeforeUrl !== comparisonAfterUrl);

  useEffect(() => {
    comparisonOpenRef.current = isComparing;
  }, [isComparing]);

  useEffect(() => {
    if (!canCompareModels && isComparing) setIsComparing(false);
  }, [canCompareModels, isComparing, setIsComparing]);

  // ponytail: load source only while Compare is open; caching waits for measured repeat-use cost.
  useEffect(() => {
    const beforeGroup = comparisonBeforeGroupRef.current;
    if (!beforeGroup) return;

    if (!isComparing || !canCompareModels || !comparisonBeforeUrl) {
      beforeGroup.visible = false;
      while (beforeGroup.children.length) {
        const child = beforeGroup.children[0];
        beforeGroup.remove(child);
        disposeObject3D(child);
      }
      setIsComparisonLoading(false);
      return;
    }

    let isCancelled = false;
    setIsComparisonLoading(true);
    beforeGroup.visible = false;
    while (beforeGroup.children.length) {
      const child = beforeGroup.children[0];
      beforeGroup.remove(child);
      disposeObject3D(child);
    }

    sharedGLTFLoader.load(
      comparisonBeforeUrl,
      (gltf) => {
        const original = gltf.scene;
        if (isCancelled || !comparisonBeforeGroupRef.current) {
          disposeObject3D(original);
          return;
        }
        const bounds = new THREE.Box3().setFromObject(original);
        if (bounds.isEmpty()) {
          disposeObject3D(original);
          setIsComparisonLoading(false);
          setIsComparing(false);
          return;
        }
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z);
        const scale = maxDimension > 0 ? 2 / maxDimension : 1;
        original.position.sub(center.clone().multiplyScalar(scale));
        original.position.y += (size.y * scale) / 2;
        original.scale.setScalar(scale);
        original.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            applyShadingToMesh(child, shadingModeRef.current, Boolean(showWireframeRef.current));
          }
        });
        comparisonBeforeGroupRef.current.add(original);
        comparisonBeforeGroupRef.current.visible = true;
        setIsComparisonLoading(false);
      },
      undefined,
      (error) => {
        if (!isCancelled) {
          setIsComparisonLoading(false);
          setIsComparing(false);
          toast.error('Could not load the original mesh for comparison');
          console.warn('Original mesh comparison load failed:', error);
        }
      }
    );

    return () => {
      isCancelled = true;
    };
  }, [isComparing, canCompareModels, comparisonBeforeUrl, setIsComparing, applyShadingToMesh]);

  useEffect(() => {
    if (!modelUrl || !modelGroupRef.current) {
      setHasModel(false);
      useViewerStore.getState().setModelStats(null);
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
    useViewerStore.getState().setActiveModelObject(null);
    useViewerStore.getState().setModelStats(null);
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    const detectedExt = modelUrl.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
    const assetFormat = currentAsset?.format?.toLowerCase();
    const knownFormats = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];
    const format = (assetFormat && knownFormats.includes(assetFormat))
      ? assetFormat
      : (detectedExt && knownFormats.includes(detectedExt))
        ? detectedExt
        : 'glb';

    const handleObjectLoaded = (object: THREE.Object3D, animations?: THREE.AnimationClip[]) => {
      if (isCancelled || !modelGroupRef.current) {
        disposeObject3D(object);
        return;
      }

      // Capture native geometry before viewport normalization changes its dimensions.
      useViewerStore.getState().setModelStats(collectMeshStats(object));

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

      // Enable shadows, cache original materials, and apply active shading mode cleanly
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          applyShadingToMesh(child, shadingMode, Boolean(showWireframe));
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
      useViewerStore.getState().setActiveModelObject(object);
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
  }, [modelUrl, fitCameraToModel, shadingMode, showWireframe, applyShadingToMesh]);

  // 6. Highlight hovered part in main viewer (top-level hook — never nested inside another hook)
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group || !hoveredPartId) {
      group?.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.__hoverOriginalMaterial) {
          child.material = child.userData.__hoverOriginalMaterial;
          delete child.userData.__hoverOriginalMaterial;
        }
      });
      return;
    }

    // Parse part index from id like "p1" -> 0, "p2" -> 1, etc.
    const match = hoveredPartId.match(/^p(\d+)$/);
    if (!match) return;
    const meshIndex = parseInt(match[1], 1) - 1;

    let meshCount = 0;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (meshCount === meshIndex) {
          if (!child.userData.__hoverOriginalMaterial) {
            child.userData.__hoverOriginalMaterial = child.material;
          }
          child.material = new THREE.MeshStandardMaterial({
            color: 0xf9cf00,
            emissive: 0xf9cf00,
            emissiveIntensity: 0.5,
            roughness: 0.2,
            metalness: 0.1,
          });
        }
        meshCount++;
      }
    });

    return () => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.__hoverOriginalMaterial) {
          child.material = child.userData.__hoverOriginalMaterial;
          delete child.userData.__hoverOriginalMaterial;
        }
      });
    };
  }, [hoveredPartId]);

  // 7. Broadcast live camera rotation so an external XYZ gizmo can reflect the active axis
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;

    const update = () => {
      if (!camera || !controls) return;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      // Find which cardinal axis the camera is most aligned with
      const absX = Math.abs(dir.dot(new THREE.Vector3(1, 0, 0)));
      const absY = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0)));
      const absZ = Math.abs(dir.dot(new THREE.Vector3(0, 0, 1)));
      const axis =
        absX >= absY && absX >= absZ
          ? dir.x > 0
            ? 'right'
            : 'left'
          : absY >= absX && absY >= absZ
          ? dir.y > 0
            ? 'top'
            : 'bottom'
          : dir.z > 0
          ? 'front'
          : 'back';
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('setCameraRotation', { detail: axis }));
      }
    };

    // Initial broadcast so the gizmo reflects the starting view
    update();
    controls.addEventListener('change', update);

    return () => {
      controls.removeEventListener('change', update);
    };
  }, []);

  const updateComparisonPosition = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const next = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    comparisonPositionRef.current = next;
    if (comparisonDividerRef.current) comparisonDividerRef.current.style.left = `${next}%`;
    comparisonHandleRef.current?.setAttribute('aria-valuenow', String(Math.round(next)));
    comparisonHandleRef.current?.setAttribute('aria-valuetext', `${Math.round(next)} percent before`);
  };

  const moveComparisonBy = (delta: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = Math.max(0, Math.min(100, comparisonPositionRef.current + delta));
    updateComparisonPosition(rect.left + (rect.width * next) / 100);
  };

  // Single source of truth for the viewport UI shell: one mutually exclusive
  // status replaces the previously overlapping JSX conditions (empty vs
  // executing vs comparing vs error toast).
  type ViewportUIStatus = 'idle' | 'empty' | 'executing' | 'comparing' | 'error';
  const viewportStatus: ViewportUIStatus = loadError
    ? 'error'
    : isExecuting
      ? 'executing'
      : !hasModel
        ? 'empty'
        : isComparing && canCompareModels
          ? 'comparing'
          : 'idle';

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
      {/* Snapshot Button — top-left of viewport */}
      <div className="absolute top-3 left-3 z-50 flex gap-1 pointer-events-auto">
        <button
          onClick={() => {
            captureWorkspace();
          }}
          className="px-3 py-1.5 rounded-lg bg-[#F9CF00] text-[#080808] font-bold shadow-[0_0_15px_rgba(249,207,0,0.4)] hover:scale-105 hover:bg-[#FFE04D] transition-all duration-200 cursor-pointer"
          aria-label="Take snapshot"
        >
          📷 Snapshot
        </button>
      </div>
      {/* Sleek Empty State Watermark matching Reference */}
      {viewportStatus === 'empty' && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
          <div className="flex flex-col items-center text-center px-4 max-w-sm select-none">
            {/* ForMesh3D Electric Gold Brand Mark */}
            <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--surface-1))] border border-[#F9CF00]/40 flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_24px_rgba(249,207,0,0.25)] mb-4 ring-1 ring-white/10">
              <HugeiconsIcon icon={SparklesIcon} size={28} className="text-[#F9CF00] drop-shadow-[0_0_10px_rgba(249,207,0,0.6)]" />
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] mb-1.5">
              {emptyStateCopy.title}
            </h2>
            <p className="text-xs text-zinc-300 font-medium drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
              {emptyStateCopy.description}
            </p>
          </div>
        </div>
      )}

      {/* Execution Progress Overlay */}
      {viewportStatus === 'executing' && (
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

      {viewportStatus === 'comparing' && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/65 border border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white">
            Before
          </div>
          <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/65 border border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white">
            After
          </div>
          <div ref={comparisonDividerRef} className="absolute top-0 bottom-0" style={{ left: '50%' }}>
            <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-[#F9CF00] shadow-[0_0_10px_rgba(249,207,0,0.7)]" />
            <div
              ref={comparisonHandleRef}
              role="slider"
              tabIndex={0}
              aria-label="Before and after comparison split"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={50}
              aria-valuetext="50 percent before"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                updateComparisonPosition(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) updateComparisonPosition(event.clientX);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveComparisonBy(-1);
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveComparisonBy(1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  updateComparisonPosition(containerRef.current?.getBoundingClientRect().left ?? 0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  updateComparisonPosition(containerRef.current?.getBoundingClientRect().right ?? 0);
                }
              }}
              className="pointer-events-auto absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-10 rounded-full bg-[#171821] border border-[#F9CF00] shadow-lg flex items-center justify-center cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-[#F9CF00]"
            >
              <span className="flex items-center gap-0.5 text-[#F9CF00]">
                <span className="w-0.5 h-3 rounded-full bg-current" />
                <span className="w-0.5 h-3 rounded-full bg-current" />
              </span>
            </div>
          </div>
          {isComparisonLoading && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/70 border border-white/10 text-[10px] text-zinc-200">
              Loading original mesh…
            </div>
          )}
        </div>
      )}

      {/* Error Toast */}
      {viewportStatus === 'error' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/30 text-red-200 text-xs shadow-xl backdrop-blur-md">
          {loadError}
        </div>
      )}
    </div>
  );
};
