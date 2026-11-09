'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace } from '../store/WorkspaceContext';
import type { ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import {
  Scissors,
  Image as ImageIcon,
  Box,
  Lightbulb,
  SlidersHorizontal,
  ChevronRight,
  Trash2,
  Edit2,
  Layers,
  Palette,
  GitFork,
  FolderArchive,
} from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  TriangleAlertIcon,
  Cancel,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';

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
// 2. Mesh Part Segmentation Panel Component
// ==========================================
export const SegmentationPanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    cancelExecution,
    runSegmentation,
    currentAsset,
    generationSettings,
    setGenerationSettings,
  } = useWorkspace();

  const { state: meshUploadState, upload: uploadMesh } = useMeshAssetUpload();
  const isMeshUploading = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';

  // 1-to-1 Untouched Upload card refs & state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meshInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [inputTab, setInputTab] = useState<'image' | 'mesh'>('image');
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Core Segmentation parameter state
  const [numParts, setNumParts] = useState<number>(8);
  const [decompositionMode, setDecompositionMode] = useState<'semantic' | 'geometric'>('semantic');
  const [hierarchical, setHierarchical] = useState<boolean>(false);

  // Advanced Segmentation Settings Flyout state
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [minFaceThreshold, setMinFaceThreshold] = useState<number>(50);
  const [saveIndividualParts, setSaveIndividualParts] = useState<boolean>(true);
  const [outputFormat, setOutputFormat] = useState<'glb' | 'obj'>('glb');
  const [colorizePreview, setColorizePreview] = useState<boolean>(true);
  const [mounted, setMounted] = useState(false);

  const advancedTriggerRef = useRef<HTMLButtonElement>(null);
  const advancedFlyoutRef = useRef<HTMLDivElement>(null);

  // Keep imagePreview in sync with workspace generationSettings
  useEffect(() => {
    if (generationSettings.image && generationSettings.image !== imagePreview) {
      setImagePreview(generationSettings.image);
    }
  }, [generationSettings.image, imagePreview]);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Clear sticky drag glow on global window dragend, drop, or dragleave
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    };
    const handleWindowDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    };
    window.addEventListener('dragend', handleGlobalDragEnd);
    window.addEventListener('drop', handleGlobalDragEnd);
    window.addEventListener('dragleave', handleWindowDragLeave);
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      window.removeEventListener('drop', handleGlobalDragEnd);
      window.removeEventListener('dragleave', handleWindowDragLeave);
    };
  }, []);

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

  const handleRunSegmentation = async () => {
    if (!currentAsset && !generationSettings.image) {
      toast.error('Please load a 3D mesh or upload an image first');
      return;
    }
    try {
      if (runSegmentation) {
        await runSegmentation({
          numParts,
          method: decompositionMode,
          hierarchical,
          outputFormat,
          modelParameters: {
            method: decompositionMode,
            hierarchical,
            min_face_island_threshold: minFaceThreshold,
            save_individual_parts: saveIndividualParts,
            colorize_preview: colorizePreview,
          },
        });
      }
    } catch (err: any) {
      toast.error(`Mesh segmentation failed: ${err.message || 'Unknown error'}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Mesh segmentation cancelled');
    } catch (err: any) {
      toast.error(`Cancel failed: ${err.message || 'Unknown error'}`);
    }
  };

  // Slider percentage for parts slider (range 2 to 32)
  const partsPercentage = Math.round(((numParts - 2) / (32 - 2)) * 100);

  // Slider percentage for min face threshold (range 10 to 500)
  const minFacePercentage = Math.round(((minFaceThreshold - 10) / (500 - 10)) * 100);

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden">
      {/* 1. Header: Clean Mesh Part Segmentation Title */}
      <div className="flex items-center justify-center py-2 border-b border-[hsl(var(--border))] px-8 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Scissors className="w-3.5 h-3.5 text-[#F9CF00]" />
          <h2 className="text-[11px] font-bold text-[hsl(var(--foreground))] tracking-wide uppercase truncate">
            Mesh Segmentation
          </h2>
        </div>
      </div>

      {/* 2. Scrollable Body without scrollbar */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2 min-h-0 no-scrollbar">
        {/* Hidden File Inputs */}
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

        {/* 3. Target Parts (Single-Row Preset Pills) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Target Parts
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F9CF00]/15 text-[#F9CF00] font-semibold border border-[#F9CF00]/30 font-mono">
              {numParts} Parts · {decompositionMode.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1 p-0.5 rounded-xl bg-black/30 border border-white/[0.06]">
            {([4, 8, 16, 24] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setNumParts(preset)}
                className={`h-7.5 rounded-lg text-xs font-semibold flex items-center justify-center transition-all cursor-pointer ${
                  numParts === preset
                    ? 'bg-[#F9CF00] text-black shadow-sm font-bold'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <span>{preset} Parts</span>
              </button>
            ))}
          </div>
        </div>

        {/* 4. Advanced Segmentation Settings Trigger Button (Opens Dynamic Portal Flyout) */}
        <div className="pt-0.5">
          <button
            ref={advancedTriggerRef}
            type="button"
            aria-expanded={isAdvancedOpen}
            onClick={() => setIsAdvancedOpen((prev) => !prev)}
            className={`w-full h-8 px-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer shadow-sm ${
              isAdvancedOpen
                ? 'bg-[#1b1b2f] border-[#F9CF00] text-white ring-1 ring-[#F9CF00]/50'
                : 'bg-[hsl(var(--surface-2))] border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] text-[hsl(var(--foreground))]'
            }`}
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#F9CF00]" />
              <span className="text-[11px] font-medium text-zinc-200">Advanced Segmentation Settings</span>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                isAdvancedOpen ? 'rotate-90 text-[#F9CF00]' : ''
              }`}
            />
          </button>
        </div>

        {/* Dynamic Flying Side Settings Panel (Portal to document.body) */}
        {mounted && isAdvancedOpen && typeof document !== 'undefined' && createPortal(
          <div
            ref={advancedFlyoutRef}
            id="segmentation-advanced-flyout"
            role="dialog"
            aria-label="Advanced Segmentation Settings"
            className="fixed left-4 right-4 md:left-[290px] md:right-auto bottom-12 md:bottom-16 w-auto md:w-[300px] p-3.5 rounded-2xl bg-[#141421] border border-[#F9CF00]/50 shadow-[0_16px_50px_rgba(0,0,0,0.85)] space-y-3 animate-in fade-in zoom-in-95 duration-150 z-50 pointer-events-auto select-none"
          >
            {/* Header with Title and Close Button */}
            <div className="flex items-start justify-between pb-1.5 border-b border-white/[0.08]">
              <div>
                <h3 className="text-[11px] font-bold text-white tracking-wide">Advanced Segmentation Settings</h3>
                <p className="text-[9.5px] text-zinc-400 mt-0.5">Settings automatically saved</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAdvancedOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close Advanced Segmentation settings"
              >
                <HugeiconsIcon icon={Cancel} size={13} />
              </button>
            </div>

            {/* Parameter 1: Decomposition Mode (Semantic vs Geometric) */}
            <div className="space-y-1">
              <span className="text-[10.5px] text-zinc-300 font-medium block">
                Decomposition Algorithm
              </span>
              <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-black/30 border border-white/[0.04]">
                <button
                  type="button"
                  onClick={() => setDecompositionMode('semantic')}
                  className={`h-7 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    decompositionMode === 'semantic'
                      ? 'bg-white text-black shadow-sm font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span>Semantic</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDecompositionMode('geometric')}
                  className={`h-7 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    decompositionMode === 'geometric'
                      ? 'bg-white text-black shadow-sm font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span>Geometric</span>
                </button>
              </div>
            </div>

            {/* Parameter 2: Fine-Grain Target Parts Slider (2 to 32) */}
            <div className="space-y-1.5 p-2 rounded-xl bg-black/30 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-zinc-300 font-medium">Target Parts Count</span>
                <span className="text-[9.5px] font-mono text-[#F9CF00] font-bold px-1.5 py-0.5 rounded bg-[#F9CF00]/10 border border-[#F9CF00]/20">
                  {numParts} Parts
                </span>
              </div>
              <div className="space-y-1 pt-0.5">
                <input
                  type="range"
                  min={2}
                  max={32}
                  step={1}
                  value={numParts}
                  onChange={(e) => setNumParts(parseInt(e.target.value, 10))}
                  style={{
                    background: `linear-gradient(to right, #F9CF00 0%, #F9CF00 ${partsPercentage}%, rgba(255, 255, 255, 0.08) ${partsPercentage}%, rgba(255, 255, 255, 0.08) 100%)`,
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none transition-all duration-75 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#F9CF00] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(249,207,0,0.7)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#F9CF00]"
                />
                <div className="flex justify-between text-[8.5px] font-mono text-zinc-400 px-0.5">
                  <span>2 Parts</span>
                  <span>16 Parts</span>
                  <span>32 Parts</span>
                </div>
              </div>
            </div>

            {/* Parameter 2: Hierarchical Assembly Tree Toggle */}
            <div className="flex items-center justify-between py-1 border-t border-white/[0.06] pt-1.5">
              <div className="space-y-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <GitFork className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] text-zinc-200 font-medium">Hierarchical Tree</span>
                </div>
                <p className="text-[9px] text-zinc-400">Organizes parts into multi-level parent-child assembly hierarchy</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hierarchical}
                onClick={() => setHierarchical(!hierarchical)}
                className={`w-7.5 h-4 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                  hierarchical ? 'bg-[#6366F1]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                    hierarchical ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Parameter 2: Min Face Island Threshold Slider */}
            <div className="space-y-1.5 p-2 rounded-xl bg-black/30 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-zinc-300 font-medium">Min Face Island Threshold</span>
                <span className="text-[9.5px] font-mono text-[#F9CF00] font-bold px-1.5 py-0.5 rounded bg-[#F9CF00]/10 border border-[#F9CF00]/20">
                  {minFaceThreshold} faces
                </span>
              </div>
              <div className="space-y-1 pt-0.5">
                <input
                  type="range"
                  min={10}
                  max={500}
                  step={10}
                  value={minFaceThreshold}
                  onChange={(e) => setMinFaceThreshold(parseInt(e.target.value, 10))}
                  style={{
                    background: `linear-gradient(to right, #F9CF00 0%, #F9CF00 ${minFacePercentage}%, rgba(255, 255, 255, 0.08) ${minFacePercentage}%, rgba(255, 255, 255, 0.08) 100%)`,
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none transition-all duration-75 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#F9CF00] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(249,207,0,0.7)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#F9CF00]"
                />
                <div className="flex justify-between text-[8.5px] font-mono text-zinc-400 px-0.5">
                  <span>10 (Fine)</span>
                  <span>50 (Default)</span>
                  <span>500 (Coarse)</span>
                </div>
              </div>
              <p className="text-[9px] text-zinc-400 leading-tight">
                Filters out small detached face islands below this polygon count threshold.
              </p>
            </div>

            {/* Parameter 2: Save Individual Part Files */}
            <div className="flex items-center justify-between py-0.5 border-t border-white/[0.06] pt-1.5">
              <div className="space-y-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <FolderArchive className="w-3 h-3 text-emerald-400" />
                  <span className="text-[11px] text-zinc-200 font-medium">Save Individual Part Files</span>
                </div>
                <p className="text-[9px] text-zinc-400">Exports isolated 3D files for each part alongside combined scene</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={saveIndividualParts}
                onClick={() => setSaveIndividualParts(!saveIndividualParts)}
                className={`w-7.5 h-4 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                  saveIndividualParts ? 'bg-emerald-500' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                    saveIndividualParts ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Parameter 3: Export Format */}
            <div className="space-y-1 border-t border-white/[0.06] pt-1.5">
              <span className="text-[10.5px] text-zinc-300 font-medium block">Export Format</span>
              <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-black/30 border border-white/[0.04]">
                {(['glb', 'obj'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setOutputFormat(fmt)}
                    className={`h-6.5 rounded-lg text-[10.5px] font-bold uppercase transition-all cursor-pointer ${
                      outputFormat === fmt
                        ? 'bg-white text-black font-extrabold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <span>{fmt.toUpperCase()} {fmt === 'glb' ? '(Packed)' : '(Mesh Multi-Group)'}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Parameter 4: Colorize Part Preview */}
            <div className="flex items-center justify-between py-0.5 border-t border-white/[0.06] pt-1.5">
              <div className="space-y-0.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <Palette className="w-3 h-3 text-[#F9CF00]" />
                  <span className="text-[11px] text-zinc-200 font-medium">Colorize Part Preview</span>
                </div>
                <p className="text-[9px] text-zinc-400">Assigns distinctive high-contrast colors per segmented part</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={colorizePreview}
                onClick={() => setColorizePreview(!colorizePreview)}
                className={`w-7.5 h-4 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                  colorizePreview ? 'bg-[#F9CF00]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                    colorizePreview ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* 7. Sticky Bottom Action CTA Button (NO model name in button or subtitle as requested) */}
      <div className="p-3 pt-2 pb-3 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0 space-y-1.5">
        {isExecuting ? (
          <div className="p-3 rounded-2xl bg-[#141524] border border-[#F9CF00]/30 shadow-xl space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-3.5 h-3.5 border-2 border-[#F9CF00] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-semibold text-white truncate text-xs">
                  {executionStep || 'Segmenting mesh parts...'}
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
          <div className="space-y-1">
            <button
              type="button"
              onClick={handleRunSegmentation}
              disabled={!currentAsset && !generationSettings.image}
              className="w-full h-8 rounded-full bg-[#F9CF00] hover:bg-[#ffdb29] text-black font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#F9CF00]/15 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Scissors className="w-3.5 h-3.5 text-black" />
              <span>Segment Mesh</span>
            </button>
            <div className="flex items-center justify-center text-[9.5px] text-zinc-400 px-1 font-mono">
              <span>
                Target: {numParts} Parts · Mode: {decompositionMode === 'semantic' ? 'Semantic' : 'Geometric'} · Format: {outputFormat.toUpperCase()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
