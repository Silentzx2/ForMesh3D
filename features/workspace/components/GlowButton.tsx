'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  CheckIcon,
  CancelCircleIcon,
  IterationCwIcon,
  ArrowDown01Icon,
  TrashIcon,
  LoaderCircleIcon,
} from '@hugeicons/core-free-icons';

/** Glow button variant color palette. Resting state is gray #A1A1AA; active/hover is the variant glow. */
const VARIANT_CONFIG: Record<
  GlowButtonVariant,
  { active: string; hoverShadow: string; icon: IconSvgElement }
> = {
  keep: { active: '#F9CF00', hoverShadow: '0 0 14px rgba(249, 207, 0, 0.55)', icon: CheckIcon },
  discard: { active: '#F43F5E', hoverShadow: '0 0 14px rgba(244, 63, 94, 0.55)', icon: TrashIcon },
  regenerate: { active: '#6366F1', hoverShadow: '0 0 14px rgba(99, 102, 241, 0.55)', icon: IterationCwIcon },
  cancel: { active: '#EF4444', hoverShadow: '0 0 14px rgba(239, 68, 68, 0.55)', icon: CancelCircleIcon },
  export: { active: '#8B5CF6', hoverShadow: '0 0 14px rgba(139, 92, 246, 0.55)', icon: ArrowDown01Icon },
  default: { active: '#F9CF00', hoverShadow: '0 0 14px rgba(249, 207, 0, 0.55)', icon: CheckIcon },
};

export type GlowButtonVariant = 'keep' | 'discard' | 'regenerate' | 'cancel' | 'export' | 'default';
export type GlowButtonSize = 'sm' | 'md' | 'lg';
export type GlowButtonResult = 'idle' | 'success' | 'error';

export interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlowButtonVariant;
  size?: GlowButtonSize;
  loading?: boolean;
  /** Terminal result state driving the success/error portion of the button state machine. */
  result?: GlowButtonResult;
  iconOnly?: boolean;
  className?: string;
}

/**
 * GlowButton — layout-stable glow button.
 *
 * Resting: #A1A1AA text/border on transparent. Active: variant glow color + drop-shadow.
 * Hover: color/shadow only (150-300ms), NO scale/translate. Focus ring visible.
 * Disabled: opacity 50%.
 *
 * Internal state machine: idle → hover → pressed → (disabled) | success/error → idle.
 * Guards: no success without terminal state; no regress from terminal without explicit reset.
 */
export const GlowButton: React.FC<GlowButtonProps> = React.memo(function GlowButton({
  variant = 'default',
  size = 'md',
  loading = false,
  result = 'idle',
  iconOnly = false,
  className = '',
  disabled = false,
  children,
  onClick,
  ...rest
}) {
  const cfg = VARIANT_CONFIG[variant];

  // Internal button state machine.
  const [state, setState] = useState<GlowButtonResult>('idle');
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  // Transition guard: once in a terminal state (success/error), do not regress
  // back to idle unless result explicitly resets to 'idle'.
  const isTerminal = state === 'success' || state === 'error';

  useEffect(() => {
    if (result === 'idle') {
      // Explicit reset from terminal back to idle.
      if (isTerminal) setState('idle');
      return;
    }
    if (result === 'success' && state !== 'success') setState('success');
    if (result === 'error' && state !== 'error') setState('error');
  }, [result, state, isTerminal]);

  const handleMouseEnter = useCallback(() => {
    if (disabled || loading) return;
    setIsHovered(true);
  }, [disabled, loading]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setIsPressed(false);
  }, []);

  const handleMouseDown = useCallback(() => {
    if (disabled || loading) return;
    setIsPressed(true);
  }, [disabled, loading]);

  const handleMouseUp = useCallback(() => {
    setIsPressed(false);
  }, []);

  const activeColor = loading ? '#A1A1AA' : (disabled ? '#A1A1AA' : cfg.active);
  const restingColor = '#A1A1AA';

  const isActive = isHovered || isPressed;
  const showGlow = isActive && !disabled && !loading;

  const baseClasses = [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap',
    'font-medium text-xs leading-none',
    'transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1019]',
    `focus-visible:ring-[${cfg.active}]`,
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'cursor-pointer',
    'select-none',
    'border',
    'border-transparent',
    // resting text/border color
    `text-[${restingColor}]`,
    `border-[${restingColor}]`,
    // active glow text + shadow
    showGlow ? `text-[${activeColor}] shadow-[${cfg.hoverShadow}]` : '',
    'bg-transparent',
    'active:shadow-none',
    // layout-stable: NO scale/translate on hover/active
  ]
    .filter(Boolean)
    .join(' ');

  const sizeClasses = {
    sm: 'px-2.5 py-1.5 min-h-[30px] gap-1',
    md: 'px-3.5 py-1.5 min-h-[36px] gap-1.5',
    lg: 'px-4.5 py-2 min-h-[42px] gap-2',
  }[size];

  const textClasses = disabled ? 'opacity-50' : '';
  const iconClasses = loading ? 'animate-spin' : '';

  const Icon = cfg.icon;
  const spinnerIcon = LoaderCircleIcon;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      aria-busy={loading || undefined}
      className={[baseClasses, sizeClasses, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? (
        <HugeiconsIcon icon={spinnerIcon} size={size === 'sm' ? 12 : 14} className={iconClasses} />
      ) : (
        <HugeiconsIcon icon={Icon} size={size === 'sm' ? 12 : 14} className={textClasses} />
      )}
      {!iconOnly && children && <span className={textClasses}>{children}</span>}
    </button>
  );
});

GlowButton.displayName = 'GlowButton';
