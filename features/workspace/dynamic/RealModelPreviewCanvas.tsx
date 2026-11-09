'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useViewerStore } from '@/stores/useViewerStore';
import { Rotate3d, Sparkles } from 'lucide-react';

export interface RealModelPreviewCanvasProps {
  mode: 'rigging' | 'segmentation' | 'uv' | 'animation';
  selectedId?: string | null;
  onSelectId?: (id: string) => void;
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
  const interactivesRef = useRef<{ obj: THREE.Object3D; id: string }[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth || 220;
    const h = el.clientHeight || 220;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 0.4, 3.2);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5);
    dl.position.set(3, 4, 3);
    scene.add(dl);

    const group = new THREE.Group();
    scene.add(group);
    interactivesRef.current = [];

    // Build model representation
    const root = activeModel ? activeModel.clone(true) : new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.25, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: 0x2e3248, roughness: 0.4 })
    );

    // Apply mode materials to meshes
    let meshIdx = 0;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (mode === 'segmentation') {
          const part = parts[meshIdx % Math.max(1, parts.length)];
          if (part) {
            node.visible = part.visible;
            node.material = new THREE.MeshStandardMaterial({
              color: colorizeViewport ? new THREE.Color(part.color) : 0x475569,
              roughness: 0.35,
            });
            interactivesRef.current.push({ obj: node, id: part.id });
          }
        } else if (mode === 'uv' && viewportChecker) {
          node.material = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xf9cf00 });
        } else {
          node.material = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 });
        }
        if ((mode === 'segmentation' && highlightBoundaries) || (mode === 'uv' && highlightSeams)) {
          const wire = new THREE.LineSegments(
            new THREE.EdgesGeometry(node.geometry, 24),
            new THREE.LineBasicMaterial({ color: mode === 'uv' ? 0xef4444 : 0xffffff, opacity: 0.6, transparent: true })
          );
          node.add(wire);
        }
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

    // Rigging: Add SkeletonHelper & joint markers
    if (mode === 'rigging') {
      const realBones: THREE.Bone[] = [];
      root.traverse((n) => { if (n instanceof THREE.Bone) realBones.push(n); });
      if (realBones.length > 0) {
        const skel = new THREE.SkeletonHelper(root);
        (skel.material as THREE.LineBasicMaterial).depthTest = !xrayBones;
        (skel.material as THREE.LineBasicMaterial).color = new THREE.Color(0xf9cf00);
        skel.renderOrder = xrayBones ? 999 : 0;
        group.add(skel);
        realBones.forEach((b) => {
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 10, 10),
            new THREE.MeshBasicMaterial({ color: selectedId === b.name ? 0xf9cf00 : 0xffffff, depthTest: !xrayBones })
          );
          sphere.renderOrder = xrayBones ? 1000 : 1;
          b.getWorldPosition(sphere.position);
          group.add(sphere);
          interactivesRef.current.push({ obj: sphere, id: b.name });
        });
      } else {
        bones.forEach((b) => {
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.035, 10, 10),
            new THREE.MeshBasicMaterial({ color: selectedId === b.id ? 0xf9cf00 : 0xffffff, depthTest: !xrayBones })
          );
          sphere.position.set(b.pos[0] * 0.8, b.pos[1] * 0.8, b.pos[2] * 0.8);
          sphere.renderOrder = xrayBones ? 1000 : 1;
          group.add(sphere);
          interactivesRef.current.push({ obj: sphere, id: b.id });
        });
      }
    }

    // Animation overlay
    if (mode === 'animation' && showArmature && activeModel) {
      const skel = new THREE.SkeletonHelper(root);
      (skel.material as THREE.LineBasicMaterial).color = new THREE.Color(0xf9cf00);
      group.add(skel);
    }

    // Camera view angle
    if (orbitYaw !== undefined) {
      const rad = (orbitYaw * Math.PI) / 180;
      camera.position.set(Math.sin(rad) * 3.2, 0.4, Math.cos(rad) * 3.2);
    } else if (viewAngle === 'front') camera.position.set(0, 0, 3.2);
    else if (viewAngle === 'side') camera.position.set(3.2, 0.2, 0);

    let rafId: number;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [activeModel, mode, selectedId, xrayBones, orbitYaw, bones, parts, highlightBoundaries, colorizeViewport, viewAngle, highlightSeams, viewportChecker, showArmature]);

  const handlePointer = (e: React.MouseEvent<HTMLDivElement>, isClick: boolean) => {
    const el = containerRef.current;
    if (!el || interactivesRef.current.length === 0) return;
    const rect = el.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const camera = new THREE.PerspectiveCamera(40, rect.width / rect.height, 0.1, 50);
    camera.position.set(0, 0.4, 3.2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(interactivesRef.current.map((i) => i.obj), true);
    if (hits.length > 0) {
      const hit = hits[0].object;
      const found = interactivesRef.current.find((i) => i.obj === hit || i.obj.children.includes(hit));
      if (found) {
        if (isClick && onSelectId) onSelectId(found.id);
        else setHovered(found.id);
        return;
      }
    }
    if (!isClick) setHovered(null);
  };

  return (
    <div
      ref={containerRef}
      onClick={(e) => handlePointer(e, true)}
      onMouseMove={(e) => handlePointer(e, false)}
      className={`relative w-full aspect-square max-h-[220px] rounded-xl overflow-hidden border border-white/[0.08] bg-[#0c0d14] ${
        hovered ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <div className="absolute inset-0 opacity-40 pointer-events-none [background:radial-gradient(circle_at_50%_50%,rgba(35,30,60,0.5)_0%,transparent_80%)]" />
      <div className="absolute top-1.5 left-2 text-[8px] font-mono text-zinc-500 pointer-events-none flex items-center gap-1 z-20">
        <Rotate3d className="w-2.5 h-2.5 text-[#F9CF00]" />
        <span>Orbit · Select in 3D</span>
      </div>
      {activeModel && (
        <div className="absolute bottom-1.5 right-2 text-[8px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-0.5 z-20 pointer-events-none">
          <Sparkles className="w-2 h-2" />
          <span>Real Mesh</span>
        </div>
      )}
    </div>
  );
};
