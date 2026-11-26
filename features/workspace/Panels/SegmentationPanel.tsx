'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import {
  Scissors,
  SlidersHorizontal,
  ChevronRight,
  Palette,
  GitFork,
  FolderArchive,
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

export const SegmentationPanel: React.FC = () => {
  const {
    isExecuting,
    executionStatus,
    executionProgress,
    executionStep,
    cancelExecution,
    runSegmentation,
    currentAsset,
  } = useWorkspace();

  const meshUpload = useMeshAssetUpload();
  const isMeshUploading =
    meshUpload.state.status === 'uploading' || meshUpload.state.status === 'verifying';

  // Core Segmentation parameter state
  const [partFieldReadiness, setPartFieldReadiness] = useState<{
    status: 'checking' | 'ready' | 'unavailable';
    reason: string;
  }>({ status: 'checking', reason: 'Checking PartField runtime…' });
  const [numParts, setNumParts] = useState<number>(8);
  const [hierarchical, setHierarchical] = useState<boolean>(false);

  // Inline Advanced Segmentation Settings state
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [minFaceThreshold, setMinFaceThreshold] = useState<number>(50);
  const [saveIndividualParts, setSaveIndividualParts] = useState<boolean>(true);
  const [outputFormat, setOutputFormat] = useState<'glb' | 'obj'>('glb');
  const [colorizePreview, setColorizePreview] = useState<boolean>(true);

  const hasValidMesh = useMemo(() => isValidMeshAsset(currentAsset), [currentAsset]);
  const panelState = deriveDownstreamToolState({
    hasValidMesh,
    isUploading: isMeshUploading,
    executionStatus,
    isExecuting,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/segment/readiness', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Readiness check failed (${response.status})`);
        return response.json();
      })
      .then((data: { available?: boolean; reason?: string }) => {
        setPartFieldReadiness({
          status: data.available ? 'ready' : 'unavailable',
          reason: data.available
            ? 'PartField runtime ready'
            : data.reason || 'PartField model runtime is not ready',
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPartFieldReadiness({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'Could not verify PartField runtime',
        });
      });
    return () => controller.abort();
  }, []);

  const handleRunSegmentation = async () => {
    if (partFieldReadiness.status !== 'ready') {
      toast.error('PartField AI is unavailable', {
        description: partFieldReadiness.reason || 'Check the backend GPU, checkpoint, and dependencies.',
      });
      return;
    }
    if (!hasValidMesh) {
      toast.error('Please select or upload a 3D mesh first');
      return;
    }
    try {
      await runSegmentation({
        numParts,
        method: 'semantic',
        hierarchical,
        outputFormat,
        modelParameters: {
          method: 'semantic',
          hierarchical,
          min_face_island_threshold: minFaceThreshold,
          save_individual_parts: saveIndividualParts,
          colorize_preview: colorizePreview,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Mesh segmentation failed: ${msg}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Mesh segmentation cancelled');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Cancel failed: ${msg}`);
    }
  };

  const partsPercentage = Math.round(((numParts - 2) / (32 - 2)) * 100);
  const minFacePercentage = Math.round(((minFaceThreshold - 10) / (500 - 10)) * 100);

  return (
    <div
      data-panel-state={panelState}
      className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-[hsl(var(--primary))]/15 flex items-center justify-center text-[hsl(var(--primary))]">
            <Scissors className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-xs font-semibold text-zinc-100 tracking-normal truncate">
            Mesh Segmentation
          </h2>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] text-zinc-400 border border-white/[0.08]">
          PartField
        </span>
      </div>

      {/* Scrollable Tool Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 workspace-tool-body">
        <ActiveMeshBar
          uploadState={meshUpload.state}
          onUploadFile={meshUpload.upload}
          onCancelUpload={meshUpload.cancel}
          onResetUpload={meshUpload.reset}
        />

        {/* Target Parts Presets */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">Target Parts</span>
            <span className="text-[11px] font-mono text-[hsl(var(--primary))] font-semibold">
              {numParts} Parts
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.08]">
            {([4, 8, 16, 24] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setNumParts(preset)}
                className={`h-7.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  numParts === preset
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Fine-Grain Target Parts Slider */}
        <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08]">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-300">Part Count</span>
            <span className="font-mono text-[11px] text-zinc-200 font-semibold">
              {numParts}
            </span>
          </div>
          <input
            type="range"
            aria-label="Target Parts Count"
            min={2}
            max={32}
            step={1}
            value={numParts}
            onChange={(e) => setNumParts(parseInt(e.target.value, 10))}
            style={{
              background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${partsPercentage}%, rgba(255, 255, 255, 0.1) ${partsPercentage}%, rgba(255, 255, 255, 0.1) 100%)`,
            }}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[hsl(var(--primary))]"
          />
          <div className="flex justify-between text-[11px] font-mono text-zinc-400">
            <span>2</span>
            <span>16</span>
            <span>32</span>
          </div>
        </div>

        {/* Inline Collapsible Advanced Segmentation Settings */}
        <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))] overflow-hidden">
          <button
            type="button"
            aria-expanded={isAdvancedOpen}
            onClick={() => setIsAdvancedOpen((prev) => !prev)}
            className="w-full h-9 px-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span className="text-xs font-medium text-zinc-200">Advanced Segmentation</span>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                isAdvancedOpen ? 'rotate-90 text-[hsl(var(--primary))]' : ''
              }`}
            />
          </button>

          {isAdvancedOpen && (
            <div className="p-3 pt-2 border-t border-white/[0.08] space-y-3 bg-black/20">
              {/* Hierarchical Tree */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <GitFork className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
                    <span className="text-xs text-zinc-200 font-medium">Hierarchical Tree</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Multi-level parent-child assembly</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hierarchical}
                  onClick={() => setHierarchical(!hierarchical)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    hierarchical ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      hierarchical ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Min Face Island Threshold */}
              <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">Min Face Island</span>
                  <span className="font-mono text-[11px] text-[hsl(var(--primary))] font-semibold">
                    {minFaceThreshold} faces
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Min Face Island Threshold"
                  min={10}
                  max={500}
                  step={10}
                  value={minFaceThreshold}
                  onChange={(e) => setMinFaceThreshold(parseInt(e.target.value, 10))}
                  style={{
                    background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${minFacePercentage}%, rgba(255, 255, 255, 0.1) ${minFacePercentage}%, rgba(255, 255, 255, 0.1) 100%)`,
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[hsl(var(--primary))]"
                />
              </div>

              {/* Save Individual Part Files */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <FolderArchive className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-zinc-200 font-medium">Save Individual Parts</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Export isolated 3D files per part</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={saveIndividualParts}
                  onClick={() => setSaveIndividualParts(!saveIndividualParts)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    saveIndividualParts ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      saveIndividualParts ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Colorize Part Preview */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                    <span className="text-xs text-zinc-200 font-medium">Colorize Part Preview</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Distinct colors per segmented part</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={colorizePreview}
                  onClick={() => setColorizePreview(!colorizePreview)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    colorizePreview ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      colorizePreview ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Export Format */}
              <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                <span className="text-xs text-zinc-300 font-medium block">Export Format</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['glb', 'obj'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setOutputFormat(fmt)}
                      className={`h-7 rounded-lg text-xs font-mono font-semibold uppercase transition-colors cursor-pointer ${
                        outputFormat === fmt
                          ? 'bg-[hsl(var(--accent))] text-white'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {fmt}
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
        {partFieldReadiness.status !== 'ready' && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-200"
          >
            {partFieldReadiness.status === 'checking'
              ? 'Checking PartField runtime readiness…'
              : partFieldReadiness.reason || 'PartField AI is unavailable. Check CUDA, checkpoint, and dependencies.'}
          </div>
        )}

        {panelState === 'tool_executing' ? (
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-3.5 h-3.5 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-medium text-white truncate">
                  {executionStep || 'Segmenting mesh parts...'}
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
              onClick={handleRunSegmentation}
              disabled={!hasValidMesh || isMeshUploading || partFieldReadiness.status !== 'ready'}
              className="w-full h-9 rounded-full bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Scissors className="w-3.5 h-3.5 text-black" />
              <span>Run AI Segmentation</span>
            </button>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 font-mono">
              <span>{numParts} Parts · Semantic</span>
              <span>{outputFormat.toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
