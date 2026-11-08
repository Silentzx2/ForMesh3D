import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { CommandPalette } from '../CommandPalette';
import { SnapshotMenu } from './SnapshotMenu';
import { useUIStore } from '@/stores/useUIStore';
import { ResourceMonitor } from './ResourceMonitor';
import { NotificationCenter } from '../Notifications/NotificationCenter';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  CheckIcon,
  ChevronDown,
  HexagonIcon,
  LayersIcon,
  Menu,
  PackageIcon,
  Search01Icon,
  SettingsIcon,
  SparklesIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';

interface TopHeaderProps {
  onMobileMenuToggle?: () => void;
  isMobileNavOpen?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onMobileMenuToggle, isMobileNavOpen }) => {
  const router = useRouter();
  const {
    navigateToMain,
    activeTool,
    navigateToTool,
    systemStats,
    setIsSettingsOpen,
  } = useWorkspace();

  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkspaceMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [workspaceMenuOpen]);

  return (
    <header
      id="persistent-top-header"
      className="h-10 px-2.5 md:px-3 bg-[hsl(var(--surface-0))] flex items-center justify-between border-b border-white/[0.06] select-none z-50 text-xs w-full flex-shrink-0 min-w-0 shadow-sm"
    >
      {/* Left Branding & Mode Dropdown */}
      <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
        {/* Mobile menu button */}
        <button
          onClick={onMobileMenuToggle}
          className="group md:hidden p-1 rounded-md text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all duration-200 flex-shrink-0 active:scale-95"
          aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
        >
          <HugeiconsIcon icon={Menu} size={14} className="w-3.5 h-3.5 group-hover:scale-105 transition-transform duration-200" />
        </button>

        {/* Brand Studio Logo (ForMesh 3D) */}
        <div
          onClick={() => navigateToMain('dashboard')}
          className="flex items-center gap-1.5 cursor-pointer group py-0.5 pr-1 flex-shrink-0 select-none"
        >
          {/* Stylized Logo Cube */}
          <div className="w-4 h-4 rounded-[4px] bg-gradient-to-br from-[#FFD866] via-[#F5C542] to-[#E0A800] flex items-center justify-center text-[#080808] font-black text-[9px] shadow-[0_0_8px_rgba(245,197,66,0.35)] tracking-tighter group-hover:shadow-[0_0_14px_rgba(245,197,66,0.6)] group-hover:scale-105 active:scale-95 transition-all duration-200">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-current">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="font-extrabold text-[11px] tracking-wider text-white uppercase font-sans hidden sm:inline group-hover:text-primary transition-colors duration-200">
            ForMesh <span className="text-primary font-black">3D</span>
          </span>
        </div>

        {/* 3D Workspace Mode Switcher Dropdown - hidden on mobile */}
        <div ref={workspaceMenuRef} className="relative hidden md:block">
          <button
            id="btn-workspace-switcher"
            onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            className="group h-6 px-2 rounded-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.16] hover:bg-white/[0.08] flex items-center gap-1 transition-all duration-200 active:scale-95 cursor-pointer shadow-sm"
          >
            <span className="text-zinc-200 group-hover:text-white text-[10px] font-semibold flex gap-1 items-center transition-colors duration-200">
              <span className="text-primary font-bold">3D Workspace</span>
              <HugeiconsIcon
                icon={ChevronDown}
                size={11}
                className={`w-2.5 h-2.5 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200 ${
                  workspaceMenuOpen ? 'rotate-180 text-primary' : 'group-hover:scale-105'
                }`}
              />
            </span>
          </button>

          {workspaceMenuOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-48 py-1 rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                Workspace Modes
              </div>
              <button
                onClick={() => { navigateToTool('model'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] transition-colors cursor-pointer ${
                  activeTool === 'model'
                    ? 'bg-white/[0.08] text-primary font-bold'
                    : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={Box} size={13} className="w-3 h-3 text-primary" />
                  <span>3D Model Studio</span>
                </div>
                {activeTool === 'model' && <HugeiconsIcon icon={CheckIcon} size={13} className="w-3 h-3 text-primary" />}
              </button>
              <button
                onClick={() => { navigateToTool('remesh'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] transition-colors cursor-pointer ${
                  activeTool === 'remesh'
                    ? 'bg-white/[0.08] text-primary font-bold'
                    : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={HexagonIcon} size={13} className="w-3 h-3 text-primary" />
                  <span>Quad Remesh (Poly)</span>
                </div>
                {activeTool === 'remesh' && <HugeiconsIcon icon={CheckIcon} size={13} className="w-3 h-3 text-primary" />}
              </button>
              <button
                onClick={() => { navigateToTool('texture'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] transition-colors cursor-pointer ${
                  activeTool === 'texture'
                    ? 'bg-white/[0.08] text-primary font-bold'
                    : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={LayersIcon} size={13} className="w-3 h-3 text-primary" />
                  <span>PBR Texture Studio</span>
                </div>
                {activeTool === 'texture' && <HugeiconsIcon icon={CheckIcon} size={13} className="w-3 h-3 text-primary" />}
              </button>
              <button
                onClick={() => { navigateToTool('animation'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] transition-colors cursor-pointer ${
                  activeTool === 'animation'
                    ? 'bg-white/[0.08] text-primary font-bold'
                    : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={SparklesIcon} size={13} className="w-3 h-3 text-primary" />
                  <span>Animation & Rigging</span>
                </div>
                {activeTool === 'animation' && <HugeiconsIcon icon={CheckIcon} size={13} className="w-3 h-3 text-primary" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: FastAPI Status Pill, AI Models, Snapshots, Notifications, Settings, Profile */}
      <div className="flex items-center gap-1 md:gap-1.5 flex-shrink-0">
        {/* FastAPI Status Pill */}
        <SimpleTooltip
          label={`FastAPI Backend: ${systemStats.status.toUpperCase()} • GPUs: ${systemStats.gpus?.length || 1} • ${systemStats.total_vram_used_gb != null && systemStats.total_vram_total_gb != null ? `${systemStats.total_vram_used_gb.toFixed(1)}/${systemStats.total_vram_total_gb.toFixed(1)}GB VRAM` : 'Ready'}`}
          side="bottom"
        >
          <button
            id="btn-fastapi-status-pill"
            onClick={() => navigateToMain('system')}
            className="group flex items-center gap-1.5 h-6 px-2 rounded-full border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.16] text-[10px] font-semibold transition-all duration-200 active:scale-95 cursor-pointer shadow-sm"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                systemStats.status === 'online'
                  ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                  : 'bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]'
              }`}
            />
            <span
              className={`transition-colors duration-200 ${
                systemStats.status === 'online' ? 'text-zinc-300 group-hover:text-emerald-300' : 'text-rose-400'
              }`}
            >
              {systemStats.status === 'online' ? 'FastAPI Online' : 'FastAPI Offline'}
            </span>
          </button>
        </SimpleTooltip>

        {/* Resource Monitor - System Stats */}
        <ResourceMonitor />

        {/* Command palette search */}
        <SimpleTooltip label="Command palette • Ctrl K" side="bottom">
          <button
            id="btn-header-command-palette"
            type="button"
            onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
            className="group hidden sm:flex items-center gap-1 h-6 px-2 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.16] text-[10px] text-zinc-300 hover:text-white transition-all duration-200 shadow-sm cursor-pointer active:scale-95"
            aria-label="Open command palette"
          >
            <HugeiconsIcon icon={Search01Icon} size={12} className="w-3 h-3 text-zinc-400 group-hover:text-primary group-hover:scale-105 transition-all duration-200" />
            <span className="font-semibold hidden md:inline">Search</span>
            <kbd className="hidden lg:inline-flex items-center px-1 py-0.2 rounded border border-white/[0.1] bg-black/30 text-[8px] text-zinc-400 font-mono">Ctrl K</kbd>
          </button>
        </SimpleTooltip>

        {/* AI Models Button - hidden on small mobile */}
        <SimpleTooltip label="Manage AI 3D Models & Weights" side="bottom">
          <button
            id="btn-header-models"
            onClick={() => router.push('/admin?tab=models')}
            className="group hidden sm:flex items-center gap-1 h-6 px-2 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.16] text-[10px] text-zinc-300 hover:text-white transition-all duration-200 shadow-sm cursor-pointer active:scale-95"
          >
            <HugeiconsIcon icon={PackageIcon} size={12} className="w-3 h-3 text-zinc-400 group-hover:text-primary group-hover:scale-105 transition-all duration-200" />
            <span className="font-semibold hidden md:inline">AI Models</span>
          </button>
        </SimpleTooltip>

        {/* Workspace Snapshots */}
        <SnapshotMenu />

        {/* Activity & Notification Center */}
        <NotificationCenter />

        {/* Quick Settings Icon */}
        <SimpleTooltip label="Quick Settings" side="bottom">
          <button
            id="btn-header-settings"
            onClick={() => setIsSettingsOpen(true)}
            className="group w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all duration-200 active:scale-90 cursor-pointer"
            aria-label="Quick Settings"
          >
            <HugeiconsIcon icon={SettingsIcon} size={13} className="w-3 h-3 transition-transform duration-300 group-hover:rotate-45 group-hover:scale-105 group-hover:text-white" />
          </button>
        </SimpleTooltip>

        {/* Profile Avatar */}
        <SimpleTooltip label="Admin & Settings" side="bottom">
          <button
            id="btn-header-profile"
            onClick={() => router.push('/admin?tab=settings')}
            className="group w-6 h-6 rounded-full bg-gradient-to-tr from-zinc-800 to-zinc-700 border border-white/[0.12] hover:border-primary/60 flex items-center justify-center text-[9px] font-bold text-primary cursor-pointer transition-all duration-200 active:scale-90 shadow-sm"
            aria-label="Admin & Settings"
          >
            <HugeiconsIcon icon={UserIcon} size={13} className="w-3 h-3 text-zinc-300 group-hover:text-white group-hover:scale-105 transition-all duration-200" />
          </button>
        </SimpleTooltip>
      </div>

      {/* Global Command Palette (T-02) */}
      <CommandPalette />
    </header>
  );
};

