'use client';

import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ZapIcon, CpuIcon } from '@hugeicons/core-free-icons';
import { EngineMode } from '../services/meshProcessingBridge';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

interface EngineModeSelectorProps {
  mode: EngineMode;
  onChange: (mode: EngineMode) => void;
  tool: 'remesh' | 'uv' | 'segment' | 'rig';
  activeScriptId?: string;
  onScriptChange?: (scriptId: string) => void;
  className?: string;
  aiDisabled?: boolean;
  aiDisabledReason?: string;
}

export const EngineModeSelector: React.FC<EngineModeSelectorProps> = ({
  mode,
  onChange,
  tool,
  activeScriptId,
  onScriptChange,
  className = '',
  aiDisabled,
  aiDisabledReason,
}) => {
  const { systemStats } = useWorkspace();
  const hasGpu = Boolean(
    (systemStats as any)?.gpu_available ??
    (systemStats?.gpu && systemStats.gpu !== 'None' && systemStats.gpu !== 'CPU' && systemStats.gpu !== '')
  );

  const isAiDisabled =
    aiDisabled !== undefined
      ? aiDisabled
      : !hasGpu;

  const disabledReason =
    aiDisabledReason ||
    (!hasGpu
      ? 'No GPU available'
      : 'AI mode unavailable');

  const engineSubtitle = isAiDisabled
    ? 'Script Only'
    : mode === 'ai'
    ? (tool === 'rig'
        ? (isAiDisabled ? 'GPU Offline' : 'GPU (SkinTokens)')
        : tool === 'uv'
        ? (isAiDisabled ? 'GPU Offline' : 'GPU (PartUV)')
        : tool === 'remesh'
        ? (isAiDisabled ? 'GPU Offline' : 'GPU (TriFlow)')
        : tool === 'segment'
        ? (isAiDisabled ? 'GPU Offline' : 'GPU (PartField)')
        : (isAiDisabled ? 'GPU Offline' : 'GPU Neural'))
    : 'CPU Script';

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between text-[9.5px] text-zinc-400 px-0.5">
        <span className="font-semibold uppercase tracking-wider">Engine</span>
        <span className="font-mono text-[9px] text-zinc-500">
          {engineSubtitle}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-black/40 border border-white/[0.06] h-7">
        {isAiDisabled ? (
          <SimpleTooltip label={disabledReason} side="top">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="w-full h-6 rounded-md text-[10.5px] font-bold flex items-center justify-center gap-1 opacity-40 bg-zinc-800/80 text-zinc-500 cursor-not-allowed select-none"
            >
              <HugeiconsIcon icon={ZapIcon} size={12} className="flex-shrink-0" />
              <span>AI Model</span>
            </button>
          </SimpleTooltip>
        ) : (
          <button
            type="button"
            onClick={() => onChange('ai')}
            className={`h-6 rounded-md text-[10.5px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
              mode === 'ai'
                ? 'bg-[#F9CF00] text-black shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <HugeiconsIcon icon={ZapIcon} size={12} className="flex-shrink-0" />
            <span>AI Model</span>
          </button>
        )}
      </div>
    </div>
  );
};
