'use client';

import React, { useState, useMemo } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import {
  Bone,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
} from '@/components/icons/hugeicons-components';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import {
  ActiveMeshBar,
  isValidMeshAsset,
  deriveDownstreamToolState,
} from '../components';

export const RiggingPanel: React.FC = () => {
  const {
    isExecuting,
    executionStatus,
    executionProgress,
    executionStep,
    cancelExecution,
    currentAsset,
    runAutoRigging,
  } = useWorkspace();

  const meshUpload = useMeshAssetUpload();
  const isMeshUploading =
    meshUpload.state.status === 'uploading' || meshUpload.state.status === 'verifying';

  // Verified SkinTokens Neural Rigging Parameters (from skintokens_adapter.py)
  const [useSkeleton, setUseSkeleton] = useState<boolean>(false);
  const [useTransfer, setUseTransfer] = useState<boolean>(true);
  const [usePostprocess, setUsePostprocess] = useState<boolean>(false);
  const [temperature, setTemperature] = useState<number>(1.0);
  const [topK, setTopK] = useState<number>(5);
  const [topP, setTopP] = useState<number>(0.95);
  const [repetitionPenalty, setRepetitionPenalty] = useState<number>(2.0);
  const [numBeams, setNumBeams] = useState<number>(10);

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const hasValidMesh = useMemo(() => isValidMeshAsset(currentAsset), [currentAsset]);
  const panelState = deriveDownstreamToolState({
    hasValidMesh,
    isUploading: isMeshUploading,
    executionStatus,
    isExecuting,
  });

  const handleAutoRig = async () => {
    if (!hasValidMesh) {
      toast.error('Please select or upload a 3D mesh first');
      return;
    }
    try {
      await runAutoRigging({
        skeletonTemplate: 'humanoid',
        exportFormat: 'glb',
        modelPreference: 'skintokens_auto_rigging',
        modelParameters: {
          top_k: topK,
          top_p: topP,
          temperature,
          repetition_penalty: repetitionPenalty,
          num_beams: numBeams,
          use_skeleton: useSkeleton,
          use_transfer: useTransfer,
          use_postprocess: usePostprocess,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Auto-rigging error', { description: msg });
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Auto-rigging cancelled');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Cancel failed: ${msg}`);
    }
  };

  return (
    <div
      data-panel-state={panelState}
      className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-[hsl(var(--primary))]/15 flex items-center justify-center text-[hsl(var(--primary))]">
            <Bone className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-xs font-semibold text-zinc-100 tracking-normal truncate">
            3D Rigging
          </h2>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] text-zinc-400 border border-white/[0.08]">
          GLB
        </span>
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

        {/* Rigging Type: Humanoid (Verified SkinTokens Mode) */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-300 block">
            Rigging Type
          </span>
          <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--accent))]/60 flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[hsl(var(--accent))]/15 border border-[hsl(var(--accent))]/30 flex items-center justify-center text-[hsl(var(--accent))] flex-shrink-0">
                <Bone className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-100">Humanoid Rig</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-zinc-300">
                    SkinTokens
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                  Autoregressive skeleton &amp; skinning weights (GLB output)
                </p>
              </div>
            </div>
          </div>

          {/* Informational T/A-pose guidance only */}
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[11px] text-zinc-400">
            <HugeiconsIcon icon={InformationCircleIcon} size={14} className="text-zinc-400 flex-shrink-0" />
            <span>Use a T- or A-pose mesh for best rigging results.</span>
          </div>
        </div>

        {/* Inline Collapsible SkinTokens Parameters */}
        <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))] overflow-hidden">
          <button
            type="button"
            aria-expanded={isSettingsOpen}
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            className="w-full h-9 px-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span className="text-xs font-medium text-zinc-200">SkinTokens Settings</span>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                isSettingsOpen ? 'rotate-90 text-[hsl(var(--primary))]' : ''
              }`}
            />
          </button>

          {isSettingsOpen && (
            <div className="p-3 pt-2 border-t border-white/[0.08] space-y-3 bg-black/20">
              {/* Sampling Temperature */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="rig-temperature" className="text-zinc-300">
                    Temperature
                  </label>
                  <span className="font-mono text-[11px] text-zinc-200 font-semibold">
                    {temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  id="rig-temperature"
                  type="range"
                  min={0.01}
                  max={2.0}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer accent-[hsl(var(--primary))]"
                />
              </div>

              {/* Top-P */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="rig-top-p" className="text-zinc-300">
                    Top-P
                  </label>
                  <span className="font-mono text-[11px] text-zinc-200 font-semibold">
                    {topP.toFixed(2)}
                  </span>
                </div>
                <input
                  id="rig-top-p"
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer accent-[hsl(var(--primary))]"
                />
              </div>

              {/* Repetition Penalty */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="rig-rep-penalty" className="text-zinc-300">
                    Repetition Penalty
                  </label>
                  <span className="font-mono text-[11px] text-zinc-200 font-semibold">
                    {repetitionPenalty.toFixed(1)}
                  </span>
                </div>
                <input
                  id="rig-rep-penalty"
                  type="range"
                  min={1.0}
                  max={5.0}
                  step={0.1}
                  value={repetitionPenalty}
                  onChange={(e) => setRepetitionPenalty(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer accent-[hsl(var(--primary))]"
                />
              </div>

              {/* Top-K & Num Beams */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">
                    Top-K (<span className="font-mono">{topK}</span>)
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {[3, 5, 10].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTopK(k)}
                        className={`h-7 rounded-md text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                          topK === k
                            ? 'bg-[hsl(var(--accent))] text-white'
                            : 'bg-white/[0.04] text-zinc-400 hover:text-white'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-400 block">
                    Beams (<span className="font-mono">{numBeams}</span>)
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {[5, 10, 15].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setNumBeams(b)}
                        className={`h-7 rounded-md text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                          numBeams === b
                            ? 'bg-[hsl(var(--accent))] text-white'
                            : 'bg-white/[0.04] text-zinc-400 hover:text-white'
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Boolean Toggles */}
              <div className="space-y-2 pt-1 border-t border-white/[0.08]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs text-zinc-200 font-medium block">Use Existing Skeleton</span>
                    <span className="text-[11px] text-zinc-400">Keep source mesh skeleton if present</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useSkeleton}
                    onClick={() => setUseSkeleton((v) => !v)}
                    className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                      useSkeleton ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        useSkeleton ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs text-zinc-200 font-medium block">Texture &amp; Scale Transfer</span>
                    <span className="text-[11px] text-zinc-400">Preserve original textures and scale</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useTransfer}
                    onClick={() => setUseTransfer((v) => !v)}
                    className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                      useTransfer ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        useTransfer ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs text-zinc-200 font-medium block">Voxel Skin Postprocess</span>
                    <span className="text-[11px] text-zinc-400">Refine volumetric skinning weights</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={usePostprocess}
                    onClick={() => setUsePostprocess((v) => !v)}
                    className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                      usePostprocess ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        usePostprocess ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
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
                  {executionStep || 'Auto-rigging character...'}
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
              onClick={handleAutoRig}
              disabled={!hasValidMesh || isMeshUploading}
              className="w-full h-9 rounded-full bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5 text-black" />
              <span>Auto-Rig Character</span>
            </button>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 font-mono">
              <span>SkinTokens · Humanoid</span>
              <span>Output: GLB</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
