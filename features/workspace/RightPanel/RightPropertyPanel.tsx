import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useWorkspace } from '../store/WorkspaceContext';
import { ShadingMode, ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';
import { downloadArtifact } from '../lib/artifactDownload';
import { triggerClientExport, type ClientSupportedExportFormat } from '../utils/clientExporters';
import { ModelComparisonViewer } from '../Viewport/ModelComparisonViewer';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  Cancel,
  CheckIcon,
  ChevronDown,
  DownloadIcon,
  EyeIcon,
  HexagonIcon,
  LayersIcon,
  Lock,
  MoveIcon,
  PaletteIcon,
  Plus,
  RefreshCw,
  Search01Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Unlock,
  ZapIcon,
} from '@hugeicons/core-free-icons';
import { useViewerStore } from '@/stores/useViewerStore';
import { useUIStore } from '@/stores/useUIStore';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { DynamicUVInspector } from '../dynamic/DynamicUVInspector';
import { DynamicSegmentationInspector } from '../dynamic/DynamicSegmentationInspector';
import { DynamicAnimationInspector } from '../dynamic/DynamicAnimationInspector';
import { DynamicRiggingInspector } from '../dynamic/DynamicRiggingInspector';
import { Grid3X3, Scissors, Film, Bone } from 'lucide-react';

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
    assets = []
  } = useWorkspace();

  const modelStats = useViewerStore((s) => s.modelStats);
  const activeModelObject = useViewerStore((s) => s.activeModelObject);

  // Accordion state persisted in UI store
  const rightPanelSections = useUIStore((s) => s.rightPanelSections);
  const setRightPanelSectionExpanded = useUIStore((s) => s.setRightPanelSectionExpanded);
  const toggleRightPanelSection = useUIStore((s) => s.toggleRightPanelSection);

  // Client-side text filter
  const [filterQuery, setFilterQuery] = useState('');
  const normalizedFilter = filterQuery.trim().toLowerCase();

  // Model comparison state
  const [selectedCompareAssetId, setSelectedCompareAssetId] = useState<string | null>(null);
  const [selectedLineageUrl, setSelectedLineageUrl] = useState<string | null>(null);
  const [selectedLineageLabel, setSelectedLineageLabel] = useState<string | null>(null);
  const [isComparePickerOpen, setIsComparePickerOpen] = useState(false);

  // Auto-expand section matching activeTool; manual toggle overrides auto behavior
  const manualOverridesRef = useRef<Set<string>>(new Set());
  const prevToolRef = useRef<string | null>(null);

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

  const isSectionVisible = (keywords: string[]) => {
    if (!normalizedFilter) return true;
    return keywords.some(
      (kw) => kw.toLowerCase().includes(normalizedFilter) || normalizedFilter.includes(kw.toLowerCase())
    );
  };

  const isSectionExpanded = (sectionId: string, keywords: string[]) => {
    if (normalizedFilter) {
      return isSectionVisible(keywords);
    }
    // Context section is ALWAYS expanded by default for tool inspectors
    if (sectionId === 'context') return true;
    // When inside a dedicated dynamic tool, collapse general mesh properties by default to keep the dynamic inspector front & center
    if (activeTool === 'rigging' || activeTool === 'segment' || activeTool === 'uv' || activeTool === 'animation') {
      return rightPanelSections?.[sectionId] ?? false;
    }
    return rightPanelSections?.[sectionId] ?? true;
  };

  const [exportFormat, setExportFormat] = useState<'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply'>('glb');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

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
    albedoColor: 'hsl(0, 0%, 100%)',
    roughness: 0.45,
    metallic: 0.15,
    normalStrength: 1.0,
    ambientOcclusion: 0.85,
    displacementScale: 0.05,
    normalFormat: 'OpenGL' as 'OpenGL' | 'DirectX',
    uvProjection: 'Smart UV (xatlas)'
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
    }
  };

  const handleExportDownload = async () => {
    if (!currentAsset) return;
    const sourceUrl =
      currentAsset.artifacts?.gameReadyFormats?.[exportFormat] ||
      (exportFormat === 'glb' ? currentAsset.artifacts?.gameReady : undefined) ||
      (exportFormat === 'glb' ? currentAsset.source?.localUrl || currentAsset.source?.viewUrl : undefined) ||
      (exportFormat === 'fbx' ? currentAsset.artifacts?.riggedFbx : undefined) ||
      (currentAsset.category === 'generation' && currentAsset.id
        ? `/api/v1/system/jobs/${currentAsset.id}/download?artifact_format=${exportFormat}`
        : undefined);

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
        setIsExporting(true);
        try {
          toast.info(`Generating ${exportFormat.toUpperCase()} in browser...`);
          await triggerClientExport(activeModelObject, exportFormat as ClientSupportedExportFormat, `${assetBaseName}.${exportFormat}`);
          setExportSuccess(true);
          toast.success(`${exportFormat.toUpperCase()} exported successfully!`);
          setTimeout(() => setExportSuccess(false), 3000);
        } catch (err: any) {
          console.error('Client export failed:', err);
          toast.error('Export failed', { description: err?.message || 'Failed to export model' });
        } finally {
          setIsExporting(false);
        }
        return;
      }

      toast.error('Export unavailable', {
        description: `${exportFormat.toUpperCase()} is not available for this asset yet.`,
      });
      return;
    }

    setIsExporting(true);
    try {
      await downloadArtifact(sourceUrl, `${assetBaseName}.${exportFormat}`, exportFormat);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      // If remote download fails, attempt client Three.js export fallback
      if (activeModelObject && exportFormat !== 'fbx') {
        try {
          toast.info(`Backend artifact unavailable. Generating ${exportFormat.toUpperCase()} from viewport...`);
          await triggerClientExport(activeModelObject, exportFormat as ClientSupportedExportFormat, `${assetBaseName}.${exportFormat}`);
          setExportSuccess(true);
          toast.success(`${exportFormat.toUpperCase()} exported from viewport!`);
          setTimeout(() => setExportSuccess(false), 3000);
          return;
        } catch (clientErr: any) {
          console.error('Fallback client export failed:', clientErr);
        }
      }
      console.error(error);
      const msg = error instanceof Error ? error.message : 'Export failed';
      toast.error('Export failed', { description: msg });
      setExportSuccess(false);
    } finally {
      setIsExporting(false);
    }
  };

  // Dedicated Dynamic Inspectors for specific tools — ONLY these show on their respective pages!
  if (activeTool === 'uv') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
              <Grid3X3 className="w-4 h-4 text-[#F9CF00]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-xs text-[hsl(var(--foreground))] uppercase tracking-wide">Smart UV Inspector</h2>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] block">Atlas Preview &amp; Quality Metrics</span>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[#F9CF00]/15 border border-[#F9CF00]/30 text-[#F9CF00] flex-shrink-0">
            Active
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicUVInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'segment') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
              <Scissors className="w-4 h-4 text-[#F9CF00]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-xs text-[hsl(var(--foreground))] uppercase tracking-wide">Segmentation Inspector</h2>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] block">Part Layers &amp; Assembly Tree</span>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[#F9CF00]/15 border border-[#F9CF00]/30 text-[#F9CF00] flex-shrink-0">
            Active
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicSegmentationInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'animation') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
              <Film className="w-4 h-4 text-[#F9CF00]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-xs text-[hsl(var(--foreground))] uppercase tracking-wide">Motion Inspector</h2>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] block">Playback Scrubber &amp; Diagnostics</span>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[#F9CF00]/15 border border-[#F9CF00]/30 text-[#F9CF00] flex-shrink-0">
            Active
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicAnimationInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'rigging') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
              <Bone className="w-4 h-4 text-[#F9CF00]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-xs text-[hsl(var(--foreground))] uppercase tracking-wide">Auto-Rigging & Armature</h2>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] block">Interactive Armature &amp; Joint Hierarchy</span>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[#F9CF00]/15 border border-[#F9CF00]/30 text-[#F9CF00] flex-shrink-0">
            Active
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <DynamicRiggingInspector />
        </div>
      </div>
    );
  }

  if (activeTool === 'remesh') {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
        <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
              <HugeiconsIcon icon={HexagonIcon} size={16} className="w-4 h-4 text-[#F9CF00]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-xs text-[hsl(var(--foreground))] uppercase tracking-wide">Quad Retopology Inspector</h2>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] block">Topology Flow &amp; Polygon Budget</span>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[#F9CF00]/15 border border-[#F9CF00]/30 text-[#F9CF00] flex-shrink-0">
            Active
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
          <div className="p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">FastMesh Variant</span>
              <span className="font-mono font-bold text-primary">{remeshSettings.variant}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Output Polygons</span>
              <span className="font-mono text-[hsl(var(--neon-blue))] uppercase font-bold">{remeshSettings.polyType}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Current Topology</span>
              <span className="font-mono text-[hsl(var(--neon-green))] font-bold">{currentAsset?.topology || 'Triangle'}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Face Count</span>
              <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset?.statsAvailable ? currentAsset.faces.toLocaleString() : (currentAsset?.faces ? currentAsset.faces.toLocaleString() : '—')}</span>
            </div>
            <div className="flex justify-between items-center text-xs border-t border-[hsl(var(--border))]/50 pt-2">
              <span className="text-[hsl(var(--muted-foreground))]">Vertex Count</span>
              <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset?.statsAvailable ? currentAsset.vertices.toLocaleString() : (currentAsset?.vertices ? currentAsset.vertices.toLocaleString() : '—')}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Wireframe & Shading Overrides
            </span>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowWireframe(!showWireframe)}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  showWireframe
                    ? 'bg-[hsl(var(--neon-green))]/20 text-[hsl(var(--neon-green))] border border-[hsl(var(--neon-green))]/40'
                    : 'bg-[hsl(var(--surface-1))] text-[hsl(var(--muted-foreground))] hover:text-white border border-[hsl(var(--border))]'
                }`}
              >
                <span>Wireframe Overlay</span>
              </button>
              <button
                type="button"
                onClick={() => setShadingMode(shadingMode === 'wireframe' ? 'clay' : 'wireframe')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  shadingMode === 'wireframe'
                    ? 'bg-primary text-black font-bold'
                    : 'bg-[hsl(var(--surface-1))] text-[hsl(var(--muted-foreground))] hover:text-white border border-[hsl(var(--border))]'
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
        <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
              <HugeiconsIcon icon={PaletteIcon} size={16} className="w-4 h-4 text-[#F9CF00]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-xs text-[hsl(var(--foreground))] uppercase tracking-wide">PBR Material Inspector</h2>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] block">Material Channels &amp; Texture Maps</span>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[#F9CF00]/15 border border-[#F9CF00]/30 text-[#F9CF00] flex-shrink-0">
            Active
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
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
        <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-3 shadow-inner">
          <HugeiconsIcon icon={Box} size={16} className="w-6 h-6 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-xs font-bold text-white tracking-wide">No Active 3D Asset</div>
        <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed max-w-[210px]">
          Generate a model or select one from the Assets tab to inspect geometry, PBR maps, and exports.
        </div>
      </div>
    );
  }

  // Keywords for filtering
  const transformKeywords = ['transform', 'position', 'rotation', 'scale', 'world space', 'euler', 'ratio', 'x', 'y', 'z'];
  const geometryKeywords = ['geometry', 'topology', 'manifold', 'watertight', 'vertices', 'polygons', 'faces', 'surface area', 'volume', 'uv charts', 'dimensions', 'components', 'semantic', 'details'];
  const contextKeywords = ['ai generator', 'pipeline', 'model engine', 'octree', 'diffusion', 'rmbg', 'cutout', 'generator'];
  const shadingKeywords = ['shading', 'viewport', 'pbr lit', 'clay', 'gold', 'chrome', 'ceramic', 'normals', 'wire solo', 'wireframe', 'overlay'];
  const comparisonKeywords = ['model comparison', 'comparison', 'compare', 'lineage', 'qa', 'score', 'delta'];
  const exportKeywords = ['quick export', 'export', 'download', 'format', 'glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'embed', 'draco', 'compression'];

  // QA score calculations for Model Comparison (never estimate client-side)
  const currentQAReport = (currentAsset.artifacts?.qaReport as any);
  const currentQA = (currentQAReport?.qa as any) || currentQAReport;
  const currentScore = typeof currentAsset.qaScore === 'number'
    ? currentAsset.qaScore
    : typeof currentQA?.score === 'number'
    ? currentQA.score
    : typeof currentQAReport?.score === 'number'
    ? currentQAReport.score
    : undefined;
  const currentTopology = currentQA?.subscores?.geometry_topology ?? currentQAReport?.subscores?.geometry_topology;
  const currentUV = currentQA?.subscores?.uv_material ?? currentQAReport?.subscores?.uv_material;
  const currentBudget = currentQA?.subscores?.platform ?? currentQAReport?.subscores?.platform;

  let compareScore: number | undefined;
  let compareTopology: number | undefined;
  let compareUV: number | undefined;
  let compareBudget: number | undefined;

  if (selectedCompareAssetId) {
    const compareAsset = assets.find((a: ModelAsset) => a.id === selectedCompareAssetId);
    if (compareAsset) {
      const compReport = (compareAsset.artifacts?.qaReport as any);
      const compQA = (compReport?.qa as any) || compReport;
      compareScore = typeof compareAsset.qaScore === 'number'
        ? compareAsset.qaScore
        : typeof compQA?.score === 'number'
        ? compQA.score
        : typeof compReport?.score === 'number'
        ? compReport.score
        : undefined;
      compareTopology = compQA?.subscores?.geometry_topology ?? compReport?.subscores?.geometry_topology;
      compareUV = compQA?.subscores?.uv_material ?? compReport?.subscores?.uv_material;
      compareBudget = compQA?.subscores?.platform ?? compReport?.subscores?.platform;
    }
  } else if (selectedLineageUrl) {
    const beforeQA = (currentQAReport?.before_postprocess?.qa as any) || (currentQAReport?.before_postprocess as any) || (currentQAReport?.before as any);
    if (beforeQA) {
      compareScore = beforeQA.score;
      compareTopology = beforeQA.subscores?.geometry_topology;
      compareUV = beforeQA.subscores?.uv_material;
      compareBudget = beforeQA.subscores?.platform;
    }
  }

  const activeCompareTarget = selectedLineageUrl || selectedCompareAssetId;

  return (
    <div 
      id="panel-properties-inspector" 
      className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden"
    >
      {/* Header with Asset Meta */}
      <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] flex items-center justify-center text-primary flex-shrink-0">
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))] truncate">{currentAsset.name}</h2>
            <span className="text-xs text-[hsl(var(--muted-foreground))] block">Inspector & Properties</span>
          </div>
        </div>
        <span className="text-xs uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-primary flex-shrink-0">
          {currentAsset.format}
        </span>
      </div>

      {/* Client-side text filter */}
      <div className="px-2.5 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]/50">
        <div className="relative flex items-center">
          <HugeiconsIcon icon={Search01Icon} size={14} className="absolute left-2.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter properties..."
            className="w-full pl-8 pr-7 py-1 text-xs rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-primary transition-all font-mono"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2 text-[hsl(var(--muted-foreground))] hover:text-white"
            >
              <HugeiconsIcon icon={Cancel} size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-2.5 space-y-2.5">
        {/* 3. 3D AI Generator Pipeline (Shown exclusively on Model page) */}
        {activeTool === 'model' && isSectionVisible(contextKeywords) && (
          <Collapsible
            open={isSectionExpanded('context', contextKeywords)}
            onOpenChange={() => handleManualToggle('context')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    3D AI Generator Pipeline
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('context', contextKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-2 pt-1 border-t border-[hsl(var(--border))]/40">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-[hsl(var(--foreground))]">
                  <span>Model Engine</span>
                  <span className="font-mono text-primary">{generationSettings.aiModel}</span>
                </div>
                <div className="flex justify-between text-[hsl(var(--foreground))]">
                  <span>Octree Depth</span>
                  <span className="font-mono text-[hsl(var(--foreground))]">Workflow-defined</span>
                </div>
                <div className="flex justify-between text-[hsl(var(--foreground))]">
                  <span>Diffusion Steps</span>
                  <span className="font-mono text-[hsl(var(--foreground))]">Workflow-defined</span>
                </div>
                <div className="flex justify-between text-[hsl(var(--foreground))]">
                  <span>Cutout RMBG</span>
                  <span className="font-mono text-[hsl(var(--neon-green))]">{generationSettings.removeBackground ? 'Requested' : 'Off'}</span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {/* 1. Object Transform Section */}
        {isSectionVisible(transformKeywords) && (
          <Collapsible
            open={isSectionExpanded('transform', transformKeywords)}
            onOpenChange={() => handleManualToggle('transform')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={MoveIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Object Transform
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('transform', transformKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetTransform();
                }}
                className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))] transition-colors"
              >
                <SimpleTooltip label="Reset Transform">
                  <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" />
                </SimpleTooltip>
              </button>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-2 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* Position (m) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Position (m)</span>
                  <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">World Space</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--destructive))] font-bold mr-1 text-xs">X</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={transform.posX} 
                      onChange={(e) => setTransform(p => ({ ...p, posX: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-green))] font-bold mr-1 text-xs">Y</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={transform.posY} 
                      onChange={(e) => setTransform(p => ({ ...p, posY: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-blue))] font-bold mr-1 text-xs">Z</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={transform.posZ} 
                      onChange={(e) => setTransform(p => ({ ...p, posZ: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                </div>
              </div>

              {/* Rotation (°) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Rotation (Euler °)</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--destructive))] font-bold mr-1 text-xs">X</span>
                    <input 
                      type="number" 
                      value={transform.rotX} 
                      onChange={(e) => setTransform(p => ({ ...p, rotX: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-green))] font-bold mr-1 text-xs">Y</span>
                    <input 
                      type="number" 
                      value={transform.rotY} 
                      onChange={(e) => setTransform(p => ({ ...p, rotY: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-blue))] font-bold mr-1 text-xs">Z</span>
                    <input 
                      type="number" 
                      value={transform.rotZ} 
                      onChange={(e) => setTransform(p => ({ ...p, rotZ: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                </div>
              </div>

              {/* Scale */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Scale Ratio</span>
                  <button
                    onClick={() => setTransform(p => ({ ...p, lockScale: !p.lockScale }))}
                    className="flex items-center gap-1 text-primary hover:underline text-[11px]"
                  >
                    {transform.lockScale ? <HugeiconsIcon icon={Lock} size={16} className="w-3 h-3" /> : <HugeiconsIcon icon={Unlock} size={16} className="w-3 h-3" />}
                    <span>{transform.lockScale ? 'Uniform Locked' : 'Independent'}</span>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--destructive))] font-bold mr-1 text-xs">X</span>
                    <input 
                      type="number" 
                      step="0.05" 
                      value={transform.scaleX} 
                      onChange={(e) => handleScaleChange(parseFloat(e.target.value) || 1)}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-green))] font-bold mr-1 text-xs">Y</span>
                    <input 
                      type="number" 
                      step="0.05" 
                      value={transform.scaleY} 
                      onChange={(e) => setTransform(p => ({ ...p, scaleY: parseFloat(e.target.value) || 1 }))}
                      disabled={transform.lockScale}
                      className={`w-full bg-transparent text-[hsl(var(--foreground))] outline-none ${transform.lockScale ? 'opacity-70' : ''}`} 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-blue))] font-bold mr-1 text-xs">Z</span>
                    <input 
                      type="number" 
                      step="0.05" 
                      value={transform.scaleZ} 
                      onChange={(e) => setTransform(p => ({ ...p, scaleZ: parseFloat(e.target.value) || 1 }))}
                      disabled={transform.lockScale}
                      className={`w-full bg-transparent text-[hsl(var(--foreground))] outline-none ${transform.lockScale ? 'opacity-70' : ''}`} 
                    />
                  </div>
                </div>
              </div>

              {/* Reset to Identity Transform */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleResetTransform}
                  className="h-7 px-2.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={RefreshCw} size={12} className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
                  <span>Reset Transform</span>
                </button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 2. Geometry Statistics & Topology Health */}
        {isSectionVisible(geometryKeywords) && (() => {
          const verticesDisplay = currentAsset?.vertices
            ? currentAsset.vertices.toLocaleString()
            : modelStats?.vertices
            ? modelStats.vertices.toLocaleString()
            : '—';

          const facesDisplay = currentAsset?.faces
            ? currentAsset.faces.toLocaleString()
            : modelStats?.triangles
            ? modelStats.triangles.toLocaleString()
            : '—';

          const isManifold = currentAsset?.isManifold ?? modelStats?.isManifold ?? true;
          const nonManifoldEdges = currentAsset?.nonManifoldEdges ?? modelStats?.nonManifoldEdges ?? 0;
          const surfaceArea = currentAsset?.surfaceArea ?? modelStats?.surfaceArea;
          const volume = currentAsset?.volume ?? modelStats?.volume;
          const uvCharts = currentAsset?.uvCharts ?? modelStats?.uvCharts;

          return (
            <Collapsible
              open={isSectionExpanded('geometry', geometryKeywords)}
              onOpenChange={() => handleManualToggle('geometry')}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
            >
              <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                  >
                    <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                      Geometry & Topology
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                        isSectionExpanded('geometry', geometryKeywords) ? 'rotate-180 text-primary' : ''
                      }`}
                    />
                  </button>
                </CollapsibleTrigger>
                {isManifold && nonManifoldEdges === 0 ? (
                  <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--neon-green))] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--neon-green))]/10 border border-[hsl(var(--neon-green))]/30">
                    <HugeiconsIcon icon={ShieldCheckIcon} size={16} className="w-3 h-3" />
                    Manifold
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                    <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-3 h-3" />
                    Non-Manifold ({nonManifoldEdges})
                  </span>
                )}
              </div>

              <CollapsibleContent className="px-2.5 pb-3 space-y-2.5 pt-1 border-t border-[hsl(var(--border))]/40">
                {/* Counts & Flow */}
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Vertices</span>
                    <span className="font-bold text-[hsl(var(--foreground))]">{verticesDisplay}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Polygons</span>
                    <span className="font-bold text-primary">{facesDisplay}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Topology</span>
                    <span className="font-bold text-[hsl(var(--neon-blue))] truncate block">{currentAsset.topology || 'Triangle'}</span>
                  </div>
                </div>

                {/* Physical Telemetry: Surface Area, Volume, UV Charts */}
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Surface Area</span>
                    <span className="font-bold text-[hsl(var(--foreground))]">{surfaceArea !== undefined ? `${surfaceArea} m²` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Volume</span>
                    <span className="font-bold text-primary">{volume !== undefined ? `${volume} m³` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">UV Islands</span>
                    <span className="font-bold text-[hsl(var(--neon-green))]">{uvCharts !== undefined && uvCharts > 0 ? `${uvCharts} charts` : '1 chart'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                  <span>UV Channels</span>
                  <span className="font-mono text-[hsl(var(--foreground))]">2 (UV0: Diffuse, UV1: Lightmap)</span>
                </div>
                {currentAsset.dimensions && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                    <span>Dimensions (X×Y×Z)</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset.dimensions.x} × {currentAsset.dimensions.y} × {currentAsset.dimensions.z} m</span>
                  </div>
                )}
                {currentAsset.componentCount !== undefined && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                    <span>Components / Parts</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset.componentCount > 0 ? `${currentAsset.componentCount} connected parts` : '1 part'}</span>
                  </div>
                )}
                {currentAsset.meshDetails && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                    <span>Semantic Details</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">
                      {Array.isArray((currentAsset.meshDetails as any)?.semantic_parts)
                        ? ((currentAsset.meshDetails as any).semantic_parts.length > 0
                          ? (currentAsset.meshDetails as any).semantic_parts.join(', ')
                          : 'Not analyzed / monolithic')
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
        {isSectionVisible(shadingKeywords) && (
          <Collapsible
            open={isSectionExpanded('shading', shadingKeywords)}
            onOpenChange={() => handleManualToggle('shading')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={EyeIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Viewport Shading
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('shading', shadingKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 pt-1 border-t border-[hsl(var(--border))]/40">
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => setShadingMode('textured')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'textured'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  PBR Lit
                </button>

                <button
                  onClick={() => setShadingMode('clay')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'clay'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Clay
                </button>

                <button
                  onClick={() => setShadingMode('matcap-gold')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-gold'
                      ? 'bg-amber-400 text-black font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Gold
                </button>

                <button
                  onClick={() => setShadingMode('matcap-chrome')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-chrome'
                      ? 'bg-zinc-200 text-black font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Chrome
                </button>

                <button
                  onClick={() => setShadingMode('matcap-ceramic')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-ceramic' || shadingMode === 'matcap'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Ceramic
                </button>

                <button
                  onClick={() => setShadingMode('matcap-normal')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-normal' || shadingMode === 'normals'
                      ? 'bg-sky-400 text-black font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Normals
                </button>

                <button
                  onClick={() => setShadingMode('wireframe')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'wireframe'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Wire Solo
                </button>

                <button
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    showWireframe
                      ? 'bg-[hsl(var(--neon-green))]/20 text-[hsl(var(--neon-green))] font-bold border border-[hsl(var(--neon-green))]/40'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  + Overlay
                </button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 5. Model Comparison Viewer (UX-02) */}
        {currentAsset && isSectionVisible(comparisonKeywords) && (
          <Collapsible
            open={isSectionExpanded('modelComparison', comparisonKeywords)}
            onOpenChange={() => handleManualToggle('modelComparison')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={ZapIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Model Comparison Viewer
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('modelComparison', comparisonKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-3 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* Target Picker Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {activeCompareTarget ? (
                  <div className="flex items-center justify-between w-full p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-xs font-mono truncate text-[hsl(var(--foreground))]">
                      vs {selectedLineageLabel || assets.find((a: ModelAsset) => a.id === selectedCompareAssetId)?.name || 'Comparison Target'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompareAssetId(null);
                        setSelectedLineageUrl(null);
                        setSelectedLineageLabel(null);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[hsl(var(--surface-3))] hover:bg-[hsl(var(--surface-4))] text-zinc-300 hover:text-white transition-all text-[11px]"
                    >
                      <span>Clear</span>
                      <HugeiconsIcon icon={Cancel} size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 w-full">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsComparePickerOpen(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-zinc-200 hover:text-white transition-all font-mono text-xs cursor-pointer"
                      >
                        <HugeiconsIcon icon={Plus} size={14} className="text-primary" />
                        <span>Select Mesh to Compare</span>
                      </button>
                    </div>

                    {/* Quick Lineage Comparison Options (Master vs Game-Ready / LOD) */}
                    {Boolean(currentAsset.artifacts?.source && currentAsset.artifacts?.source !== currentAsset.artifacts?.gameReady) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLineageUrl(currentAsset.artifacts!.source!);
                          setSelectedCompareAssetId(null);
                          setSelectedLineageLabel('Source Master (Raw)');
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-md bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-[11px] text-[hsl(var(--muted-foreground))] hover:text-white transition-colors"
                      >
                        <span>Compare with Source Master</span>
                      </button>
                    )}

                    {Boolean(currentAsset.artifacts?.lods && currentAsset.artifacts.lods.length > 0) && (
                      <div className="flex gap-1.5">
                        {currentAsset.artifacts!.lods!.map((lodUrl, idx) => {
                          const match = lodUrl.match(/lod(\d+)/i);
                          const label = match ? `LOD ${match[1]}` : `LOD ${idx}`;
                          return (
                            <button
                              key={lodUrl}
                              type="button"
                              onClick={() => {
                                setSelectedLineageUrl(lodUrl);
                                setSelectedCompareAssetId(null);
                                setSelectedLineageLabel(label);
                              }}
                              className="flex-1 py-1 px-1.5 rounded-md bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-[10px] font-mono text-[hsl(var(--muted-foreground))] hover:text-white transition-colors"
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Surface Real QA Score Delta and Sub-scores (Topology/UV/Budget) */}
              {activeCompareTarget && (
                <div>
                  {typeof currentScore === 'number' && typeof compareScore === 'number' ? (
                    <div className="p-2.5 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-[hsl(var(--foreground))]">Objective QA Delta</span>
                        {(() => {
                          const delta = compareScore - currentScore;
                          return (
                            <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded border ${
                              delta > 0
                                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                                : delta < 0
                                ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                                : 'text-sky-400 bg-sky-500/10 border-sky-500/30'
                            }`}>
                              {delta > 0 ? `+${delta}` : delta} pts ({currentScore} → {compareScore})
                            </span>
                          );
                        })()}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                        <div className="p-1.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))]">
                          <span className="text-[hsl(var(--muted-foreground))] block">Topology</span>
                          <span className="font-bold text-[hsl(var(--foreground))]">
                            {typeof currentTopology === 'number' && typeof compareTopology === 'number'
                              ? `${(compareTopology - currentTopology >= 0 ? '+' : '') + (compareTopology - currentTopology).toFixed(1)}`
                              : '—'}
                          </span>
                        </div>
                        <div className="p-1.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))]">
                          <span className="text-[hsl(var(--muted-foreground))] block">UV & Mat</span>
                          <span className="font-bold text-[hsl(var(--foreground))]">
                            {typeof currentUV === 'number' && typeof compareUV === 'number'
                              ? `${(compareUV - currentUV >= 0 ? '+' : '') + (compareUV - currentUV).toFixed(1)}`
                              : '—'}
                          </span>
                        </div>
                        <div className="p-1.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))]">
                          <span className="text-[hsl(var(--muted-foreground))] block">Budget</span>
                          <span className="font-bold text-[hsl(var(--foreground))]">
                            {typeof currentBudget === 'number' && typeof compareBudget === 'number'
                              ? `${(compareBudget - currentBudget >= 0 ? '+' : '') + (compareBudget - currentBudget).toFixed(1)}`
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] italic px-1">
                      Backend QA diagnostic data not available for comparison target.
                    </div>
                  )}
                </div>
              )}

              <ModelComparisonViewer 
                className="w-full h-full min-h-[200px]" 
                showControls={true} 
                modelIds={activeCompareTarget ? [currentAsset.id, activeCompareTarget] : []} 
              />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 7. Production Export Section */}
        {isSectionVisible(exportKeywords) && (
          <Collapsible
            open={isSectionExpanded('export', exportKeywords)}
            onOpenChange={() => handleManualToggle('export')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={DownloadIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Quick Export Asset
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('export', exportKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-3 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* Formats Grid */}
              <div className="grid grid-cols-6 gap-1">
                {(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`py-1.5 rounded-lg uppercase font-mono font-bold text-xs transition-colors ${
                      exportFormat === fmt
                        ? 'bg-primary text-[hsl(var(--primary-foreground))]'
                        : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>

              {/* Target Format Specification & Pipeline Info */}
              <div className="p-2.5 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[hsl(var(--muted-foreground))]">Pipeline Target</span>
                  <span className="font-mono text-primary font-bold">{exportFormat.toUpperCase()}</span>
                </div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                  {exportFormat === 'glb' && 'glTF 2.0 Binary: Standard real-time 3D delivery with packed PBR textures.'}
                  {exportFormat === 'gltf' && 'glTF 2.0 Embedded: Human-readable JSON wrapper with embedded base64 buffers.'}
                  {exportFormat === 'fbx' && 'Autodesk FBX: Preserves skeletal bones, joint hierarchy, and skin weights.'}
                  {exportFormat === 'obj' && 'Wavefront OBJ: Universally compatible polygonal geometry definition.'}
                  {exportFormat === 'stl' && 'Standard Tessellation: Watertight surface triangular mesh for 3D printing.'}
                  {exportFormat === 'ply' && 'Polygon File Format: Point and face coordinates for scanners and CAD suites.'}
                </div>
              </div>

              {/* Download Button */}
              <button
                id="btn-export-download"
                onClick={handleExportDownload}
                disabled={isExporting}
                className="w-full h-8 rounded-xl bg-[hsl(var(--surface-3))] hover:bg-[hsl(var(--surface-4))] border border-[hsl(var(--border))] text-primary font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-md cursor-pointer"
              >
                {isExporting ? (
                  <HugeiconsIcon icon={RefreshCw} size={16} className="w-4 h-4 animate-spin text-primary" />
                ) : exportSuccess ? (
                  <HugeiconsIcon icon={CheckIcon} size={16} className="w-4 h-4 text-[hsl(var(--neon-green))]"/>
                ) : (
                  <HugeiconsIcon icon={DownloadIcon} size={16} className="w-4 h-4 text-primary" />
                )}
                <span>
                  {isExporting ? 'Packing 3D Bundle...' : exportSuccess ? 'Export Saved!' : `Download ${exportFormat.toUpperCase()}`}
                </span>
              </button>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

    </div>
  );
};