'use client';

import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SimpleTooltipProps {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  tooltipClassName?: string;
}

export const SimpleTooltip: React.FC<SimpleTooltipProps> = ({
  label,
  children,
  side = 'right',
  className = '',
  tooltipClassName = '',
}) => {
  const triggerChild = React.isValidElement(children) ? (
    children
  ) : (
    <span className={cn('inline-flex', className)}>{children}</span>
  );

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{triggerChild}</TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(
          typeof label === 'string' ? 'whitespace-nowrap' : 'min-w-[180px] whitespace-normal',
          tooltipClassName
        )}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
};
