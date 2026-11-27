'use client';

import React, { useState, useMemo } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import {
  Grid3X3,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
  Layers,
  Zap,
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

export const UVPanel: React.FC = () => {
  const {
    isExecuting,
    executionStatus,
    executionProgress,
    executionStep,
    cancelExecution,
    runUVUnwrapGeneration,
    currentAsset,
    shadingMode,
    setShadingMode,
  } = useWorkspace();

  const meshUpload = useMeshAssetUpload();
  const isMeshUploading =
    meshUpload.state.status === 'uploading' || meshUpload.state.status === 'verifying';

  // Core Smart UV parameter state
  const [unwrapStrategy, setUnwrapStrategy] = useState<'organic' | 'hard_surface'>('organic');
  const [atlasResolution, setAtlasResolution] = useState<'1K' | '2K' | '4K'>('2K');
  const [islandMargin, setIslandMargin] = useState<2 | 4 | 8 | 16>(8);

  // Inline Advanced UV Settings state
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [distortionThreshold, setDistortionThreshold] = useState<number>(1.25);
  const [symmetryStacking, setSymmetryStacking] = useState<boolean>(true);
  const [saveIndividualParts, setSaveIndividualParts] = useState<boolean>(true);
  const [outputFormat, setOutputFormat] = useState<'obj' | 'glb'>('glb');

  const hasValidMesh = useMemo(() => isValidMeshAsset(currentAsset), [currentAsset]);
  const panelState = deriveDownstreamToolState({
    hasValidMesh,
    isUploading: isMeshUploading,
    executionStatus,
    isExecuting,
  });

  const handleRunUV = async () => {
    if (!hasValidMesh) {
      toast.error('Please select or upload a 3D mesh first');
      return;
    }
    try {
      await runUVUnwrapGeneration({
        distortionThreshold,
        packMethod: 'blender',
        outputFormat,
        saveIndividualParts,
        unwrapStrategy,
        atlasResolution,
        islandMargin,
        symmetryStacking,
        boundaryPacker: true,
        modelParameters: {
          unwrap_strategy: unwrapStrategy,
          atlas_resolution: atlasResolution,
          island_margin: islandMargin,
          symmetry_stacking: symmetryStacking,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Smart UV unwrapping failed: ${msg}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('UV unwrapping cancelled');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Cancel failed: ${msg}`);
    }
  };

  const distortionPercentage = Math.round(((distortionThreshold - 1.0) / (2.5 - 1.0)) * 100);

  const getMarginLabel = (margin: number) => {
    if (margin === 2) return 'Tight';
    if (margin === 4) return 'Standard';
    if (margin === 8) return 'Safe';
    return 'Wide';
  };

  return (
    <div
      data-panel-state={panelState}
      className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-[hsl(var(--primary))]/15 flex items-center justify-center text-[hsl(var(--primary))]">
            <Grid3X3 className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-xs font-semibold text-zinc-100 tracking-normal truncate">
            Smart UV Unwrap
          </h2>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] text-zinc-400 border border-white/[0.08]">
          PartUV
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

        {/* PartUV Info */}
        <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span>PartUV Neural Unwrap</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-400">8GB VRAM</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-snug">
            Part-based seam prediction &amp; low-distortion parameterization.
          </p>
        </div>

        {/* Unwrap Strategy */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-300 block">
            Unwrap Strategy
          </span>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setUnwrapStrategy('organic')}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                unwrapStrategy === 'organic'
                  ? 'bg-[hsl(var(--accent))] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              Organic
            </button>
            <button
              type="button"
              onClick={() => setUnwrapStrategy('hard_surface')}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                unwrapStrategy === 'hard_surface'
                  ? 'bg-[hsl(var(--accent))] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              Hard-Surface
            </button>
          </div>
        </div>

        {/* Atlas Resolution */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-300 block">
            Atlas Resolution
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.08]">
            {(['1K', '2K', '4K'] as const).map((res) => (
              <button
                key={res}
                type="button"
                onClick={() => setAtlasResolution(res)}
                className={`h-7.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  atlasResolution === res
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
        </div>

        {/* Island Margin */}
        <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">Island Margin</span>
            <span className="text-[11px] font-mono text-[hsl(var(--primary))] font-semibold">
              {islandMargin}px · {getMarginLabel(islandMargin)}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {([2, 4, 8, 16] as const).map((px) => (
              <button
                key={px}
                type="button"
                onClick={() => setIslandMargin(px)}
                className={`h-7 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  islandMargin === px
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'bg-black/30 text-zinc-400 hover:text-white border border-white/[0.06]'
                }`}
              >
                {px}px
              </button>
            ))}
          </div>
        </div>

        {/* Viewport UV Checker Toggle */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08]">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded border border-white/20"
              style={{
                backgroundImage: `conic-gradient(
                  #22252a 0.25turn, #e2e6ed 0.25turn 0.5turn,
                  #22252a 0.5turn 0.75turn, #e2e6ed 0.75turn
                )`,
                backgroundSize: '4px 4px',
              }}
            />
            <span className="text-xs font-medium text-zinc-200">Viewport UV Checker</span>
          </div>
          <button
            type="button"
            onClick={() => setShadingMode(shadingMode === 'uv-checker' ? 'textured' : 'uv-checker')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
              shadingMode === 'uv-checker'
                ? 'bg-[hsl(var(--accent))] text-white'
                : 'bg-white/[0.06] text-zinc-400 hover:text-white'
            }`}
          >
            {shadingMode === 'uv-checker' ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Inline Collapsible Advanced UV Settings */}
        <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))] overflow-hidden">
          <button
            type="button"
            aria-expanded={isAdvancedOpen}
            onClick={() => setIsAdvancedOpen((prev) => !prev)}
            className="w-full h-9 px-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span className="text-xs font-medium text-zinc-200">Advanced UV Settings</span>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                isAdvancedOpen ? 'rotate-90 text-[hsl(var(--primary))]' : ''
              }`}
            />
          </button>

          {isAdvancedOpen && (
            <div className="p-3 pt-2 border-t border-white/[0.08] space-y-3 bg-black/20">
              {/* Distortion Tolerance */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">Distortion Tolerance</span>
                  <span className="font-mono text-[11px] text-[hsl(var(--primary))] font-semibold">
                    {distortionThreshold.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Distortion Tolerance"
                  min={1.0}
                  max={2.5}
                  step={0.05}
                  value={distortionThreshold}
                  onChange={(e) => setDistortionThreshold(parseFloat(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${distortionPercentage}%, rgba(255, 255, 255, 0.1) ${distortionPercentage}%, rgba(255, 255, 255, 0.1) 100%)`,
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[hsl(var(--primary))]"
                />
                <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                  <span>1.0x</span>
                  <span>1.25x</span>
                  <span>2.5x</span>
                </div>
              </div>

              {/* Symmetry Stacking */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
                    <span className="text-xs text-zinc-200 font-medium">Symmetry Stacking</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Overlaps mirrored islands to save texels</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={symmetryStacking}
                  onClick={() => setSymmetryStacking(!symmetryStacking)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    symmetryStacking ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      symmetryStacking ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Separate Sub-Parts */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-zinc-200 font-medium">Separate Sub-Parts</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Isolated charts for distinct mesh parts</p>
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

              {/* Export Format */}
              <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                <span className="text-xs text-zinc-300 font-medium block">Export Format</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['obj', 'glb'] as const).map((fmt) => (
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
        {panelState === 'tool_executing' ? (
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-3.5 h-3.5 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="font-medium text-white truncate">
                  {executionStep || 'Unwrapping UVs...'}
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
              onClick={handleRunUV}
              disabled={!hasValidMesh || isMeshUploading}
              className="w-full h-9 rounded-full bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Grid3X3 className="w-3.5 h-3.5 text-black" />
              <span>Run Smart UV</span>
            </button>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 font-mono">
              <span>{atlasResolution} · {islandMargin}px</span>
              <span>{distortionThreshold.toFixed(2)}x · {outputFormat.toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
