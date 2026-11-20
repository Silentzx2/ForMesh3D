'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useWorkspace } from '../store/WorkspaceContext';
import type { ShadingMode } from './MeshRenderer';
import { useViewerStore } from '@/stores/useViewerStore';
import { getApiClient } from '@/services/apiClient';
import { useMeshLoader, MeshLoadStatus } from './useMeshLoader';
import { detectGpuAvailability } from './MeshRenderer';
import { StreamVideoViewer } from './StreamVideoViewer';

import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshCw, SparklesIcon, AlertCircle } from '@hugeicons/core-free-icons';

interface MeshViewerProps {
  className?: string;
}

/**
 * MeshViewer — GPU-first local mesh viewport with WebSocket streaming fallback.
 *
 * - GPU-accelerated WebGL rendering (MeshRenderer) when a real GPU is present.
 * - Automatic CPU fallback when WebGL is unavailable or software-only.
 * - URL-keyed mesh cache — same URL never re-downloads or re-parses.
 * - Smooth load/unload with full GPU texture/geometry + RAM release.
 * - Original mesh geometry and quality preserved exactly.
 */
export const MeshViewer: React.FC<MeshViewerProps> = ({ className = '' }) => {
  const {
    currentAsset,
    workspaceId,
    activeTool,
    shadingMode,
    showWireframe,
    environmentSettings,
    hoveredPartId,
    setHoveredPartId,
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

  // --- MeshLoader hook (GPU-first, cached, smooth unload) ---
  const {
    status: loadStatus,
    error: loadError,
    isGpu,
    renderer,
    containerRef,
    initRenderer,
    loadModel,
    unload,
  } = useMeshLoader();

  const [reducedMotion, setReducedMotion] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const shadingModeRef = useRef(shadingMode);
  const showWireframeRef = useRef(showWireframe);
  useEffect(() => {
    shadingModeRef.current = shadingMode;
    showWireframeRef.current = showWireframe;
  }, [shadingMode, showWireframe]);

  // Reduced motion preference
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReducedMotion(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Handle retry
  const handleRetryLoad = useCallback(() => {
    setRetryKey((prev) => prev + 1);
  }, []);

  // --- Resolve model URL ---
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
    (assetFormat === 'fbx' ? currentAsset?.artifacts?.riggedFbx : null) ||
    currentAsset?.artifacts?.collision;
  const isMeshAsset = currentAsset && currentAsset.category !== 'texture' &&
    currentAsset.format !== 'IMAGE' && currentAsset.format !== 'FILE';
  const modelUrl =
    currentAsset?.source?.viewUrl ||
    currentAsset?.source?.localUrl ||
    (isMeshAsset ? artifactUrl || assetFileUrl : null) ||
    null;

  // --- GPU probe + renderer init on mount ---
  useEffect(() => {
    if (containerRef.current) {
      initRenderer(containerRef.current);
    }
  }, [initRenderer]);

  // Re-init renderer if container changes (e.g. after unmount/remount)
  useEffect(() => {
    if (containerRef.current && !renderer) {
      initRenderer(containerRef.current);
    }
  }, [renderer, initRenderer]);

  // --- Load model when URL changes ---
  useEffect(() => {
    if (!modelUrl) {
      unload();
      return;
    }
    void loadModel(modelUrl);
  }, [modelUrl, loadModel, unload]);

  // --- Apply shading/wireframe when they change ---
  useEffect(() => {
    if (renderer) {
      const resolveMode = (m: string): ShadingMode => {
        const map: Record<string, ShadingMode> = {
          textured: 'textured' as ShadingMode,
          solid: 'textured' as ShadingMode,
          clay: 'clay' as ShadingMode,
          'matcap-gold': 'matcap-gold' as ShadingMode,
          'matcap-chrome': 'matcap-chrome' as ShadingMode,
          'uv-checker': 'uv-checker' as ShadingMode,
          wireframe: 'wireframe' as ShadingMode,
        };
        return (map[m] || 'textured') as ShadingMode;
      };
      renderer.setShadingMode(resolveMode(shadingMode), Boolean(showWireframe));
    }
  }, [shadingMode, showWireframe, renderer]);



  // --- Highlight hovered part ---
  useEffect(() => {
    const group = (renderer as any)?.modelGroup;
    if (!group) return;
    if (!hoveredPartId) {
      group.traverse((child: any) => {
        if (child instanceof THREE.Mesh && child.userData.__hoverOriginalMaterial) {
          child.material = child.userData.__hoverOriginalMaterial;
          delete child.userData.__hoverOriginalMaterial;
        }
      });
      return;
    }
    const match = hoveredPartId.match(/^p(\d+)$/);
    if (!match) return;
    const meshIndex = parseInt(match[1], 10) - 1;
    let meshCount = 0;
    group.traverse((child: any) => {
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
      group.traverse((child: any) => {
        if (child instanceof THREE.Mesh && child.userData.__hoverOriginalMaterial) {
          child.material = child.userData.__hoverOriginalMaterial;
          delete child.userData.__hoverOriginalMaterial;
        }
      });
    };
  }, [hoveredPartId, renderer]);

  // --- Broadcast camera rotation for external gizmo ---
  useEffect(() => {
    const controls = (renderer as any)?.controls;
    const camera = (renderer as any)?.camera;
    if (!controls || !camera) return;
    const update = () => {
      if (!camera || !controls) return;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const absX = Math.abs(dir.dot(new THREE.Vector3(1, 0, 0)));
      const absY = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0)));
      const absZ = Math.abs(dir.dot(new THREE.Vector3(0, 0, 1)));
      const axis =
        absX >= absY && absX >= absZ
          ? dir.x > 0 ? 'right' : 'left'
          : absY >= absX && absY >= absZ
          ? dir.y > 0 ? 'top' : 'bottom'
          : dir.z > 0 ? 'front' : 'back';
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('setCameraRotation', { detail: axis }));
      }
    };
    update();
    controls.addEventListener('change', update);
    return () => controls.removeEventListener('change', update);
  }, [renderer]);

  // --- Viewport UI status ---
  const viewportStatus: MeshLoadStatus = loadError ? 'error' : loadStatus;

  const handleSnapshot = useCallback(() => {
    const r = renderer;
    if (!r) {
      toast.error('3D Viewport is not ready for snapshot');
      return;
    }
    const dom = r.domElement;
    const origWidth = dom.width;
    const origHeight = dom.height;
    const origPixelRatio = r.getPixelRatio();
    r.setSize(1920, 1080);
    r.setPixelRatio(1);
    requestAnimationFrame(() => {
      r.render();
      r.domElement.toBlob((blob) => {
        r.setSize(origWidth, origHeight);
        r.setPixelRatio(origPixelRatio);
        if (!blob) {
          toast.error('Failed to create snapshot image');
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'mesh-snapshot.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        toast.success('Snapshot saved');
      }, 'image/png', 1.0);
    });
  }, [renderer]);

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
      {/* WebGL unavailable fallback */}
      {!isGpu && renderer && (
        <div className="absolute top-0 left-0 right-0 z-50 flex flex-col items-center justify-center p-2 bg-black/90 text-white text-center border-b border-[#F9CF00]/40">
          <HugeiconsIcon icon={AlertCircle} size={20} className="text-[#F9CF00] mr-2" />
          <span className="text-xs text-zinc-200 font-medium">
            WebGL not available — using CPU fallback renderer.
          </span>
        </div>
      )}

      {/* Local Three.js canvas (GPU/CPU mesh rendering) */}


      {/* Cloud stream viewer (fallback when local load fails or no local mesh) */}
      {modelUrl && viewportStatus === 'error' && (
        <StreamVideoViewer
          workspaceId={workspaceId}
          modelUrl={modelUrl}
          shadingMode={shadingMode}
          showWireframe={showWireframe}
          className="absolute inset-0 z-0"
        />
      )}

      {/* Loading state */}
      {viewportStatus === 'loading' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none bg-black/40 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-black/70 border border-white/10 shadow-2xl">
            <HugeiconsIcon icon={SparklesIcon} size={28} className="text-[#F9CF00] animate-pulse" />
            <div className="flex flex-col items-center">
              <span className="text-xs font-semibold text-white">Loading 3D model…</span>
              <span className="text-[10px] text-zinc-400 mt-0.5">{isGpu ? 'GPU rendering' : 'CPU fallback'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {viewportStatus === 'error' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-4 bg-black/60">
          <div className="max-w-sm flex flex-col items-center text-center p-4 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 shadow-xl">
            <HugeiconsIcon icon={AlertCircle} size={24} className="text-red-400 mb-2" />
            <span className="text-xs font-semibold">Mesh Load Failed</span>
            <span className="text-[11px] text-red-300/80 mt-1">{loadError ?? 'Failed to load 3D model'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRetryLoad();
              }}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={RefreshCw} size={14} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!modelUrl && viewportStatus === 'idle' && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
          <div className="flex flex-col items-center text-center px-4 max-w-sm select-none">
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

      {/* Snapshot button */}
      <div className="absolute top-3 left-3 z-50 flex gap-1 pointer-events-auto">
        <button
          onClick={handleSnapshot}
          className="px-3 py-1.5 rounded-lg bg-[#F9CF00] text-[#080808] font-bold shadow-[0_0_15px_rgba(249,207,0,0.4)] hover:scale-105 hover:bg-[#FFE04D] transition-all duration-200 cursor-pointer"
          aria-label="Take snapshot"
        >
          📷 Snapshot
        </button>
      </div>
    </div>
  );
};
