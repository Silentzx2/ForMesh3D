'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { MOTION_SPRING } from '@/lib/motion';

interface ThinkingGenerationCardProps {
  progress: number;
  step?: string;
  referenceImage?: string | null;
  reducedMotion?: boolean;
}

const STAGES = ['Prep', 'Shape', 'Decode', 'Export'] as const;

export const ThinkingGenerationCard: React.FC<ThinkingGenerationCardProps> = ({
  progress,
  step,
  referenceImage,
  reducedMotion = false,
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const activeStageIdx = pct >= 85 ? 3 : pct >= 55 ? 2 : pct >= 25 ? 1 : 0;
  const label = step?.trim() || 'Synthesizing 3D geometry...';

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={MOTION_SPRING}
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 z-20 w-[min(92vw,340px)] rounded-2xl bg-[hsl(var(--surface-1))]/92 backdrop-blur-md border border-white/[0.1] shadow-[0_16px_48px_rgba(0,0,0,0.65)] p-3 space-y-2.5"
    >
      <div className="flex items-center gap-2.5">
        {referenceImage && (
          <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-black/50 flex-shrink-0">
            <img src={referenceImage} alt="" aria-hidden="true" className="w-full h-full object-cover opacity-85" />
            {!reducedMotion && (
              <motion.div
                aria-hidden="true"
                animate={{ y: ['-100%', '220%'] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-x-0 h-1 bg-[hsl(var(--primary))] shadow-[0_0_8px_hsl(var(--primary))]"
              />
            )}
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              {!reducedMotion && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--primary))] opacity-75" />
              )}
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--primary))]" />
            </span>
            {reducedMotion ? (
              <span className="text-xs font-semibold text-zinc-100 truncate">{label}</span>
            ) : (
              <motion.span
                initial={{ backgroundPosition: '200% center' }}
                animate={{ backgroundPosition: '-200% center' }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, #a1a1aa 0%, #f5c542 45%, #ffffff 50%, #f5c542 55%, #a1a1aa 100%)',
                  backgroundSize: '200% auto',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
                className="text-xs font-semibold truncate bg-clip-text text-transparent"
              >
                {label}
              </motion.span>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
            <span>{pct}%</span>
            <span>{elapsed.toFixed(1)}s</span>
          </div>
        </div>
      </div>

      {/* Gold Progress Bar */}
      <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--primary))] to-[#FFD866] transition-[width] duration-300"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>

      {/* 4-Stage Pipeline Stepper */}
      <div className="grid grid-cols-4 gap-1 pt-0.5">
        {STAGES.map((stageName, idx) => {
          const isDone = idx < activeStageIdx;
          const isActive = idx === activeStageIdx;
          return (
            <div
              key={stageName}
              className={`flex items-center justify-center gap-1 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                isDone
                  ? 'border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                  : isActive
                    ? 'border-white/20 bg-white/[0.06] text-white font-semibold'
                    : 'border-transparent text-zinc-500'
              }`}
            >
              <span>{isDone ? '✓' : `${idx + 1}.`}</span>
              <span>{stageName}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};
