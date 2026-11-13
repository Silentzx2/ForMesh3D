'use client';

import React from 'react';
import { Zap, Cpu } from 'lucide-react';
import { EngineMode } from '../services/meshProcessingBridge';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

interface EngineModeSelectorProps {
  mode: EngineMode;
  onChange: (mode: EngineMode) => void;
  tool: 'remesh' | 'uv' | 'segment';
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

  const isAiDisabled = aiDisabled || tool === 'segment' || !hasGpu;
  const disabledReason = aiDisabledReason || (tool === 'segment' ? 'No AI model registered on server' : !hasGpu ? 'No GPU available' : 'AI mode unavailable');

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between text-[9.5px] text-zinc-400 px-0.5">
        <span className="font-semibold uppercase tracking-wider">Engine</span>
        <span className="font-mono text-[9px] text-zinc-500">
          {isAiDisabled ? 'Script Only' : mode === 'ai' ? (hasGpu ? 'GPU Neural' : 'GPU Offline') : 'CPU Script'}
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
              <Zap className="w-3 h-3 flex-shrink-0" />
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
            <Zap className="w-3 h-3 flex-shrink-0" />
            <span>AI Model</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onChange('script')}
          className={`h-6 rounded-md text-[10.5px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
            mode === 'script'
              ? 'bg-white text-black shadow-sm'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Cpu className="w-3 h-3 flex-shrink-0" />
          <span>Fast Script</span>
        </button>
      </div>

      {/* Script Sub-selector for UV tool only when in script mode */}
      {mode === 'script' && tool === 'uv' && (
        <div className="flex items-center justify-between pt-0.5 text-[9.5px]">
          <span className="text-zinc-500 font-mono">Algorithm:</span>
          <div className="flex gap-1">
            {[
              { id: 'xatlas_fast', label: 'XAtlas' },
              { id: 'blender_smart_uv', label: 'Blender' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onScriptChange?.(s.id)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono cursor-pointer transition-colors ${
                  activeScriptId === s.id || (!activeScriptId && s.id === 'xatlas_fast')
                    ? 'bg-[#F9CF00]/20 text-[#F9CF00] border border-[#F9CF00]/40 font-bold'
                    : 'bg-black/30 text-zinc-400 hover:text-white border border-white/[0.04]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
