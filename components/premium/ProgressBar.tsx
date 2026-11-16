'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type ProgressColor = 'purple' | 'blue' | 'cyan' | 'green' | 'amber' | 'pink';

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  color?: ProgressColor;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'thin';
  showGlow?: boolean;
  indeterminate?: boolean;
  /** Show a percentage label with gradient text */
  showLabel?: boolean;
}

const COLORS: Record<ProgressColor, { from: string; to: string; glow: string }> = {
  purple: { from: 'hsl(var(--neon-cyan))', to: 'hsl(var(--neon-orange))', glow: 'hsl(var(--primary) / 0.45)' },
  blue: { from: 'hsl(var(--blue-500))', to: 'hsl(var(--blue-500))', glow: 'hsl(var(--blue-500) / 0.3)' },
  cyan: { from: 'hsl(var(--neon-cyan))', to: 'hsl(var(--primary))', glow: 'hsl(var(--primary) / 0.45)' },
  green: { from: 'hsl(var(--neon-green))', to: 'hsl(var(--neon-green))', glow: 'hsl(var(--neon-green) / 0.3)' },
  pink: { from: 'hsl(var(--primary))', to: 'hsl(var(--neon-cyan))', glow: 'hsl(var(--primary) / 0.45)' },
  amber: { from: 'hsl(var(--neon-cyan))', to: 'hsl(var(--neon-orange))', glow: 'hsl(var(--primary) / 0.45)' },
};

function getGlowStyle(color: ProgressColor): string {
  const c = COLORS[color].glow;
  return `0 0 8px ${c}, 0 0 16px ${c}`;
}

const SIZES: Record<string, string> = {
  xs: 'h-0.5',
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2.5',
  thin: 'h-0.5',
};

export function ProgressBar({
  value,
  max = 100,
  className,
  color = 'amber',
  size = 'md',
  showGlow = false,
  indeterminate = false,
  showLabel = false,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const c = COLORS[color];
  const isThin = size === 'thin';

  return (
    <div className={cn('relative w-full', showLabel && 'flex items-center gap-3', className)}>
      <div
        className={cn(
          'relative flex-1 overflow-hidden rounded-full',
          SIZES[size],
          isThin ? 'bg-[hsl(var(--surface-3)/0.5)]' : 'bg-[hsl(var(--surface-3))]'
        )}
      >
        {indeterminate ? (
          <div className="absolute inset-0">
            <div
              className="absolute h-full w-1/3 rounded-full"
              style={{
                background: `linear-gradient(90deg, ${c.from}, ${c.to})`,
                animation: 'progress-indeterminate 2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
                boxShadow: getGlowStyle(color),
                filter: 'brightness(1.1)',
              }}
            />
          </div>
        ) : (
          <motion.div
            className="relative h-full rounded-full overflow-hidden"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{
              background: `linear-gradient(90deg, ${c.from}, ${c.to})`,
              boxShadow: showGlow ? getGlowStyle(color) : `0 2px 8px ${c.glow}`,
            }}
          >
            {/* Animated gradient shimmer moving across the fill */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(90deg, transparent 0%, hsl(var(--foreground) / 0.25) 50%, transparent 100%)`,
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s ease-in-out infinite',
              }}
            />
            {/* Bright tip at the leading edge */}
            {!isThin && pct > 0 && (
              <div
                className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-full rounded-full"
                style={{
                  background: 'white',
                  opacity: 0.6,
                  filter: `drop-shadow(0 0 3px ${c.glow})`,
                }}
              />
            )}
          </motion.div>
        )}
      </div>

      {/* Percentage label with gradient text */}
      {showLabel && !indeterminate && (
        <motion.span
          className="text-xs font-mono font-medium tabular-nums min-w-[2.5rem] text-right"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          style={{
            background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {Math.round(pct)}%
        </motion.span>
      )}
    </div>
  );
}
