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
} from 'lucide-react';

interface LeftNavigationProps {
  isMobileDrawer?: boolean;
  onToolSelect?: () => void;
}

interface ToolConfig {
  id: ToolType;
  label: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  badge?: string;
  hasDropdown?: boolean;
}

export const LeftNavigation: React.FC<LeftNavigationProps> = ({
  isMobileDrawer = false,
  onToolSelect,
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
      hasDropdown: true,
    },
    {
      id: 'remesh',
      label: 'Retopo',
      tooltip: 'Quad Retopology & Remeshing',
      icon: RefreshCw,
      hasDropdown: true,
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
      hasDropdown: true,
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
        isMobileDrawer ? 'w-full py-2 px-3' : 'w-[46px] py-1.5'
      }`}
    >
      {/* Primary Tool Stack */}
      <div className="flex-1 w-full flex flex-col items-center gap-1 overflow-y-auto overflow-x-hidden scrollbar-none px-0.5">
        {tools.map((t, idx) => {
          const active = isCurrentActive(t);
          const executing = isExecuting && active;
          const IconComp = t.icon;

          return (
            <SimpleTooltip key={`${t.label}-${idx}`} label={t.tooltip} side="right">
              <button
                type="button"
                onClick={() => handleSelect(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative w-full group flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg transition-all duration-200 cursor-pointer ${
                  active
                    ? 'text-[#F9CF00] bg-white/[0.08] font-bold shadow-sm'
                    : 'text-zinc-200 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {/* Active Indicator Bar on Left */}
                {active && (
                  <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[#F9CF00]" />
                )}

                {/* Solid, Bold High-Contrast Icon */}
                <div className="relative mb-0.5">
                  <IconComp
                    strokeWidth={active ? 2.5 : 2}
                    className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${
                      active ? 'text-[#F9CF00]' : 'text-zinc-200 group-hover:text-white'
                    }`}
                  />
                  {executing && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#F9CF00] animate-ping" />
                  )}
                </div>

                {/* Label */}
                <div className="flex items-center gap-0.5">
                  <span className={`text-[8px] tracking-tight leading-none text-center font-medium ${
                    active ? 'text-[#F9CF00] font-bold' : 'text-zinc-400 group-hover:text-zinc-200'
                  }`}>
                    {t.label}
                  </span>
                  {t.hasDropdown && (
                    <span className="text-[7px] opacity-60 leading-none">▾</span>
                  )}
                </div>
              </button>
            </SimpleTooltip>
          );
        })}
      </div>

      {/* Bottom Settings Icon */}
      <div className="w-full mt-auto flex flex-col items-center px-0.5 pb-0.5 pt-1 border-t border-[hsl(var(--border))]">
        <SimpleTooltip label="Studio Settings" side="right">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open Studio Settings"
            className="w-full py-1.5 flex flex-col items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
          >
            <Settings2 strokeWidth={2} className="w-4 h-4 mb-0.5 text-zinc-200 group-hover:text-white transition-colors" />
            <span className="text-[8px] leading-none text-zinc-400 font-medium">Settings</span>
          </button>
        </SimpleTooltip>
      </div>
    </nav>
  );
};
