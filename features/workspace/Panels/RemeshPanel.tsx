'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import {
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  Layers,
  ShieldCheck,
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

export type GenerationIntent = 'game_ready' | 'cinematic' | 'mobile' | 'native';

export const RemeshPanel: React.FC = () => {
  const {
    isExecuting,
    executionStatus,
    executionProgress,
    executionStep,
    cancelExecution,
    runRemeshGeneration,
    remeshSettings,
    setRemeshSettings,
    currentAsset,
    setGenerationSettings,
  } = useWorkspace();

  const meshUpload = useMeshAssetUpload();
  const isMeshUploading =
    meshUpload.state.status === 'uploading' || meshUpload.state.status === 'verifying';

  // Core Parameters
  const [polyType, setPolyType] = useState<'quad' | 'tri'>(remeshSettings.polyType || 'quad');
  const [targetPolycount, setTargetPolycount] = useState<number>(remeshSettings.targetPolycount || 50000);
  const [localPolycount, setLocalPolycount] = useState<number>(remeshSettings.targetPolycount || 50000);

  // Inline Advanced Settings
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [preserveEdges, setPreserveEdges] = useState(true);
  const [featureAngle, setFeatureAngle] = useState<30 | 45 | 60>(45);
  const [adaptiveDensity, setAdaptiveDensity] = useState(true);
  const [watertightHealing, setWatertightHealing] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'obj' | 'fbx'>('obj');

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasValidMesh = useMemo(() => isValidMeshAsset(currentAsset), [currentAsset]);
  const panelState = deriveDownstreamToolState({
    hasValidMesh,
    isUploading: isMeshUploading,
    executionStatus,
    isExecuting,
  });

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

  useEffect(() => {
    setRemeshSettings((prev) => ({
      ...prev,
      polyType,
      targetPolycount,
    }));

    setGenerationSettings((prev) => ({
      ...prev,
      targetPolycount,
      target_polycount: targetPolycount,
      polycount: targetPolycount,
      topologyMode: polyType === 'quad' ? 'quad' : 'triangle',
      quadTopology: polyType === 'quad',
    }));
  }, [polyType, targetPolycount, setRemeshSettings, setGenerationSettings]);

  const handleRunRetopo = async () => {
    if (!hasValidMesh) {
      toast.error('Please select or upload a 3D mesh first');
      return;
    }
    try {
      await runRemeshGeneration({
        polyType,
        targetPolycount: localPolycount,
        preserveEdges,
        featureAngle,
        adaptiveDensity,
        watertightHealing,
        outputFormat,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Retopology failed: ${msg}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Retopology cancelled');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Cancel failed: ${msg}`);
    }
  };

  const getBudgetTierLabel = (count: number) => {
    if (count <= 10000) return 'Mobile';
    if (count <= 30000) return 'Low-Poly';
    if (count <= 75000) return 'Game Ready';
    return 'Cinematic';
  };

  const sliderPercentage = Math.min(100, Math.max(0, ((localPolycount - 5000) / (200000 - 5000)) * 100));

  return (
    <div
      data-panel-state={panelState}
      className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-[hsl(var(--primary))]/15 flex items-center justify-center text-[hsl(var(--primary))]">
            <RefreshCw className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-xs font-semibold text-zinc-100 tracking-normal">
            Retopology
          </h2>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] text-zinc-400 border border-white/[0.08]">
          Quads &amp; Tris
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

        {/* Topology Type */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-300 block">
            Topology Type
          </span>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setPolyType('quad')}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                polyType === 'quad'
                  ? 'bg-[hsl(var(--accent))] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              Pure Quads
            </button>
            <button
              type="button"
              onClick={() => setPolyType('tri')}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                polyType === 'tri'
                  ? 'bg-[hsl(var(--accent))] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              Triangles
            </button>
          </div>
        </div>

        {/* Target Face Budget */}
        <div className="space-y-2.5 p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">
              Target Face Budget
            </span>
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-xs font-bold text-white">
                {localPolycount.toLocaleString()}
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] font-semibold">
                {getBudgetTierLabel(localPolycount)}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <input
              type="range"
              aria-label="Target Face Budget"
              min={5000}
              max={200000}
              step={1000}
              value={localPolycount}
              onChange={(e) => updatePolycount(parseInt(e.target.value, 10), false)}
              onPointerUp={() => updatePolycount(localPolycount, true)}
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${sliderPercentage}%, rgba(255, 255, 255, 0.1) ${sliderPercentage}%, rgba(255, 255, 255, 0.1) 100%)`,
              }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none accent-[hsl(var(--primary))]"
            />
            <div className="flex justify-between text-[11px] font-mono text-zinc-400">
              <span>5K</span>
              <span>50K</span>
              <span>100K</span>
              <span>200K</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {[
              { label: '5K', val: 5000 },
              { label: '20K', val: 20000 },
              { label: '50K', val: 50000 },
              { label: '100K', val: 100000 },
            ].map((p) => (
              <button
                key={p.val}
                type="button"
                onClick={() => updatePolycount(p.val, true)}
                className={`h-7 rounded-lg text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                  localPolycount === p.val
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'bg-black/30 text-zinc-400 hover:text-white border border-white/[0.06]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* TriFlow AI Info */}
        <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span>TriFlow Neural Engine</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-400">Flow Matching</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-snug">
            Predicts clean edge loops conditioned on your face budget.
          </p>
        </div>

        {/* Inline Collapsible Advanced Settings */}
        <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))] overflow-hidden">
          <button
            type="button"
            aria-expanded={isAdvancedOpen}
            onClick={() => setIsAdvancedOpen((prev) => !prev)}
            className="w-full h-9 px-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
              <span className="text-xs font-medium text-zinc-200">Advanced Settings</span>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                isAdvancedOpen ? 'rotate-90 text-[hsl(var(--primary))]' : ''
              }`}
            />
          </button>

          {isAdvancedOpen && (
            <div className="p-3 pt-2 border-t border-white/[0.08] space-y-3 bg-black/20">
              {/* Preserve Sharp Edges */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                    <span className="text-xs text-zinc-200 font-medium">Preserve Sharp Edges</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Maintains creases on hard surfaces</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preserveEdges}
                  onClick={() => setPreserveEdges(!preserveEdges)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    preserveEdges ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      preserveEdges ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {preserveEdges && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Feature Angle</span>
                    <span className="font-mono text-[11px] text-zinc-400">{featureAngle}°</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[30, 45, 60].map((deg) => (
                      <button
                        key={deg}
                        type="button"
                        onClick={() => setFeatureAngle(deg as 30 | 45 | 60)}
                        className={`h-7 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                          featureAngle === deg
                            ? 'bg-[hsl(var(--accent))] text-white'
                            : 'bg-white/[0.04] text-zinc-400 hover:text-white'
                        }`}
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Adaptive Density */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
                    <span className="text-xs text-zinc-200 font-medium">Adaptive Density</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">More faces on curves, fewer on flats</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={adaptiveDensity}
                  onClick={() => setAdaptiveDensity(!adaptiveDensity)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    adaptiveDensity ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      adaptiveDensity ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Watertight Healing */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-zinc-200 font-medium">Watertight Healing</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Guarantees manifold closed mesh</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={watertightHealing}
                  onClick={() => setWatertightHealing(!watertightHealing)}
                  className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
                    watertightHealing ? 'bg-[hsl(var(--accent))]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                      watertightHealing ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Export Format */}
              <div className="space-y-1 pt-2 border-t border-white/[0.08]">
                <span className="text-xs text-zinc-300 font-medium block">Export Format</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['obj', 'fbx'] as const).map((fmt) => (
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
                  {executionStep || 'Retopologizing mesh...'}
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
              onClick={handleRunRetopo}
              disabled={!hasValidMesh || isMeshUploading}
              className="w-full h-9 rounded-full bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3.5 h-3.5 text-black" />
              <span>Run Neural Retopology</span>
            </button>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 font-mono">
              <span>Target: {localPolycount.toLocaleString()} {polyType === 'quad' ? 'Quads' : 'Tris'}</span>
              <span>{outputFormat.toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
