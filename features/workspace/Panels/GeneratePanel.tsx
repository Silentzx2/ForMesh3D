'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace } from '../store/WorkspaceContext';
import type { ModelAsset } from '../types';
import { useFeatureAvailability } from '@/hooks/useFeatureAvailability';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import {
  Sparkles,
  Image as ImageIcon,
  Box,
  RotateCw,
  Lightbulb,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  X as CancelIcon,
  Trash2,
  Edit2,
  ThumbsUp,
} from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  TriangleAlertIcon,
  UploadIcon,
  Cancel,
  FolderOpenIcon,
  ViewIcon,
  HelpCircleIcon,
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
// 2. Focused GeneratePanel Component
// ==========================================
export type GenerationIntent = 'game_ready' | 'cinematic' | 'mobile' | 'native';

export const GeneratePanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    cancelExecution,
    generate3DModel,
    generationSettings,
    setGenerationSettings,
  } = useWorkspace();

  const [isGeneralSettingsOpen, setIsGeneralSettingsOpen] = useState(false);
  const [intent, setIntent] = useState<GenerationIntent>('game_ready');

  // ===== Dynamic model list from backend (weights-aware) =====
  const { modelDetails, weightsStatus, getModelsForFeature, loading: modelsLoading } = useFeatureAvailability();

  // Models completely disabled from UI per user direction (trellis2, pixal3d, taoflowforge, unique3d)
  const isMeshModelDisabled = (mid: string) => {
    const lower = mid.toLowerCase();
    return (
      lower.startsWith('trellis2') ||
      lower.startsWith('pixal3d') ||
      lower.startsWith('taoflowforge') ||
      lower.startsWith('unique3d')
    );
  };

  const MESH_MODEL_LABELS: Record<string, { label: string; tag: string; note: string }> = {
    'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh': { label: 'Hunyuan3D-2 Mini Turbo', tag: 'Fast Geometry', note: 'Fast Geometry · Official locked profile' },
    'triposg_image_to_raw_mesh': { label: 'TripoSG', tag: 'Hierarchical Geometry', note: 'Stable · 1024 resolution' },
    'hunyuan3d_shape_v21_image_to_raw_mesh': { label: 'Hunyuan3D-2.1 Shape', tag: 'High Detail', note: '10GB VRAM · 50 steps · 512 octree' },
    'unique3d_image_to_raw_mesh': { label: 'Unique3D', tag: 'Legacy / Deprecated', note: 'Working but not actively used' },
    'trellis_image_to_3d': { label: 'TRELLIS', tag: 'Stable', note: '50-step inference' },
    'trellis_image_to_raw_mesh': { label: 'TRELLIS', tag: 'Raw Mesh', note: 'Stable production model' },
  };

  const KNOWN_MESH_MODEL_IDS = [
    'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
    'triposg_image_to_raw_mesh',
    'hunyuan3d_shape_v21_image_to_raw_mesh',
    'trellis_image_to_raw_mesh',
    'trellis_image_to_3d',
  ];

  const meshModels = useMemo(() => {
    const rawIds = [
      ...getModelsForFeature('image_to_raw_mesh'),
      ...getModelsForFeature('image-to-raw-mesh'),
      ...getModelsForFeature('image_to_mesh'),
    ];
    const candidatePool = rawIds.length > 0 ? rawIds : KNOWN_MESH_MODEL_IDS;
    const uniqueCandidates = Array.from(new Set(candidatePool));

    return uniqueCandidates
      .filter((mid) => !isMeshModelDisabled(mid))
      .filter((mid) => {
        // Strict weight check: only display models whose weights are verified available
        return weightsStatus[mid] === true || modelDetails[mid]?.weights_available === true;
      })
      .map((mid) => {
        const info = MESH_MODEL_LABELS[mid];
        return {
          id: mid,
          label: info?.label || mid,
          tag: info?.tag || 'Ready',
          note: info?.note || '',
        };
      });
  }, [getModelsForFeature, modelDetails, weightsStatus]);

  const defaultMeshModel = useMemo(() => {
    return meshModels[0]?.id || 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh';
  }, [meshModels]);

  const [selectedModel, setSelectedModel] = useState(defaultMeshModel);

  // Keep selectedModel synced with whatever model actually has downloaded weights
  useEffect(() => {
    if (meshModels.length > 0 && !meshModels.some((m) => m.id === selectedModel)) {
      setSelectedModel(meshModels[0].id);
    }
  }, [meshModels, selectedModel]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const { state: meshUploadState, upload: uploadMesh } = useMeshAssetUpload();
  const isMeshUploading = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const meshInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const geomTextureFlyoutRef = useRef<HTMLDivElement>(null);
  const geomTextureTriggerRef = useRef<HTMLButtonElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [inputTab, setInputTab] = useState<'image' | 'mesh'>('image');
  const [isDragOver, setIsDragOver] = useState(false);

  // Geometry & Texture flyout settings matching Tripo reference
  const [isGeomTextureOpen, setIsGeomTextureOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [enablePostprocess, setEnablePostprocess] = useState(true);
  const [enableTexture, setEnableTexture] = useState(true);
  const [textureQuality, setTextureQuality] = useState<'2K' | '4K'>('4K');
  const [removeLighting, setRemoveLighting] = useState(true);
  const [enablePbr, setEnablePbr] = useState(true);
  const [topologyMode, setTopologyMode] = useState<'Quad' | 'Triangle'>('Triangle');
  const [polycount, setPolycount] = useState(600000);
  const [seed, setSeed] = useState<number | ''>(typeof generationSettings.seed === 'number' ? generationSettings.seed : '');
  const dragCounterRef = useRef(0);

  // Keep imagePreview in sync with workspace generationSettings
  useEffect(() => {
    if (generationSettings.image && generationSettings.image !== imagePreview) {
      setImagePreview(generationSettings.image);
    }
  }, [generationSettings.image, imagePreview]);

  // Sync initial parameters into workspace settings on mount
  useEffect(() => {
    setGenerationSettings((prev) => ({
      ...prev,
      aiModel: prev.aiModel || selectedModel,
      intent: prev.intent || intent,
      enablePostprocess: prev.enablePostprocess ?? enablePostprocess,
      generateTexture: prev.generateTexture ?? enableTexture,
      texture_enabled: prev.texture_enabled ?? enableTexture,
      textureEnabled: prev.textureEnabled ?? enableTexture,
      textureResolution: prev.textureResolution ?? textureQuality,
      texture_resolution: prev.texture_resolution ?? textureQuality,
      textureQuality: prev.textureQuality ?? (textureQuality === '4K' ? 'high' : 'medium'),
      removeBackground: prev.removeBackground ?? removeLighting,
      highResolutionNormalBaking: prev.highResolutionNormalBaking ?? enablePbr,
      quadTopology: prev.quadTopology ?? (topologyMode === 'Quad'),
      topologyMode: prev.topologyMode ?? (topologyMode === 'Quad' ? 'quad' : 'triangle'),
      autoOptimizeSettings: {
        ...prev.autoOptimizeSettings,
        targetPolycount: prev.autoOptimizeSettings?.targetPolycount || polycount,
      },
      polycount: prev.polycount || polycount,
      targetPolycount: prev.targetPolycount || polycount,
      target_polycount: prev.target_polycount || polycount,
    }));
  }, [setGenerationSettings]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close Geometry & Texture flyout on outside click or Escape
  useEffect(() => {
    if (!isGeomTextureOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        geomTextureFlyoutRef.current &&
        !geomTextureFlyoutRef.current.contains(target) &&
        geomTextureTriggerRef.current &&
        !geomTextureTriggerRef.current.contains(target)
      ) {
        setIsGeomTextureOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsGeomTextureOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGeomTextureOpen]);

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

  // Inspect dataTransfer items during dragover/dragenter before user releases/drops file
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
          // 3D model files (.glb, .obj, .fbx, .stl) usually present as 'model/*', 'application/*', or empty string ''
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

  // Automatic pre-drop switch while user is hovering with dragged file
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
    if (!generationSettings.image && !imagePreview) {
      toast.error('Please upload or select an image first');
      return;
    }
    try {
      await generate3DModel();
    } catch (err: any) {
      toast.error(`Generation failed: ${err.message || 'Unknown error'}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Generation cancelled');
    } catch (err: any) {
      toast.error(`Cancel failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden">
      {/* 1. Header: Centered Generate Model */}
      <div className="flex items-center justify-center py-2 border-b border-[hsl(var(--border))] px-4 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#F9CF00]" />
          <h2 className="text-xs font-bold text-[hsl(var(--foreground))] tracking-wide uppercase">Generate Model</h2>
        </div>
      </div>

      {/* Fixed tool body — no internal scrolling (Flex column so Parameter Deck can anchor with mt-auto) */}
      <div className="flex-1 overflow-hidden p-2 flex flex-col min-h-0 workspace-tool-body">
        {/* 2. Studio Input Card (Matching Tripo Reference Design, Layout & Colors) */}
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
              <div className="relative w-full h-[195px] workspace-upload-preview rounded-xl overflow-hidden bg-[#0c0d14] border border-white/[0.08] flex items-center justify-center group/preview">
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
                className={`relative group w-full h-[200px] workspace-upload-dropzone rounded-xl border border-dashed transition-all p-2 flex flex-col items-center justify-between cursor-pointer shadow-inner ${
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
              className={`relative group w-full h-[195px] workspace-upload-dropzone rounded-xl border border-dashed transition-all p-3 flex flex-col items-center justify-center text-center cursor-pointer shadow-inner ${
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

      {/* Parameter Deck (Geometry, AI Model & Seed in natural flow below dropzone) */}
      <div className="pt-2.5 space-y-2.5">
        {/* 3. General Settings: Geometry & Texture (Matching Tripo Reference & Dynamic Loading) */}
        <div className="border-t border-[hsl(var(--border))] pt-2 relative">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              General Settings
            </span>
          </div>

          {/* Geometry & Texture Trigger Button */}
          <button
            ref={geomTextureTriggerRef}
            type="button"
            aria-expanded={isGeomTextureOpen}
            onClick={() => setIsGeomTextureOpen((prev) => !prev)}
            className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer shadow-sm ${
              isGeomTextureOpen
                ? 'bg-[#1b1b2f] border-[#6366F1] text-white ring-1 ring-[#6366F1]/50'
                : 'bg-[hsl(var(--surface-2))] border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] text-[hsl(var(--foreground))]'
            }`}
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#6366F1]" />
              <span>Geometry &amp; Texture</span>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] transition-transform duration-200 ${
                isGeomTextureOpen ? 'rotate-90 text-[#6366F1]' : ''
              }`}
            />
          </button>

          {/* Dynamic Flying Side Geometry & Texture Settings Panel */}
          {mounted && isGeomTextureOpen && typeof document !== 'undefined' && createPortal(
            <div
              ref={geomTextureFlyoutRef}
              id="geometry-texture-flyout"
              role="dialog"
              aria-label="Geometry and Texture Settings"
              className="fixed left-4 right-4 md:left-[290px] md:right-auto bottom-12 md:bottom-16 w-auto md:w-[280px] p-3.5 rounded-2xl bg-[#141421] border border-[#6366F1]/50 shadow-[0_16px_50px_rgba(0,0,0,0.85)] space-y-2.5 animate-in fade-in zoom-in-95 duration-150 z-50 pointer-events-auto select-none"
            >
            {/* Header with Title and Close Button */}
            <div className="flex items-start justify-between pb-1 border-b border-white/[0.08]">
              <div>
                <h3 className="text-xs font-bold text-white tracking-wide">Geometry &amp; Texture</h3>
                <p className="text-[9px] text-zinc-400 mt-0.5">Settings automatically saved</p>
              </div>
              <button
                type="button"
                onClick={() => setIsGeomTextureOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close Geometry & Texture settings"
              >
                <HugeiconsIcon icon={Cancel} size={13} />
              </button>
            </div>

            {/* Toggle 1: Post-Processing */}
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-200 font-medium">Post-Processing</span>
                <span title="Automatic mesh cleanup, manifold healing, smoothing and feature edge preservation" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <HugeiconsIcon icon={HelpCircleIcon} size={12} />
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enablePostprocess}
                onClick={() => {
                  const next = !enablePostprocess;
                  setEnablePostprocess(next);
                  setGenerationSettings((prev) => ({ ...prev, enablePostprocess: next }));
                }}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${
                  enablePostprocess ? 'bg-[#6366F1]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    enablePostprocess ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Toggle 3: Texture Enable */}
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-200 font-medium">Texture</span>
                <span title="Generate high-resolution texture map" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <HugeiconsIcon icon={HelpCircleIcon} size={12} />
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enableTexture}
                onClick={() => {
                  const next = !enableTexture;
                  setEnableTexture(next);
                  setGenerationSettings((prev) => ({
                    ...prev,
                    generateTexture: next,
                    texture_enabled: next,
                    textureEnabled: next,
                  }));
                }}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${
                  enableTexture ? 'bg-[#6366F1]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    enableTexture ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Texture Quality: 2K / 4K pills (8K removed as requested) */}
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-300 font-medium">Texture Quality</span>
                <span title="Texture map resolution" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <HugeiconsIcon icon={HelpCircleIcon} size={12} />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/[0.06]">
                {(['2K', '4K'] as const).map((res) => {
                  const isSelected = textureQuality === res;
                  return (
                    <button
                      key={res}
                      type="button"
                      onClick={() => {
                        setTextureQuality(res);
                        setGenerationSettings((prev) => ({
                          ...prev,
                          textureResolution: res,
                          texture_resolution: res,
                          textureQuality: res === '4K' ? 'high' : 'medium',
                        }));
                      }}
                      className={`h-6.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#3b3577] text-white border border-[#6366F1] shadow-sm'
                          : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <span>{res}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Toggle 4: Remove Lighting */}
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-200 font-medium">Remove Lighting</span>
                <span title="De-light albedo textures to extract true material colors" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <HugeiconsIcon icon={HelpCircleIcon} size={12} />
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={removeLighting}
                onClick={() => {
                  const next = !removeLighting;
                  setRemoveLighting(next);
                  setGenerationSettings((prev) => ({ ...prev, removeBackground: next }));
                }}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${
                  removeLighting ? 'bg-[#6366F1]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    removeLighting ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Toggle 5: PBR */}
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-200 font-medium">PBR</span>
                <span title="Generate physically based roughness, metallic and normal maps" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <HugeiconsIcon icon={HelpCircleIcon} size={12} />
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enablePbr}
                onClick={() => {
                  const next = !enablePbr;
                  setEnablePbr(next);
                  setGenerationSettings((prev) => ({ ...prev, highResolutionNormalBaking: next }));
                }}
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${
                  enablePbr ? 'bg-[#6366F1]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    enablePbr ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Topology Mode: Quad / Triangle (Controlled by Post-Processing) */}
            <div className={`space-y-1 pt-0.5 transition-all duration-200 ${!enablePostprocess ? 'opacity-35 pointer-events-none select-none cursor-not-allowed' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-zinc-300 font-medium">Topology</span>
                  <span title="Target mesh face topology structure (requires Post-Processing)" className="text-zinc-500 hover:text-zinc-300 transition-colors">
                    <HugeiconsIcon icon={HelpCircleIcon} size={12} />
                  </span>
                </div>
                {!enablePostprocess && (
                  <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Off</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/[0.06]">
                <button
                  type="button"
                  disabled={!enablePostprocess}
                  onClick={() => {
                    setTopologyMode('Quad');
                    setGenerationSettings((prev) => ({ ...prev, quadTopology: true, topologyMode: 'quad' }));
                  }}
                  className={`h-6.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    !enablePostprocess ? 'cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    topologyMode === 'Quad'
                      ? 'bg-[#3b3577] text-white border border-[#6366F1] shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="text-[11px]">▢</span>
                  <span>Quad</span>
                </button>
                <button
                  type="button"
                  disabled={!enablePostprocess}
                  onClick={() => {
                    setTopologyMode('Triangle');
                    setGenerationSettings((prev) => ({ ...prev, quadTopology: false, topologyMode: 'triangle' }));
                  }}
                  className={`h-6.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    !enablePostprocess ? 'cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    topologyMode === 'Triangle'
                      ? 'bg-[#3b3577] text-white border border-[#6366F1] shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="text-[11px]">△</span>
                  <span>Triangle</span>
                </button>
              </div>
            </div>

            {/* Polycount Slider (Controlled by Post-Processing, Max 600K) */}
            <div className={`space-y-1 pt-1 border-t border-white/[0.08] transition-all duration-200 ${!enablePostprocess ? 'opacity-35 pointer-events-none select-none cursor-not-allowed' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-zinc-300 font-medium">Polycount (Target)</span>
                  {!enablePostprocess && (
                    <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Off</span>
                  )}
                </div>
                <span className="text-[11px] font-mono text-[#F9CF00] font-bold">
                  {polycount.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                disabled={!enablePostprocess}
                min="500"
                max="600000"
                step="2500"
                value={polycount}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setPolycount(val);
                  setGenerationSettings((prev) => ({
                    ...prev,
                    polycount: val,
                    targetPolycount: val,
                    target_polycount: val,
                    autoOptimizeSettings: { ...prev.autoOptimizeSettings, targetPolycount: val },
                  }));
                }}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#6366F1] disabled:cursor-not-allowed"
              />
              <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500">
                <span>500</span>
                <span>600,000 (Max 600K)</span>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* 4. AI Model Section */}
      <div className="border-t border-[hsl(var(--border))] pt-2 space-y-1" ref={modelDropdownRef}>
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
            className="w-full h-8 px-2 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between text-left transition-all cursor-pointer shadow-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-md bg-[#F9CF00]/10 border border-[#F9CF00]/25 flex items-center justify-center text-[#F9CF00] flex-shrink-0">
                <ThumbsUp className="w-3 h-3 text-[#F9CF00]" />
              </div>
              <div className="min-w-0 flex items-baseline gap-1.5">
                <p className="text-[11px] font-bold text-[hsl(var(--foreground))] truncate">
                  {meshModels.length === 0
                    ? (modelsLoading ? 'Checking weights...' : 'No weights installed')
                    : (meshModels.find((m) => m.id === selectedModel)?.label || meshModels[0]?.label || 'Select Model')}
                </p>
                {meshModels.length > 0 && (
                  <span className="text-[9px] text-[hsl(var(--muted-foreground))] truncate hidden sm:inline opacity-75">
                    {meshModels.find((m) => m.id === selectedModel)?.tag}
                  </span>
                )}
              </div>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] flex-shrink-0 ml-1 transition-transform duration-200 ${
                isModelDropdownOpen ? 'rotate-180 text-primary' : ''
              }`}
            />
          </button>

          {/* AI Model Dropdown opens DOWNWARDS */}
          {isModelDropdownOpen && (
            <div
              role="listbox"
              aria-label="Available AI models"
              className="absolute top-full mt-1 left-0 right-0 rounded-xl bg-[#1a1b26] border border-white/10 shadow-2xl p-1 z-40 space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
            >
              {meshModels.length === 0 ? (
                <div className="px-3 py-2 text-center text-zinc-400 text-[11px]">
                  {modelsLoading ? 'Checking model weights...' : 'No models with downloaded weights found. Use Manager to download weights.'}
                </div>
              ) : (
                meshModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selectedModel === m.id}
                    onClick={() => handleModelSelect(m.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all cursor-pointer flex items-center justify-between ${
                      selectedModel === m.id
                        ? 'bg-[#F9CF00] text-black font-bold shadow-sm'
                        : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="min-w-0 pr-1">
                      <span className="block font-semibold truncate leading-tight">{m.label}</span>
                      <span className="text-[9px] opacity-70 block truncate leading-tight">{m.note}</span>
                    </div>
                    <span className="text-[9px] font-mono opacity-65 flex-shrink-0">{m.tag}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4b. Seed & Randomizer */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Seed</span>
          {seed !== '' && (
            <button
              type="button"
              onClick={() => {
                setSeed('');
                setGenerationSettings((prev) => ({ ...prev, seed: undefined }));
              }}
              className="text-[9px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              Reset to Random
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
          <div className="relative flex-1 flex items-center min-w-0">
            <span className="text-xs pl-2 pr-1 text-zinc-200 select-none">🎲</span>
            <input
              type="number"
              placeholder="Random (or 123456)"
              value={seed}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                if (val === '' || (!isNaN(val) && val >= 0)) {
                  setSeed(val);
                  setGenerationSettings((prev) => ({ ...prev, seed: val === '' ? undefined : val }));
                }
              }}
              className="w-full bg-transparent text-xs text-white placeholder:text-zinc-400 focus:outline-none font-mono py-1 pr-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const newSeed = Math.floor(Math.random() * 900000) + 100000;
              setSeed(newSeed);
              setGenerationSettings((prev) => ({ ...prev, seed: newSeed }));
              toast.info(`New random seed: ${newSeed}`);
            }}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/15 text-zinc-100 hover:text-white text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 border border-white/[0.08] active:scale-95"
            title="Generate new random seed"
          >
            <RotateCw className="w-2.5 h-2.5" />
            <span>New</span>
          </button>
        </div>
      </div>
      </div>
      </div>

      {/* 5. Bottom Action CTA Button & Execution Progress (Pinned, Never Clipped) */}
      <div className="p-2.5 pt-2 border-t border-white/[0.06] bg-[hsl(var(--surface-1))] flex-shrink-0 space-y-2">
        {isExecuting ? (
          <div className="p-3 rounded-2xl bg-[#141524] border border-[#F9CF00]/30 shadow-xl space-y-2.5 animate-in fade-in">
            {/* Live Progress Header */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-4 h-4 border-2 border-[#F9CF00] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-semibold text-white truncate text-[11px]">
                  {executionStep || 'Generating 3D model...'}
                </span>
              </div>
              <span className="font-mono font-bold text-[#F9CF00] text-xs flex-shrink-0">
                {Math.round(executionProgress)}%
              </span>
            </div>

            {/* Progress Bar Track */}
            <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-[#F9CF00] to-[#FFE04D] transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(4, Math.min(100, Math.round(executionProgress)))}%` }}
              />
            </div>

            {/* Cancel Button */}
            <button
              type="button"
              onClick={handleCancel}
              className="w-full py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 hover:text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.98]"
            >
              <HugeiconsIcon icon={Cancel} size={14} />
              <span>Cancel Generation</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!generationSettings.image && !imagePreview}
            className="w-full h-8 rounded-full bg-[#F9CF00] hover:bg-[#ffdb29] text-black font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#F9CF00]/15 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-4 h-4 text-black" />
            <span>Generate Model</span>
          </button>
        )}
      </div>
    </div>
  );
};
