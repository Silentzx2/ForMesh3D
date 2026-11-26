'use client';
import React, { useMemo } from 'react';
import type { ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, TriangleAlertIcon, SparklesIcon } from '@hugeicons/core-free-icons';

export interface QualityMetrics {
  triangles: number | null;
  nonManifoldEdges: number | null;
  holes: number | null;
  featureEdgeRetention: number | null;
  warnings: string[];
  passedGate: boolean | null;
  status: 'Sharp' | 'Clean' | 'Needs Review' | 'Not Assessed';
}
function firstFiniteMetric(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}
function collectWarnings(...sources: unknown[]): string[] {
  const warnings = new Set<string>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) if (typeof item === 'string' && item.trim()) warnings.add(item.trim());
  }
  return [...warnings];
}
export function computeQualityMetrics(asset?: ModelAsset | null, rawResult?: Record<string, any> | null): QualityMetrics {
  const qaReport = (
    asset?.artifacts?.qaReport || (asset as any)?.qa_report ||
    (asset as any)?.quality_trace?.game_ready?.qa || rawResult?.qa_report ||
    rawResult?.quality_report || rawResult?.artifacts?.qaReport
  ) as Record<string, any> | undefined;
  const afterMetrics = qaReport?.after_postprocess?.metrics || qaReport?.metrics || rawResult?.metrics || {};
  const masterToDeriv = qaReport?.master_to_derivative || rawResult?.master_to_derivative || {};
  const meshDetails = ((asset?.meshDetails || rawResult?.mesh_details) || {}) as Record<string, any>;
  const triangles = firstFiniteMetric(asset?.triangles, asset?.faces, afterMetrics.triangle_count,
    afterMetrics.triangles, meshDetails.triangle_count, meshDetails.triangles, rawResult?.triangle_count);
  const nonManifoldEdges = firstFiniteMetric(asset?.nonManifoldEdges, afterMetrics.non_manifold_edges,
    meshDetails.non_manifold_edges, rawResult?.non_manifold_edges,
    asset?.isManifold === true ? 0 : asset?.isManifold === false ? 1 : null);
  const holes = firstFiniteMetric(afterMetrics.hole_count, afterMetrics.holes, meshDetails.hole_count,
    meshDetails.holes, rawResult?.hole_count);
  const featureEdgeRetention = firstFiniteMetric(masterToDeriv.feature_edge_retention,
    afterMetrics.feature_edge_retention, qaReport?.feature_edge_retention,
    meshDetails.feature_edge_retention, rawResult?.feature_edge_retention);
  const warnings = collectWarnings(asset?.qaWarnings, asset?.degradedReasons, qaReport?.warnings,
    rawResult?.warnings, rawResult?.degraded_reasons);
  const topoGate = qaReport?.topology_gate || rawResult?.topology_gate;
  const qualGate = qaReport?.quality_gate || masterToDeriv.quality_gate || rawResult?.quality_gate;
  const qaStatus = String(asset?.qaStatus ?? qaReport?.status ?? rawResult?.qa_status ?? '').toLowerCase();
  const gateResults: boolean[] = [];
  if (typeof topoGate?.passed_clean === 'boolean') gateResults.push(topoGate.passed_clean);
  if (typeof qualGate?.passed === 'boolean') gateResults.push(qualGate.passed);
  if (qaStatus === 'pass') gateResults.push(true);
  if (qaStatus === 'fail' || qaStatus === 'warn') gateResults.push(false);
  const passedGate = gateResults.length ? gateResults.every(Boolean) : null;
  const backendTier = String(asset?.qualityTier || rawResult?.quality_tier ||
    qaReport?.quality_tier || (rawResult?.quality_trace as any)?.quality_tier || '').toLowerCase();
  const explicitReview = asset?.productionStatus === 'degraded' || asset?.productionStatus === 'failed' ||
    qaStatus === 'fail' || qaStatus === 'warn' || warnings.length > 0 || passedGate === false ||
    (nonManifoldEdges !== null && nonManifoldEdges > 0) || (holes !== null && holes > 0);
  let status: QualityMetrics['status'];
  if (backendTier === 'needs_review' || explicitReview) status = 'Needs Review';
  else if (backendTier === 'sharp') status = 'Sharp';
  else if (backendTier === 'clean') status = 'Clean';
  else {
    const retentionRatio = featureEdgeRetention === null ? null
      : featureEdgeRetention <= 1 ? featureEdgeRetention : featureEdgeRetention / 100;
    if (retentionRatio !== null && retentionRatio >= 0.85) status = 'Sharp';
    else if (qaStatus === 'pass' || qualGate?.passed === true || topoGate?.passed_clean === true ||
      (nonManifoldEdges === 0 && holes === 0)) status = 'Clean';
    else status = 'Not Assessed';
  }
  return { triangles, nonManifoldEdges, holes, featureEdgeRetention, warnings, passedGate, status };
}
export interface QualityBadgeProps {
  asset?: ModelAsset | null;
  rawResult?: Record<string, any> | null;
  metrics?: Partial<QualityMetrics>;
  className?: string;
  size?: 'sm' | 'md';
}
export const QualityBadge: React.FC<QualityBadgeProps> = React.memo(({
  asset, rawResult, metrics: customMetrics, className = '', size = 'md',
}) => {
  const computed = useMemo(() => {
    const base = computeQualityMetrics(asset, rawResult);
    return { ...base, ...customMetrics, status: customMetrics?.status ?? base.status, warnings: customMetrics?.warnings ?? base.warnings };
  }, [asset, rawResult, customMetrics]);
  const { status, triangles, nonManifoldEdges, holes, featureEdgeRetention, warnings, passedGate } = computed;
  const badgeConfig = {
    Sharp: { label: 'Sharp', icon: SparklesIcon, style: 'bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] border-[hsl(var(--primary))]/30', dotStyle: 'bg-[hsl(var(--primary))]' },
    Clean: { label: 'Clean', icon: CheckIcon, style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dotStyle: 'bg-emerald-400' },
    'Needs Review': { label: 'Needs Review', icon: TriangleAlertIcon, style: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dotStyle: 'bg-amber-400' },
    'Not Assessed': { label: 'Not assessed', icon: null, style: 'bg-white/[0.05] text-zinc-400 border-white/[0.10]', dotStyle: 'bg-zinc-500' },
  }[status];
  const metricDisplay = (value: number | null | undefined) => value == null ? 'Not reported' : value.toLocaleString();
  const retentionDisplay = featureEdgeRetention == null ? 'Not reported'
    : `${(featureEdgeRetention <= 1 ? featureEdgeRetention * 100 : featureEdgeRetention).toFixed(1)}%`;
  const gateDisplay = passedGate == null ? 'Not reported' : passedGate ? 'Passed' : 'Failed';
  const tooltipContent = (
    <div className="space-y-1.5 text-left py-1 px-0.5 text-[10px]">
      <div className="font-bold border-b border-white/10 pb-1 flex items-center justify-between gap-3">
        <span className="text-white">Mesh Quality Report</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${badgeConfig.style}`}>{status}</span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4 text-zinc-300"><span>Triangles</span><span className="font-mono text-white font-bold">{metricDisplay(triangles)}</span></div>
        <div className="flex justify-between gap-4 text-zinc-300"><span>Non-Manifold Edges</span><span className={`font-mono font-bold ${nonManifoldEdges == null ? 'text-zinc-400' : nonManifoldEdges > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{metricDisplay(nonManifoldEdges)}</span></div>
        <div className="flex justify-between gap-4 text-zinc-300"><span>Holes</span><span className={`font-mono font-bold ${holes == null ? 'text-zinc-400' : holes > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{metricDisplay(holes)}</span></div>
        <div className="flex justify-between gap-4 text-zinc-300"><span>Feature Edge Retention</span><span className="font-mono text-[hsl(var(--primary))] font-bold">{retentionDisplay}</span></div>
        <div className="flex justify-between gap-4 text-zinc-300"><span>QA Gate</span><span className="font-mono text-white font-bold">{gateDisplay}</span></div>
      </div>
      {warnings.length > 0 && <div className="pt-1 border-t border-white/10 text-[9px] text-amber-300/90 leading-tight">{warnings[0]}</div>}
    </div>
  );
  return (
    <SimpleTooltip label={tooltipContent} side="top">
      <span data-testid="quality-badge" className={`inline-flex items-center gap-1 font-semibold rounded-md border tracking-wide transition-colors cursor-help ${size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'} ${badgeConfig.style}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${badgeConfig.dotStyle}`} />
        {badgeConfig.icon && <HugeiconsIcon icon={badgeConfig.icon} size={size === 'sm' ? 11 : 13} className="stroke-[2.5]" />}
        <span>{badgeConfig.label}</span>
      </span>
    </SimpleTooltip>
  );
});
QualityBadge.displayName = 'QualityBadge';
