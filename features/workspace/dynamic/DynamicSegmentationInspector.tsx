'use client';

import React, { useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { invalidateViewportRender } from '../Viewport/viewportEvents';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { RealModelPreviewCanvas } from './RealModelPreviewCanvas';
import { downloadArtifact } from '../lib/artifactDownload';
import {
  Scissors,
  Eye,
  EyeOff,
  FolderArchive,
  Sparkles,
} from '@/components/icons/hugeicons-components';
import { toast } from 'sonner';

interface SegmentPart {
  id: string;
  name: string;
  color: string;
  faces: number;
  volumePercent: number;
  visible: boolean;
}

const PART_PALETTE = [
  '#3B82F6', // Blue (Head)
  '#10B981', // Green (Torso)
  '#F59E0B', // Amber (Left Arm)
  '#EF4444', // Red (Right Arm)
  '#8B5CF6', // Purple (Left Leg)
  '#EC4899', // Pink (Right Leg)
  '#06B6D4', // Cyan (Weapon/Prop)
  '#F97316', // Orange (Backpack/Gear)
];

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}

function buildSimpleZip(files: { name: string; data: Uint8Array }[]): Blob {
  const fileEntries: { nameBytes: Uint8Array; data: Uint8Array; offset: number; crc: number }[] = [];
  let offset = 0;
  const parts: Uint8Array[] = [];

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    let crc = ~0;
    for (let i = 0; i < file.data.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ file.data[i]) & 0xff];
    }
    crc = (crc ^ ~0) >>> 0;

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);

    fileEntries.push({ nameBytes, data: file.data, offset, crc });
    parts.push(header);
    parts.push(file.data);
    offset += header.length + file.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const entry of fileEntries) {
    const cd = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(cd.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint32(42, entry.offset, true);
    cd.set(entry.nameBytes, 46);
    parts.push(cd);
    cdSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);
  eView.setUint32(0, 0x06054b50, true);
  eView.setUint16(8, fileEntries.length, true);
  eView.setUint16(10, fileEntries.length, true);
  eView.setUint32(12, cdSize, true);
  eView.setUint32(16, cdOffset, true);
  parts.push(eocd);

  return new Blob(parts as unknown as BlobPart[], { type: 'application/zip' });
}

export const DynamicSegmentationInspector: React.FC = () => {
  const { currentAsset, setHoveredPartId } = useWorkspace();
  const activeModelObject = useViewerStore((s) => s.activeModelObject);
  const [highlightBoundaries, setHighlightBoundaries] = useState(false);
  const [colorizeViewport, setColorizeViewport] = useState(true);
  const [selectedPartId, setSelectedPartId] = useState<string | null>('p1');
  const [viewAngle, setViewAngle] = useState<'front' | 'ortho' | 'side'>('ortho');
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Extract REAL submesh parts from loaded model
  const { realParts, isRealModelData } = useMemo(() => {
    if (!activeModelObject) return { realParts: null, isRealModelData: false };

    const childMeshes: THREE.Mesh[] = [];
    activeModelObject.traverse((c) => {
      if (c instanceof THREE.Mesh && c.geometry && !c.userData?.__isWireframeOverlay) {
        childMeshes.push(c);
      }
    });

    if (childMeshes.length === 0) return { realParts: null, isRealModelData: false };

    let totalFaces = 0;
    childMeshes.forEach((m) => {
      const count = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      totalFaces += count;
    });

    const computed = childMeshes.map((m, idx) => {
      const count = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      const volPercent = Math.max(1, Math.round((count / Math.max(1, totalFaces)) * 1000) / 10);
      return {
        id: `p${idx + 1}`,
        name: m.name ? m.name.replace(/_/g, ' ') : `Part ${idx + 1}`,
        color: PART_PALETTE[idx % PART_PALETTE.length],
        faces: Math.round(count),
        volumePercent: volPercent,
        visible: m.visible,
      };
    });

    return { realParts: computed, isRealModelData: true };
  }, [activeModelObject]);

  const [parts, setParts] = useState<SegmentPart[]>([]);
  const [explodeAmount, setExplodeAmount] = useState(0);

  React.useEffect(() => {
    setExplodeAmount(0);
    if (realParts && realParts.length > 0) {
      setParts(realParts);
      setSelectedPartId(realParts[0]?.id || null);
    } else {
      setParts([]);
      setSelectedPartId(null);
    }
  }, [realParts]);

  React.useEffect(() => {
    if (!activeModelObject) return;
    const meshes: THREE.Mesh[] = [];
    activeModelObject.traverse((c) => {
      if (c instanceof THREE.Mesh && c.geometry && !c.userData?.__isWireframeOverlay) {
        meshes.push(c);
      }
    });
    if (meshes.length < 2) return;

    // Cache each part's original local position and explode direction once (in activeModelObject local space)
    // so MeshViewer world scaling never distorts offsets and dragging the slider never drifts.
    if (!activeModelObject.userData.__explodeInitialized) {
      const localModelBox = new THREE.Box3();
      const partLocalCenters: THREE.Vector3[] = [];
      meshes.forEach((m) => {
        if (!m.userData.__origPos) {
          m.userData.__origPos = m.position.clone();
        }
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const box = (m.geometry.boundingBox ? m.geometry.boundingBox.clone() : new THREE.Box3());
        const center = box.getCenter(new THREE.Vector3()).add(m.userData.__origPos as THREE.Vector3);
        partLocalCenters.push(center);
        box.translate(m.userData.__origPos as THREE.Vector3);
        localModelBox.union(box);
      });
      const localCenter = localModelBox.getCenter(new THREE.Vector3());
      const localRadius = Math.max(1e-4, localModelBox.getSize(new THREE.Vector3()).length() * 0.35);
      meshes.forEach((m, idx) => {
        const dir = partLocalCenters[idx].clone().sub(localCenter);
        if (dir.lengthSq() < 1e-8) {
          const angle = (idx / meshes.length) * Math.PI * 2;
          dir.set(Math.cos(angle), 0.35, Math.sin(angle));
        }
        m.userData.__explodeDir = dir.normalize();
      });
      activeModelObject.userData.__explodeRadius = localRadius;
      activeModelObject.userData.__explodeInitialized = true;
    }

    const radius = (activeModelObject.userData.__explodeRadius as number) || 1;
    meshes.forEach((m) => {
      const orig = (m.userData.__origPos as THREE.Vector3) || new THREE.Vector3();
      if (explodeAmount === 0) {
        m.position.copy(orig);
      } else {
        const dir = (m.userData.__explodeDir as THREE.Vector3) || new THREE.Vector3(0, 1, 0);
        m.position.copy(orig).addScaledVector(dir, (explodeAmount / 100) * radius);
      }
      m.updateMatrixWorld(true);
    });
    invalidateViewportRender();
  }, [activeModelObject, explodeAmount]);

  const totalFaces = useMemo(() => parts.reduce((acc, p) => acc + p.faces, 0), [parts]);
  const visibleCount = useMemo(() => parts.filter((p) => p.visible).length, [parts]);

  const handleSelectId = useCallback((id: string) => {
    setSelectedPartId(id);
    const p = parts.find((x) => x.id === id);
    if (p) toast.info(`Selected Part: ${p.name}`);
  }, [parts]);

  const handleHoverId = useCallback((id: string | null) => {
    setHoveredPartId(id);
  }, [setHoveredPartId]);

  // Toggle visibility of individual part and update activeModelObject mesh in Three.js scene
  const togglePartVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const partIndex = parts.findIndex((part) => part.id === id);
    const part = parts[partIndex];
    if (!part) return;
    const nextVis = !part.visible;

    if (activeModelObject) {
      let meshIdx = 0;
      activeModelObject.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          if (meshIdx === partIndex || node.name === part.name) {
            node.visible = nextVis;
          }
          meshIdx++;
        }
      });
    }

    setParts((prev) => prev.map((item) => item.id === id ? { ...item, visible: nextVis } : item));
    invalidateViewportRender();
  };

  const toggleAllVisibility = () => {
    const allVisible = visibleCount === parts.length;
    const nextVis = !allVisible;
    setParts((prev) => prev.map((p) => ({ ...p, visible: nextVis })));
    if (activeModelObject) {
      activeModelObject.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.visible = nextVis;
        }
      });
      invalidateViewportRender();
    }
    toast.info(allVisible ? 'Hidden all parts' : 'Showing all parts');
  };

  // Real Export: Downloads backend ZIP or generates real multi-part client ZIP
  const handleExportZip = async () => {
    setIsExportingZip(true);
    setExportError(null);
    toast.info('Packaging segmented parts into ZIP archive...');
    try {

      const assetId = currentAsset?.id;
      if (assetId) {
        try {
          await downloadArtifact(`/api/v1/system/jobs/${assetId}/download?artifact_format=zip`, `${currentAsset?.name || 'segmented_parts'}.zip`, 'zip');
          toast.success('Segmented parts exported as ZIP archive (.zip)');
          return;
        } catch {
          // Fall through to client zip generation
        }
      }

      if (activeModelObject) {
        const objExporter = new OBJExporter();
        const files: { name: string; data: Uint8Array }[] = [];

        const meshNodes: THREE.Mesh[] = [];
        activeModelObject.traverse((node) => {
          if (node instanceof THREE.Mesh && node.geometry) meshNodes.push(node);
        });
        if (meshNodes.length < 2) {
          throw new Error('Saved individual part files are unavailable. Re-run segmentation with Save Individual Part Files enabled.');
        }

        meshNodes.forEach((node, meshIdx) => {
          const part = parts[meshIdx];
          const partName = (part?.name || node.name || `part_${meshIdx + 1}`).replace(/\s+/g, '_');
          const objText = objExporter.parse(node);
          files.push({
            name: `${partName}.obj`,
            data: new TextEncoder().encode(objText),
          });
        });

        const zipBlob = buildSimpleZip(files);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentAsset?.name || 'segmented_parts'}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
        toast.success(`Exported ${files.length} parts as ZIP archive (.zip)`);
      } else {
        throw new Error('No active 3D model available to export');
      }
    } catch (err: any) {
      setExportError(err.message || 'Export failed');
      toast.error(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <div className="space-y-2 select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Segmented Mesh
          </span>
          {isRealModelData && (
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-0.5">
              <Sparkles className="w-2.5 h-2.5" />
              <span>Real Mesh</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/[0.06]">
          {(['ortho', 'front', 'side'] as const).map((angle) => (
            <button
              key={angle}
              type="button"
              onClick={() => setViewAngle(angle)}
              className={`h-6 px-2 rounded text-[10px] font-semibold transition-all capitalize cursor-pointer ${
                viewAngle === angle ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {angle}
            </button>
          ))}
        </div>
      </div>

      {/* Real 3D Segmented Mesh Canvas */}
      <RealModelPreviewCanvas
        mode="segmentation"
        selectedId={selectedPartId}
        onSelectId={handleSelectId}
        onHoverId={handleHoverId}
        parts={parts}
        highlightBoundaries={highlightBoundaries}
        colorizeViewport={colorizeViewport}
        viewAngle={viewAngle}
      />

      {/* Parts Proportion Ribbon */}
      <div className="p-2 rounded-xl bg-black/40 border border-white/[0.08] space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-[hsl(var(--primary))]" aria-hidden="true" />
            <span className="text-xs font-semibold text-white">Parts Assembly</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] font-mono font-semibold border border-[hsl(var(--primary))]/30">
            {parts.length} Parts
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-white/5 border border-white/[0.06]">
          {parts.map((p) => (
            <div
              key={p.id}
              style={{
                width: `${p.volumePercent}%`,
                backgroundColor: p.visible ? p.color : 'rgba(255,255,255,0.1)',
              }}
              className={`h-full transition-all duration-150 ${selectedPartId === p.id ? 'ring-1 ring-white' : ''}`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
          <span>{totalFaces.toLocaleString()} tris</span>
          <span>{visibleCount}/{parts.length} Active</span>
        </div>
      </div>

      {/* Explode / Separate Parts Slider */}
      {parts.length > 1 && (
        <div className="p-2 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400 font-semibold uppercase tracking-wider">Explode Parts</span>
            <span className="font-mono text-[hsl(var(--primary))]">{explodeAmount}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={explodeAmount}
            onChange={(e) => setExplodeAmount(Number(e.target.value))}
            aria-label="Explode Parts"
            className="w-full h-1.5 accent-[#F9CF00] cursor-pointer"
          />
        </div>
      )}

      {/* Part Hierarchy List */}
      <div className="space-y-1">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Part Hierarchy
          </span>
          <div className="flex items-center gap-2">
            {selectedPartId && parts.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setParts((prev) => prev.map((p) => ({ ...p, visible: p.id === selectedPartId })));
                  if (activeModelObject) {
                    const idx = parts.findIndex((p) => p.id === selectedPartId);
                    let mIdx = 0;
                    activeModelObject.traverse((n) => {
                      if (n instanceof THREE.Mesh) {
                        n.visible = mIdx === idx;
                        mIdx++;
                      }
                    });
                    invalidateViewportRender();
                  }
                }}
                className="text-[10px] text-zinc-300 hover:text-white cursor-pointer font-semibold"
              >
                Isolate
              </button>
            )}
            <button
              type="button"
              onClick={toggleAllVisibility}
              className="text-[10px] text-[hsl(var(--primary))] hover:underline cursor-pointer font-semibold"
            >
              {visibleCount === parts.length ? 'Hide All' : 'Show All'}
            </button>
          </div>
        </div>

        <div className="space-y-1 max-h-[200px] overflow-y-auto pr-0.5">
          {parts.map((part) => {
            const isSelected = selectedPartId === part.id;
            return (
              <div
                key={part.id}
                onClick={() => setSelectedPartId(isSelected ? null : part.id)}
                className={`p-1.5 rounded-lg border flex items-center justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[hsl(var(--surface-1))] border-[hsl(var(--primary))] text-white'
                    : 'bg-[hsl(var(--surface-1))] border-white/[0.06] hover:border-white/20 text-zinc-300'
                } ${!part.visible ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: part.color }}
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold block truncate leading-tight text-white">
                      {part.name}
                    </span>
                    <span className="text-[9px] font-mono text-zinc-400 block">
                      {part.faces.toLocaleString()} tris · {part.volumePercent}%
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => togglePartVisibility(part.id, e)}
                  className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                  aria-label={part.visible ? 'Hide Part' : 'Show Part'}
                >
                  {part.visible ? <Eye className="w-3.5 h-3.5 text-zinc-300" /> : <EyeOff className="w-3.5 h-3.5 text-zinc-500" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Viewport Sync Controls */}
      <div className="space-y-1.5 p-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-200 font-medium">Highlight Part Seams</span>
          <button
            type="button"
            role="switch"
            aria-checked={highlightBoundaries}
            onClick={() => setHighlightBoundaries(!highlightBoundaries)}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${highlightBoundaries ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${highlightBoundaries ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
          <span className="text-[11px] text-zinc-200 font-medium">Colorize Viewport</span>
          <button
            type="button"
            role="switch"
            aria-checked={colorizeViewport}
            onClick={() => setColorizeViewport(!colorizeViewport)}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${colorizeViewport ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${colorizeViewport ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Real Export ZIP */}
      <button
        type="button"
        onClick={handleExportZip}
        disabled={isExportingZip}
        className="w-full h-8 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
      >
        <FolderArchive className="w-3.5 h-3.5 text-[hsl(var(--primary))]" aria-hidden="true" />
        <span>{isExportingZip ? 'Packaging ZIP Archive...' : 'Export Separate Parts (.ZIP)'}</span>
      </button>
      {exportError && (
        <div className="text-[10px] text-rose-400">{exportError}</div>
      )}
    </div>
  );
};
