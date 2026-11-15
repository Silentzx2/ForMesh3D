'use client';

import React from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { LoaderCircleIcon, CheckIcon, AlertCircleIcon } from '@hugeicons/core-free-icons';

/** Internal progress state machine: empty → loading → completed → error. */
export type ProgressStageStatus = 'empty' | 'loading' | 'completed' | 'error';

export interface JobProgressStageProps {
  label: string;
  status?: ProgressStageStatus;
  className?: string;
}

/**
 * JobProgressStage — label chip + status icon (spinner / check / alert).
 *
 * Status-driven icon:
 *   empty   → no icon (label chip only)
 *   loading → spinning LoaderCircleIcon
 *   completed → CheckIcon (green)
 *   error   → AlertCircleIcon (rose)
 *
 * No duplicated progress state: status is derived from the single source of truth
 * (useWorkspace executionStatus/executionStep/executionProgress) passed in by the consumer.
 */
export const JobProgressStage: React.FC<JobProgressStageProps> = React.memo(function JobProgressStage({
  label,
  status = 'empty',
  className = '',
}) {
  const config: Record<ProgressStageStatus, { icon: IconSvgElement | null; color: string; animate: boolean }> = {
    empty: { icon: null, color: '#6B7280', animate: false },
    loading: { icon: LoaderCircleIcon, color: '#F9CF00', animate: true },
    completed: { icon: CheckIcon, color: '#10B981', animate: false },
    error: { icon: AlertCircleIcon, color: '#EF4444', animate: false },
  };

  const cfg = config[status];

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-medium leading-none',
        'border-transparent bg-transparent',
        status === 'loading' ? 'border-[#F9CF00]/40 text-[#F9CF00]' : '',
        status === 'completed' ? 'border-emerald-500/40 text-emerald-400' : '',
        status === 'error' ? 'border-rose-500/40 text-rose-400' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {cfg.icon && (
        <HugeiconsIcon icon={cfg.icon} size={10} className={cfg.animate ? 'animate-spin' : ''} />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
});

JobProgressStage.displayName = 'JobProgressStage';
