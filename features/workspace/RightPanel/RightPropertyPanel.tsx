import React, { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { invalidateViewportRender } from '../Viewport/viewportEvents';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';
import { downloadArtifact } from '../lib/artifactDownload';
import { triggerClientExport, type ClientSupportedExportFormat } from '../utils/clientExporters';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  CheckIcon,
  ChevronDown,
  DownloadIcon,
  EyeIcon,
  HexagonIcon,
  Lock,
  MoveIcon,
  PaletteIcon,
  RefreshCw,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Unlock,
} from '@hugeicons/core-free-icons';
import { useViewerStore } from '@/stores/useViewerStore';
import { useUIStore } from '@/stores/useUIStore';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Grid3X3, Scissors, Film, Bone } from '@/components/icons/hugeicons-components';

const InspectorLoadingFallback = () => (
  <div className="flex min-h-24 items-center justify-center text-xs text-[hsl(var(--muted-foreground))]">
    Loading inspector…
  </div>
);

interface InspectorHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}

const InspectorHeader: React.FC<InspectorHeaderProps> = ({ icon, title, subtitle }) => (
  <div className="px-3 py-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2 flex-shrink-0">
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-primary flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold text-xs text-[hsl(var(--foreground))] truncate">{title}</h2>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] block truncate">{subtitle}</span>
      </div>
    </div>
    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 border border-primary/30 text-primary flex-shrink-0">
      Active
    </span>
  </div>
);

const DynamicUVInspector = dynamic(
  () => import('../dynamic/DynamicUVInspector').then((mod) => mod.DynamicUVInspector),
  { ssr: false, loading: InspectorLoadingFallback }
);
const DynamicSegmentationInspector = dynamic(
  () => import('../dynamic/DynamicSegmentationInspector').then((mod) => mod.DynamicSegmentationInspector),
  { ssr: false, loading: InspectorLoadingFallback }
);
const DynamicAnimationInspector = dynamic(
  () => import('../dynamic/DynamicAnimationInspector').then((mod) => mod.DynamicAnimationInspector),
  { ssr: false, loading: InspectorLoadingFallback }
);
const DynamicRiggingInspector = dynamic(
  () => import('../dynamic/DynamicRiggingInspector').then((mod) => mod.DynamicRiggingInspector),
  { ssr: false, loading: InspectorLoadingFallback }
);

export const RightPropertyPanel: React.FC = () => {
  const {
    currentAsset,
    activeTool,
    shadingMode,
    setShadingMode,
    showWireframe,
    setShowWireframe,
    remeshSettings,
    generationSettings,
    updateMaterialConfig,
  } = useWorkspace();

  const modelStats = useViewerStore((s) => s.modelStats);
  const activeModelObject = useViewerStore((s) => s.activeModelObject);
  const assetSelectionState = useViewerStore((s) => s.assetSelectionState);
  const assetLoadError = useViewerStore((s) => s.assetLoadError);
  const selectedAsset = useViewerStore((s) => s.selectedAsset);
  const requestAssetSelection = useViewerStore((s) => s.requestAssetSelection);
  const verifyAsset = useViewerStore((s) => s.verifyAsset);
  const beginAssetLoad = useViewerStore((s) => s.beginAssetLoad);

  // Accordion state persisted in UI store
  const rightPanelSections = useUIStore((s) => s.rightPanelSections);
  const setRightPanelSectionExpanded = useUIStore((s) => s.setRightPanelSectionExpanded);
  const toggleRightPanelSection = useUIStore((s) => s.toggleRightPanelSection);

  // Auto-expand section matching activeTool; manual toggle overrides auto behavior
  const manualOverridesRef = useRef<Set<string>>(new Set());
  const prevToolRef = useRef<string | null>(activeTool);

  useEffect(() => {
    if (prevToolRef.current !== activeTool) {
      prevToolRef.current = activeTool;
      let targetSection: string | null = null;
      if (activeTool === 'edit') {
        targetSection = 'transform';
      } else if (activeTool === 'texture' || activeTool === 'pbr' || activeTool === 'remesh' || activeTool === 'model' || activeTool === 'uv' || activeTool === 'segment' || activeTool === 'animation' || activeTool === 'rigging') {
        targetSection = 'context';
      }
      if (targetSection && !manualOverridesRef.current.has(targetSection)) {
        setRightPanelSectionExpanded(targetSection, true);
      }
    }
  }, [activeTool, setRightPanelSectionExpanded]);

  const handleManualToggle = (sectionId: string) => {
    manualOverridesRef.current.add(sectionId);
    toggleRightPanelSection(sectionId);
  };

  const isSectionExpanded = (sectionId: string) => {
    // Dedicated tool inspectors collapse general mesh properties by default.
    if (sectionId !== 'context' && (activeTool === 'rigging' || activeTool === 'segment' || activeTool === 'uv' || activeTool === 'animation')) {
      return rightPanelSections?.[sectionId] ?? false;
    }
    return rightPanelSections?.[sectionId] ?? true;
  };

  const [exportFormat, setExportFormat] = useState<'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply'>('glb');
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'success'>('idle');
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExporting = exportState === 'exporting';
  const exportSuccess = exportState === 'success';

  const scheduleExportReset = () => {
    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    exportTimerRef.current = setTimeout(() => {
      setExportState('idle');
      exportTimerRef.current = null;
    }, 3000);
  };

  // Live 3D object transform synchronized to Three.js model group
  const [transform, setTransform] = useState({
    posX: 0,
    posY: 0,
    posZ: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    scaleZ: 1.0,
    lockScale: true
  });

  // Apply transforms live to Three.js modelGroupRef / activeModelObject
  useEffect(() => {
    if (!activeModelObject) return;
    const target = (activeModelObject.parent && activeModelObject.parent.type === 'Group')
      ? activeModelObject.parent
      : activeModelObject;

    target.position.set(transform.posX, transform.posY, transform.posZ);
    target.rotation.set(
      (transform.rotX * Math.PI) / 180,
      (transform.rotY * Math.PI) / 180,
      (transform.rotZ * Math.PI) / 180
    );
    target.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
    invalidateViewportRender();
  }, [transform, activeModelObject]);

  // Reset transform state when switching assets
  useEffect(() => {
    setTransform({
      posX: 0,
      posY: 0,
      posZ: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1.0,
      scaleY: 1.0,
      scaleZ: 1.0,
      lockScale: true
    });
  }, [currentAsset?.id]);

  // Material & PBR Shader Settings
  const [materialSettings, setMaterialSettings] = useState({
    roughness: 0.45,
    metallic: 0.15,
    normalStrength: 1.0,
    ambientOcclusion: 0.85,
    normalFormat: 'OpenGL' as 'OpenGL' | 'DirectX',
  });

  // Live THREE.MeshStandardMaterial uniform updates in textured mode
  useEffect(() => {
    if (!activeModelObject) return;
    activeModelObject.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
            mat.roughness = materialSettings.roughness;
            mat.metalness = materialSettings.metallic;
            if (mat.normalScale) {
              mat.normalScale.set(materialSettings.normalStrength, materialSettings.normalStrength);
            }
            mat.needsUpdate = true;
          }
        });
      }
    });
    invalidateViewportRender();
  }, [materialSettings.roughness, materialSettings.metallic, materialSettings.normalStrength, activeModelObject]);

  const handleScaleChange = (val: number) => {
    if (transform.lockScale) {
      setTransform(prev => ({ ...prev, scaleX: val, scaleY: val, scaleZ: val }));
    } else {
      setTransform(prev => ({ ...prev, scaleX: val }));
    }
  };

  const handleResetTransform = () => {
    setTransform({
      posX: 0,
      posY: 0,
      posZ: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1.0,
      scaleY: 1.0,
      scaleZ: 1.0,
      lockScale: true
    });
    if (activeModelObject) {
      const target = (activeModelObject.parent && activeModelObject.parent.type === 'Group')
        ? activeModelObject.parent
        : activeModelObject;
      target.position.set(0, 0, 0);
      target.rotation.set(0, 0, 0);
      target.scale.set(1, 1, 1);
      invalidateViewportRender();
    }
  };

  const buildGenerationDownloadUrl = (asset: { id: string; source?: { fileId?: string } | null }, format: string): string | undefined => {
    const fileId = asset.source?.fileId;
    if (fileId?.startsWith('job-')) {
      return `/api/v1/system/jobs/${encodeURIComponent(fileId.slice(4))}/download?artifact_format=${format}`;
    }
    if (fileId) {
      return `/api/v1/file-upload/download/${encodeURIComponent(fileId)}`;
    }
    if (asset.id) {
      return `/api/v1/system/jobs/${encodeURIComponent(asset.id)}/download?artifact_format=${format}`;
    }
    return undefined;
  };

  const handleExportDownload = async () => {
    if (!currentAsset) return;
    const sourceUrl =
      currentAsset.artifacts?.gameReadyFormats?.[exportFormat] ||
      (exportFormat === 'glb' ? currentAsset.artifacts?.gameReady : undefined) ||
      (exportFormat === 'glb' ? currentAsset.source?.localUrl || currentAsset.source?.viewUrl : undefined) ||
      (exportFormat === 'fbx' ? currentAsset.artifacts?.riggedFbx : undefined) ||
      (currentAsset.category === 'generation' ? buildGenerationDownloadUrl(currentAsset, exportFormat) : undefined);

    const assetBaseName = currentAsset.name.replace(/\.[^.]+$/, '');

    // Fallback directly to client Three.js exporter when backend download URL is missing
    if (!sourceUrl) {
      if (exportFormat === 'fbx') {
        toast.error('FBX export requires rigging', {
          description: 'FBX requires a rigged skeleton. Rig this model first in the Rigging tab or export as GLB/OBJ.',
        });
        return;
      }

      if (activeModelObject) {
        if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
        setExportState('exporting');
        try {
          toast.info(`Generating ${exportFormat.toUpperCase()} in browser...`);
          await triggerClientExport(activeModelObject, exportFormat as ClientSupportedExportFormat, `${assetBaseName}.${exportFormat}`);
          setExportState('success');
          toast.success(`${exportFormat.toUpperCase()} exported successfully!`);
          scheduleExportReset();
        } catch (err: any) {
          console.error('Client export failed:', err);
          toast.error('Export failed', { description: err?.message || 'Failed to export model' });
          setExportState('idle');
        }
        return;
      }

      toast.error('Export unavailable', {
        description: `${exportFormat.toUpperCase()} is not available for this asset yet.`,
      });
      return;
    }

    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    setExportState('exporting');
    try {
      await downloadArtifact(sourceUrl, `${assetBaseName}.${exportFormat}`, exportFormat);
      setExportState('success');
      scheduleExportReset();
    } catch (error) {
      // If remote download fails, attempt client Three.js export fallback
      if (activeModelObject && exportFormat !== 'fbx') {
        try {
          toast.info(`Backend artifact unavailable. Generating ${exportFormat.toUpperCase()} from viewport...`);
          await triggerClientExport(activeModelObject, exportFormat as ClientSupportedExportFormat, `${assetBaseName}.${exportFormat}`);
          setExportState('success');
          toast.success(`${exportFormat.toUpperCase()} exported from viewport!`);
          scheduleExportReset();
          return;
        } catch (clientErr: any) {
          console.error('Fallback client export failed:', clientErr);
        }
      }
      console.error(error);
      const msg = error instanceof Error ? error.message : 'Export failed';
      toast.error('Export failed', { description: msg });
      setExportState('idle');
    }
  };

  // Dedicated Dynamic Inspectors for specific tools — ONLY these show on their respective pages!
  if (activeTool === 'uv') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <InspectorHeader
          icon={<Grid3X3 className="w-4 h-4 text-primary" />}
          title="Smart UV Inspector"
          subtitle="Atlas Preview & Quality Metrics"
        />
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicUVInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'segment') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <InspectorHeader
          icon={<Scissors className="w-4 h-4 text-primary" />}
          title="Segmentation Inspector"
          subtitle="Part Layers & Assembly Tree"
        />
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicSegmentationInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'animation') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <InspectorHeader
          icon={<Film className="w-4 h-4 text-primary" />}
          title="Motion Inspector"
          subtitle="Playback Scrubber & Diagnostics"
        />
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicAnimationInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'rigging') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <InspectorHeader
          icon={<Bone className="w-4 h-4 text-primary" />}
          title="Auto-Rigging & Armature"
          subtitle="Interactive Armature & Joint Hierarchy"
        />
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicRiggingInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'remesh') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <InspectorHeader
          icon={<HugeiconsIcon icon={HexagonIcon} size={16} className="w-4 h-4 text-primary" />}
          title="Quad Retopology Inspector"
          subtitle="Topology Flow & Polygon Budget"
        />
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
          <div className="p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">Output Polygons</span>
              <span className="font-mono text-primary uppercase font-semibold">{remeshSettings.polyType}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Current Topology</span>
              <span className="font-mono text-emerald-400 font-semibold">{currentAsset?.topology || 'Triangle'}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Face Count</span>
              <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset?.faces ? currentAsset.faces.toLocaleString() : '—'}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Vertex Count</span>
              <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset?.vertices ? currentAsset.vertices.toLocaleString() : '—'}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
            <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              Wireframe &amp; Shading Overrides
            </span>
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setShowWireframe(!showWireframe)}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  showWireframe
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                    : 'bg-[hsl(var(--surface-1))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                }`}
              >
                <span>Wireframe Overlay</span>
              </button>
              <button
                type="button"
                onClick={() => setShadingMode(shadingMode === 'wireframe' ? 'clay' : 'wireframe')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  shadingMode === 'wireframe'
                    ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold'
                    : 'bg-[hsl(var(--surface-1))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                }`}
              >
                <span>Wire Solo</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTool === 'texture' || activeTool === 'pbr') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <InspectorHeader
          icon={<HugeiconsIcon icon={PaletteIcon} size={16} className="w-4 h-4 text-primary" />}
          title="PBR Material Inspector"
          subtitle="Material Channels & Texture Maps"
        />
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
          {/* Roughness */}
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-1.5">
            <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
              <span className="font-medium">Roughness</span>
              <span className="font-mono font-bold text-primary">{materialSettings.roughness.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={materialSettings.roughness}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setMaterialSettings(p => ({ ...p, roughness: val }));
                updateMaterialConfig?.({ roughness: val });
              }}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Metallic */}
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-1.5">
            <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
              <span className="font-medium">Metallic</span>
              <span className="font-mono font-bold text-primary">{materialSettings.metallic.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={materialSettings.metallic}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setMaterialSettings(p => ({ ...p, metallic: val }));
                updateMaterialConfig?.({ metalness: val });
              }}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Normal Strength */}
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-1.5">
            <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
              <span className="font-medium">Normal Intensity</span>
              <span className="font-mono font-bold text-primary">{materialSettings.normalStrength.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={materialSettings.normalStrength}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setMaterialSettings(p => ({ ...p, normalStrength: val }));
                updateMaterialConfig?.({ normalScale: val });
              }}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Cavity & AO */}
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-1.5">
            <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
              <span className="font-medium">Cavity &amp; AO Strength</span>
              <span className="font-mono font-bold text-primary">{materialSettings.ambientOcclusion.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={materialSettings.ambientOcclusion}
              onChange={(e) => setMaterialSettings(p => ({ ...p, ambientOcclusion: parseFloat(e.target.value) }))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
            <span>Normal Standard</span>
            <div className="flex gap-1.5">
              {(['OpenGL', 'DirectX'] as const).map(fmt => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setMaterialSettings(p => ({ ...p, normalFormat: fmt }))}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                    materialSettings.normalFormat === fmt
                      ? 'bg-primary text-[hsl(var(--primary-foreground))]'
                      : 'bg-[hsl(var(--surface-1))] text-[hsl(var(--muted-foreground))] hover:text-white'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {currentAsset?.artifacts?.pbrMaps && Object.keys(currentAsset.artifacts.pbrMaps).length > 0 && (
            <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Baked PBR Maps
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(currentAsset.artifacts.pbrMaps).map(([mapType, url]) => (
                  <a
                    key={mapType}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-3))] text-[11px] font-medium text-[hsl(var(--foreground))] flex items-center justify-between border border-[hsl(var(--border))] transition-colors"
                  >
                    <span className="capitalize">{mapType}</span>
                    <HugeiconsIcon icon={DownloadIcon} size={16} className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!currentAsset) {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full items-center justify-center bg-[hsl(var(--surface-1))] px-6 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-0))] border border-[hsl(var(--border))] flex items-center justify-center text-[hsl(var(--muted-foreground))] mb-3">
          <HugeiconsIcon icon={Box} size={16} className="w-6 h-6 stroke-[1.5]" />
        </div>
        <div className="text-xs font-semibold text-[hsl(var(--foreground))]">No Active 3D Asset</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-relaxed max-w-[210px]">
          Generate a model or select one from the Assets tab to inspect geometry, PBR maps, and exports.
        </div>
      </div>
    );
  }

  return (
    <div 
      id="panel-properties-inspector" 
      className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden"
    >
      {/* Header with Asset Meta */}
      <div className="px-3 py-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] flex items-center justify-center text-primary flex-shrink-0">
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-xs text-[hsl(var(--foreground))] truncate">{currentAsset.name}</h2>
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] block">Inspector &amp; Properties</span>
          </div>
        </div>
        <span className="text-[11px] uppercase font-mono font-semibold px-2 py-0.5 rounded-md bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-primary flex-shrink-0">
          {currentAsset.format}
        </span>
      </div>

      {/* Mesh Selection State */}
      {assetSelectionState !== 'idle' && assetSelectionState !== 'ready' && (
        <div className="px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]/40 flex flex-col gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${assetSelectionState === 'loading' ? 'bg-primary animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
              {assetSelectionState === 'loading' ? 'Loading mesh…' : assetSelectionState === 'verifying' ? 'Verifying…' : 'Selecting…'}
            </span>
          </div>
          {assetSelectionState === 'error' && assetLoadError && (
            <>
              <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1">
                {assetLoadError}
              </div>
              <button
                type="button"
                onClick={() => {
                  const requestId = requestAssetSelection(selectedAsset);
                  verifyAsset(requestId);
                  beginAssetLoad(requestId);
                }}
                className="self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[hsl(var(--foreground))] text-[hsl(var(--background))] text-[11px] font-semibold cursor-pointer transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HugeiconsIcon icon={RefreshCw} size={12} />
                <span>Retry</span>
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
        {/* 1. 3D AI Generator Pipeline (Shown exclusively on Model page) */}
        {activeTool === 'model' && (
          <Collapsible
            open={isSectionExpanded('context')}
            onOpenChange={() => handleManualToggle('context')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden"
          >
            <div className="flex items-center justify-between px-2.5 py-2 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={SparklesIcon} size={15} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-semibold text-xs text-[hsl(var(--foreground))]">
                    Generator Pipeline
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto transition-transform duration-200 ${
                      isSectionExpanded('context') ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-2.5 pt-2 space-y-1.5 text-xs border-t border-[hsl(var(--border))]/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[hsl(var(--muted-foreground))]">Model Engine</span>
                <span className="font-mono text-[11px] text-primary truncate">{generationSettings.aiModel}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[hsl(var(--muted-foreground))]">Cutout RMBG</span>
                <span className={`font-mono text-[11px] ${generationSettings.removeBackground ? 'text-emerald-400' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  {generationSettings.removeBackground ? 'Enabled' : 'Off'}
                </span>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 2. Object Transform Section */}
        <Collapsible
          open={isSectionExpanded('transform')}
          onOpenChange={() => handleManualToggle('transform')}
          className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden"
        >
          <div className="flex items-center justify-between px-2.5 py-2 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 flex-1 text-left select-none cursor-pointer group"
              >
                <HugeiconsIcon icon={MoveIcon} size={15} className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="font-semibold text-xs text-[hsl(var(--foreground))]">
                  Object Transform
                </span>
                <HugeiconsIcon
                  icon={ChevronDown}
                  size={14}
                  className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                    isSectionExpanded('transform') ? 'rotate-180 text-primary' : ''
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <SimpleTooltip label="Reset Transform">
              <button
                type="button"
                aria-label="Reset Transform"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetTransform();
                }}
                className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))] transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={RefreshCw} size={14} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>
          </div>

          <CollapsibleContent className="px-2.5 pb-2.5 pt-2 space-y-2.5 border-t border-[hsl(var(--border))]/50">
            {/* Position (m) */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-medium">Position (m)</span>
                <span className="font-mono">World</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-rose-400 font-semibold mr-1">X</span>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Position X"
                    value={transform.posX}
                    onChange={(e) => setTransform(p => ({ ...p, posX: parseFloat(e.target.value) || 0 }))}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-emerald-400 font-semibold mr-1">Y</span>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Position Y"
                    value={transform.posY}
                    onChange={(e) => setTransform(p => ({ ...p, posY: parseFloat(e.target.value) || 0 }))}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-sky-400 font-semibold mr-1">Z</span>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Position Z"
                    value={transform.posZ}
                    onChange={(e) => setTransform(p => ({ ...p, posZ: parseFloat(e.target.value) || 0 }))}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
              </div>
            </div>

            {/* Rotation (°) */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-medium">Rotation (°)</span>
                <span className="font-mono">Euler</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-rose-400 font-semibold mr-1">X</span>
                  <input
                    type="number"
                    aria-label="Rotation X"
                    value={transform.rotX}
                    onChange={(e) => setTransform(p => ({ ...p, rotX: parseFloat(e.target.value) || 0 }))}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-emerald-400 font-semibold mr-1">Y</span>
                  <input
                    type="number"
                    aria-label="Rotation Y"
                    value={transform.rotY}
                    onChange={(e) => setTransform(p => ({ ...p, rotY: parseFloat(e.target.value) || 0 }))}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-sky-400 font-semibold mr-1">Z</span>
                  <input
                    type="number"
                    aria-label="Rotation Z"
                    value={transform.rotZ}
                    onChange={(e) => setTransform(p => ({ ...p, rotZ: parseFloat(e.target.value) || 0 }))}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
              </div>
            </div>

            {/* Scale */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-medium">Scale</span>
                <button
                  type="button"
                  onClick={() => setTransform(p => ({ ...p, lockScale: !p.lockScale }))}
                  className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
                >
                  {transform.lockScale ? <HugeiconsIcon icon={Lock} size={12} className="w-3 h-3" /> : <HugeiconsIcon icon={Unlock} size={12} className="w-3 h-3" />}
                  <span>{transform.lockScale ? 'Uniform' : 'Independent'}</span>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-rose-400 font-semibold mr-1">X</span>
                  <input
                    type="number"
                    step="0.05"
                    aria-label="Scale X"
                    value={transform.scaleX}
                    onChange={(e) => handleScaleChange(parseFloat(e.target.value) || 1)}
                    className="w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none"
                  />
                </label>
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-emerald-400 font-semibold mr-1">Y</span>
                  <input
                    type="number"
                    step="0.05"
                    aria-label="Scale Y"
                    value={transform.scaleY}
                    onChange={(e) => setTransform(p => ({ ...p, scaleY: parseFloat(e.target.value) || 1 }))}
                    disabled={transform.lockScale}
                    className={`w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none ${transform.lockScale ? 'opacity-60' : ''}`}
                  />
                </label>
                <label className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] focus-within:border-[hsl(var(--ring))]">
                  <span className="text-sky-400 font-semibold mr-1">Z</span>
                  <input
                    type="number"
                    step="0.05"
                    aria-label="Scale Z"
                    value={transform.scaleZ}
                    onChange={(e) => setTransform(p => ({ ...p, scaleZ: parseFloat(e.target.value) || 1 }))}
                    disabled={transform.lockScale}
                    className={`w-full min-w-0 bg-transparent text-[hsl(var(--foreground))] outline-none ${transform.lockScale ? 'opacity-60' : ''}`}
                  />
                </label>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 3. Geometry Statistics & Topology Health */}
        {(() => {
          const verticesDisplay = currentAsset.statsAvailable
            ? currentAsset.vertices.toLocaleString()
            : currentAsset.vertices > 0
              ? currentAsset.vertices.toLocaleString()
              : modelStats?.vertices?.toLocaleString() ?? '—';

          const facesDisplay = currentAsset.statsAvailable
            ? currentAsset.faces.toLocaleString()
            : currentAsset.faces > 0
              ? currentAsset.faces.toLocaleString()
              : modelStats?.triangles?.toLocaleString() ?? '—';

          const isManifold = currentAsset.isManifold ?? modelStats?.isManifold;
          const nonManifoldEdges = currentAsset.nonManifoldEdges ?? modelStats?.nonManifoldEdges;
          const manifoldStatus = isManifold === true || (isManifold === undefined && nonManifoldEdges === 0)
            ? 'manifold'
            : isManifold === false || (nonManifoldEdges !== undefined && nonManifoldEdges > 0)
              ? 'non-manifold'
              : 'unknown';
          const surfaceArea = currentAsset.surfaceArea ?? modelStats?.surfaceArea;
          const volume = currentAsset.volume ?? modelStats?.volume;
          const uvCharts = currentAsset.uvCharts ?? modelStats?.uvCharts;

          return (
            <Collapsible
              open={isSectionExpanded('geometry')}
              onOpenChange={() => handleManualToggle('geometry')}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden"
            >
              <div className="flex items-center justify-between px-2.5 py-2 hover:bg-[hsl(var(--surface-2))]/40 transition-colors gap-1.5">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 min-w-0 text-left select-none cursor-pointer group"
                  >
                    <HugeiconsIcon icon={Box} size={15} className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-semibold text-xs text-[hsl(var(--foreground))] truncate">
                      Geometry &amp; Topology
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto transition-transform duration-200 shrink-0 ${
                        isSectionExpanded('geometry') ? 'rotate-180 text-primary' : ''
                      }`}
                    />
                  </button>
                </CollapsibleTrigger>
                {manifoldStatus === 'manifold' ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 shrink-0">
                    <HugeiconsIcon icon={ShieldCheckIcon} size={12} className="w-3 h-3" />
                    Manifold
                  </span>
                ) : manifoldStatus === 'non-manifold' ? (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 shrink-0">
                    <HugeiconsIcon icon={TriangleAlertIcon} size={12} className="w-3 h-3" />
                    Non-Manifold{nonManifoldEdges !== undefined ? ` (${nonManifoldEdges})` : ''}
                  </span>
                ) : (
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono px-1.5 py-0.5 rounded border border-[hsl(var(--border))] shrink-0">
                    Pending
                  </span>
                )}
              </div>

              <CollapsibleContent className="px-2.5 pb-2.5 pt-2 space-y-2 border-t border-[hsl(var(--border))]/50">
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px] font-sans">Vertices</span>
                    <span className="font-semibold text-[hsl(var(--foreground))]">{verticesDisplay}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px] font-sans">Polygons</span>
                    <span className="font-semibold text-primary">{facesDisplay}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px] font-sans">Topology</span>
                    <span className="font-semibold text-[hsl(var(--foreground))] truncate block">{currentAsset.topology || 'Triangle'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px] font-sans">UV Islands</span>
                    <span className="font-semibold text-emerald-400">{uvCharts !== undefined ? `${uvCharts} charts` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px] font-sans">Surface Area</span>
                    <span className="font-semibold text-[hsl(var(--foreground))]">{surfaceArea !== undefined ? `${surfaceArea} m²` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px] font-sans">Volume</span>
                    <span className="font-semibold text-[hsl(var(--foreground))]">{volume !== undefined ? `${volume} m³` : '—'}</span>
                  </div>
                </div>

                {currentAsset.dimensions && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1.5 border-t border-[hsl(var(--border))]/50">
                    <span>Dimensions</span>
                    <span className="font-mono text-[11px] text-[hsl(var(--foreground))]">{currentAsset.dimensions.x} × {currentAsset.dimensions.y} × {currentAsset.dimensions.z} m</span>
                  </div>
                )}
                {currentAsset.fileSize && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1.5 border-t border-[hsl(var(--border))]/50">
                    <span>File Size</span>
                    <span className="font-mono text-[11px] text-[hsl(var(--foreground))]">{currentAsset.fileSize}</span>
                  </div>
                )}
                {currentAsset.componentCount !== undefined && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1.5 border-t border-[hsl(var(--border))]/50">
                    <span>Components</span>
                    <span className="font-mono text-[11px] text-[hsl(var(--foreground))]">{currentAsset.componentCount > 0 ? `${currentAsset.componentCount} parts` : '1 part'}</span>
                  </div>
                )}
                {currentAsset.meshDetails && (
                  <div className="flex items-center justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))] pt-1.5 border-t border-[hsl(var(--border))]/50">
                    <span className="shrink-0">Semantic Parts</span>
                    <span className="font-mono text-[11px] text-[hsl(var(--foreground))] truncate">
                      {Array.isArray((currentAsset.meshDetails as any)?.semantic_parts)
                        ? ((currentAsset.meshDetails as any).semantic_parts.length > 0
                          ? (currentAsset.meshDetails as any).semantic_parts.join(', ')
                          : 'Monolithic')
                        : typeof (currentAsset.meshDetails as any)?.semantic_parts === 'string'
                          ? (currentAsset.meshDetails as any).semantic_parts
                          : 'Unsupported'}
                    </span>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })()}

        {/* 4. Shading & Render Viewport Overrides */}
        <Collapsible
          open={isSectionExpanded('shading')}
          onOpenChange={() => handleManualToggle('shading')}
          className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden"
        >
          <div className="flex items-center justify-between px-2.5 py-2 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 flex-1 text-left select-none cursor-pointer group"
              >
                <HugeiconsIcon icon={EyeIcon} size={15} className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="font-semibold text-xs text-[hsl(var(--foreground))]">
                  Viewport Shading
                </span>
                <HugeiconsIcon
                  icon={ChevronDown}
                  size={14}
                  className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto transition-transform duration-200 ${
                    isSectionExpanded('shading') ? 'rotate-180 text-primary' : ''
                  }`}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="px-2.5 pb-2.5 pt-2 border-t border-[hsl(var(--border))]/50">
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'textured', label: 'PBR Lit', active: shadingMode === 'textured' },
                  { id: 'clay', label: 'Clay', active: shadingMode === 'clay' },
                  { id: 'matcap-gold', label: 'Gold', active: shadingMode === 'matcap-gold' },
                  { id: 'matcap-chrome', label: 'Chrome', active: shadingMode === 'matcap-chrome' },
                  { id: 'matcap-ceramic', label: 'Ceramic', active: shadingMode === 'matcap-ceramic' || shadingMode === 'matcap' },
                  { id: 'matcap-normal', label: 'Normals', active: shadingMode === 'matcap-normal' || shadingMode === 'normals' },
                  { id: 'wireframe', label: 'Wire Solo', active: shadingMode === 'wireframe' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setShadingMode(item.id)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors text-center cursor-pointer ${
                    item.active
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-semibold'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowWireframe(!showWireframe)}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors text-center cursor-pointer ${
                  showWireframe
                    ? 'bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/40'
                    : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                }`}
              >
                + Wire Overlay
              </button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 5. Export Format Section */}
        <Collapsible
          open={isSectionExpanded('export')}
          onOpenChange={() => handleManualToggle('export')}
          className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden"
        >
          <div className="flex items-center justify-between px-2.5 py-2 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 flex-1 text-left select-none cursor-pointer group"
              >
                <HugeiconsIcon icon={DownloadIcon} size={15} className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="font-semibold text-xs text-[hsl(var(--foreground))]">
                  Export Format
                </span>
                <HugeiconsIcon
                  icon={ChevronDown}
                  size={14}
                  className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto transition-transform duration-200 ${
                    isSectionExpanded('export') ? 'rotate-180 text-primary' : ''
                  }`}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="px-2.5 pb-2.5 pt-2 space-y-2 border-t border-[hsl(var(--border))]/50">
            <div className="grid grid-cols-3 gap-1.5">
              {(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setExportFormat(fmt)}
                  className={`py-1.5 rounded-lg uppercase font-mono font-semibold text-[11px] transition-colors cursor-pointer ${
                    exportFormat === fmt
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[hsl(var(--muted-foreground))]">Pipeline Target</span>
                <span className="font-mono text-primary font-semibold">{exportFormat.toUpperCase()}</span>
              </div>
              <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                {exportFormat === 'glb' && 'glTF 2.0 Binary with packed PBR textures.'}
                {exportFormat === 'gltf' && 'glTF 2.0 JSON with embedded base64 buffers.'}
                {exportFormat === 'fbx' && 'Autodesk FBX with skeleton and skin weights.'}
                {exportFormat === 'obj' && 'Wavefront OBJ polygonal geometry.'}
                {exportFormat === 'stl' && 'Watertight triangular mesh for 3D printing.'}
                {exportFormat === 'ply' && 'Polygon File Format for point/face data.'}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Single Pinned Bottom Export Action */}
      <div className="p-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <button
          id="btn-pinned-export-download"
          type="button"
          onClick={handleExportDownload}
          disabled={isExporting || !currentAsset}
          className="w-full h-9 rounded-xl bg-primary hover:bg-primary/90 text-[hsl(var(--primary-foreground))] font-bold text-xs flex items-center justify-center gap-2 transition-colors active:scale-[0.98] shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isExporting ? (
            <HugeiconsIcon icon={RefreshCw} size={16} className="w-4 h-4 animate-spin" />
          ) : exportSuccess ? (
            <HugeiconsIcon icon={CheckIcon} size={16} className="w-4 h-4 text-emerald-700" />
          ) : (
            <HugeiconsIcon icon={DownloadIcon} size={16} className="w-4 h-4" />
          )}
          <span>
            {isExporting ? 'Packing 3D Bundle...' : exportSuccess ? 'Export Saved!' : `Export ${exportFormat.toUpperCase()}`}
          </span>
        </button>
      </div>

    </div>
  );
};