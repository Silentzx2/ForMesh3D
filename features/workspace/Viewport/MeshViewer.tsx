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
import { loadGLBWithProgress } from '../lib/glbCache';
import { dispatchCameraOrientation, VIEWPORT_EVENTS } from './viewportEvents';

import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshCw, SparklesIcon, AlertCircle } from '@hugeicons/core-free-icons';

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

/**
 * Extract outer polygon edges from an OBJ text when it contains quads/n-gons,
 * so wireframe overlay shows true quad topology instead of triangulated diagonals.
 */
function extractObjQuadEdgesGeometry(objText: string): THREE.BufferGeometry | null {
  const verts: number[] = [];
  const edgePositions: number[] = [];
  let hasQuadOrNgon = false;

  const lines = objText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line[0] === '#') continue;
    if (line[0] === 'v' && (line[1] === ' ' || line[1] === '\t')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      }
    } else if (line[0] === 'f' && (line[1] === ' ' || line[1] === '\t')) {
      const parts = line.split(/\s+/).slice(1);
      if (parts.length < 3) continue;
      if (parts.length >= 4) hasQuadOrNgon = true;
      const vCount = verts.length / 3;
      const indices: number[] = [];
      for (const p of parts) {
        const raw = parseInt(p.split('/')[0], 10);
        if (Number.isNaN(raw)) continue;
        const idx = raw > 0 ? raw - 1 : vCount + raw;
        if (idx >= 0 && idx < vCount) indices.push(idx);
      }
      for (let j = 0; j < indices.length; j++) {
        const a = indices[j] * 3;
        const b = indices[(j + 1) % indices.length] * 3;
        edgePositions.push(
          verts[a], verts[a + 1], verts[a + 2],
          verts[b], verts[b + 1], verts[b + 2],
        );
      }
    }
  }

  if (!hasQuadOrNgon || edgePositions.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  return geom;
}

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

const DEFAULT_VIEWPORT_BACKGROUND =
  'radial-gradient(ellipse 70% 68% at 50% 48%, #484a4f 0%, #383a3e 28%, #27282b 55%, #1a1b1e 80%, #131416 100%)';

export const BACKGROUND_OPTIONS = [
  {
    id: 'studio-vignette',
    label: 'Studio Vignette',
    value: DEFAULT_VIEWPORT_BACKGROUND,
    preview: DEFAULT_VIEWPORT_BACKGROUND,
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
      backgroundColor: DEFAULT_VIEWPORT_BACKGROUND,
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

const disposeMaterialTextures = (m: any) => {
  if (!m) return;
  const textureKeys = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap',
    'aoMap', 'emissiveMap', 'lightMap', 'alphaMap',
    'bumpMap', 'displacementMap'
  ];
  for (const k of textureKeys) {
    if (m[k] && typeof m[k].dispose === 'function') {
      m[k].dispose();
    }
  }
};

const disposeObject3D = (obj: THREE.Object3D) => {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const orig = child.userData?.__originalMaterial;
      if (orig) {
        if (Array.isArray(orig)) {
          orig.forEach((m) => {
            disposeMaterialTextures(m);
            m?.dispose?.();
          });
        } else {
          disposeMaterialTextures(orig);
          orig?.dispose?.();
        }
      }
      const helperMats = [
        child.userData?.__clayMaterial,
        child.userData?.__normalMaterial,
        child.userData?.__goldMaterial,
        child.userData?.__chromeMaterial,
        child.userData?.__wireMaterial,
        child.userData?.__uvCheckerMaterial,
      ];
      helperMats.forEach((m) => {
        disposeMaterialTextures(m);
        m?.dispose?.();
      });
      if (child.material && child.material !== orig && !helperMats.includes(child.material)) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            disposeMaterialTextures(m);
            m?.dispose?.();
          });
        } else {
          disposeMaterialTextures(child.material);
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
    shadingMode,
    showWireframe,
    wireframeMode,
    showGrid,
    isTurntable,
    viewportResetTrigger,
    isExecuting,
    executionStatus,
    executionProgress,
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
  const selectionRequestId = useViewerStore((state) => state.selectionRequestId);

  const [loadState, setLoadState] = useState<
    | { status: 'empty'; hasModel: false; error: null }
    | { status: 'loading'; hasModel: boolean; error: null }
    | { status: 'loaded'; hasModel: true; error: null }
    | { status: 'error'; hasModel: false; error: string }
  >({ status: 'empty', hasModel: false, error: null });
  const modelLoadStatus = loadState.status;
  const hasModel = loadState.hasModel;
  const loadError = loadState.error;
  const [retryKey, setRetryKey] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [webglInitKey, setWebglInitKey] = useState(0);

  const handleRetryLoad = useCallback(() => {
    setLoadState((prev) => ({ status: 'empty', hasModel: false, error: null }));
    setRetryKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReducedMotion(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const shadingModeRef = useRef(shadingMode);
  const showWireframeRef = useRef(showWireframe);
  const wireframeModeRef = useRef(wireframeMode);
  const reducedMotionRef = useRef(reducedMotion);
  const scanRevealRef = useRef<{ active: boolean; startMs: number; minY: number; maxY: number }>({
    active: false,
    startMs: 0,
    minY: 0,
    maxY: 2.0,
  });
  useEffect(() => {
    shadingModeRef.current = shadingMode;
    showWireframeRef.current = showWireframe;
    wireframeModeRef.current = wireframeMode;
    reducedMotionRef.current = reducedMotion;
    invalidateRenderRef.current();
  }, [shadingMode, showWireframe, wireframeMode, reducedMotion]);

  // Three.js instances stored in refs to avoid React re-render overhead
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const invalidateRenderRef = useRef<() => void>(() => {});
  const isTurntableRef = useRef(isTurntable);
  isTurntableRef.current = isTurntable;
  const pendingViewportRestoreRef = useRef<{ cameraPosition: [number, number, number]; target: [number, number, number] } | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const boundExternalClipRef = useRef<THREE.AnimationClip | null>(null);

  const disposeMixer = useCallback((resetStore = true) => {
    const mixer = mixerRef.current;
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
      mixerRef.current = null;
    }
    boundExternalClipRef.current = null;
    if (resetStore) {
      useAnimationStore.getState().clearClipOnAssetSwitch();
      useAnimationStore.getState().setLoadedSkeletonBoneNames(null);
    }
  }, []);
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

    // Renderer with preserveDrawingBuffer enabled for high-res snapshot capture.
    // Pre-check WebGL availability with an offscreen canvas BEFORE constructing
    // WebGLRenderer. getContext() returns null silently when WebGL is disabled,
    // blacklisted, or sandboxed — no throw, no Three.js console spam. Only call
    // the constructor when a context is actually available; keep try/catch as a
    // safety net for any other constructor failure.
    const webglProbe = document.createElement('canvas');
    const webglContext =
      webglProbe.getContext('webgl') || webglProbe.getContext('webgl2');
    if (!webglContext) {
      const msg = 'WebGL context is not available in this browser/environment.';
      setWebglError(msg);
      rendererRef.current = null;
      console.warn('[MeshViewer] WebGL not available:', msg);
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown WebGL error';
      setWebglError(msg);
      rendererRef.current = null;
      console.error('[MeshViewer] WebGL context creation failed:', msg);
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    // WebGL context loss / restore handling
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebglError('WebGL context was lost');
    };
    const handleContextRestored = () => {
      setWebglError(null);
      invalidateRenderRef.current();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

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
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
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

    // Real-mesh bottom-to-top scan reveal plane & glowing gold ring
    const revealPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
    const scanRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.012, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.85 })
    );
    scanRing.rotation.x = Math.PI / 2;
    scanRing.visible = false;
    scene.add(scanRing);

    // Render on demand. OrbitControls emits "change" while damping settles;
    // imported model animations and the optional turntable keep their own RAF alive.
    let animId: number | null = null;
    let isDisposed = false;
    const renderFrame = () => {
      animId = null;
      if (isDisposed) return;

      controls.update();

      let keepAnimating = false;
      const animState = useAnimationStore.getState();
      if (animState.isPlaying && animState.duration > 0) {
        animState.tickPlayback(performance.now());
        keepAnimating = true;
      }
      if (mixerRef.current) {
        mixerRef.current.setTime(useAnimationStore.getState().currentTime);
      }

      if (modelGroupRef.current && isTurntableRef.current) {
        modelGroupRef.current.rotation.y += 0.008;
        keepAnimating = true;
      }

      // ~0.95s bottom-to-top scan reveal on newly loaded mesh
      const reveal = scanRevealRef.current;
      if (reveal.active && modelGroupRef.current && !reducedMotionRef.current) {
        const t = Math.min(1, (performance.now() - reveal.startMs) / 950);
        const y = reveal.minY + (reveal.maxY - reveal.minY) * t;
        renderer.localClippingEnabled = true;
        revealPlane.constant = y;
        scanRing.visible = t < 1;
        scanRing.position.y = y;
        modelGroupRef.current.traverse((c) => {
          if (c instanceof THREE.Mesh && c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach((m) => {
              if (!m.clippingPlanes || m.clippingPlanes[0] !== revealPlane) {
                m.clippingPlanes = [revealPlane];
                m.needsUpdate = true;
              }
            });
          }
        });
        if (t >= 1) {
          reveal.active = false;
          scanRing.visible = false;
          renderer.localClippingEnabled = false;
          modelGroupRef.current.traverse((c) => {
            if (c instanceof THREE.Mesh && c.material) {
              const mats = Array.isArray(c.material) ? c.material : [c.material];
              mats.forEach((m) => {
                if (m.clippingPlanes) {
                  m.clippingPlanes = null;
                  m.needsUpdate = true;
                }
              });
            }
          });
        } else {
          keepAnimating = true;
        }
      } else {
        scanRing.visible = false;
      }

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      if (keepAnimating) scheduleRender();
    };
    const scheduleRender = () => {
      if (isDisposed || animId !== null) return;
      animId = requestAnimationFrame(renderFrame);
    };
    invalidateRenderRef.current = scheduleRender;
    controls.addEventListener('change', scheduleRender);
    const handleViewportInvalidation = () => scheduleRender();
    window.addEventListener(VIEWPORT_EVENTS.INVALIDATE_RENDER, handleViewportInvalidation);
    scheduleRender();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
          invalidateRenderRef.current();
        }
      }
    });
    resizeObserver.observe(container);

    // Cleanup on unmount
    return () => {
      isDisposed = true;
      if (animId !== null) cancelAnimationFrame(animId);
      invalidateRenderRef.current = () => {};
      controls.removeEventListener('change', scheduleRender);
      window.removeEventListener(VIEWPORT_EVENTS.INVALIDATE_RENDER, handleViewportInvalidation);
      resizeObserver.disconnect();
      disposeMixer(true);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      disposeObject3D(scene);
      scanRing.geometry.dispose();
      (scanRing.material as THREE.Material).dispose();
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
    };
  }, [webglInitKey]);

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
      invalidateRenderRef.current();
    };

    window.addEventListener('setCameraPreset', handleCameraPreset as EventListener);
    return () => window.removeEventListener('setCameraPreset', handleCameraPreset as EventListener);
  }, []);

  // 3. Viewport Lighting & Exposure Listeners
  useEffect(() => {
    const handleExposure = (e: CustomEvent<number>) => {
      if (rendererRef.current && typeof e.detail === 'number') {
        rendererRef.current.toneMappingExposure = e.detail;
        invalidateRenderRef.current();
      }
    };

    const handleLighting = (e: CustomEvent<{ tone?: LightTone }>) => {
      const tone = e.detail?.tone;
      if (tone && LIGHT_TONES[tone]) {
        const t = LIGHT_TONES[tone];
        if (keyLightRef.current) keyLightRef.current.color.setHex(t.key);
        if (fillLightRef.current) fillLightRef.current.color.setHex(t.fill);
        if (rimLightRef.current) rimLightRef.current.color.setHex(t.rim);
        invalidateRenderRef.current();
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
            invalidateRenderRef.current();

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
    invalidateRenderRef.current();
  }, [environmentSettings]);

  // 4. Grid, Wireframe & Shading Mode Toggle
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGrid !== false;
      invalidateRenderRef.current();
    }
  }, [showGrid]);

  // Helper to cleanly apply shading mode to a mesh without corrupting original materials
  const applyShadingToMesh = useCallback((mesh: THREE.Mesh, mode: ShadingMode, wireframe: boolean) => {
    if (!mesh.userData.__originalMaterial && mesh.material) {
      mesh.userData.__originalMaterial = mesh.material;
    }
    const orig = mesh.userData.__originalMaterial;
    if (!orig) return;

    const activeWireMode = wireframe ? (wireframeModeRef.current === 'xray' ? 'xray' : 'overlay') : 'off';

    // Manage surface wireframe overlay child (solid mesh stays visible underneath; internal faces hidden)
    let overlayChild = mesh.children.find((c) => c.userData?.__isWireframeOverlay) as THREE.Object3D | undefined;
    if (activeWireMode === 'overlay' && mode !== 'wireframe') {
      if (!overlayChild) {
        const quadEdges = mesh.userData.__quadEdgesGeometry as THREE.BufferGeometry | undefined;
        if (quadEdges) {
          const lineMat = new THREE.LineBasicMaterial({
            color: 0xf9cf00,
            transparent: true,
            opacity: 0.55,
          });
          overlayChild = new THREE.LineSegments(quadEdges, lineMat);
        } else {
          const overlayMat = new THREE.MeshBasicMaterial({
            color: 0xf9cf00,
            wireframe: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            transparent: true,
            opacity: 0.45,
          });
          overlayChild = new THREE.Mesh(mesh.geometry, overlayMat);
        }
        overlayChild.userData.__isWireframeOverlay = true;
        overlayChild.raycast = () => {};
        mesh.add(overlayChild);
      }
      overlayChild.visible = true;
    } else if (overlayChild) {
      overlayChild.visible = false;
    }

    // Full internal X-ray wireframe mode
    if (activeWireMode === 'xray' || mode === 'wireframe') {
      if (!mesh.userData.__wireMaterial) {
        mesh.userData.__wireMaterial = new THREE.MeshBasicMaterial({
          color: 0x00ffcc,
          wireframe: true,
        });
      }
      mesh.material = mesh.userData.__wireMaterial;
      return;
    }

    if (mode === 'normals' || mode === 'matcap-normal') {
      if (!mesh.userData.__normalMaterial) {
        mesh.userData.__normalMaterial = new THREE.MeshNormalMaterial({ wireframe: false });
      }
      mesh.material = mesh.userData.__normalMaterial;
    } else if (mode === 'clay') {
      if (!mesh.userData.__clayMaterial) {
        mesh.userData.__clayMaterial = new THREE.MeshStandardMaterial({
          color: 0xb0b3b8,
          roughness: 0.85,
          metalness: 0.05,
        });
      }
      mesh.material = mesh.userData.__clayMaterial;
    } else if (mode === 'matcap-gold') {
      if (!mesh.userData.__goldMaterial) {
        mesh.userData.__goldMaterial = new THREE.MeshStandardMaterial({
          color: 0xffd700,
          roughness: 0.25,
          metalness: 0.85,
        });
      }
      mesh.material = mesh.userData.__goldMaterial;
    } else if (mode === 'matcap-chrome') {
      if (!mesh.userData.__chromeMaterial) {
        mesh.userData.__chromeMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.05,
          metalness: 0.98,
        });
      }
      mesh.material = mesh.userData.__chromeMaterial;
    } else if (mode === 'uv-checker') {
      if (!mesh.userData.__uvCheckerMaterial) {
        mesh.userData.__uvCheckerMaterial = new THREE.MeshStandardMaterial({
          map: getUVCheckerTexture(),
          roughness: 0.4,
          metalness: 0.05,
        });
      }
      mesh.material = mesh.userData.__uvCheckerMaterial;
    } else {
      // 'textured' or default
      mesh.material = orig;
    }
  }, [getUVCheckerTexture]);

  const effectiveShadingMode: ShadingMode = shadingMode || 'textured';

  useEffect(() => {
    modelGroupRef.current?.traverse((child) => {
      if (child instanceof THREE.Mesh && !child.userData?.__isWireframeOverlay) {
        applyShadingToMesh(child, effectiveShadingMode, Boolean(showWireframe));
      }
    });
    if (keyLightRef.current) {
      keyLightRef.current.castShadow = wireframeMode !== 'xray';
    }
    invalidateRenderRef.current();
  }, [showWireframe, wireframeMode, effectiveShadingMode, applyShadingToMesh]);

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
    const pendingViewport = pendingViewportRestoreRef.current;
    if (pendingViewport) {
      cameraRef.current.position.set(...pendingViewport.cameraPosition);
      controlsRef.current.target.set(...pendingViewport.target);
      cameraRef.current.lookAt(controlsRef.current.target);
      controlsRef.current.update();
      pendingViewportRestoreRef.current = null;
    }
    invalidateRenderRef.current();
  }, []);

  useEffect(() => {
    const captureViewport = () => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return;
      useViewerStore.getState().setViewport({
        cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      });
    };
    const restoreViewport = (event: Event) => {
      const viewport = (event as CustomEvent<{
        cameraPosition: [number, number, number];
        target: [number, number, number];
      }>).detail;
      if (!viewport) return;
      pendingViewportRestoreRef.current = viewport;
      if (!modelGroupRef.current?.children.length && cameraRef.current && controlsRef.current) {
        cameraRef.current.position.set(...viewport.cameraPosition);
        controlsRef.current.target.set(...viewport.target);
        cameraRef.current.lookAt(controlsRef.current.target);
        controlsRef.current.update();
        pendingViewportRestoreRef.current = null;
        invalidateRenderRef.current();
      }
    };
    window.addEventListener('capture-viewer-viewport', captureViewport);
    window.addEventListener('restore-viewer-viewport', restoreViewport);
    return () => {
      window.removeEventListener('capture-viewer-viewport', captureViewport);
      window.removeEventListener('restore-viewer-viewport', restoreViewport);
    };
  }, []);

  useEffect(() => {
    if (modelGroupRef.current && modelGroupRef.current.children.length > 0) {
      fitCameraToModel(modelGroupRef.current);
    }
  }, [viewportResetTrigger, fitCameraToModel]);

  // 4. Load 3D Model when URL changes
  const assetFormat = currentAsset?.format?.toLowerCase();
  const assetFileId = currentAsset?.source?.fileId || currentAsset?.fileId;
  const assetFileUrl = assetFileId
    ? assetFileId.startsWith('job-')
      ? `/api/v1/system/jobs/${encodeURIComponent(assetFileId.slice(4))}/download?artifact_format=${assetFormat || 'glb'}`
      : `/api/v1/file-upload/download/${encodeURIComponent(assetFileId)}`
    : null;
  const artifactUrl =
    currentAsset?.artifacts?.gameReadyFormats?.[assetFormat || ''] ||
    currentAsset?.artifacts?.gameReady ||
    currentAsset?.artifacts?.source ||
    currentAsset?.artifacts?.lods?.[0] ||
    currentAsset?.artifacts?.rigged ||
    (assetFormat === 'fbx' ? currentAsset?.artifacts?.riggedFbx : null) ||
    currentAsset?.artifacts?.collision;
  const isMeshAsset = currentAsset && currentAsset.category !== 'texture' &&
    currentAsset.format !== 'IMAGE' && currentAsset.format !== 'FILE';
  const modelUrl =
    currentAsset?.source?.viewUrl ||
    currentAsset?.source?.localUrl ||
    (isMeshAsset ? artifactUrl || assetFileUrl : null) ||
    (currentAsset ? null : loadedModelUrl) ||
    null;

  useEffect(() => {
    invalidateRenderRef.current();
  }, [isTurntable]);

  useEffect(() => {
    const selectionState = useViewerStore.getState();
    const requestId = selectionState.selectionRequestId;
    const tracksSelection = selectionState.assetSelectionState === 'loading';
    if (!modelUrl || !modelGroupRef.current) {
      if (!modelUrl && tracksSelection) selectionState.failAssetLoad(requestId, 'Selected asset has no renderable model URL.');
      scanRevealRef.current.active = false;
      if (rendererRef.current) rendererRef.current.localClippingEnabled = false;
      setLoadState({ status: 'empty', hasModel: false, error: null });
      const group = modelGroupRef.current;
      if (group) {
        while (group.children.length > 0) {
          const child = group.children[0];
          group.remove(child);
          disposeObject3D(child);
        }
      }
      useViewerStore.getState().setActiveModelObject(null);
      useViewerStore.getState().setModelStats(null);
      disposeMixer(true);
      invalidateRenderRef.current();
      return;
    }

    const abortController = new AbortController();
    let isCancelled = false;
    setLoadState((prev) => ({ status: 'loading', hasModel: prev.hasModel, error: null }));

    // Clear previous model from scene
    const group = modelGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject3D(child);
    }
    useViewerStore.getState().setActiveModelObject(null);
    useViewerStore.getState().setModelStats(null);
    disposeMixer(true);
    invalidateRenderRef.current();

    const detectedExt = modelUrl.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
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
      const stats = collectMeshStats(object);
      useViewerStore.getState().setModelStats(stats);
      if (tracksSelection) useViewerStore.getState().completeAssetLoad(requestId, modelUrl, currentAsset?.name ?? null, stats);

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

      const hasAnimations = Boolean(animations && animations.length > 0);
      const boneNames: string[] = [];
      object.traverse((child) => {
        if ((child as THREE.Bone).isBone && child.name) {
          boneNames.push(child.name);
        }
        if (child instanceof THREE.Mesh) {
          const triCount = child.geometry?.index
            ? child.geometry.index.count / 3
            : (child.geometry?.attributes?.position?.count || 0) / 3;
          // Ultra-dense meshes (>800k tris) bypass shadow-map rasterization to preserve 60 FPS
          child.castShadow = triCount < 800_000;
          child.receiveShadow = true;
          child.frustumCulled = true;
          if (!hasAnimations) {
            child.matrixAutoUpdate = false;
            child.updateMatrix();
          }
          applyShadingToMesh(child, shadingModeRef.current, Boolean(showWireframeRef.current));
        }
      });

      // Hook up animations if available
      if (animations && animations.length > 0) {
        try {
          const mixer = new THREE.AnimationMixer(object);
          mixerRef.current = mixer;
          boundExternalClipRef.current = animations[0];
          const action = mixer.clipAction(animations[0]);
          action.play();
          useAnimationStore.getState().bindEmbeddedClip(animations[0]);
          mixer.setTime(0);
        } catch {
          // Skip if animation mixer cannot bind
        }
      }

      group.add(object);
      useAnimationStore.getState().setLoadedSkeletonBoneNames(boneNames.length > 0 ? boneNames : null);
      useViewerStore.getState().setActiveModelObject(object);
      fitCameraToModel(object);
      if (!reducedMotionRef.current) {
        const box = new THREE.Box3().setFromObject(object);
        scanRevealRef.current = {
          active: true,
          startMs: performance.now(),
          minY: Number.isFinite(box.min.y) ? box.min.y - 0.05 : 0,
          maxY: Number.isFinite(box.max.y) ? box.max.y + 0.05 : 2.0,
        };
      }
      invalidateRenderRef.current();
      setLoadState({ status: 'loaded', hasModel: true, error: null });
    };

    const handleLoadFailure = (msg: string) => {
      if (!isCancelled) {
        setLoadState({ status: 'error', hasModel: false, error: msg });
        if (tracksSelection) useViewerStore.getState().failAssetLoad(requestId, msg);
      }
    };

    // Load by format
    if (format === 'glb' || format === 'gltf') {
      void loadGLBWithProgress(modelUrl, undefined, abortController.signal).then((buffer) => {
        if (isCancelled || abortController.signal.aborted) return;
        const basePath = modelUrl.startsWith('blob:') || modelUrl.startsWith('data:')
          ? ''
          : new URL('.', new URL(modelUrl, window.location.href)).href;
        sharedGLTFLoader.parse(
          buffer,
          basePath,
          (gltf) => {
            if (isCancelled || abortController.signal.aborted) return;
            handleObjectLoaded(gltf.scene, gltf.animations);
          },
          (err) => {
            if (isCancelled || abortController.signal.aborted) return;
            handleLoadFailure(`Failed to load 3D model: ${err instanceof Error ? err.message : 'Invalid model file'}`);
          }
        );
      }).catch((err: unknown) => {
        if (isCancelled || abortController.signal.aborted) return;
        handleLoadFailure(`Failed to load 3D model: ${err instanceof Error ? err.message : 'Network error'}`);
      });
    } else if (format === 'obj') {
      void fetch(modelUrl, { signal: abortController.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((objText) => {
          if (isCancelled || abortController.signal.aborted) return;
          const obj = sharedOBJLoader.parse(objText);
          const quadEdgesGeo = extractObjQuadEdgesGeometry(objText);
          if (quadEdgesGeo) {
            obj.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                child.userData.__quadEdgesGeometry = quadEdgesGeo;
              }
            });
          }
          handleObjectLoaded(obj);
        })
        .catch((err: unknown) => {
          if (isCancelled || abortController.signal.aborted) return;
          handleLoadFailure(`Failed to load OBJ: ${(err as any)?.message || 'Error'}`);
        });
    } else if (format === 'fbx') {
      sharedFBXLoader.load(
        modelUrl,
        (fbx) => {
          if (isCancelled || abortController.signal.aborted) return;
          handleObjectLoaded(fbx, fbx.animations);
        },
        undefined,
        (err: unknown) => {
          if (isCancelled || abortController.signal.aborted) return;
          handleLoadFailure(`Failed to load FBX: ${(err as any)?.message || 'Error'}`);
        }
      );
    } else if (format === 'stl') {
      sharedSTLLoader.load(
        modelUrl,
        (geom) => {
          if (isCancelled || abortController.signal.aborted) return;
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0xc8cdd5, roughness: 0.6 });
          const mesh = new THREE.Mesh(geom, mat);
          handleObjectLoaded(mesh);
        },
        undefined,
        (err: unknown) => {
          if (isCancelled || abortController.signal.aborted) return;
          handleLoadFailure(`Failed to load STL: ${(err as any)?.message || 'Error'}`);
        }
      );
    } else if (format === 'ply') {
      sharedPLYLoader.load(
        modelUrl,
        (geom) => {
          if (isCancelled || abortController.signal.aborted) return;
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0xc8cdd5, roughness: 0.6 });
          const mesh = new THREE.Mesh(geom, mat);
          handleObjectLoaded(mesh);
        },
        undefined,
        (err: unknown) => {
          if (isCancelled || abortController.signal.aborted) return;
          handleLoadFailure(`Failed to load PLY: ${(err as any)?.message || 'Error'}`);
        }
      );
    }

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [modelUrl, assetFormat, fitCameraToModel, applyShadingToMesh, retryKey, selectionRequestId]);

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
      invalidateRenderRef.current();
      return;
    }

    // Parse part index from id like "p1" -> 0, "p2" -> 1, etc.
    const match = hoveredPartId.match(/^p(\d+)$/);
    if (!match) return;
    const meshIndex = parseInt(match[1], 10) - 1;

    let meshCount = 0;
    const hoverMaterials: THREE.Material[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (meshCount === meshIndex) {
          if (!child.userData.__hoverOriginalMaterial) {
            child.userData.__hoverOriginalMaterial = child.material;
          }
          const hoverMat = new THREE.MeshStandardMaterial({
            color: 0xf9cf00,
            emissive: 0xf9cf00,
            emissiveIntensity: 0.5,
            roughness: 0.2,
            metalness: 0.1,
          });
          hoverMaterials.push(hoverMat);
          child.material = hoverMat;
        }
        meshCount++;
      }
    });
    invalidateRenderRef.current();

    return () => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.__hoverOriginalMaterial) {
          child.material = child.userData.__hoverOriginalMaterial;
          delete child.userData.__hoverOriginalMaterial;
        }
      });
      hoverMaterials.forEach((m) => m.dispose());
    };
  }, [hoveredPartId]);

  // 7. Broadcast live camera quaternion so CameraTriad reflects orientation without React re-renders
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;

    const update = () => {
      if (!camera) return;
      dispatchCameraOrientation([
        camera.quaternion.x,
        camera.quaternion.y,
        camera.quaternion.z,
        camera.quaternion.w,
      ]);
    };

    // Initial broadcast so the triad reflects the starting view
    update();
    controls.addEventListener('change', update);

    return () => {
      controls.removeEventListener('change', update);
    };
  }, [webglInitKey]);

  // 8. Single animation clock & external clip binding subscription
  useEffect(() => {
    const unsub = useAnimationStore.subscribe((state) => {
      const activeClip = state.activeThreeClip;
      const root = modelGroupRef.current?.children[0] ?? null;

      if (activeClip && root && activeClip !== boundExternalClipRef.current) {
        disposeMixer(false);
        try {
          const mixer = new THREE.AnimationMixer(root);
          mixerRef.current = mixer;
          boundExternalClipRef.current = activeClip;
          const action = mixer.clipAction(activeClip);
          action.play();
          mixer.setTime(state.currentTime);
        } catch {
          disposeMixer(false);
        }
      } else if (!activeClip && boundExternalClipRef.current) {
        disposeMixer(false);
      }

      if (mixerRef.current && (state.isPlaying || state.currentTime >= 0)) {
        invalidateRenderRef.current();
      }
    });
    return unsub;
  }, [disposeMixer]);

  // Single source of truth for the viewport UI shell: one mutually exclusive
  // status replaces the previously overlapping JSX conditions (empty, loading,
  // executing, or error).
  type ViewportUIStatus = 'idle' | 'empty' | 'loading' | 'executing' | 'error';
  const viewportStatus: ViewportUIStatus = loadError
    ? 'error'
    : isExecuting
      ? 'executing'
      : modelLoadStatus === 'loading'
        ? 'loading'
        : !hasModel
          ? 'empty'
          : 'idle';

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
      style={{
        background: environmentSettings?.backgroundColor && environmentSettings.backgroundColor !== 'transparent'
          ? environmentSettings.backgroundColor
          : DEFAULT_VIEWPORT_BACKGROUND,
      }}
    >
      {/* WebGL unavailable fallback — shown when the renderer cannot create a context */}
      {webglError && (
        <div className="absolute top-0 left-0 right-0 z-50 flex flex-col items-center justify-center p-2 bg-black/90 text-white text-center border-b border-primary/40">
          <HugeiconsIcon icon={AlertCircle} size={20} className="text-primary mr-2" />
          <span className="text-xs text-zinc-200 font-medium">
            WebGL not available — 3D viewport disabled. {webglError}
          </span>
        </div>
      )}
      {/* Sleek Empty State Watermark matching Reference */}
      {viewportStatus === 'empty' && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
          <div className="flex flex-col items-center text-center px-4 max-w-sm select-none">
            {/* ForMesh3D Studio Gold Brand Mark */}
            <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--surface-1))] border border-primary/40 flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.4)] mb-4 ring-1 ring-white/10">
              <HugeiconsIcon icon={SparklesIcon} size={28} className="text-primary" />
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

      {viewportStatus === 'loading' && (
        <div role="status" aria-live="polite" className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
          <div className="w-full max-w-xs mx-auto rounded-lg border border-white/10 bg-black/60 p-4 shadow-[0_0_24px_rgba(0,0,0,0.6)]">
            <div className="flex flex-col items-center gap-4 mb-3">
              <HugeiconsIcon icon={SparklesIcon} size={26} className="text-primary" />
              <span className={`text-xs font-mono text-zinc-200 ${reducedMotion ? '' : 'animate-pulse'}`}>Loading 3D model…</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className={`h-2 w-2/3 rounded-full bg-white/10 ${reducedMotion ? '' : 'animate-pulse'}`} />
              <div className={`h-1.5 w-1/2 rounded-full bg-white/10 ${reducedMotion ? '' : 'animate-pulse'}`} />
              <div className={`h-2 w-3/4 rounded-full bg-white/10 ${reducedMotion ? '' : 'animate-pulse'}`} />
            </div>
          </div>
        </div>
      )}

      {/* Execution Progress Bar — bottom center */}
      {executionStatus === 'running' && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="w-64 h-1.5 rounded-full bg-white/10 border border-white/5">
            <div
              className="h-full rounded-full transition-all duration-300 bg-white"
              style={{
                width: `${Math.max(0, Math.min(100, Math.round(executionProgress)))}%`,
              }}
            />
          </div>
          <p className="text-[10px] text-white font-mono mt-1 text-center">
            {Math.round(executionProgress)}%
          </p>
        </div>
      )}

      {/* Error Card — retry button */}
      {viewportStatus === 'error' && (
        <div role="alert" className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 px-4 py-3 rounded-xl bg-red-950/90 border border-red-500/30 text-red-200 shadow-xl backdrop-blur-md text-xs leading-relaxed">
          <div className="flex items-start gap-2">
            <span>{loadError ?? 'Failed to load 3D model'}</span>
          </div>
          <button
            type="button"
            onClick={handleRetryLoad}
            aria-label="Retry loading model"
            className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F8FAFC] text-[#080808] text-[10px] font-semibold cursor-pointer transition-colors duration-200 hover:bg-[#F8FAFC]/90 focus-visible:ring-2 focus-visible:ring-[#000]"
          >
            <HugeiconsIcon icon={RefreshCw} size={14} className="text-[#080808]" />
            <span>Retry</span>
          </button>
        </div>
      )}
    </div>
  );
};
