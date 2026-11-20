'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useViewerStore } from '@/stores/useViewerStore';
import { HugeiconsIcon } from '@hugeicons/react';
import { ThreeDRotateIcon, SparklesIcon } from '@hugeicons/core-free-icons';

export interface RealModelPreviewCanvasProps {
  mode: 'rigging' | 'segmentation' | 'uv' | 'animation';
  selectedId?: string | null;
  onSelectId?: (id: string) => void;
  onHoverId?: (id: string | null) => void;
  xrayBones?: boolean;
  orbitYaw?: number;
  bones?: Array<{ id: string; name: string; parent: string | null; pos: [number, number, number] }>;
  parts?: Array<{ id: string; name: string; color: string; visible: boolean }>;
  highlightBoundaries?: boolean;
  colorizeViewport?: boolean;
  viewAngle?: 'front' | 'ortho' | 'side';
  highlightSeams?: boolean;
  viewportChecker?: boolean;
  showArmature?: boolean;
  showTrajectory?: boolean;
}

export const RealModelPreviewCanvas: React.FC<RealModelPreviewCanvasProps> = ({
  mode,
  selectedId,
  onSelectId,
  onHoverId,
  xrayBones = true,
  orbitYaw,
  bones = [],
  parts = [],
  highlightBoundaries = true,
  colorizeViewport = true,
  viewAngle = 'ortho',
  highlightSeams = true,
  viewportChecker = false,
  showArmature = true,
  showTrajectory = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeModel = useViewerStore((s) => s.activeModelObject);
  const [hovered, setHovered] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Persistent Three.js references (prevent WebGL context thrashing)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const interactivesRef = useRef<{ obj: THREE.Object3D; id: string }[]>([]);

  // Stable callback refs to avoid re-triggering effects on every render
  const onHoverIdRef = useRef(onHoverId);
  onHoverIdRef.current = onHoverId;
  const onSelectIdRef = useRef(onSelectId);
  onSelectIdRef.current = onSelectId;

  // Geometry edge cache to avoid synchronous CPU recomputation
  const edgeGeoCacheRef = useRef<WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>>(new WeakMap());

  // 1. One-time WebGL Engine Mount & OrbitControls Lifecycle
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const w = el.clientWidth || 220;
    const h = el.clientHeight || 220;

    // WebGL probe
    const webglProbe = document.createElement('canvas');
    const webglContext = webglProbe.getContext('webgl') || webglProbe.getContext('webgl2');
    if (!webglContext) {
      setWebglError('WebGL context is not available in this browser/environment.');
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 0.4, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    rendererRef.current = renderer;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5);
    dl.position.set(3, 4, 3);
    scene.add(dl);

    const modelGroup = new THREE.Group();
    modelGroupRef.current = modelGroup;
    scene.add(modelGroup);

    // Responsive resize observer without context reconstruction
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nw = entry.contentRect.width;
        const nh = entry.contentRect.height;
        if (nw > 0 && nh > 0 && cameraRef.current && rendererRef.current) {
          cameraRef.current.aspect = nw / nh;
          cameraRef.current.updateProjectionMatrix();
          rendererRef.current.setSize(nw, nh);
        }
      }
    });
    resizeObserver.observe(el);

    let rafId: number;
    let isDisposed = false;
    const renderLoop = () => {
      if (isDisposed) return;
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && el.contains(renderer.domElement)) {
        el.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
    };
  }, []);

  // 2. Model Structure Build — Only runs when activeModel identity actually changes
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;

    // Clear previous children
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }
    interactivesRef.current = [];

    // Build model representation
    const root = activeModel ? activeModel.clone(true) : new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.25, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: 0x2e3248, roughness: 0.4 })
    );

    let meshIdx = 0;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry) {
        node.userData.__meshIndex = meshIdx;

        // Caching edges geometry once to eliminate CPU freeze
        let edgeGeo = edgeGeoCacheRef.current.get(node.geometry);
        if (!edgeGeo) {
          // Bounded calculation for performance
          edgeGeo = new THREE.EdgesGeometry(node.geometry, 30);
          edgeGeoCacheRef.current.set(node.geometry, edgeGeo);
        }

        const wire = new THREE.LineSegments(
          edgeGeo,
          new THREE.LineBasicMaterial({
            color: mode === 'uv' ? 0xef4444 : 0xffffff,
            opacity: 0.6,
            transparent: true,
          })
        );
        wire.name = '__wire_boundary';
        node.add(wire);

        interactivesRef.current.push({ obj: node, id: `p${meshIdx + 1}` });
        meshIdx++;
      }
    });

    // Center & scale
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 1.7 / Math.max(size.x, size.y, size.z, 0.01);
    root.position.sub(center).multiplyScalar(scale);
    root.scale.setScalar(scale);
    group.add(root);

    // Rigging Armature setup
    if (mode === 'rigging') {
      const realBones: THREE.Bone[] = [];
      root.traverse((n) => { if (n instanceof THREE.Bone) realBones.push(n); });
      if (realBones.length > 0) {
        const skel = new THREE.SkeletonHelper(root);
        (skel.material as THREE.LineBasicMaterial).depthTest = !xrayBones;
        (skel.material as THREE.LineBasicMaterial).color = new THREE.Color(0xf9cf00);
        skel.renderOrder = xrayBones ? 999 : 0;
        group.add(skel);
      }
    }
  }, [activeModel, mode, xrayBones]);

  // 3. Fast In-Place Materials & Visibility Updates (Zero Context Rebuild, Zero Allocation)
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;

    group.traverse((node) => {
      if (node instanceof THREE.Mesh && node.userData.__meshIndex !== undefined) {
        const meshIdx = node.userData.__meshIndex as number;

        if (mode === 'segmentation') {
          const part = parts[meshIdx % Math.max(1, parts.length)];
          if (part) {
            node.visible = part.visible;
            if (node.material instanceof THREE.MeshStandardMaterial) {
              node.material.color.set(colorizeViewport ? part.color : '#475569');
              node.material.roughness = 0.35;
              node.material.needsUpdate = true;
            } else {
              node.material = new THREE.MeshStandardMaterial({
                color: colorizeViewport ? new THREE.Color(part.color) : 0x475569,
                roughness: 0.35,
              });
            }
          }
        } else if (mode === 'uv' && viewportChecker) {
          node.material = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xf9cf00 });
        }

        // Toggle wire boundary visibility without recreating geometry
        const wire = node.getObjectByName('__wire_boundary');
        if (wire) {
          wire.visible = Boolean((mode === 'segmentation' && highlightBoundaries) || (mode === 'uv' && highlightSeams));
        }
      }
    });
  }, [mode, parts, selectedId, colorizeViewport, highlightBoundaries, highlightSeams, viewportChecker]);

  // 4. View Angle Adjustment
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (orbitYaw !== undefined) {
      const rad = (orbitYaw * Math.PI) / 180;
      camera.position.set(Math.sin(rad) * 3.2, 0.4, Math.cos(rad) * 3.2);
    } else if (viewAngle === 'front') {
      camera.position.set(0, 0, 3.2);
    } else if (viewAngle === 'side') {
      camera.position.set(3.2, 0.2, 0);
    } else {
      camera.position.set(2.2, 1.4, 2.2);
    }
    controls.update();
  }, [viewAngle, orbitYaw]);

  // 5. Throttled Pointer Handler
  const isRaycastingRef = useRef(false);
  const handlePointer = useCallback((e: React.MouseEvent<HTMLDivElement>, isClick: boolean) => {
    const el = containerRef.current;
    const camera = cameraRef.current;
    if (!el || !camera || interactivesRef.current.length === 0) return;

    if (!isClick && isRaycastingRef.current) return;
    if (!isClick) isRaycastingRef.current = true;

    const rect = el.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);

    const meshObjects = interactivesRef.current.map((i) => i.obj);
    const hits = ray.intersectObjects(meshObjects, true);

    if (hits.length > 0) {
      const hit = hits[0].object;
      const found = interactivesRef.current.find((i) => i.obj === hit || i.obj.children.includes(hit));
      if (found) {
        if (isClick) {
          onSelectIdRef.current?.(found.id);
        } else {
          setHovered(found.id);
          onHoverIdRef.current?.(found.id);
        }
        isRaycastingRef.current = false;
        return;
      }
    }

    if (!isClick) {
      setHovered(null);
      onHoverIdRef.current?.(null);
      isRaycastingRef.current = false;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      onClick={(e) => handlePointer(e, true)}
      onMouseMove={(e) => handlePointer(e, false)}
      className={`relative w-full aspect-square max-h-[220px] rounded-xl overflow-hidden border border-white/[0.08] bg-[hsl(var(--surface-0))] ${
        hovered ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      {webglError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-4 bg-black/80 text-white text-center">
          <HugeiconsIcon icon={SparklesIcon} size={24} className="text-[#F9CF00] mb-2" />
          <h3 className="text-sm font-semibold mb-1">WebGL not available</h3>
          <p className="text-[10px] text-zinc-300 max-w-[180px]">
            The 3D preview could not initialize because WebGL context creation failed.
            <br />
            {webglError}
          </p>
        </div>
      )}
      <div className="absolute inset-0 opacity-40 pointer-events-none [background:radial-gradient(circle_at_50%_50%,rgba(35,30,60,0.5)_0%,transparent_80%)]" />
      <div className="absolute top-1.5 left-2 text-[8px] font-mono text-zinc-500 pointer-events-none flex items-center gap-1 z-20">
        <HugeiconsIcon icon={ThreeDRotateIcon} size={10} className="text-[hsl(var(--primary))]" />
        <span>Orbit · Select in 3D</span>
      </div>
      {activeModel && (
        <div className="absolute bottom-1.5 right-2 text-[8px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-0.5 z-20 pointer-events-none">
          <HugeiconsIcon icon={SparklesIcon} size={8} />
          <span>Real Mesh</span>
        </div>
      )}
    </div>
  );
};
