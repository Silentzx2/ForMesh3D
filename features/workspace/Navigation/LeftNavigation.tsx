'use client';

import React from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { ToolType } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  BoneIcon,
  Box,
  CircleDashedIcon,
  FilmIcon,
  GridIcon,
  LayersIcon,
  ScissorsIcon,
  SettingsIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';

interface LeftNavigationProps {
  isMobileDrawer?: boolean;
  onToolSelect?: () => void;
}

interface ToolConfig {
  id: ToolType;
  label: string;
  tooltip: string;
  icon: any;
  badge?: string;
  hasDropdown?: boolean;
}

export const LeftNavigation: React.FC<LeftNavigationProps> = ({
  isMobileDrawer = false,
  onToolSelect,
}) => {
  const { activeTool, mainNav, navigateToTool, isExecuting, setIsSettingsOpen } = useWorkspace();

  const tools: ToolConfig[] = [
    {
      id: 'model',
      label: 'Model',
      tooltip: 'Generate 3D Model (Image to 3D)',
      icon: Box,
    },
    {
      id: 'segment',
      label: 'Segment',
      tooltip: 'Mesh Part Segmentation',
      icon: ScissorsIcon,
    },
    {
      id: 'remesh',
      label: 'Retopo',
      tooltip: 'Quad Retopology & Remeshing',
      icon: CircleDashedIcon,
    },
    {
      id: 'uv',
      label: 'Smart UV',
      tooltip: 'Automatic UV Unwrapping',
      icon: GridIcon,
    },
    {
      id: 'texture',
      label: 'Texture',
      tooltip: '3D Texture Generator',
      icon: LayersIcon,
    },
    {
      id: 'pbr',
      label: 'PBR',
      tooltip: 'PBR Material Maps Generator',
      icon: SparklesIcon,
    },
    {
      id: 'rigging',
      label: 'Rig',
      tooltip: 'Character Rigging (SkinTokens)',
      icon: BoneIcon,
    },
    {
      id: 'animation',
      label: 'Animate',
      tooltip: '3D Character Animation',
      icon: FilmIcon,
    },
  ];

  const handleSelect = (toolId: ToolType) => {
    navigateToTool(toolId);
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
      className={`h-full bg-[hsl(var(--surface-1))] border-r border-[hsl(var(--border))] flex flex-col items-center select-none z-20 ${
        isMobileDrawer ? 'w-full py-2 px-3' : 'w-[54px] py-2'
      }`}
    >
      {/* Primary Tool Stack */}
      <div className="flex-1 w-full flex flex-col items-center gap-1 overflow-y-auto overflow-x-hidden scrollbar-none px-1">
        {tools.map((t, idx) => {
          const active = isCurrentActive(t);
          const executing = isExecuting && active;

          return (
            <SimpleTooltip key={`${t.label}-${idx}`} label={t.tooltip} side="right">
              <button
                type="button"
                onClick={() => handleSelect(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative w-full group flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg transition-all duration-200 cursor-pointer ${
                  active
                    ? 'text-[#F9CF00] bg-white/[0.06] font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {/* Active Indicator Bar on Left */}
                {active && (
                  <span className="absolute left-0.5 top-2 bottom-2 w-0.5 rounded-r-full bg-[#F9CF00]" />
                )}

                {/* Badge pill */}
                {t.badge && (
                  <span className="absolute -top-1 px-1 py-0.2 rounded-full text-[7px] font-black uppercase tracking-wider bg-gradient-to-r from-cyan-500 to-indigo-500 text-white shadow-sm">
                    {t.badge}
                  </span>
                )}

                {/* Icon */}
                <div className="relative mb-0.5">
                  <HugeiconsIcon
                    icon={t.icon}
                    size={17}
                    className={`transition-transform duration-200 group-hover:scale-110 ${
                      active ? 'text-[#F9CF00]' : 'text-zinc-400 group-hover:text-white'
                    }`}
                  />
                  {executing && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#F9CF00] animate-ping" />
                  )}
                </div>

                {/* Label */}
                <div className="flex items-center gap-0.5">
                  <span className="text-[9.5px] tracking-tight leading-none text-center">
                    {t.label}
                  </span>
                  {t.hasDropdown && (
                    <span className="text-[7.5px] opacity-60 leading-none">▾</span>
                  )}
                </div>
              </button>
            </SimpleTooltip>
          );
        })}
      </div>

      {/* Bottom App / Settings Icon - seamlessly integrated into rail stack without isolated block divider */}
      <div className="w-full mt-auto flex flex-col items-center px-1 pb-1">
        <SimpleTooltip label="Studio Settings" side="right">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open Studio Settings"
            className="w-full py-1.5 flex flex-col items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
          >
            <HugeiconsIcon icon={SettingsIcon} size={17} className="mb-0.5 text-zinc-400 hover:text-white transition-colors" />
            <span className="text-[9.5px] leading-none">App</span>
          </button>
        </SimpleTooltip>
      </div>
    </nav>
  );
};
