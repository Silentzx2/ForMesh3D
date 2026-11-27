'use client';
import React from 'react';

export interface JobProgressBarProps {
  progress?: number | null;
  label?: string;
  status?: 'empty' | 'queued' | 'loading' | 'completed' | 'error';
  queuePosition?: number | null;
  totalPending?: number | null;
  className?: string;
}
export const JobProgressBar: React.FC<JobProgressBarProps> = React.memo(function JobProgressBar({
  progress = null, label, status = 'empty', queuePosition, totalPending, className = '',
}) {
  const isDeterminate = status !== 'queued' && typeof progress === 'number' && Number.isFinite(progress);
  const pct = status === 'completed' ? 100 : isDeterminate ? Math.max(0, Math.min(100, Math.round(progress as number))) : 0;
  const isIndeterminate = status === 'queued' || (status === 'loading' && !isDeterminate);
  const barColor = status === 'loading' ? 'bg-gradient-to-r from-[#F9CF00] to-[#FFE04D]'
    : status === 'queued' ? 'bg-zinc-400'
    : status === 'completed' ? 'bg-emerald-500'
    : status === 'error' ? 'bg-rose-500'
    : 'bg-gradient-to-r from-[#F9CF00] to-[#FFE04D]';
  const rightLabel = status === 'queued'
    ? (typeof queuePosition === 'number' ? `Queue ${queuePosition}${typeof totalPending === 'number' ? ` / ${totalPending}` : ''}` : 'Queued')
    : status === 'loading' ? (isDeterminate ? `${pct}%` : 'Processing')
    : status === 'completed' ? '100%'
    : status === 'error' ? 'Failed' : '';
  return (
    <div className={['w-full space-y-1.5', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-between text-[10px]">
        {label && <span className={`font-semibold truncate min-w-0 pr-2 ${status === 'loading' ? 'text-[#F9CF00]' : 'text-zinc-300'}`}>{label}</span>}
        <span className="font-mono font-bold flex-shrink-0">{rightLabel}</span>
      </div>
      <div role="progressbar" aria-label={label || 'Job progress'} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={isDeterminate || status === 'completed' ? pct : undefined}
        aria-valuetext={rightLabel || (isIndeterminate ? 'In progress' : undefined)}
        className="w-full h-2 rounded-full bg-black/40 overflow-hidden border border-white/10">
        <div className={`h-full rounded-full ${barColor} ${isDeterminate || status === 'completed' ? 'transition-all duration-300' : isIndeterminate ? 'w-1/3 animate-pulse' : 'w-0'}`}
          style={isDeterminate || status === 'completed' ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  );
});
JobProgressBar.displayName = 'JobProgressBar';
