'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
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
  const pathname = usePathname();
  const { activeTool, mainNav, navigateToTool, isExecuting } = useWorkspace();

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
      className={`h-full bg-[#121214] border-r border-white/[0.08] flex flex-col items-center select-none z-20 ${
        isMobileDrawer ? 'w-full py-2 px-3' : 'w-[68px] py-3'
      }`}
    >
      {/* Primary Tool Stack */}
      <div className="flex-1 w-full flex flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden scrollbar-none px-1">
        {tools.map((t, idx) => {
          const active = isCurrentActive(t);
          const executing = isExecuting && active;

          return (
            <SimpleTooltip key={`${t.label}-${idx}`} label={t.tooltip} side="right">
              <button
                type="button"
                onClick={() => handleSelect(t.id)}
                className={`relative w-full group flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all duration-200 cursor-pointer ${
                  active
                    ? 'text-[#F9CF00] bg-white/[0.06] font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {/* Active Indicator Bar on Left */}
                {active && (
                  <span className="absolute left-0.5 top-2.5 bottom-2.5 w-1 rounded-r-full bg-[#F9CF00]" />
                )}

                {/* Badge pill */}
                {t.badge && (
                  <span className="absolute -top-1 px-1 py-0.2 rounded-full text-[7.5px] font-black uppercase tracking-wider bg-gradient-to-r from-cyan-500 to-indigo-500 text-white shadow-sm">
                    {t.badge}
                  </span>
                )}

                {/* Icon */}
                <div className="relative mb-1">
                  <HugeiconsIcon
                    icon={t.icon}
                    size={20}
                    className={`transition-transform duration-200 group-hover:scale-110 ${
                      active ? 'text-[#F9CF00]' : 'text-zinc-400 group-hover:text-white'
                    }`}
                  />
                  {executing && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#F9CF00] animate-ping" />
                  )}
                </div>

                {/* Label */}
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] tracking-tight leading-none text-center">
                    {t.label}
                  </span>
                  {t.hasDropdown && (
                    <span className="text-[8px] opacity-60 leading-none">▾</span>
                  )}
                </div>
              </button>
            </SimpleTooltip>
          );
        })}
      </div>

      {/* Bottom App / Settings Icon */}
      <div className="w-full pt-2 border-t border-white/[0.08] mt-auto flex flex-col items-center px-1">
        <SimpleTooltip label="Studio Settings" side="right">
          <button
            type="button"
            className="w-full py-2 flex flex-col items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
          >
            <HugeiconsIcon icon={SettingsIcon} size={18} className="mb-0.5" />
            <span className="text-[10px] leading-none">App</span>
          </button>
        </SimpleTooltip>
      </div>
    </nav>
  );
};
