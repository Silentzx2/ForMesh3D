'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import type { ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  ChevronDown,
  ChevronRight,
  SparklesIcon,
  TriangleAlertIcon,
  UploadIcon,
  ThumbsUpIcon,
  Cancel,
  Box,
  Delete02Icon,
  Edit02Icon,
  Idea01Icon,
  Image01Icon,
  Image02Icon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

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
// 2. Focused GeneratePanel Component
// ==========================================
export type GenerationIntent = 'game_ready' | 'cinematic' | 'mobile' | 'native';

export const GeneratePanel: React.FC = () => {
  const {
    isExecuting,
    generate3DModel,
    generationSettings,
    setGenerationSettings,
  } = useWorkspace();

  const [isGeneralSettingsOpen, setIsGeneralSettingsOpen] = useState(false);
  const [intent, setIntent] = useState<GenerationIntent>('game_ready');
  const [selectedModel, setSelectedModel] = useState('hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  // Sync default model and intent into workspace settings on mount
  useEffect(() => {
    setGenerationSettings((prev) => {
      const updates: Partial<typeof prev> = {};
      if (!prev.aiModel && selectedModel) updates.aiModel = selectedModel;
      if (!prev.intent && intent) updates.intent = intent;
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
    });
  }, [selectedModel, intent, setGenerationSettings]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Close AI model dropdown on outside click or Escape
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

  const availableModels = [
    {
      id: 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
      label: 'Hunyuan3D-2 Mini Turbo',
      tag: 'Best Speed & Geometry',
      note: 'Fast Geometry · Official locked profile',
    },
    {
      id: 'taoflowforge_image_to_raw_mesh',
      label: 'TaoFlowForge',
      tag: 'Native Flow Topology',
      note: 'Progressive Flow · Clean surface loops',
    },
    {
      id: 'pixal3d_image_to_raw_mesh',
      label: 'Pixal3D',
      tag: 'High Precision Reconstruction',
      note: 'Neighborhood Attention · Fine Details',
    },
  ];

  const processImageFile = (file: File) => {
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
      }));
      toast.success(`Image selected: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  const handleRemoveImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setImagePreview(null);
    setGenerationSettings((prev) => ({ ...prev, image: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    setGenerationSettings((prev) => ({ ...prev, aiModel: modelId }));
    setIsModelDropdownOpen(false);
  };

  const handleIntentSelect = (newIntent: GenerationIntent) => {
    setIntent(newIntent);
    setGenerationSettings((prev) => ({ ...prev, intent: newIntent }));
  };

  const handleGenerate = async () => {
    try {
      await generate3DModel();
    } catch (err: any) {
      toast.error(`Generation failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-y-auto overflow-x-hidden p-2 space-y-2.5">
      {/* 1. Header: Generate Model - pr-8 prevents collapse button overlap */}
      <div className="flex items-center justify-between pb-1 border-b border-[hsl(var(--border))] pr-8">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={SparklesIcon} size={15} className="text-[#F9CF00]" />
          <h2 className="text-xs font-bold text-[hsl(var(--foreground))] tracking-wide uppercase">Generate Model</h2>
        </div>
        <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-2))] px-2 py-0.5 rounded-md border border-[hsl(var(--border))] font-mono">
          HD Model
        </span>
      </div>

      {/* 2. Studio Image Upload Card (Matching Tripo Reference Design, Layout & Colors) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleImageUpload}
        className="hidden"
      />
      <div className="p-2.5 rounded-2xl border border-[#48457D] bg-[#161626] shadow-xl space-y-2">
        {/* Top 4-Pill Mode Selector Bar */}
        <div className="h-8 px-1 rounded-xl bg-[#0f0f1c] border border-white/[0.04] flex items-center justify-between">
          <button
            type="button"
            className="h-6 px-3 rounded-lg bg-white text-black font-bold flex items-center justify-center shadow-sm cursor-pointer"
            title="Image to 3D"
          >
            <HugeiconsIcon icon={Image01Icon} size={15} />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-6 px-3 rounded-lg text-zinc-400 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
            title="3D Mesh Input"
          >
            <HugeiconsIcon icon={Box} size={15} />
          </button>
          <button
            type="button"
            onClick={() => toast.info('Multi-View input ready')}
            className="h-6 px-3 rounded-lg text-zinc-400 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
            title="Multi-View Images"
          >
            <HugeiconsIcon icon={Image02Icon} size={15} />
          </button>
          <button
            type="button"
            onClick={() => toast.info('Text & Sketch mode ready')}
            className="h-6 px-3 rounded-lg text-zinc-400 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
            title="Sketch / Prompt"
          >
            <HugeiconsIcon icon={Edit02Icon} size={15} />
          </button>
        </div>

        {/* Dropzone Container */}
        {imagePreview || generationSettings.image ? (
          <div className="relative w-full h-[195px] rounded-xl overflow-hidden bg-[#0d0e17] border border-[#48457D]/40 flex items-center justify-center group/preview">
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
              <HugeiconsIcon icon={Delete02Icon} size={14} />
            </button>

            {/* Bottom Floating Actions (Edit + Multi-Views) */}
            <div className="absolute bottom-2 inset-x-2 flex items-center justify-between pointer-events-none">
              {/* Pencil Edit button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Edit or Replace Image"
                className="pointer-events-auto w-7 h-7 rounded-full bg-[#1b1c2b]/90 hover:bg-[#25273b] border border-white/10 text-white flex items-center justify-center shadow-lg cursor-pointer transition-all active:scale-95"
              >
                <HugeiconsIcon icon={Edit02Icon} size={13} />
              </button>

              {/* Generate Multi-Views Pill */}
              <button
                type="button"
                onClick={() => toast.info('Multi-view synthesis ready for processing')}
                className="pointer-events-auto h-7 px-2.5 rounded-full bg-[#1b1c2b]/90 hover:bg-[#25273b] border border-white/10 text-white text-[10px] font-semibold flex items-center gap-1.5 shadow-lg cursor-pointer transition-all active:scale-95"
              >
                <span className="w-3.5 h-3.5 rounded-full bg-[#F9CF00] text-black flex items-center justify-center text-[8px] font-black">
                  ★
                </span>
                <span>Generate Multi-Views</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload concept image"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className="relative group w-full h-[195px] rounded-xl border border-dashed border-[#48457D]/60 hover:border-[#6366F1] bg-[#12131F] [background-image:linear-gradient(45deg,#18192A_25%,transparent_25%),linear-gradient(-45deg,#18192A_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18192A_75%),linear-gradient(-45deg,transparent_75%,#18192A_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0px] p-2.5 flex flex-col items-center justify-between cursor-pointer transition-all shadow-inner"
          >
            {/* Top Right Tip Lightbulb */}
            <div className="w-full flex justify-end">
              <span className="p-0.5 text-zinc-400/70 hover:text-[#F9CF00] transition-colors" title="Image prompt tips">
                <HugeiconsIcon icon={Idea01Icon} size={14} />
              </span>
            </div>

            {/* Center Upload Prompt */}
            <div className="flex flex-col items-center text-center -mt-1">
              <HugeiconsIcon icon={Image01Icon} size={28} className="text-zinc-300 group-hover:text-white group-hover:scale-105 transition-all mb-1" />
              <span className="text-xs font-bold text-white tracking-wide">Upload</span>
              <span className="text-[10px] text-zinc-400 font-mono mt-0.5">JPG, PNG, WEBP Size ≤ 20MB</span>
            </div>

            {/* Bottom Generate Image Link */}
            <div className="text-[10.5px] font-medium text-zinc-300 group-hover:text-white flex items-center gap-1 transition-colors pb-0.5">
              <span>Generate Image for 3D</span>
              <span className="text-zinc-400 group-hover:translate-x-0.5 transition-transform">›</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. General Settings Accordion */}
      <div className="border-t border-[hsl(var(--border))] pt-2">
        <button
          type="button"
          aria-expanded={isGeneralSettingsOpen}
          aria-label="Toggle General Settings"
          onClick={() => setIsGeneralSettingsOpen(!isGeneralSettingsOpen)}
          className="w-full flex items-center justify-between p-1.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] text-xs font-semibold text-[hsl(var(--foreground))] transition-all cursor-pointer shadow-sm"
        >
          <div className="flex items-center gap-1.5">
            <span>General Settings</span>
            <span className="text-[10px] text-[#F9CF00] font-mono font-bold">
              {intent === 'game_ready' ? '50k Tris' : intent === 'cinematic' ? '200k Tris' : intent === 'mobile' ? '20k Tris' : 'Raw'}
            </span>
          </div>
          <HugeiconsIcon icon={isGeneralSettingsOpen ? ChevronDown : ChevronRight} size={14} className="text-[hsl(var(--muted-foreground))]" />
        </button>

        {isGeneralSettingsOpen && (
          <div className="p-3 rounded-xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] text-xs space-y-2.5 mt-1.5">
            <div>
              <label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider block mb-1.5">
                Production Intent Preset
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'game_ready', label: 'Game Ready', desc: '50k Tris · PBR' },
                  { id: 'cinematic', label: 'Cinematic', desc: '200k Tris · High' },
                  { id: 'mobile', label: 'Mobile', desc: '20k Tris · Fast' },
                  { id: 'native', label: 'Raw Native', desc: 'Immutable Master' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleIntentSelect(item.id as GenerationIntent)}
                    className={`p-2 rounded-lg text-left transition-all cursor-pointer border ${
                      intent === item.id
                        ? 'bg-[#F9CF00]/15 border-[#F9CF00] text-white shadow-sm'
                        : 'bg-[hsl(var(--surface-2))] border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))]'
                    }`}
                  >
                    <p className={`text-[11px] font-bold ${intent === item.id ? 'text-[#F9CF00]' : 'text-[hsl(var(--foreground))]'}`}>
                      {item.label}
                    </p>
                    <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-0.5">{item.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. AI Model Section */}
      <div className="border-t border-[hsl(var(--border))] pt-2.5 space-y-1.5" ref={modelDropdownRef}>
        <label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider block">
          AI Model
        </label>

        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isModelDropdownOpen}
            aria-label="Select AI Model"
            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            className="w-full p-1.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between text-left transition-all cursor-pointer shadow-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#F9CF00]/10 border border-[#F9CF00]/25 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
                <HugeiconsIcon icon={ThumbsUpIcon} size={15} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[hsl(var(--foreground))] truncate">
                  {availableModels.find((m) => m.id === selectedModel)?.label || 'Select Model'}
                </p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                  {availableModels.find((m) => m.id === selectedModel)?.tag}
                </p>
              </div>
            </div>
            <HugeiconsIcon icon={ChevronDown} size={14} className="text-[hsl(var(--muted-foreground))] flex-shrink-0 ml-1" />
          </button>

          {isModelDropdownOpen && (
            <div
              role="listbox"
              aria-label="Available AI models"
              className="absolute bottom-full mb-1 left-0 right-0 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] shadow-2xl p-1 z-30 space-y-1"
            >
              {availableModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={selectedModel === m.id}
                  onClick={() => handleModelSelect(m.id)}
                  className={`w-full text-left p-2 rounded-lg text-xs transition-all cursor-pointer flex items-center justify-between ${
                    selectedModel === m.id ? 'bg-[#F9CF00] text-black font-bold' : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  <div>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="text-[9.5px] opacity-75">{m.note}</span>
                  </div>
                  <span className="text-[10px] opacity-75">{m.tag}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 5. Bottom Action CTA Button */}
      <div className="pt-2 mt-auto">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isExecuting}
          className="w-full py-2 rounded-full bg-[#F9CF00] hover:bg-[#ffdb29] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#F9CF00]/15 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExecuting ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              <span>Generating Model...</span>
            </>
          ) : (
            <span>Generate Model</span>
          )}
        </button>
      </div>
    </div>
  );
};
