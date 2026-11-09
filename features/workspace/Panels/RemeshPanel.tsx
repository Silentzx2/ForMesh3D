'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace } from '../store/WorkspaceContext';
import type { ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import {
  Sparkles,
  RefreshCw,
  Box,
  Image as ImageIcon,
  RotateCw,
  Lightbulb,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit2,
  Cpu,
  Layers,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  TriangleAlertIcon,
  Cancel,
  HelpCircleIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import { EngineModeSelector } from './EngineModeSelector';
import type { EngineMode } from '../services/meshProcessingBridge';

// ==========================================
// 1. Quality Metrics & QualityBadge Export
// ==========================================
export interface QualityMetrics {
  triangles: number;
  nonManifoldEdges: number;
  holes: number;
  featureEdgeRetention: number | null;
  warnings: string[];
  passedGate: boolean;
  status: 'Sharp' | 'Clean' | 'Needs Review';
}

export function computeQualityMetrics(
  asset?: ModelAsset | null,
  rawResult?: Record<string, any> | null
): QualityMetrics {
  const qaReport = (
    asset?.artifacts?.qaReport ||
    (asset as any)?.qa_report ||
    (asset as any)?.quality_trace?.game_ready?.qa ||
    rawResult?.qa_report ||
    rawResult?.quality_report ||
    rawResult?.artifacts?.qaReport
  ) as Record<string, any> | undefined;

  const afterMetrics = qaReport?.after_postprocess?.metrics || qaReport?.metrics || rawResult?.metrics || {};
  const masterToDeriv = qaReport?.master_to_derivative || rawResult?.master_to_derivative || {};
  const meshDetails = ((asset?.meshDetails || rawResult?.mesh_details) || {}) as Record<string, any>;

  const triangles = Number(
    asset?.triangles ||
    asset?.faces ||
    afterMetrics.triangle_count ||
    afterMetrics.triangles ||
    meshDetails.triangle_count ||
    meshDetails.triangles ||
    rawResult?.triangle_count ||
    0
  );

  const nonManifoldEdges = Number(
    asset?.nonManifoldEdges ??
    afterMetrics.non_manifold_edges ??
    meshDetails.non_manifold_edges ??
    rawResult?.non_manifold_edges ??
    (asset?.isManifold === false ? 1 : 0)
  );

  const holes = Number(
    afterMetrics.hole_count ??
    afterMetrics.holes ??
    meshDetails.hole_count ??
    meshDetails.holes ??
    rawResult?.hole_count ??
    0
  );

  const rawRetention =
    masterToDeriv.feature_edge_retention ??
    afterMetrics.feature_edge_retention ??
    qaReport?.feature_edge_retention ??
    meshDetails.feature_edge_retention ??
    rawResult?.feature_edge_retention;

  const featureEdgeRetention = (rawRetention !== undefined && rawRetention !== null && !isNaN(Number(rawRetention)))
    ? Number(rawRetention)
    : null;

  const warnings: string[] = [];
  if (Array.isArray(asset?.qaWarnings)) warnings.push(...asset!.qaWarnings);
  if (Array.isArray(asset?.degradedReasons)) warnings.push(...asset!.degradedReasons);
  if (Array.isArray(qaReport?.warnings)) warnings.push(...qaReport!.warnings);
  if (Array.isArray(rawResult?.warnings)) warnings.push(...rawResult!.warnings);
  if (Array.isArray(rawResult?.degraded_reasons)) warnings.push(...rawResult!.degraded_reasons);

  const topoGate = qaReport?.topology_gate || rawResult?.topology_gate;
  const qualGate = qaReport?.quality_gate || masterToDeriv.quality_gate || rawResult?.quality_gate;
  const gateFailed = (topoGate && topoGate.passed_clean === false) || (qualGate && qualGate.passed === false);
  const passedGate = !gateFailed && asset?.qaStatus !== 'fail';

  let status: 'Sharp' | 'Clean' | 'Needs Review';
  const backendTier = asset?.qualityTier || rawResult?.quality_tier || qaReport?.quality_tier || (rawResult?.quality_trace as any)?.quality_tier;
  if (backendTier && (String(backendTier).toLowerCase() === 'sharp' || String(backendTier).toLowerCase() === 'clean')) {
    status = String(backendTier).toLowerCase() === 'sharp' ? 'Sharp' : 'Clean';
  } else if (
    asset?.productionStatus === 'degraded' ||
    asset?.qaStatus === 'fail' ||
    asset?.qaStatus === 'warn' ||
    warnings.length > 0 ||
    gateFailed ||
    nonManifoldEdges > 0 ||
    holes > 0
  ) {
    status = 'Needs Review';
  } else if (featureEdgeRetention !== null && featureEdgeRetention >= 0.85) {
    status = 'Sharp';
  } else {
    status = 'Clean';
  }

  return {
    triangles,
    nonManifoldEdges,
    holes,
    featureEdgeRetention,
    warnings,
    passedGate,
    status,
  };
}

export interface QualityBadgeProps {
  asset?: ModelAsset | null;
  rawResult?: Record<string, any> | null;
  metrics?: Partial<QualityMetrics>;
  className?: string;
  size?: 'sm' | 'md';
}

export const QualityBadge: React.FC<QualityBadgeProps> = React.memo(({
  asset,
  rawResult,
  metrics: customMetrics,
  className = '',
  size = 'md',
}) => {
  const computed = useMemo(() => {
    const base = computeQualityMetrics(asset, rawResult);
    return { ...base, ...customMetrics };
  }, [asset, rawResult, customMetrics]);

  const { status, triangles, nonManifoldEdges, holes, featureEdgeRetention, warnings } = computed;

  const badgeConfig = {
    Sharp: {
      label: 'Sharp',
      icon: SparklesIcon,
      style: 'bg-[#F9CF00]/15 text-[#F9CF00] border-[#F9CF00]/30 shadow-[0_0_8px_rgba(249,207,0,0.15)]',
      dotStyle: 'bg-[#F9CF00]',
    },
    Clean: {
      label: 'Clean',
      icon: CheckIcon,
      style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(52,211,153,0.15)]',
      dotStyle: 'bg-emerald-400',
    },
    'Needs Review': {
      label: 'Needs Review',
      icon: TriangleAlertIcon,
      style: 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_8px_rgba(251,191,36,0.15)]',
      dotStyle: 'bg-amber-400',
    },
  }[status];

  const retentionDisplay = featureEdgeRetention !== null
    ? `${(featureEdgeRetention <= 1 ? featureEdgeRetention * 100 : featureEdgeRetention).toFixed(1)}%`
    : '100.0%';

  const tooltipContent = (
    <div className="space-y-1.5 text-left py-1 px-0.5 text-[9.5px]">
      <div className="font-bold border-b border-white/10 pb-1 flex items-center justify-between gap-3">
        <span className="text-white">Mesh Quality Report</span>
        <span className={`px-1.5 py-0.2 rounded text-[8px] font-mono font-bold ${badgeConfig.style}`}>
          {status}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Triangles</span>
          <span className="font-mono text-white font-bold">{triangles.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Non-Manifold Edges</span>
          <span className={`font-mono font-bold ${nonManifoldEdges > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {nonManifoldEdges}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Holes</span>
          <span className={`font-mono font-bold ${holes > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {holes}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-zinc-300">
          <span>Feature Edge Retention</span>
          <span className="font-mono text-[#F9CF00] font-bold">{retentionDisplay}</span>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="pt-1 border-t border-white/10 text-[8px] text-amber-300/90 leading-tight">
          ⚠ {warnings[0]}
        </div>
      )}
    </div>
  );

  return (
    <SimpleTooltip label={tooltipContent} side="top">
      <span
        data-testid="quality-badge"
        className={`inline-flex items-center gap-1 font-bold rounded-md border tracking-wider transition-all cursor-help ${
          size === 'sm' ? 'px-1.5 py-0.2 text-[8px]' : 'px-2 py-0.5 text-[9.5px]'
        } ${badgeConfig.style} ${className}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${badgeConfig.dotStyle}`} />
        <HugeiconsIcon icon={badgeConfig.icon} size={size === 'sm' ? 11 : 13} className="stroke-[2.5]" />
        <span>{badgeConfig.label}</span>
      </span>
    </SimpleTooltip>
  );
});
QualityBadge.displayName = 'QualityBadge';

// ==========================================
// 2. Focused RemeshPanel (Retopo) Component
// ==========================================
export type GenerationIntent = 'game_ready' | 'cinematic' | 'mobile' | 'native';

export const RemeshPanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    cancelExecution,
    runRemeshGeneration,
    remeshSettings,
    setRemeshSettings,
    currentAsset,
    generationSettings,
    setGenerationSettings,
  } = useWorkspace();

  // Core Parameters on Main Panel
  const [engineMode, setEngineMode] = useState<EngineMode>('ai');
  const [polyType, setPolyType] = useState<'quad' | 'tri'>(remeshSettings.polyType || 'quad');
  const [targetPolycount, setTargetPolycount] = useState<number>(remeshSettings.targetPolycount || 50000);
  const [localPolycount, setLocalPolycount] = useState<number>(remeshSettings.targetPolycount || 50000);
  const [variant, setVariant] = useState<'V4K' | 'V1K'>(remeshSettings.variant || 'V4K');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  // Dynamic Side Flyout State
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [preserveEdges, setPreserveEdges] = useState(true);
  const [featureAngle, setFeatureAngle] = useState<30 | 45 | 60>(45);
  const [adaptiveDensity, setAdaptiveDensity] = useState(true);
  const [watertightHealing, setWatertightHealing] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'glb' | 'obj'>('glb');

  // Debounce ref for smooth non-blocking slider interaction
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Upload mesh and image support (1-to-1 with GeneratePanel)
  const { state: meshUploadState, upload: uploadMesh } = useMeshAssetUpload();
  const isMeshUploading = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meshInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [inputTab, setInputTab] = useState<'image' | 'mesh'>('image');
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const advancedTriggerRef = useRef<HTMLButtonElement>(null);
  const advancedFlyoutRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Synchronize image preview with workspace generationSettings
  useEffect(() => {
    if (generationSettings.image && generationSettings.image !== imagePreview) {
      setImagePreview(generationSettings.image);
    }
  }, [generationSettings.image, imagePreview]);

  // Update polycount with debounce so slider drags at 120fps without lag or glitch
  const updatePolycount = (val: number, immediate = false) => {
    const clamped = Math.max(5000, Math.min(200000, val));
    setLocalPolycount(clamped);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (immediate) {
      setTargetPolycount(clamped);
    } else {
      debounceTimerRef.current = setTimeout(() => {
        setTargetPolycount(clamped);
      }, 75);
    }
  };

  // Synchronize remesh parameters with workspace context
  useEffect(() => {
    setRemeshSettings((prev) => ({
      ...prev,
      polyType,
      targetPolycount,
      variant,
    }));

    setGenerationSettings((prev) => ({
      ...prev,
      targetPolycount,
      target_polycount: targetPolycount,
      polycount: targetPolycount,
      topologyMode: polyType === 'quad' ? 'quad' : 'triangle',
      quadTopology: polyType === 'quad',
    }));
  }, [polyType, targetPolycount, variant, setRemeshSettings, setGenerationSettings]);

  // Close flyout on outside click or Escape
  useEffect(() => {
    if (!isAdvancedOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        advancedFlyoutRef.current &&
        !advancedFlyoutRef.current.contains(target) &&
        advancedTriggerRef.current &&
        !advancedTriggerRef.current.contains(target)
      ) {
        setIsAdvancedOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAdvancedOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAdvancedOpen]);

  // Close model dropdown on outside click or Escape
  useEffect(() => {
    if (!isModelDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModelDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModelDropdownOpen]);

  // Retopology Models supported by backend FastMesh pipeline
  const availableModels = [
    {
      id: 'V4K',
      label: 'FastMesh V4K',
      tag: 'High Fidelity',
      note: 'Preserves fine edge details and feature curves',
      badge: '4K Base',
    },
    {
      id: 'V1K',
      label: 'FastMesh V1K',
      tag: 'Fast Base',
      note: 'Rapid lightweight quad retopology',
      badge: '1K Base',
    },
  ];

  const isMeshFile = (file: File) => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    return ['.glb', '.gltf', '.obj', '.fbx', '.stl', '.ply'].includes(ext);
  };

  const isImageFile = (file: File) => {
    return (
      file.type.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.svg'].some((ext) =>
        file.name.toLowerCase().endsWith(ext)
      )
    );
  };

  const detectDraggedFileType = (e: React.DragEvent): 'image' | 'mesh' | null => {
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (isMeshFile(file)) return 'mesh';
        if (isImageFile(file)) return 'image';
      }
    }
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          if (item.type.startsWith('image/')) return 'image';
          return 'mesh';
        }
      }
    }
    return null;
  };

  const processImageFile = (file: File) => {
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Image exceeds 20MB limit');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      setGenerationSettings((prev) => ({
        ...prev,
        image: result,
        imageName: file.name,
      }));
      setInputTab('image');
      toast.success(`Image selected: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleCardDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
    const detected = detectDraggedFileType(e);
    if (detected === 'mesh' && inputTab !== 'mesh') {
      setInputTab('mesh');
    } else if (detected === 'image' && inputTab !== 'image') {
      setInputTab('image');
    }
  };

  const handleCardDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    handleCardDragOver(e);
  };

  const handleCardDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related) || dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const file = e.target.files?.[0];
    if (file) {
      if (isMeshFile(file)) {
        setInputTab('mesh');
        await uploadMesh(file);
        toast.success(`3D Mesh loaded: ${file.name}`);
      } else {
        processImageFile(file);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMeshUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const file = e.target.files?.[0];
    if (file) {
      if (isImageFile(file)) {
        setInputTab('image');
        processImageFile(file);
      } else {
        setInputTab('mesh');
        await uploadMesh(file);
        toast.success(`3D Mesh loaded: ${file.name}`);
      }
    }
    if (meshInputRef.current) meshInputRef.current.value = '';
  };

  const handleUnifiedDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (isMeshFile(file)) {
      setInputTab('mesh');
      await uploadMesh(file);
      toast.success(`3D Mesh loaded: ${file.name}`);
    } else if (isImageFile(file)) {
      setInputTab('image');
      processImageFile(file);
    } else {
      if (inputTab === 'mesh') {
        await uploadMesh(file);
        toast.success(`3D Mesh loaded: ${file.name}`);
      } else {
        processImageFile(file);
      }
    }
  };

  const handleRemoveImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setImagePreview(null);
    setGenerationSettings((prev) => ({ ...prev, image: null, imageName: undefined }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRunRetopo = async () => {
    if (!currentAsset && !generationSettings.image) {
      toast.error('No active 3D model found. Please load or generate a mesh first.');
      return;
    }
    try {
      if (runRemeshGeneration) {
        await runRemeshGeneration({
          engineMode,
          variant,
          polyType,
          targetPolycount,
          preserveEdges,
          featureAngle,
          adaptiveDensity,
          watertightHealing,
          outputFormat,
        });
      }
    } catch (err: any) {
      toast.error(`Retopology failed: ${err.message || 'Unknown error'}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Retopology cancelled');
    } catch (err: any) {
      toast.error(`Cancel failed: ${err.message || 'Unknown error'}`);
    }
  };

  const getBudgetTierLabel = (count: number) => {
    if (count <= 10000) return 'Mobile';
    if (count <= 30000) return 'Low-Poly';
    if (count <= 75000) return 'Game Ready';
    return 'Cinematic';
  };

  // Calculate dynamic slider percentage for native Tripo gradient track fill
  const sliderPercentage = Math.min(100, Math.max(0, ((localPolycount - 5000) / (200000 - 5000)) * 100));

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden select-none">
      {/* 1. Header (Clean, Refined Studio Header) */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-[#F9CF00]/15 flex items-center justify-center text-[#F9CF00]">
            <RefreshCw className="w-3 h-3" />
          </div>
          <h2 className="text-xs font-bold text-zinc-100 tracking-normal">
            Retopology
          </h2>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] text-zinc-400 border border-white/[0.04]">
          Quads &amp; Tris
        </span>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col justify-between gap-2.5 min-h-0">
        <div className="space-y-2.5 flex-shrink-0">
          {/* 2. Studio Input Card (1-to-1 with GeneratePanel) */}
          <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/*,.glb,.gltf,.obj,.fbx,.stl,.ply"
          onChange={handleImageUpload}
          className="hidden"
        />
        <input
          ref={meshInputRef}
          type="file"
          accept=".glb,.gltf,.obj,.fbx,.stl,.ply,image/png,image/jpeg,image/webp,image/*"
          onChange={handleMeshUpload}
          className="hidden"
        />

        {/* 1-TO-1 EXACT UNTOUCHED UPLOAD CARD */}
        <div
          className={`p-2 rounded-2xl border transition-colors space-y-2 flex-shrink-0 ${
            isDragOver
              ? 'border-[#F9CF00] ring-1 ring-[#F9CF00]/40 bg-[#161726]'
              : 'border-white/[0.08] bg-[#12131d]'
          }`}
          onDragOver={handleCardDragOver}
          onDragEnter={handleCardDragEnter}
          onDragLeave={handleCardDragLeave}
          onDrop={handleUnifiedDrop}
        >
          {/* Top 2-Pill Mode Selector Bar: Image & 3D Mesh */}
          <div className="h-7 p-0.5 rounded-xl bg-[#0f0f1c] border border-white/[0.04] flex items-center gap-1">
            <button
              type="button"
              onClick={() => setInputTab('image')}
              onDragOver={(e) => {
                e.preventDefault();
                if (inputTab !== 'image') setInputTab('image');
              }}
              className={`flex-1 h-6 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                inputTab === 'image'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-300 hover:text-white'
              }`}
              title="Image to 3D"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Image</span>
            </button>
            <button
              type="button"
              onClick={() => setInputTab('mesh')}
              onDragOver={(e) => {
                e.preventDefault();
                if (inputTab !== 'mesh') setInputTab('mesh');
              }}
              className={`flex-1 h-6 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                inputTab === 'mesh'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-300 hover:text-white'
              }`}
              title="Upload 3D Mesh"
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Mesh</span>
            </button>
          </div>

          {/* Dropzone Container depending on Tab */}
          {inputTab === 'image' ? (
            imagePreview || generationSettings.image ? (
              <div className="relative w-full h-[195px] rounded-xl overflow-hidden bg-[#0c0d14] border border-white/[0.08] flex items-center justify-center group/preview">
                <img
                  src={imagePreview || generationSettings.image || ''}
                  alt="Uploaded concept"
                  className="max-h-[190px] w-auto max-w-full object-contain"
                />

                {/* Top-Right Trash Delete Button */}
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  aria-label="Remove uploaded image"
                  title="Remove image"
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/75 hover:bg-black/95 text-white flex items-center justify-center border border-white/10 shadow-lg cursor-pointer transition-all group-hover/preview:scale-105"
                >
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                </button>

                {/* Bottom Floating Replace Action */}
                <div className="absolute bottom-2.5 right-2.5 pointer-events-none">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Replace Image"
                    className="pointer-events-auto h-7 px-3 rounded-full bg-[#1b1c2b]/90 hover:bg-[#25273b] border border-white/10 text-white text-[10px] font-semibold flex items-center gap-1.5 shadow-lg cursor-pointer transition-all active:scale-95"
                  >
                    <Edit2 className="w-3 h-3 text-white" />
                    <span>Replace</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload concept image"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleCardDragOver}
                onDragEnter={handleCardDragEnter}
                onDragLeave={handleCardDragLeave}
                onDrop={handleUnifiedDrop}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`relative group w-full h-[200px] rounded-xl border border-dashed transition-all p-2 flex flex-col items-center justify-between cursor-pointer shadow-inner ${
                  isDragOver
                    ? 'border-[#F9CF00] bg-[#1c1d2c] ring-1 ring-[#F9CF00]/40'
                    : 'border-white/[0.12] hover:border-white/25 bg-[#0f1019]'
                } [background-image:linear-gradient(45deg,#18192A_25%,transparent_25%),linear-gradient(-45deg,#18192A_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18192A_75%),linear-gradient(-45deg,transparent_75%,#18192A_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0px]`}
              >
                {/* Top Right Tip Lightbulb */}
                <div className="w-full flex justify-end">
                  <span className="p-0.5 text-zinc-300 hover:text-[#F9CF00] transition-colors" title="Image prompt tips">
                    <Lightbulb className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Center Upload Prompt */}
                <div className="flex flex-col items-center text-center -mt-1">
                  <ImageIcon
                    className={`w-7 h-7 mb-1 transition-all ${
                      isDragOver ? 'text-[#F9CF00] scale-110' : 'text-zinc-200 group-hover:text-white group-hover:scale-105'
                    }`}
                  />
                  <span className="text-xs font-bold text-white tracking-wide">
                    {isDragOver ? 'Drop Image Here' : 'Upload Image'}
                  </span>
                  <span className="text-[10px] text-zinc-300 font-mono mt-0.5">JPG, PNG, WEBP · Size ≤ 20MB</span>
                </div>

                {/* Bottom Helper Note */}
                <div className="text-[10px] font-medium text-zinc-300 group-hover:text-white flex items-center gap-1 transition-colors pb-0.5">
                  <span>Front view or clean background recommended</span>
                </div>
              </div>
            )
          ) : (
            /* 3D Mesh Upload Tab View */
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload 3D Mesh"
              onClick={() => !isMeshUploading && meshInputRef.current?.click()}
              onDragOver={handleCardDragOver}
              onDragEnter={handleCardDragEnter}
              onDragLeave={handleCardDragLeave}
              onDrop={handleUnifiedDrop}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!isMeshUploading) meshInputRef.current?.click();
                }
              }}
              className={`relative group w-full h-[195px] rounded-xl border border-dashed transition-all p-3 flex flex-col items-center justify-center text-center cursor-pointer shadow-inner ${
                isDragOver
                  ? 'border-[#F9CF00] bg-[#1c1d2c] ring-1 ring-[#F9CF00]/40'
                  : 'border-white/[0.12] hover:border-white/25 bg-[#0f1019]'
              } [background-image:linear-gradient(45deg,#18192A_25%,transparent_25%),linear-gradient(-45deg,#18192A_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18192A_75%),linear-gradient(-45deg,transparent_75%,#18192A_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0px]`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform mb-2 ${
                  isDragOver
                    ? 'bg-[#F9CF00] text-black scale-110 shadow-[#F9CF00]/30'
                    : 'bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white shadow-indigo-500/25 group-hover:scale-105'
                }`}
              >
                <Box className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <span className="text-xs font-bold text-white tracking-wide">
                {isDragOver ? 'Drop 3D Mesh Here' : isMeshUploading ? 'Uploading Mesh...' : 'Upload 3D Mesh'}
              </span>
              <span className="text-[10px] text-zinc-400 mt-1 font-medium">
                OBJ, FBX, STL, GLB, PLY
              </span>
              <span className="text-[9px] text-zinc-500 font-mono mt-0.5">
                Size ≤ 150MB
              </span>
            </div>
          )}
        </div>

        {/* Live Upload Progress Bar with Real Speed & Remaining Time */}
        {isMeshUploading && (
          <div className="p-2 rounded-xl bg-black/40 border border-[#F9CF00]/30 space-y-1.5 animate-in fade-in">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                <div className="w-2.5 h-2.5 border-2 border-[#F9CF00] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-semibold text-white truncate text-[10px]">
                  {meshUploadState.fileName || 'Uploading 3D Mesh...'}
                </span>
              </div>
              <span className="font-mono font-bold text-[#F9CF00] text-[10px] flex-shrink-0">
                {meshUploadState.percent ?? 50}%
              </span>
            </div>

            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#F9CF00] to-[#FFE04D] transition-all duration-200 rounded-full"
                style={{ width: `${Math.max(4, Math.min(100, meshUploadState.percent ?? 50))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[9px] text-zinc-400 font-mono">
              <span>
                {meshUploadState.totalBytes
                  ? `${(meshUploadState.loadedBytes / 1048576).toFixed(1)} MB / ${(meshUploadState.totalBytes / 1048576).toFixed(1)} MB`
                  : `${(meshUploadState.loadedBytes / 1048576).toFixed(1)} MB`}
              </span>
              <span>
                {meshUploadState.totalBytes && meshUploadState.loadedBytes > 0
                  ? `~${Math.max(1, Math.ceil((meshUploadState.totalBytes - meshUploadState.loadedBytes) / 2097152))}s left`
                  : 'Transferring...'}
              </span>
            </div>
          </div>
        )}

          {/* Dual-Engine Mode Switcher: Neural AI vs Script Mode */}
          <EngineModeSelector
            mode={engineMode}
            onChange={setEngineMode}
            tool="remesh"
          />

          {/* 3. Topology Type: Pure Quads vs Triangles */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Topology Type
            </span>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setPolyType('quad')}
                className={`h-8 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  polyType === 'quad'
                    ? 'bg-white text-black shadow-sm font-extrabold'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <span>Pure Quads (Quad)</span>
              </button>
              <button
                type="button"
                onClick={() => setPolyType('tri')}
                className={`h-8 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  polyType === 'tri'
                    ? 'bg-white text-black shadow-sm font-extrabold'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <span>Triangles (Tris)</span>
              </button>
            </div>
          </div>

          {/* 4. Target Polycount: Tripo-Style Smooth Gradient Slider + Quick Presets */}
          <div className="space-y-2.5 p-3 rounded-2xl bg-[#12131d] border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Target Budget
              </span>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-sm font-bold text-white tracking-tight">
                  {localPolycount.toLocaleString()}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#F9CF00]/15 text-[#F9CF00] font-semibold border border-[#F9CF00]/30">
                  {getBudgetTierLabel(localPolycount)}
                </span>
              </div>
            </div>

            {/* Tripo-Style Ultra-Smooth Range Slider */}
            <div className="space-y-1.5 pt-1">
              <input
                type="range"
                min={5000}
                max={200000}
                step={1000}
                value={localPolycount}
                onChange={(e) => updatePolycount(parseInt(e.target.value, 10), false)}
                onPointerUp={() => updatePolycount(localPolycount, true)}
                style={{
                  background: `linear-gradient(to right, #F9CF00 0%, #F9CF00 ${sliderPercentage}%, rgba(255, 255, 255, 0.08) ${sliderPercentage}%, rgba(255, 255, 255, 0.08) 100%)`,
                }}
                className="w-full h-2 rounded-full appearance-none cursor-pointer focus:outline-none transition-all duration-75 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#F9CF00] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(249,207,0,0.7)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:active:scale-95 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#F9CF00] [&::-moz-range-thumb]:shadow-[0_0_10px_rgba(249,207,0,0.7)] [&::-moz-range-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-zinc-400 px-0.5">
                <span>5K</span>
                <span>50K</span>
                <span>100K</span>
                <span>200K</span>
              </div>
            </div>

            {/* Quick 1-Click Presets */}
            <div className="grid grid-cols-4 gap-1.5 pt-0.5">
              {[
                { label: '5K Mob', val: 5000 },
                { label: '20K Low', val: 20000 },
                { label: '50K Game', val: 50000 },
                { label: '100K Cine', val: 100000 },
              ].map((p) => (
                <button
                  key={p.val}
                  type="button"
                  onClick={() => updatePolycount(p.val, true)}
                  className={`h-7 rounded-lg text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                    localPolycount === p.val
                      ? 'bg-[#F9CF00] text-black shadow-sm font-extrabold'
                      : 'bg-black/30 text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-white/[0.04]'
                  }`}
                >
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 5. Advanced Retopo Settings Trigger Button (Opens Dynamic Side Flyout) */}
          {/* 5. Advanced Retopo Settings Trigger Button (Opens Dynamic Side Flyout) */}
          <div className="pt-0.5">
            <button
              ref={advancedTriggerRef}
              type="button"
              aria-expanded={isAdvancedOpen}
              onClick={() => setIsAdvancedOpen((prev) => !prev)}
              className={`w-full h-8.5 px-3 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer shadow-sm ${
                isAdvancedOpen
                  ? 'bg-[#1b1b2f] border-[#F9CF00] text-white ring-1 ring-[#F9CF00]/50'
                  : 'bg-[hsl(var(--surface-2))] border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] text-[hsl(var(--foreground))]'
              }`}
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#F9CF00]" />
                <span className="text-xs font-medium text-zinc-200">Advanced Settings</span>
              </div>
              <ChevronRight
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                  isAdvancedOpen ? 'rotate-90 text-[#F9CF00]' : ''
                }`}
              />
            </button>
          </div>

          {/* 6. Retopo Engine Dropdown (Only visible in AI Mode) */}
          {engineMode === 'ai' && (
            <div className="space-y-1.5 pt-1.5 border-t border-[hsl(var(--border))]" ref={modelDropdownRef}>
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                Retopo Engine
              </label>

              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isModelDropdownOpen}
                aria-label="Select Retopo Engine"
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                className="w-full h-8.5 px-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between text-left transition-all cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/25 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
                    <Cpu className="w-3 h-3 text-[#F9CF00]" />
                  </div>
                  <div className="min-w-0 flex items-baseline gap-1.5">
                    <p className="text-xs font-bold text-[hsl(var(--foreground))] truncate">
                      {availableModels.find((m) => m.id === variant)?.label || 'Select Engine'}
                    </p>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate opacity-80">
                      {availableModels.find((m) => m.id === variant)?.tag}
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={`w-3 h-3 text-[hsl(var(--muted-foreground))] flex-shrink-0 ml-1 transition-transform duration-200 ${
                    isModelDropdownOpen ? 'rotate-180 text-primary' : ''
                  }`}
                />
              </button>

              {/* Model Dropdown Menu */}
              {isModelDropdownOpen && (
                <div
                  role="listbox"
                  aria-label="Available Retopo Models"
                  className="absolute top-full mt-1 left-0 right-0 rounded-xl bg-[#1a1b26] border border-white/10 shadow-2xl p-1 z-40 space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
                >
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={variant === m.id}
                      onClick={() => {
                        setVariant(m.id as 'V4K' | 'V1K');
                        setIsModelDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer flex items-center justify-between ${
                        variant === m.id
                          ? 'bg-[#F9CF00] text-black font-bold shadow-sm'
                          : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="min-w-0 pr-1">
                        <span className="block font-semibold truncate leading-tight">{m.label}</span>
                        <span className="text-[10px] opacity-70 block truncate leading-tight">{m.note}</span>
                      </div>
                      <span className="text-[10px] font-mono opacity-75 flex-shrink-0">{m.badge}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dynamic Flying Side Advanced Retopo Settings Panel (Portal) */}
        {mounted && isAdvancedOpen && typeof document !== 'undefined' && createPortal(
          <div
            ref={advancedFlyoutRef}
            id="retopo-advanced-flyout"
            role="dialog"
            aria-label="Advanced Retopology Settings"
            className="fixed left-4 right-4 md:left-[290px] md:right-auto bottom-12 md:bottom-16 w-auto md:w-[280px] p-3 rounded-2xl bg-[#141421] border border-[#F9CF00]/40 shadow-[0_16px_50px_rgba(0,0,0,0.85)] space-y-2.5 animate-in fade-in zoom-in-95 duration-150 z-50 pointer-events-auto select-none"
          >
            {/* Flyout Header */}
            <div className="flex items-start justify-between pb-1.5 border-b border-white/[0.08]">
              <div>
                <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#F9CF00]" />
                  <span>Advanced Retopo Settings</span>
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Geometry flow &amp; edge preservation</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAdvancedOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close Advanced Retopo settings"
              >
                <HugeiconsIcon icon={Cancel} size={14} />
              </button>
            </div>

            {/* Parameter 1: Sharp Feature Edge Preservation */}
            <div className="flex items-center justify-between py-1">
              <div className="space-y-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#F9CF00]" />
                  <span className="text-xs text-zinc-200 font-medium">Preserve Sharp Edges</span>
                </div>
                <p className="text-[10px] text-zinc-400">Maintains creases on hard surfaces</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={preserveEdges}
                onClick={() => setPreserveEdges(!preserveEdges)}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                  preserveEdges ? 'bg-[#F9CF00]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    preserveEdges ? 'translate-x-3.5 !bg-black' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Parameter 2: Feature Angle Threshold */}
            {preserveEdges && (
              <div className="space-y-1.5 p-2 rounded-xl bg-black/30 border border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-300 font-medium">Feature Angle</span>
                  <span className="text-[10px] font-mono text-zinc-400">{featureAngle}° crease</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-0.5 rounded-xl bg-black/40 border border-white/[0.04]">
                  {[30, 45, 60].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => setFeatureAngle(deg as 30 | 45 | 60)}
                      className={`h-7 rounded-lg text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                        featureAngle === deg
                          ? 'bg-white text-black font-extrabold shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      <span>{deg}°</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Parameter 3: Adaptive Density Distribution */}
            <div className="flex items-center justify-between py-1 border-t border-white/[0.06] pt-2">
              <div className="space-y-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs text-zinc-200 font-medium">Adaptive Density</span>
                </div>
                <p className="text-[10px] text-zinc-400">More faces on curves, less on flats</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={adaptiveDensity}
                onClick={() => setAdaptiveDensity(!adaptiveDensity)}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                  adaptiveDensity ? 'bg-[#6366F1]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    adaptiveDensity ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Parameter 4: Watertight Mesh Healing */}
            <div className="flex items-center justify-between py-1 border-t border-white/[0.06] pt-2">
              <div className="space-y-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-zinc-200 font-medium">Watertight Healing</span>
                </div>
                <p className="text-[10px] text-zinc-400">Guarantees manifold closed mesh</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={watertightHealing}
                onClick={() => setWatertightHealing(!watertightHealing)}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                  watertightHealing ? 'bg-emerald-500' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    watertightHealing ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Parameter 5: Output Format */}
            <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
              <span className="text-xs text-zinc-300 font-medium block">Export Format</span>
              <div className="grid grid-cols-2 gap-1.5 p-0.5 rounded-xl bg-black/30 border border-white/[0.06]">
                {(['glb', 'obj'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setOutputFormat(fmt)}
                    className={`h-7 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${
                      outputFormat === fmt
                        ? 'bg-white text-black font-extrabold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <span>{fmt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* 5. Sticky Bottom Action CTA Button (NO model name in button or subtitle as requested) */}
      <div className="p-3 pt-2.5 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0 space-y-2">
        {isExecuting ? (
          <div className="p-3 rounded-2xl bg-[#141524] border border-[#F9CF00]/30 shadow-xl space-y-2.5 animate-in fade-in">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-3.5 h-3.5 border-2 border-[#F9CF00] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-semibold text-white truncate text-xs">
                  {executionStep || 'Retopologizing mesh...'}
                </span>
              </div>
              <span className="font-mono font-bold text-[#F9CF00] text-xs flex-shrink-0">
                {Math.round(executionProgress)}%
              </span>
            </div>

            <div className="w-full h-1.5 rounded-full bg-black/40 overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-[#F9CF00] to-[#FFE04D] transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(4, Math.min(100, Math.round(executionProgress)))}%` }}
              />
            </div>

            <button
              type="button"
              onClick={handleCancel}
              className="w-full py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 hover:text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.98]"
            >
              <HugeiconsIcon icon={Cancel} size={14} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={handleRunRetopo}
              disabled={!currentAsset && !generationSettings.image}
              className="w-full h-8 rounded-full bg-[#F9CF00] hover:bg-[#ffdb29] text-black font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#F9CF00]/15 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3.5 h-3.5 text-black" />
              <span>{engineMode === 'ai' ? 'Run Quad Retopology (FastMesh)' : 'Run Script Retopology (Trimesh / Python)'}</span>
            </button>
            <div className="flex items-center justify-between text-[10px] text-zinc-400 px-1 font-mono">
              <span>Target: {localPolycount.toLocaleString()} {polyType === 'quad' ? 'Quads' : 'Tris'}</span>
              <span>Clean Flow</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
