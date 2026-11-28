'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RotateCcw, X, Check, AlertCircle } from 'lucide-react';

interface PendingOrientationRequest {
  file: File;
  resolve: (result: File | null) => void;
}

type OrientationListener = (req: PendingOrientationRequest) => void;
let activeListener: OrientationListener | null = null;

/**
 * Opens the "Find the Best Angle" modal for an uploaded mesh file.
 * Resolves with the original file (if unrotated), a baked GLB file (if rotated),
 * or null if the user cancelled.
 */
export function requestMeshOrientation(file: File): Promise<File | null> {
  if (!activeListener) {
    return Promise.resolve(file);
  }
  return new Promise((resolve) => {
    activeListener?.({ file, resolve });
  });
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return Math.round(((rad * 180) / Math.PI) * 100) / 100;
}

async function loadMeshFromFile(file: File): Promise<THREE.Object3D> {
  const url = URL.createObjectURL(file);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'glb';

  try {
    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('/draco/');
      loader.setDRACOLoader(dracoLoader);
      try {
        const gltf = await loader.loadAsync(url);
        return gltf.scene;
      } finally {
        dracoLoader.dispose();
      }
    }
    if (ext === 'obj') {
      const loader = new OBJLoader();
      return await loader.loadAsync(url);
    }
    if (ext === 'fbx') {
      const loader = new FBXLoader();
      return await loader.loadAsync(url);
    }
    if (ext === 'stl') {
      const loader = new STLLoader();
      const geo = await loader.loadAsync(url);
      return new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xb0b5be, roughness: 0.55, metalness: 0.1 })
      );
    }
    if (ext === 'ply') {
      const loader = new PLYLoader();
      const geo = await loader.loadAsync(url);
      geo.computeVertexNormals();
      return new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: 0xb0b5be,
          roughness: 0.55,
          metalness: 0.1,
          vertexColors: Boolean(geo.attributes.color),
        })
      );
    }
    throw new Error(`Unsupported mesh format: .${ext}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MeshOrientationModal() {
  const [request, setRequest] = useState<PendingOrientationRequest | null>(null);
  const [rotationDeg, setRotationDeg] = useState<{ x: number; y: number; z: number }>({
    x: 0,
    y: 0,
    z: 0,
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pendingRequestRef = useRef<PendingOrientationRequest | null>(null);
  const pivotRef = useRef<THREE.Group | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const sourceCenterRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    activeListener = (req) => {
      pendingRequestRef.current?.resolve(null);
      pendingRequestRef.current = req;
      setRotationDeg({ x: 0, y: 0, z: 0 });
      setLoadError(null);
      setRequest(req);
    };
    return () => {
      pendingRequestRef.current?.resolve(null);
      pendingRequestRef.current = null;
      activeListener = null;
    };
  }, []);

  // Initialize Three.js scene when a request is active
  useEffect(() => {
    if (!request || !viewportRef.current) return;

    const container = viewportRef.current;
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(0, 1.4, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-4, 2, -2);
    scene.add(ambient, key, fill);

    // Grid floor
    const grid = new THREE.GridHelper(6, 18, 0x4b5563, 0x2d323b);
    scene.add(grid);

    // OrbitControls
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0.6, 0);

    // Pivot group for rotation
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.6, 0);
    scene.add(pivot);
    pivotRef.current = pivot;

    // TransformControls (rotate gizmo)
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('rotate');
    transform.setSize(0.85);
    transform.attach(pivot);
    scene.add(transform.getHelper());

    const onDraggingChanged = (event: { value: unknown }) => {
      orbit.enabled = !event.value;
    };
    const onObjectChange = () => {
      setRotationDeg({
        x: radToDeg(pivot.rotation.x),
        y: radToDeg(pivot.rotation.y),
        z: radToDeg(pivot.rotation.z),
      });
    };
    transform.addEventListener('dragging-changed', onDraggingChanged);
    transform.addEventListener('objectChange', onObjectChange);

    let cancelled = false;
    setLoading(true);
    loadMeshFromFile(request.file)
      .then((obj) => {
        if (cancelled) return;
        // Center & normalize scale to fit nicely inside the gizmo
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const scale = 1.6 / maxDim;
        sourceCenterRef.current = center.clone();

        // Fit only the preview wrapper. Keep the source object and its units intact
        // so confirming an orientation never silently rescales the saved mesh.
        const fitGroup = new THREE.Group();
        fitGroup.scale.setScalar(scale);
        fitGroup.position.copy(center).multiplyScalar(-scale);
        fitGroup.add(obj);
        pivot.add(fitGroup);
        modelRef.current = obj;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to preview mesh');
        setLoading(false);
      });

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      transform.removeEventListener('dragging-changed', onDraggingChanged);
      transform.removeEventListener('objectChange', onObjectChange);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      pivotRef.current = null;
      modelRef.current = null;
      sourceCenterRef.current = null;
    };
  }, [request]);

  const applyRotation = useCallback((next: { x: number; y: number; z: number }) => {
    setRotationDeg(next);
    if (pivotRef.current) {
      pivotRef.current.rotation.set(degToRad(next.x), degToRad(next.y), degToRad(next.z));
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (!request || exporting) return;
    request.resolve(null);
    if (pendingRequestRef.current === request) pendingRequestRef.current = null;
    setRequest(null);
  }, [request, exporting]);

  const handleConfirm = useCallback(async () => {
    if (!request || exporting) return;
    const isUnrotated =
      Math.abs(rotationDeg.x) < 0.01 &&
      Math.abs(rotationDeg.y) < 0.01 &&
      Math.abs(rotationDeg.z) < 0.01;

    if (isUnrotated || !modelRef.current) {
      request.resolve(request.file);
      if (pendingRequestRef.current === request) pendingRequestRef.current = null;
      setRequest(null);
      return;
    }

    setExporting(true);
    try {
      const exportGroup = new THREE.Group();
      const cloned = modelRef.current.clone(true);
      const center = sourceCenterRef.current?.clone() || new THREE.Vector3();
      const rotationPivot = new THREE.Group();
      rotationPivot.position.copy(center);
      rotationPivot.rotation.set(
        degToRad(rotationDeg.x),
        degToRad(rotationDeg.y),
        degToRad(rotationDeg.z),
        'XYZ',
      );
      cloned.position.sub(center);
      rotationPivot.add(cloned);
      exportGroup.add(rotationPivot);

      const exporter = new GLTFExporter();
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          exportGroup,
          (res) => {
            if (res instanceof ArrayBuffer) resolve(res);
            else reject(new Error('Expected binary GLB output'));
          },
          (err) => reject(err),
          { binary: true }
        );
      });

      const stem = request.file.name.replace(/\.[^/.]+$/, '');
      const orientedFile = new File([buffer], `${stem}.glb`, {
        type: 'model/gltf-binary',
      });
      if (pendingRequestRef.current === request) {
        request.resolve(orientedFile);
        pendingRequestRef.current = null;
        setRequest(null);
      } else {
        request.resolve(null);
      }
    } catch (err) {
      // Never report a successful orientation save when GLB export failed.
      setLoadError(err instanceof Error ? err.message : 'Failed to export oriented mesh');
    } finally {
      setExporting(false);
    }
  }, [request, rotationDeg, exporting]);

  useEffect(() => {
    if (!request) return;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  const handleDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!exporting) handleCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!controls?.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [exporting, handleCancel]);

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mesh-orientation-title"
      onKeyDown={handleDialogKeyDown}
    >
      <div ref={dialogRef} className="w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-foreground shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <h2 id="mesh-orientation-title" className="text-sm font-semibold">
              Adjust Mesh Orientation
            </h2>
            <span className="text-xs text-muted-foreground truncate max-w-[240px]">
              ({request.file.name})
            </span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={exporting}
            aria-label="Close orientation dialog"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row h-[460px]">
          {/* Left Guide */}
          <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-0))] p-4 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Rotate the mesh to the correct up-axis and forward-facing direction. The original mesh scale is preserved.
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-emerald-200/90">
                    Upright, front-facing, feet/base aligned with the floor grid.
                  </span>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5">
                  <X className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-red-200/90">
                    Avoid lying flat, upside-down, or facing away from the camera.
                  </span>
                </div>
              </div>
            </div>

            {/* Quick 90° snap buttons */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Quick 90° Snap</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <button
                    key={axis}
                    type="button"
                    onClick={() =>
                      applyRotation({
                        ...rotationDeg,
                        [axis]: Math.round((rotationDeg[axis] + 90) * 100) / 100,
                      })
                    }
                    className="px-2 py-1.5 rounded-md text-xs font-medium bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] transition-colors uppercase"
                  >
                    +90° {axis}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right 3D Preview */}
          <div
            className="relative flex-1 min-h-0"
            style={{
              background:
                'radial-gradient(ellipse 70% 68% at 50% 48%, #484a4f 0%, #383a3e 28%, #27282b 55%, #1a1b1e 80%, #131416 100%)',
            }}
          >
            <div ref={viewportRef} className="w-full h-full" />

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-zinc-200">
                Loading mesh preview...
              </div>
            )}

            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <p className="text-xs text-zinc-200 max-w-xs">{loadError}</p>
              </div>
            )}

            {/* Floating X / Y / Z Bar */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-[hsl(var(--border))] shadow-lg">
              <button
                type="button"
                onClick={() => applyRotation({ x: 0, y: 0, z: 0 })}
                title="Reset rotation"
                aria-label="Reset rotation"
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis} className="flex items-center gap-1 text-xs">
                  <span className="uppercase text-[11px] font-medium text-muted-foreground">
                    {axis}
                  </span>
                  <input
                    type="number"
                    step="1"
                    value={rotationDeg[axis]}
                    onChange={(e) =>
                      applyRotation({
                        ...rotationDeg,
                        [axis]: Number(e.target.value) || 0,
                      })
                    }
                    className="w-14 px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-xs text-foreground tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]">
          <button
            type="button"
            onClick={handleCancel}
            disabled={exporting}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || exporting}
            className="px-5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {exporting ? 'Preparing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
