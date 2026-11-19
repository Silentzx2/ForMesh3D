'use client';

import React from 'react';

/** Determinate progress bar 0-100% with stage text. Status derived from single source of truth. */
export interface JobProgressBarProps {
  /** Progress percent 0-100. */
  progress: number;
  /** Stage label text. */
  label?: string;
  /** Status driving stage icon color: empty | loading | completed | error. */
  status?: 'empty' | 'loading' | 'completed' | 'error';
  className?: string;
}

/**
 * JobProgressBar — determinate 0-100% bar + stage label.
 *
 * Consumes executionProgress/executionStep/executionStatus from useWorkspace (single
 * source of truth). No duplicated progress state lives here.
 */
export const JobProgressBar: React.FC<JobProgressBarProps> = React.memo(function JobProgressBar({
  progress = 0,
  label,
  status = 'empty',
  className = '',
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  const barColor = status === 'loading' ? 'bg-gradient-to-r from-[#F9CF00] to-[#FFE04D]'
    : status === 'completed' ? 'bg-emerald-500'
    : status === 'error' ? 'bg-rose-500'
    : 'bg-gradient-to-r from-[#F9CF00] to-[#FFE04D]';

  return (
    <div className={['w-full space-y-1.5', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-between text-[10px]">
        {label && (
          <span className={[
            'font-semibold truncate min-w-0 pr-2',
            status === 'loading' ? 'text-[#F9CF00]' : 'text-zinc-300',
          ].filter(Boolean).join(' ')}>{label}</span>
        )}
        <span className="font-mono font-bold flex-shrink-0">
          {status === 'completed' || status === 'error' ? pct : pct}%
        </span>
      </div>

      <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden border border-white/10">
        <div
          className={`h-full transition-all duration-300 rounded-full ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
});

JobProgressBar.displayName = 'JobProgressBar';
