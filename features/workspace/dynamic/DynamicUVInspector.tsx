'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { Download, RefreshCw, Wand2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export const DynamicUVInspector: React.FC = () => {
  const { currentAsset, runUVUnwrapGeneration, isExecuting } = useWorkspace();
  const activeModelObject = useViewerStore((s) => s.activeModelObject);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [highlightSeams, setHighlightSeams] = useState(false);
  const [viewportChecker, setViewportChecker] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(0);

  // Extract REAL UV coordinates and metadata from active Three.js model
  const uvData = useMemo(() => {
    if (!activeModelObject) return null;

    const meshesWithUV: { mesh: THREE.Mesh; uv: THREE.BufferAttribute; pos: THREE.BufferAttribute; index: THREE.BufferAttribute | null }[] = [];
    activeModelObject.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry?.attributes) {
        const uvAttr = (child.geometry.attributes.uv ||
          child.geometry.attributes.uv_0 ||
          child.geometry.attributes.texcoord_0 ||
          child.geometry.attributes.uv2) as THREE.BufferAttribute | undefined;
        if (uvAttr) {
          meshesWithUV.push({
            mesh: child,
            uv: uvAttr,
            pos: child.geometry.attributes.position as THREE.BufferAttribute,
            index: child.geometry.index as THREE.BufferAttribute | null,
          });
        }
      }
    });

    if (meshesWithUV.length === 0) return null;

    let totalTris = 0;
    let totalUVArea = 0;

    meshesWithUV.forEach(({ uv, pos, index }) => {
      const faceCount = index ? index.count / 3 : pos.count / 3;
      totalTris += faceCount;

      const step = Math.max(1, Math.floor(faceCount / 500));
      for (let i = 0; i < faceCount; i += step) {
        let i0 = i * 3, i1 = i * 3 + 1, i2 = i * 3 + 2;
        if (index) {
          i0 = index.getX(i * 3);
          i1 = index.getX(i * 3 + 1);
          i2 = index.getX(i * 3 + 2);
        }
        const u0 = uv.getX(i0), v0 = uv.getY(i0);
        const u1 = uv.getX(i1), v1 = uv.getY(i1);
        const u2 = uv.getX(i2), v2 = uv.getY(i2);
        const triArea = 0.5 * Math.abs(u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1));
        totalUVArea += triArea * step;
      }
    });

    const coveragePercent = Math.min(99.0, Math.max(1.0, Math.round(totalUVArea * 1000) / 10));

    return {
      hasUV: true,
      meshes: meshesWithUV,
      totalTris,
      coverage: coveragePercent,
    };
  }, [activeModelObject, forceRefresh]);

  // Render Real UV Wireframe onto 2D Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Dark background
    ctx.fillStyle = '#0a0b12';
    ctx.fillRect(0, 0, w, h);

    // Checker pattern
    const tileSize = 32;
    for (let x = 0; x < w; x += tileSize) {
      for (let y = 0; y < h; y += tileSize) {
        if ((x / tileSize + y / tileSize) % 2 === 0) {
          ctx.fillStyle = '#10121d';
          ctx.fillRect(x, y, tileSize, tileSize);
        }
      }
    }

    // Grid coordinate lines (0.25, 0.5, 0.75)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let s = 1; s < 4; s++) {
      const pos = (w / 4) * s;
      ctx.beginPath();
      ctx.moveTo(pos, 0); ctx.lineTo(pos, h);
      ctx.moveTo(0, pos); ctx.lineTo(w, pos);
      ctx.stroke();
    }

    if (!uvData || !uvData.hasUV) return;

    // Draw Real Mesh UV Triangles
    ctx.strokeStyle = 'rgba(249, 207, 0, 0.75)';
    ctx.fillStyle = 'rgba(249, 207, 0, 0.04)';
    ctx.lineWidth = 0.5;

    uvData.meshes.forEach(({ uv, pos, index }) => {
      const faceCount = index ? index.count / 3 : pos.count / 3;
      // Stride for high density meshes to maintain 60fps
      const step = faceCount > 15000 ? Math.ceil(faceCount / 15000) : 1;

      for (let i = 0; i < faceCount; i += step) {
        let i0 = i * 3, i1 = i * 3 + 1, i2 = i * 3 + 2;
        if (index) {
          i0 = index.getX(i * 3);
          i1 = index.getX(i * 3 + 1);
          i2 = index.getX(i * 3 + 2);
        }

        const u0 = uv.getX(i0) * w;
        const v0 = (1 - uv.getY(i0)) * h;
        const u1 = uv.getX(i1) * w;
        const v1 = (1 - uv.getY(i1)) * h;
        const u2 = uv.getX(i2) * w;
        const v2 = (1 - uv.getY(i2)) * h;

        ctx.beginPath();
        ctx.moveTo(u0, v0);
        ctx.lineTo(u1, v1);
        ctx.lineTo(u2, v2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });
  }, [uvData]);

  // Generate Quick Planar UVs directly on client Three.js geometry if UVs are missing
  const handleQuickPlanarUV = () => {
    if (!activeModelObject) return;
    let generatedCount = 0;
    activeModelObject.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry) {
        const geo = node.geometry;
        if (!geo.attributes.uv) {
          geo.computeBoundingBox();
          const bbox = geo.boundingBox || new THREE.Box3();
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const min = bbox.min;
          const pos = geo.attributes.position;
          if (pos) {
            const count = pos.count;
            const uvs = new Float32Array(count * 2);
            const denomX = size.x > 0.0001 ? size.x : 1;
            const denomY = size.y > 0.0001 ? size.y : 1;
            for (let i = 0; i < count; i++) {
              const x = pos.getX(i);
              const y = pos.getY(i);
              uvs[i * 2] = Math.max(0, Math.min(1, (x - min.x) / denomX));
              uvs[i * 2 + 1] = Math.max(0, Math.min(1, (y - min.y) / denomY));
            }
            geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geo.attributes.uv.needsUpdate = true;
            generatedCount++;
          }
        }
      }
    });

    if (generatedCount > 0) {
      toast.success('Generated planar UVs for viewport preview!');
      setForceRefresh((p) => p + 1);
    } else {
      toast.info('Model already contains UV maps.');
    }
  };

  // Toggle Red Seam Highlights on Active 3D Model
  const toggleHighlightSeams = () => {
    const nextVal = !highlightSeams;
    setHighlightSeams(nextVal);
    if (!activeModelObject) return;

    activeModelObject.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        let seamLine = node.children.find((c) => c.userData.__isSeamLine);
        if (nextVal) {
          if (!seamLine) {
            const edges = new THREE.EdgesGeometry(node.geometry, 28);
            seamLine = new THREE.LineSegments(
              edges,
              new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 2 })
            );
            seamLine.userData.__isSeamLine = true;
            node.add(seamLine);
          }
          seamLine.visible = true;
        } else if (seamLine) {
          seamLine.visible = false;
        }
      }
    });
  };

  // Toggle Procedural UV Checkerboard on Active 3D Model
  const toggleViewportChecker = () => {
    const nextVal = !viewportChecker;
    setViewportChecker(nextVal);
    if (!activeModelObject) return;

    activeModelObject.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material) {
        const mat = node.material as THREE.MeshStandardMaterial;
        if (nextVal) {
          if (!mat.userData.__origMap) {
            mat.userData.__origMap = mat.map;
          }
          // Procedural 256x256 checker texture
          const canvas = document.createElement('canvas');
          canvas.width = 256; canvas.height = 256;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            for (let x = 0; x < 256; x += 32) {
              for (let y = 0; y < 256; y += 32) {
                ctx.fillStyle = (x / 32 + y / 32) % 2 === 0 ? '#ffffff' : '#1e2029';
                ctx.fillRect(x, y, 32, 32);
              }
            }
          }
          const texture = new THREE.CanvasTexture(canvas);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(4, 4);
          mat.map = texture;
          mat.needsUpdate = true;
        } else {
          if (mat.userData.__origMap !== undefined) {
            mat.map = mat.userData.__origMap;
            delete mat.userData.__origMap;
            mat.needsUpdate = true;
          }
        }
      }
    });
  };

  // Export 2D UV Layout PNG
  const handleExportUV = () => {
    if (!canvasRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${currentAsset?.name || 'model'}_uv_layout.png`;
      a.click();
      toast.success('UV Layout exported as PNG');
    } catch (err: any) {
      toast.error('Failed to export UV layout', { description: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* 2D UV Canvas Viewport */}
      <div className="relative aspect-square w-full rounded-xl overflow-hidden border border-white/[0.08] bg-[hsl(var(--surface-0))] shadow-inner">
        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          className="w-full h-full object-contain block"
        />

        {/* Real UV Overlay Badge */}
        {uvData && uvData.hasUV ? (
          <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border-[hsl(var(--primary))]/30 text-[9px] font-mono text-[hsl(var(--primary))] font-bold">
            Real Mesh UV Wireframe
          </div>
        ) : (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-4 bg-black/80 backdrop-blur-sm text-center space-y-2">
            <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">No UV Map Found</h4>
              <p className="text-[10px] text-zinc-400 max-w-[200px] mt-0.5 leading-relaxed">
                This mesh lacks UV coordinates. You can preview with quick planar UVs or run the Smart UV pipeline.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-[190px] pt-1">
              <button
                type="button"
                onClick={handleQuickPlanarUV}
                className="h-7 px-3 rounded-lg bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-black text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95"
              >
                <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Quick Viewport UVs</span>
              </button>
              <button
                type="button"
                onClick={() => runUVUnwrapGeneration()}
                disabled={isExecuting}
                className="h-7 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer border border-white/10 transition-all active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{isExecuting ? 'Unwrapping...' : 'Smart UV Unwrap'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Real UV Coverage & Triangles Metrics */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">UV Coverage</span>
          <span className="font-mono text-[11px] font-semibold text-emerald-400">
            {uvData?.hasUV ? `${uvData.coverage}%` : '0%'}
          </span>
        </div>
        <div className="p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">UV Faces</span>
          <span className="font-mono text-[11px] font-semibold text-white">
            {uvData?.hasUV ? uvData.totalTris.toLocaleString() : '0'}
          </span>
        </div>
      </div>

      {/* 3D Viewport Synchronized Toggles */}
      <div className="space-y-1.5 p-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-200 font-medium">Highlight Seam Cuts</span>
          <button
            type="button"
            role="switch"
            aria-checked={highlightSeams}
            onClick={toggleHighlightSeams}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${highlightSeams ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${highlightSeams ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
          <span className="text-[11px] text-zinc-200 font-medium">Test Grid Material</span>
          <button
            type="button"
            role="switch"
            aria-checked={viewportChecker}
            onClick={toggleViewportChecker}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${viewportChecker ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${viewportChecker ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={handleExportUV}
          disabled={isExporting || !uvData?.hasUV}
          className="h-8 px-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 border border-white/[0.1] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
        >
          <Download className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
          <span>{isExporting ? 'Exporting...' : 'Export Layout'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            toast.info('Unwrapping UV islands with optimal packing...');
            runUVUnwrapGeneration();
          }}
          disabled={isExecuting}
          className="h-8 px-2 rounded-xl bg-[hsl(var(--primary))]/15 hover:bg-[hsl(var(--primary))]/25 border border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
          <span>Auto Unwrap UV</span>
        </button>
      </div>
    </div>
  );
};
