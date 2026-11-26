'use client';

import React from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { ToolType } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import {
  Box,
  Scissors,
  RefreshCw,
  Grid3X3,
  Palette,
  Bone,
  Film,
  Settings2,
} from '@/components/icons/hugeicons-components';

interface LeftNavigationProps {
  isMobileDrawer?: boolean;
  onToolSelect?: () => void;
  firstToolButtonRef?: React.Ref<HTMLButtonElement>;
}

interface ToolConfig {
  id: ToolType;
  label: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const LeftNavigation: React.FC<LeftNavigationProps> = ({
  isMobileDrawer = false,
  onToolSelect,
  firstToolButtonRef,
}) => {
  const { activeTool, mainNav, navigateToTool, isExecuting, setIsSettingsOpen, setIsLeftPanelOpen } = useWorkspace();

  const tools: ToolConfig[] = [
    {
      id: 'model',
      label: 'Model',
      tooltip: 'Create / Generate 3D Model',
      icon: Box,
    },
    {
      id: 'texture',
      label: 'Texture',
      tooltip: '3D Texture Generator',
      icon: Palette,
    },
    {
      id: 'remesh',
      label: 'Retopo',
      tooltip: 'Quad Retopology & Remeshing',
      icon: RefreshCw,
    },
    {
      id: 'uv',
      label: 'Smart UV',
      tooltip: 'Automatic UV Unwrapping',
      icon: Grid3X3,
    },
    {
      id: 'segment',
      label: 'Segment',
      tooltip: 'Mesh Part Segmentation',
      icon: Scissors,
    },
    {
      id: 'rigging',
      label: 'Rig',
      tooltip: 'Character Rigging (SkinTokens)',
      icon: Bone,
    },
    {
      id: 'animation',
      label: 'Animate',
      tooltip: '3D Character Animation',
      icon: Film,
    },
  ];

  const handleSelect = (toolId: ToolType) => {
    navigateToTool(toolId);
    setIsLeftPanelOpen(true);
    onToolSelect?.();
  };

  const isCurrentActive = (tool: ToolConfig) => {
    if (mainNav !== 'workspace') return false;
    return activeTool === tool.id;
  };

  return (
    <nav
      id="left-tool-rail"
      aria-label="Studio 3D Tools"
      className={`h-full bg-[hsl(var(--surface-1))] flex flex-col items-center select-none ${
        isMobileDrawer ? 'w-full py-2 px-3' : 'w-[48px] py-1.5'
      }`}
    >
      {/* Primary Tool Stack */}
      <div className="flex-1 w-full flex flex-col items-center gap-1 overflow-y-auto overflow-x-hidden scrollbar-none px-0.5">
        {tools.map((t, idx) => {
          const active = isCurrentActive(t);
          const executing = isExecuting && active;
          const IconComp = t.icon;

          return (
            <SimpleTooltip key={t.id} label={t.tooltip} side="right">
              <button
                ref={idx === 0 ? firstToolButtonRef : undefined}
                type="button"
                onClick={() => handleSelect(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative w-full group flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? 'text-primary bg-white/[0.08]'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
                }`}
              >
                {/* Gold Active Indicator Bar on Left */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-primary"
                  />
                )}

                <div className="relative mb-0.5">
                  <IconComp
                    strokeWidth={active ? 2.25 : 1.75}
                    className={`w-[18px] h-[18px] transition-colors duration-150 ${
                      active ? 'text-primary' : 'text-zinc-400 group-hover:text-zinc-100'
                    }`}
                  />
                  {executing && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                    />
                  )}
                </div>

                <span
                  className={`text-[9.5px] leading-tight tracking-tight text-center ${
                    active ? 'text-primary font-semibold' : 'text-zinc-400 group-hover:text-zinc-200 font-medium'
                  }`}
                >
                  {t.label}
                </span>
              </button>
            </SimpleTooltip>
          );
        })}
      </div>

      {/* Bottom Settings Icon */}
      <div className="w-full mt-auto flex flex-col items-center px-0.5 pb-0.5 pt-1 border-t border-white/[0.08]">
        <SimpleTooltip label="Studio Settings" side="right">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open Studio Settings"
            className="group w-full py-1.5 flex flex-col items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 strokeWidth={1.75} className="w-[18px] h-[18px] mb-0.5 text-zinc-400 group-hover:text-zinc-100 transition-colors" />
            <span className="text-[9.5px] leading-tight text-zinc-400 font-medium">Settings</span>
          </button>
        </SimpleTooltip>
      </div>
    </nav>
  );
};
