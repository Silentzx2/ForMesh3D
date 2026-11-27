'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useFeatureAvailability } from '@/hooks/useFeatureAvailability';
import {
  Sparkles,
  Palette,
  ImageIcon,
  RotateCw,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit2,
  Cpu,
  Layers,
  Sun,
} from '@/components/icons/hugeicons-components';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import {
  ActiveMeshBar,
  isValidMeshAsset,
  deriveDownstreamToolState,
} from '../components';

export type GenerationIntent = 'game_ready' | 'cinematic' | 'mobile' | 'native';

export const TexturePanel: React.FC = () => {
  const {
    isExecuting,
    executionStatus,
    executionProgress,
    executionStep,
    cancelExecution,
    runTextureGeneration,
    generationSettings,
    setGenerationSettings,
    textureSettings,
    setTextureSettings,
    currentAsset,
    activeTool,
    navigateToTool,
  } = useWorkspace();

  const { modelDetails, weightsStatus, loading: modelsLoading } = useFeatureAvailability();

  const textureModels = useMemo(() => {
    const registeredIds = Object.keys(modelDetails);
    const candidatePool = registeredIds.filter((mid) => {
      const detail = modelDetails[mid];
      if (!detail || detail.enabled === false) return false;
      const type = detail.model_type || '';
      const feat = detail.feature || '';
      return (
        type === 'texture' ||
        feat === 'image_mesh_painting' ||
        feat === 'image-mesh-painting' ||
        feat === 'mesh_painting'
      );
    });
    const uniqueCandidates = Array.from(new Set(candidatePool));

    return uniqueCandidates
      .filter((mid) => weightsStatus[mid] === true || modelDetails[mid]?.weights_available === true)
      .map((mid) => {
        const detail = modelDetails[mid];
        return {
          id: mid,
          label: detail?.name || detail?.ui_label || detail?.model_name || mid,
          tag: detail?.label || detail?.ui_tag || 'Ready',
          note: detail?.description || detail?.ui_note || '',
          badge: detail?.ui_badge || (detail?.vram_requirement ? `${Math.round(detail.vram_requirement / 1024)}GB VRAM` : ''),
        };
      });
  }, [modelDetails, weightsStatus]);

  const defaultTextureModel = useMemo(() => textureModels[0]?.id || '', [textureModels]);
  const [selectedModel, setSelectedModel] = useState(defaultTextureModel);

  useEffect(() => {
    if (textureModels.length > 0 && !textureModels.some((m) => m.id === selectedModel)) {
      setSelectedModel(textureModels[0].id);
    }
  }, [textureModels, selectedModel]);

  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const meshUpload = useMeshAssetUpload();
  const isMeshUploading =
    meshUpload.state.status === 'uploading' || meshUpload.state.status === 'verifying';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Core Parameters
  const [textureQuality, setTextureQuality] = useState<'512' | '1K' | '2K' | '4K'>('2K');
  const [materialStyle, setMaterialStyle] = useState<'realistic' | 'game' | 'stylized' | 'anime'>('realistic');

  // Dynamic Model Capability Mapping
  const selectedModelDetail = modelDetails[selectedModel];
  const modelCapabilities = selectedModelDetail?.capabilities || {};
  const supportsPbr = modelCapabilities.supports_pbr !== false;
  const supportsDelighting = modelCapabilities.supports_delighting !== false;
  const supportedResolutions: ('512' | '1K' | '2K' | '4K')[] =
    (modelCapabilities.supported_texture_resolutions as ('512' | '1K' | '2K' | '4K')[]) || ['1K', '2K'];

  useEffect(() => {
    if (supportedResolutions.length > 0 && !supportedResolutions.includes(textureQuality)) {
      setTextureQuality(supportedResolutions[supportedResolutions.length - 1]);
    }
  }, [selectedModel, supportedResolutions, textureQuality]);

  // Inline Advanced Parameters
  const [isTextureSettingsOpen, setIsTextureSettingsOpen] = useState(false);
  const [removeLighting, setRemoveLighting] = useState(true);
  const [enablePbr, setEnablePbr] = useState(true);
  const [bakeNormal, setBakeNormal] = useState(true);
  const [bakeRoughness, setBakeRoughness] = useState(true);
  const [bakeMetallic, setBakeMetallic] = useState(true);
  const [bakeAo, setBakeAo] = useState(true);
  const [gutterDilation, setGutterDilation] = useState<number>(4);
  const [uvBackend, setUvBackend] = useState<'auto' | 'xatlas'>('auto');
  const [seed, setSeed] = useState<number | ''>(42891);

  const hasValidMesh = useMemo(() => isValidMeshAsset(currentAsset), [currentAsset]);
  const panelState = deriveDownstreamToolState({
    hasValidMesh,
    isUploading: isMeshUploading,
    executionStatus,
    isExecuting,
  });

  useEffect(() => {
    if (generationSettings.image && generationSettings.image !== imagePreview) {
      setImagePreview(generationSettings.image);
    }
  }, [generationSettings.image, imagePreview]);

  useEffect(() => {
    setTextureSettings((prev) => ({
      ...prev,
      resolution: textureQuality,
      style: materialStyle,
      modelId: selectedModel,
      referenceImage: imagePreview || prev.referenceImage,
      maps: {
        ...prev.maps,
        albedo: true,
        normal: supportsPbr && enablePbr && bakeNormal,
        roughness: supportsPbr && enablePbr && bakeRoughness,
        metallic: supportsPbr && enablePbr && bakeMetallic,
        ao: supportsPbr && enablePbr && bakeAo,
      },
    }));

    setGenerationSettings((prev) => ({
      ...prev,
      aiModel: selectedModel,
      textureResolution: textureQuality,
      texture_resolution: textureQuality,
      textureQuality: textureQuality === '4K' ? 'high' : textureQuality === '1K' ? 'low' : 'medium',
      removeBackground: supportsDelighting && removeLighting,
      highResolutionNormalBaking: supportsPbr && enablePbr,
      seed: seed === '' ? undefined : seed,
      image: imagePreview || prev.image,
    }));
  }, [
    textureQuality,
    materialStyle,
    selectedModel,
    imagePreview,
    enablePbr,
    bakeNormal,
    bakeRoughness,
    bakeMetallic,
    bakeAo,
    removeLighting,
    seed,
    supportsPbr,
    supportsDelighting,
    setTextureSettings,
    setGenerationSettings,
  ]);

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

  const processImageFile = (file: File) => {
    setIsDragOver(false);
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Image exceeds 25MB limit');
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
      setTextureSettings((prev) => ({
        ...prev,
        referenceImage: result,
      }));
      toast.success(`Reference image loaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (file) processImageFile(file);
  };

  const handleImageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name))) {
      processImageFile(file);
    }
  };

  const handleRemoveImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setImagePreview(null);
    setGenerationSettings((prev) => ({ ...prev, image: null, imageName: undefined }));
    setTextureSettings((prev) => ({ ...prev, referenceImage: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    setGenerationSettings((prev) => ({ ...prev, aiModel: modelId }));
    setTextureSettings((prev) => ({ ...prev, modelId }));
    setIsModelDropdownOpen(false);
  };

  const handleGenerate = async () => {
    if (!generationSettings.image && !imagePreview && !textureSettings.referenceImage) {
      toast.error('Please upload a reference image first');
      return;
    }
    if (!hasValidMesh) {
      toast.error('Please select or upload a 3D mesh to texture');
      return;
    }
    try {
      await runTextureGeneration();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Texture generation failed: ${msg}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Generation cancelled');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Cancel failed: ${msg}`);
    }
  };

  const activeImage = imagePreview || generationSettings.image || textureSettings.referenceImage;
  const showAdvancedInline = isTextureSettingsOpen || activeTool === 'pbr';

  return (
    <div
      data-panel-state={panelState}
      className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden select-none"
    >
      {/* Header and in-panel Texture / PBR routing */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-[hsl(var(--primary))]/15 flex items-center justify-center text-[hsl(var(--primary))]">
            {activeTool === 'pbr' ? <Layers className="w-3.5 h-3.5" /> : <Palette className="w-3.5 h-3.5" />}
          </div>
          <h2 className="text-xs font-semibold text-zinc-100 tracking-normal truncate">
            {activeTool === 'pbr' ? 'PBR Materials' : 'Texture'}
          </h2>
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-black/30 border border-white/[0.08] p-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => navigateToTool('texture')}
            aria-current={activeTool === 'texture' ? 'page' : undefined}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
              activeTool === 'texture' ? 'bg-[hsl(var(--accent))] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Texture
          </button>
          <button
            type="button"
            onClick={() => navigateToTool('pbr')}
            aria-current={activeTool === 'pbr' ? 'page' : undefined}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
              activeTool === 'pbr' ? 'bg-[hsl(var(--accent))] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            PBR
          </button>
        </div>
      </div>

      {/* Scrollable Tool Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 workspace-tool-body">
        {/* Compact Active-Mesh Strip */}
        <ActiveMeshBar
          uploadState={meshUpload.state}
          onUploadFile={meshUpload.upload}
          onCancelUpload={meshUpload.cancel}
          onResetUpload={meshUpload.reset}
        />

        {/* Compact Reference Image Input */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-300 block">
            Reference Image
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            onChange={handleImageUpload}
            className="hidden"
          />

          {activeImage ? (
            <div className="relative w-full h-[120px] rounded-xl overflow-hidden bg-black/40 border border-white/[0.08] flex items-center justify-center">
              <img
                src={activeImage}
                alt="Reference concept"
                className="max-h-[112px] w-auto max-w-full object-contain"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                aria-label="Remove reference image"
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center border border-white/10 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-1.5 right-1.5 h-6 px-2.5 rounded-full bg-black/75 hover:bg-black border border-white/10 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              >
                <Edit2 className="w-3 h-3" />
                <span>Replace</span>
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload reference image"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleImageDrop}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`w-full h-[96px] rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                isDragOver
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--surface-2))]'
                  : 'border-white/[0.12] hover:border-white/25 bg-black/20'
              }`}
            >
              <ImageIcon className="w-5 h-5 text-zinc-300" />
              <span className="text-xs font-medium text-zinc-200">
                {isDragOver ? 'Drop Image Here' : 'Upload Reference Image'}
              </span>
              <span className="text-[11px] font-mono text-zinc-400">PNG, JPG, WEBP</span>
            </div>
          )}
        </div>

        {/* Atlas Resolution */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">Resolution</span>
            <span className="text-[11px] font-mono text-zinc-400">
              {textureQuality === '512' ? '512' : textureQuality === '1K' ? '1024' : textureQuality === '2K' ? '2048' : '4096'}
            </span>
          </div>
          <div
            className={`grid gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.08] ${
              supportedResolutions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
            }`}
          >
            {supportedResolutions.map((res) => (
              <button
                key={res}
                type="button"
                onClick={() => setTextureQuality(res)}
                className={`h-7.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  textureQuality === res
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
        </div>

        {/* Material Style */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-300 block">Material Style</span>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { id: 'realistic', label: 'Realistic PBR' },
              { id: 'game', label: 'Game Ready' },
              { id: 'stylized', label: 'Stylized' },
              { id: 'anime', label: 'Anime Cel' },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setMaterialStyle(st.id as 'realistic' | 'game' | 'stylized' | 'anime')}
                className={`h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  materialStyle === st.id
                    ? 'bg-[hsl(var(--accent))] text-white font-semibold'
                    : 'bg-black/30 border border-white/[0.08] text-zinc-400 hover:text-white'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* AI Model & Seed */}
        <div className="space-y-2 pt-2 border-t border-white/[0.08]" ref={modelDropdownRef}>
          <div className="space-y-1 relative">
            <label className="text-xs font-medium text-zinc-300 block">AI Model</label>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isModelDropdownOpen}
              aria-label="Select AI Model"
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className="w-full h-8 px-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="w-3.5 h-3.5 text-[hsl(var(--primary))] flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">
                  {textureModels.length === 0
                    ? (modelsLoading ? 'Checking weights...' : 'No weights installed')
                    : (textureModels.find((m) => m.id === selectedModel)?.label || textureModels[0]?.label || 'Select Model')}
                </span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-400 flex-shrink-0 transition-transform ${
                  isModelDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isModelDropdownOpen && (
              <div
                role="listbox"
                aria-label="Available AI models"
                className="absolute top-full mt-1 left-0 right-0 rounded-xl bg-[hsl(var(--surface-2))] border border-white/10 shadow-2xl p-1 z-40 space-y-0.5 max-h-52 overflow-y-auto"
              >
                {textureModels.length === 0 ? (
                  <div className="px-3 py-2 text-center text-zinc-400 text-xs">
                    {modelsLoading ? 'Checking model weights...' : 'No models with downloaded weights found.'}
                  </div>
                ) : (
                  textureModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={selectedModel === m.id}
                      onClick={() => handleModelSelect(m.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-between ${
                        selectedModel === m.id
                          ? 'bg-[hsl(var(--accent))] text-white font-semibold'
                          : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="truncate pr-2">{m.label}</span>
                      <span className="text-[11px] font-mono opacity-80 flex-shrink-0">{m.badge}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Seed */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">Seed</span>
              {seed !== '' && (
                <button
                  type="button"
                  onClick={() => {
                    setSeed('');
                    setGenerationSettings((prev) => ({ ...prev, seed: undefined }));
                  }}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08]">
              <input
                type="number"
                aria-label="Seed"
                placeholder="Random"
                value={seed}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                  if (val === '' || (!isNaN(val) && val >= 0)) {
                    setSeed(val);
                    setGenerationSettings((prev) => ({ ...prev, seed: val === '' ? undefined : val }));
                  }
                }}
                className="w-full bg-transparent text-xs text-white placeholder:text-zinc-500 focus:outline-none font-mono py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => {
                  const newSeed = Math.floor(Math.random() * 900000) + 100000;
                  setSeed(newSeed);
                  setGenerationSettings((prev) => ({ ...prev, seed: newSeed }));
                  toast.info(`New seed: ${newSeed}`);
                }}
                className="flex-shrink-0 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              >
                <RotateCw className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>
          </div>
        </div>

        {/* Inline Collapsible Advanced / PBR Settings */}
        <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))] overflow-hidden">
          {activeTool !== 'pbr' ? (
            <button
              type="button"
              aria-expanded={showAdvancedInline}
              onClick={() => setIsTextureSettingsOpen((prev) => !prev)}
              className="w-full h-9 px-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                <span className="text-xs font-medium text-zinc-200">Advanced &amp; PBR Settings</span>
              </div>
              <ChevronRight
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                  showAdvancedInline ? 'rotate-90 text-[hsl(var(--primary))]' : ''
                }`}
              />
            </button>
          ) : (
            <div className="px-3 py-2 border-b border-white/[0.08] flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span className="text-xs font-semibold text-zinc-100">PBR Map Settings</span>
            </div>
          )}

          {showAdvancedInline && (
            <div className="p-3 pt-2 border-t border-white/[0.08] space-y-3 bg-black/20">
              {supportsDelighting && (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Sun className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                      <span className="text-xs text-zinc-200 font-medium">Remove Lighting</span>
                    </div>
                    <p className="text-[11px] text-zinc-400">Flat albedo without baked shadows</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={removeLighting}
                    onClick={() => setRemoveLighting((prev) => !prev)}
                    className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                      removeLighting ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        removeLighting ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              )}

              {supportsPbr ? (
                <>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
                        <span className="text-xs text-zinc-200 font-medium">Bake PBR Maps</span>
                      </div>
                      <p className="text-[11px] text-zinc-400">Normal, Roughness, Metallic &amp; AO</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enablePbr}
                      onClick={() => setEnablePbr((prev) => !prev)}
                      className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                        enablePbr ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                          enablePbr ? 'translate-x-3.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {enablePbr && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { key: 'normal', label: 'Normal', state: bakeNormal, set: setBakeNormal },
                        { key: 'roughness', label: 'Roughness', state: bakeRoughness, set: setBakeRoughness },
                        { key: 'metallic', label: 'Metallic', state: bakeMetallic, set: setBakeMetallic },
                        { key: 'ao', label: 'Ambient AO', state: bakeAo, set: setBakeAo },
                      ].map((ch) => (
                        <button
                          key={ch.key}
                          type="button"
                          onClick={() => ch.set(!ch.state)}
                          className={`h-7 px-2 rounded-lg text-[11px] font-medium flex items-center justify-between transition-colors cursor-pointer ${
                            ch.state
                              ? 'bg-[hsl(var(--accent))]/25 text-white border border-[hsl(var(--accent))]/60'
                              : 'bg-white/[0.04] text-zinc-400 hover:text-zinc-200 border border-transparent'
                          }`}
                        >
                          <span>{ch.label}</span>
                          <span>{ch.state ? '✓' : '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-zinc-400 rounded-lg bg-black/25 border border-white/[0.08] px-2.5 py-2">
                  This model produces a base-color texture atlas only.
                </p>
              )}

              {/* Gutter Dilation */}
              <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">Gutter Dilation</span>
                  <span className="text-[11px] font-mono text-zinc-400">{gutterDilation}px</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[2, 4, 8].map((px) => (
                    <button
                      key={px}
                      type="button"
                      onClick={() => setGutterDilation(px)}
                      className={`h-7 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                        gutterDilation === px
                          ? 'bg-[hsl(var(--accent))] text-white'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {px}px
                    </button>
                  ))}
                </div>
              </div>

              {/* UV Engine */}
              <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                <span className="text-xs text-zinc-300 block">UV Engine</span>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { id: 'auto', label: 'Smart Auto' },
                    { id: 'xatlas', label: 'xatlas' },
                  ].map((eng) => (
                    <button
                      key={eng.id}
                      type="button"
                      onClick={() => setUvBackend(eng.id as 'auto' | 'xatlas')}
                      className={`h-7 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        uvBackend === eng.id
                          ? 'bg-[hsl(var(--accent))] text-white'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {eng.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Execute / Cancel CTA */}
      <div className="p-3 pt-2.5 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0 space-y-1.5">
        {panelState === 'tool_executing' ? (
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-3.5 h-3.5 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-medium text-white truncate">
                  {executionStep || 'Generating textures...'}
                </span>
              </div>
              <span className="font-mono font-semibold text-[hsl(var(--primary))] flex-shrink-0">
                {Math.round(executionProgress)}%
              </span>
            </div>

            <div className="w-full h-1.5 rounded-full bg-black/40 overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(4, Math.min(100, Math.round(executionProgress)))}%` }}
              />
            </div>

            <button
              type="button"
              onClick={handleCancel}
              className="w-full py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Cancel} size={13} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!hasValidMesh || !activeImage || isMeshUploading}
              className="w-full h-9 rounded-full bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5 text-black" />
              <span>{activeTool === 'pbr' ? 'Generate PBR Maps' : 'Generate Textures'}</span>
            </button>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 font-mono">
              <span>Atlas: {textureQuality}</span>
              <span>{materialStyle}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
