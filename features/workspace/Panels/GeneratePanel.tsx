'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAppStore } from '@/stores/useAppStore';
import type { ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { getModelDefinition } from '@/constants/models';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  LayersIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UploadIcon,
  ZapIcon,
  Edit02Icon,
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
export const GeneratePanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    generate3DModel,
    generationSettings,
    setGenerationSettings,
  } = useWorkspace();

  const [modelType, setModelType] = useState<'hd' | 'smart'>('hd');
  const [inputMode, setInputMode] = useState<'image' | 'mesh' | 'multiview' | 'edit'>('image');
  const [generateInParts, setGenerateInParts] = useState(false);
  const [highResTexture, setHighResTexture] = useState(false);
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [isGeneralSettingsOpen, setIsGeneralSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableModels = [
    {
      id: 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
      label: 'Hunyuan3D-2 Mini Turbo (Fast Geometry)',
      tag: 'Best Speed',
    },
    {
      id: 'taoflowforge_image_to_raw_mesh',
      label: 'TaoFlowForge (Progressive Native Flow)',
      tag: 'Native Topology',
    },
    {
      id: 'pixal3d_image_to_raw_mesh',
      label: 'Pixal3D (Neighborhood Attention Reconstruction)',
      tag: 'High Precision',
    },
  ];

  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      toast.error('File exceeds 20MB limit');
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

  const handleGenerate = async () => {
    try {
      setGenerationSettings((prev) => ({
        ...prev,
        aiModel: selectedModel,
      }));
      await generate3DModel();
    } catch (err: any) {
      toast.error(`Generation failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1A1A1E] text-zinc-200 overflow-y-auto overflow-x-hidden p-3.5 space-y-3.5">
      {/* 1. Header: Generate Model */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={SparklesIcon} size={16} className="text-[#F9CF00]" />
          <h2 className="text-xs font-bold text-white tracking-wide uppercase">Generate Model</h2>
        </div>
      </div>

      {/* 2. Top Pill Switcher: HD Model vs Smart Mesh */}
      <div className="flex p-0.5 rounded-full bg-white/[0.06] border border-white/[0.08]">
        <button
          type="button"
          onClick={() => setModelType('hd')}
          className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
            modelType === 'hd' ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          HD Model
        </button>
        <button
          type="button"
          onClick={() => setModelType('smart')}
          className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer ${
            modelType === 'smart' ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span>Smart Mesh</span>
          <span className="text-[10px] text-[#F9CF00]">⇡</span>
        </button>
      </div>

      {/* 3. Input Mode Selector (4 Tabs) */}
      <div className="p-2 rounded-2xl bg-black/30 border border-white/[0.08] space-y-2.5">
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setInputMode('image')}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              inputMode === 'image' ? 'bg-white/10 text-[#F9CF00] shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <HugeiconsIcon icon={ImageIcon} size={15} />
          </button>
          <button
            type="button"
            onClick={() => setInputMode('mesh')}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              inputMode === 'mesh' ? 'bg-white/10 text-[#F9CF00] shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <HugeiconsIcon icon={Box} size={15} />
          </button>
          <button
            type="button"
            onClick={() => setInputMode('multiview')}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              inputMode === 'multiview' ? 'bg-white/10 text-[#F9CF00] shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <HugeiconsIcon icon={LayersIcon} size={15} />
          </button>
          <button
            type="button"
            onClick={() => setInputMode('edit')}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              inputMode === 'edit' ? 'bg-white/10 text-[#F9CF00] shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <HugeiconsIcon icon={Edit02Icon} size={15} />
          </button>
        </div>

        {/* Upload Dropzone */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative group rounded-xl border border-dashed border-white/15 hover:border-[#F9CF00]/50 bg-[#121214] p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[140px]"
        >
          {imagePreview || generationSettings.image ? (
            <img
              src={imagePreview || generationSettings.image || ''}
              alt="Upload preview"
              className="max-h-28 w-auto rounded object-contain mb-1"
            />
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-zinc-400 group-hover:text-[#F9CF00] group-hover:scale-105 transition-all mb-2">
                <HugeiconsIcon icon={UploadIcon} size={20} />
              </div>
              <p className="text-xs font-semibold text-white">Upload</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">JPG, PNG, WEBP · Max 20MB</p>
            </>
          )}

          <div className="mt-3 text-[11px] text-zinc-400 group-hover:text-white font-medium flex items-center gap-1">
            <span>Generate Image for 3D</span>
            <span className="text-[#F9CF00]">›</span>
          </div>
        </div>
      </div>

      {/* 4. General Settings Accordion */}
      <div className="border-t border-white/[0.08] pt-2">
        <button
          type="button"
          onClick={() => setIsGeneralSettingsOpen(!isGeneralSettingsOpen)}
          className="w-full flex items-center justify-between py-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition-all cursor-pointer"
        >
          <span>General Settings</span>
          <HugeiconsIcon icon={isGeneralSettingsOpen ? ChevronDown : ChevronRight} size={14} />
        </button>

        {isGeneralSettingsOpen && (
          <div className="p-2.5 rounded-xl bg-black/20 border border-white/[0.06] text-xs space-y-2 mt-1">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Geometry & Texture</span>
              <span className="text-xs text-zinc-200 font-mono">PBR Default</span>
            </div>
          </div>
        )}
      </div>

      {/* 5. Members Only / Studio Options */}
      <div className="border-t border-white/[0.08] pt-2.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F9CF00]">
          <span>✪</span>
          <span>Studio Settings</span>
        </div>

        {/* Generate in Parts toggle */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-300">Generate in Parts</span>
          <button
            type="button"
            onClick={() => setGenerateInParts(!generateInParts)}
            className={`w-9 h-5 rounded-full p-0.5 transition-all cursor-pointer ${
              generateInParts ? 'bg-[#F9CF00]' : 'bg-white/10'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-black transition-all ${
                generateInParts ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 8K Texture toggle */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-300">8K Texture</span>
          <button
            type="button"
            onClick={() => setHighResTexture(!highResTexture)}
            className={`w-9 h-5 rounded-full p-0.5 transition-all cursor-pointer ${
              highResTexture ? 'bg-[#F9CF00]' : 'bg-white/10'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-black transition-all ${
                highResTexture ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Privacy select */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-300">Privacy</span>
          <select
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value as any)}
            className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-zinc-200 outline-none cursor-pointer"
          >
            <option value="public">🌐 Public</option>
            <option value="private">🔒 Private</option>
          </select>
        </div>
      </div>

      {/* 6. AI Model Section */}
      <div className="border-t border-white/[0.08] pt-2.5 space-y-1.5">
        <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
          AI Model
        </label>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            className="w-full p-2.5 rounded-xl bg-black/40 border border-white/10 hover:border-white/20 flex items-center justify-between text-left transition-all cursor-pointer"
          >
            <div>
              <p className="text-xs font-bold text-white">
                {availableModels.find((m) => m.id === selectedModel)?.label || 'Select Model'}
              </p>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {availableModels.find((m) => m.id === selectedModel)?.tag} · High Precision
              </p>
            </div>
            <HugeiconsIcon icon={ChevronDown} size={14} className="text-zinc-400" />
          </button>

          {isModelDropdownOpen && (
            <div className="absolute bottom-full mb-1 left-0 right-0 rounded-xl bg-[#1c1c20] border border-white/10 shadow-2xl p-1 z-30 space-y-1">
              {availableModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModel(m.id);
                    setIsModelDropdownOpen(false);
                  }}
                  className={`w-full text-left p-2 rounded-lg text-xs transition-all cursor-pointer flex items-center justify-between ${
                    selectedModel === m.id ? 'bg-[#F9CF00] text-black font-bold' : 'text-zinc-300 hover:bg-white/5'
                  }`}
                >
                  <span>{m.label}</span>
                  <span className="text-[10px] opacity-75">{m.tag}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 7. Bottom Action Button */}
      <div className="pt-2 mt-auto">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isExecuting}
          className="w-full py-3 rounded-full bg-[#F9CF00] hover:bg-[#e5be00] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#F9CF00]/10 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExecuting ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <span>Generate</span>
              <HugeiconsIcon icon={ZapIcon} size={15} className="fill-black" />
              <span className="text-xs font-black">55</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
