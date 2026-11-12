'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { toast } from 'sonner';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  CameraIcon,
  CompassIcon,
  GridIcon,
  HelpCircleIcon,
  LayersIcon,
  FlipHorizontalIcon,
  RotateCw,
  SettingsIcon,
} from '@hugeicons/core-free-icons';
import type { LightTone } from './MeshViewer';
import type { ShadingMode } from '../types';
import { useViewerStore } from '@/stores/useViewerStore';

interface ViewportToolOverlayProps {
  isRightPanelOpen?: boolean;
}

export const ViewportToolOverlay: React.FC<ViewportToolOverlayProps> = ({
  isRightPanelOpen: propRightPanelOpen,
}) => {
  const {
    showWireframe,
    setShowWireframe,
    currentAsset,
    isComparing,
    setIsComparing,
    showGrid,
    setShowGrid,
    isTurntable,
    setIsTurntable,
    shadingMode,
    setShadingMode,
    isRightPanelOpen: contextRightPanelOpen,
  } = useWorkspace();

  const isRightPanelOpen = propRightPanelOpen ?? contextRightPanelOpen ?? false;
  const modelStats = useViewerStore((state) => state.modelStats);
  const [isMeshDetailsExpanded, setIsMeshDetailsExpanded] = useState(true);
  const compareBeforeUrl = currentAsset?.artifacts?.source;
  const compareAfterUrl = currentAsset?.source?.viewUrl || currentAsset?.source?.localUrl || currentAsset?.artifacts?.gameReady;
  const canCompare = Boolean(compareBeforeUrl && compareAfterUrl && compareBeforeUrl !== compareAfterUrl);

  const [activePreset, setActivePreset] = useState<'Front' | 'Top' | 'Side' | 'Iso'>('Iso');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [lightingTone, setLightingTone] = useState<LightTone>('studio');
  const [exposure, setExposure] = useState<number>(1.15);

  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  // Auto-close settings popover on outside click or Escape
  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        settingsPopoverRef.current &&
        !settingsPopoverRef.current.contains(target) &&
        settingsTriggerRef.current &&
        !settingsTriggerRef.current.contains(target)
      ) {
        setIsSettingsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSettingsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen]);

  // 1. Camera Snapshot (Zero-Load High-Definition Capture)
  const handleSnapshot = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('takeViewportSnapshot'));
    }
  };

  // 2. Camera Preset Snapping
  const handleSnapCamera = (preset: 'Front' | 'Top' | 'Side' | 'Iso') => {
    setActivePreset(preset);
    const key = preset === 'Iso' ? 'perspective' : preset.toLowerCase();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('setCameraPreset', { detail: key }));
    }
  };

  // 3. Viewport Lighting Tone
  const handleLightingChange = (tone: LightTone) => {
    setLightingTone(tone);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('setViewportLighting', { detail: { tone } }));
    }
  };

  // 4. Viewport Exposure
  const handleExposureChange = (val: number) => {
    setExposure(val);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('setViewportExposure', { detail: val }));
    }
  };

  // 5. Shading Mode
  const handleShadingChange = (mode: ShadingMode) => {
    setShadingMode(mode);
  };

  return (
    <div
      id="viewport-tool-overlay"
      className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none"
    >
      {/* Top-Right Control Cluster (Tripo-Style Vertical Tool Dock) */}
      <div
        className={`pointer-events-auto absolute top-16 md:top-20 flex flex-col items-center gap-2 transition-[right] duration-200 ease-out z-20 ${
          isRightPanelOpen ? 'hidden md:flex' : 'flex'
        }`}
        style={{
          right: isRightPanelOpen ? '276px' : '16px',
        }}
      >
        {/* Floating Pill Tool Dock */}
        <div className="relative p-1 rounded-2xl bg-[#161722]/90 backdrop-blur-md border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.65)] flex flex-col items-center gap-1">
          {/* 1. Viewport Settings button */}
          <SimpleTooltip label="Viewport Settings" side="left">
            <button
              ref={settingsTriggerRef}
              type="button"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                isSettingsOpen
                  ? 'bg-[#F9CF00] text-black shadow-sm font-bold'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
              }`}
              aria-label="Viewport Settings"
            >
              <HugeiconsIcon icon={SettingsIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 2. Camera Snapshot button (4K High Resolution) */}
          <SimpleTooltip label="Capture 4K Snapshot (PNG)" side="left">
            <button
              type="button"
              onClick={handleSnapshot}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer active:scale-90"
              aria-label="Capture 4K Snapshot"
            >
              <HugeiconsIcon icon={CameraIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 3. Before / After comparison */}
          <SimpleTooltip label={canCompare ? (isComparing ? 'Exit Before / After Compare' : 'Compare Before / After') : 'Comparison appears when a processed source and result are available'} side="left">
            <button
              type="button"
              disabled={!canCompare}
              onClick={() => setIsComparing(!isComparing)}
              aria-label={isComparing ? 'Exit model comparison' : 'Compare before and after'}
              aria-pressed={isComparing}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                isComparing
                  ? 'bg-[#F9CF00] text-black shadow-sm font-bold'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <HugeiconsIcon icon={FlipHorizontalIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 4. Wireframe toggle button */}
          <SimpleTooltip
            label={showWireframe ? 'Wireframe: ON' : 'Wireframe: OFF'}
            side="left"
          >
            <button
              type="button"
              onClick={() => setShowWireframe(!showWireframe)}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                showWireframe
                  ? 'bg-[#F9CF00] text-black shadow-sm font-bold'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
              }`}
              aria-label="Toggle Wireframe"
            >
              <HugeiconsIcon icon={LayersIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 4. Turntable 360° Auto-Rotate toggle button */}
          <SimpleTooltip
            label={isTurntable ? 'Turntable: ON' : 'Turntable: OFF'}
            side="left"
          >
            <button
              type="button"
              onClick={() => setIsTurntable(!isTurntable)}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                isTurntable
                  ? 'bg-[#F9CF00] text-black shadow-sm font-bold'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
              }`}
              aria-label="Toggle Turntable"
            >
              <HugeiconsIcon
                icon={RotateCw}
                size={16}
                className={isTurntable ? 'animate-spin' : ''}
              />
            </button>
          </SimpleTooltip>

          {/* 5. Ground Grid toggle button */}
          <SimpleTooltip
            label={showGrid !== false ? 'Grid: ON' : 'Grid: OFF'}
            side="left"
          >
            <button
              type="button"
              onClick={() => setShowGrid(showGrid === false ? true : false)}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                showGrid !== false
                  ? 'bg-[#F9CF00] text-black shadow-sm font-bold'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
              }`}
              aria-label="Toggle Ground Grid"
            >
              <HugeiconsIcon icon={GridIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 6. Help / Navigation shortcuts */}
          <SimpleTooltip
            label="Orbit: Left Drag · Pan: Right Drag · Zoom: Scroll"
            side="left"
          >
            <button
              type="button"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
              aria-label="Navigation Shortcuts"
            >
              <HugeiconsIcon icon={HelpCircleIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* Settings Popover */}
          {isSettingsOpen && (
            <div
              ref={settingsPopoverRef}
              className="absolute right-full mr-2.5 top-0 w-64 p-3 rounded-2xl bg-[#161722]/95 backdrop-blur-md border border-white/[0.1] shadow-2xl z-30 space-y-3.5 text-xs text-white"
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.08]">
                <span className="text-[11px] font-black uppercase tracking-wider text-zinc-300">
                  Viewport Settings
                </span>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  aria-label="Close settings"
                >
                  ✕
                </button>
              </div>

              {/* Camera Angle Snap */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Camera Angle
                </label>
                <div className="grid grid-cols-4 gap-1">
                  {(['Front', 'Side', 'Top', 'Iso'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSnapCamera(p)}
                      className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                        activePreset === p
                          ? 'bg-[#F9CF00] text-black shadow-sm font-black'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08]'
                      }`}
                      title={`Snap to ${p} view`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shading Mode */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Shading Mode
                </label>
                <div className="grid grid-cols-6 gap-1">
                  {(
                    [
                      { id: 'textured', label: 'PBR' },
                      { id: 'clay', label: 'Clay' },
                      { id: 'normals', label: 'Normal' },
                      { id: 'wireframe', label: 'Wire' },
                      { id: 'matcap-gold', label: 'Gold' },
                      { id: 'uv-checker', label: 'UV' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleShadingChange(m.id)}
                      className={`py-1 px-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer text-center ${
                        shadingMode === m.id || (m.id === 'normals' && shadingMode === 'matcap-normal')
                          ? 'bg-[#F9CF00] text-black shadow-sm font-black'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lighting Tone */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Lighting
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      { id: 'studio', label: 'Studio Gold' },
                      { id: 'neutral', label: 'Neutral' },
                      { id: 'warm', label: 'Warm' },
                      { id: 'cool', label: 'Cyber Cool' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleLightingChange(t.id)}
                      className={`py-1 px-2 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                        lightingTone === t.id
                          ? 'bg-[#F9CF00] text-black shadow-sm font-black'
                          : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exposure Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Exposure
                  </span>
                  <span className="text-[10px] font-mono text-[#F9CF00] font-bold">
                    {exposure.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.05"
                  value={exposure}
                  onChange={(e) => handleExposureChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F9CF00]"
                />
              </div>

              {/* Quick Toggles in popup */}
              <div className="space-y-2 pt-1 border-t border-white/[0.08]">
                {/* Turntable */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300 text-[11px]">Auto Rotate</span>
                  <button
                    type="button"
                    onClick={() => setIsTurntable(!isTurntable)}
                    className={`w-7 h-4 rounded-full p-0.5 transition-all cursor-pointer ${
                      isTurntable ? 'bg-[#F9CF00]' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-black transition-all ${
                        isTurntable ? 'translate-x-3' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Ground Grid */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300 text-[11px]">Ground Grid</span>
                  <button
                    type="button"
                    onClick={() => setShowGrid(showGrid === false ? true : false)}
                    className={`w-7 h-4 rounded-full p-0.5 transition-all cursor-pointer ${
                      showGrid !== false ? 'bg-[#F9CF00]' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-black transition-all ${
                        showGrid !== false ? 'translate-x-3' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>



      {/* Bottom Floating Material & Shader Spheres Dock (Tripo 3D style) */}
      <div
        id="viewport-material-dock"
        className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 rounded-2xl bg-[#141522]/90 backdrop-blur-md border border-white/[0.1] shadow-[0_12px_40px_rgba(0,0,0,0.65)] z-20 select-none animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        {/* Sphere 1: PBR Textured */}
        <SimpleTooltip label="PBR Textured Shader" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('textured')}
            aria-label="PBR Textured Shader"
            className={`w-7 h-7 rounded-full transition-all duration-150 cursor-pointer relative ${
              shadingMode === 'textured'
                ? 'ring-2 ring-[#F9CF00] ring-offset-2 ring-offset-[#141522] scale-110 shadow-[0_0_12px_rgba(249,207,0,0.4)]'
                : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#3b82f6] via-[#a855f7] to-[#f59e0b] shadow-[inset_-2px_-2px_4px_rgba(0,0,0,0.6),inset_2px_2px_4px_rgba(255,255,255,0.4)]" />
          </button>
        </SimpleTooltip>

        {/* Sphere 2: Clay Solid */}
        <SimpleTooltip label="Clay Matte Shader" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('clay')}
            aria-label="Clay Matte Shader"
            className={`w-7 h-7 rounded-full transition-all duration-150 cursor-pointer relative ${
              shadingMode === 'clay'
                ? 'ring-2 ring-[#F9CF00] ring-offset-2 ring-offset-[#141522] scale-110 shadow-[0_0_12px_rgba(249,207,0,0.4)]'
                : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#64748b] via-[#94a3b8] to-[#cbd5e1] shadow-[inset_-2px_-2px_4px_rgba(0,0,0,0.6),inset_2px_2px_4px_rgba(255,255,255,0.4)]" />
          </button>
        </SimpleTooltip>

        {/* Sphere 3: Normal Map Vectors */}
        <SimpleTooltip label="Surface Normals Shader" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('normals')}
            aria-label="Surface Normals Shader"
            className={`w-7 h-7 rounded-full transition-all duration-150 cursor-pointer relative ${
              shadingMode === 'normals' || shadingMode === 'matcap-normal'
                ? 'ring-2 ring-[#F9CF00] ring-offset-2 ring-offset-[#141522] scale-110 shadow-[0_0_12px_rgba(249,207,0,0.4)]'
                : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#6366f1] via-[#06b6d4] to-[#f43f5e] shadow-[inset_-2px_-2px_4px_rgba(0,0,0,0.6),inset_2px_2px_4px_rgba(255,255,255,0.4)]" />
          </button>
        </SimpleTooltip>

        {/* Sphere 4: Wireframe Topology */}
        <SimpleTooltip label="Wireframe Topology Shader" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('wireframe')}
            aria-label="Wireframe Topology Shader"
            className={`w-7 h-7 rounded-full transition-all duration-150 cursor-pointer relative ${
              shadingMode === 'wireframe'
                ? 'ring-2 ring-[#F9CF00] ring-offset-2 ring-offset-[#141522] scale-110 shadow-[0_0_12px_rgba(249,207,0,0.4)]'
                : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-[#0a0f1d] border border-[#10b981] flex items-center justify-center shadow-[inset_0_0_6px_rgba(16,185,129,0.4)]">
              <span className="text-[10px] text-[#10b981] font-mono leading-none">#</span>
            </div>
          </button>
        </SimpleTooltip>

        {/* Sphere 5: MatCap Gold */}
        <SimpleTooltip label="Gold MatCap Metallic" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('matcap-gold')}
            aria-label="Gold MatCap Metallic"
            className={`w-7 h-7 rounded-full transition-all duration-150 cursor-pointer relative ${
              shadingMode === 'matcap-gold'
                ? 'ring-2 ring-[#F9CF00] ring-offset-2 ring-offset-[#141522] scale-110 shadow-[0_0_12px_rgba(249,207,0,0.4)]'
                : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#b45309] via-[#f59e0b] to-[#fef08a] shadow-[inset_-2px_-2px_4px_rgba(0,0,0,0.6),inset_2px_2px_4px_rgba(255,255,255,0.5)]" />
          </button>
        </SimpleTooltip>

        {/* Sphere 6: UV Checker */}
        <SimpleTooltip label="UV Checker Texture (Inspect Seams & Stretch)" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('uv-checker')}
            aria-label="UV Checker Shader"
            className={`w-7 h-7 rounded-full transition-all duration-150 cursor-pointer relative overflow-hidden ${
              shadingMode === 'uv-checker'
                ? 'ring-2 ring-[#F9CF00] ring-offset-2 ring-offset-[#141522] scale-110 shadow-[0_0_12px_rgba(249,207,0,0.4)]'
                : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
          >
            <div
              className="w-full h-full rounded-full shadow-[inset_0_0_4px_rgba(0,0,0,0.7)] border border-white/20"
              style={{
                backgroundImage: `conic-gradient(
                  #22252a 0.25turn, #e2e6ed 0.25turn 0.5turn,
                  #22252a 0.5turn 0.75turn, #e2e6ed 0.75turn
                )`,
                backgroundSize: '8px 8px',
              }}
            />
          </button>
        </SimpleTooltip>

        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />

        {/* Wireframe Overlay Quick Toggle */}
        <SimpleTooltip label={showWireframe ? 'Wireframe Overlay: ON' : 'Wireframe Overlay: OFF'} side="top">
          <button
            type="button"
            onClick={() => setShowWireframe(!showWireframe)}
            aria-label="Toggle Wireframe Overlay"
            className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              showWireframe
                ? 'bg-[#F9CF00] text-black font-bold shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            <HugeiconsIcon icon={LayersIcon} size={15} />
          </button>
        </SimpleTooltip>
      </div>

      {/* Floating Mesh Details — show only stats sourced from loaded geometry or asset metadata */}
      {currentAsset && (() => {
        const details: Record<string, unknown> = currentAsset.meshDetails && typeof currentAsset.meshDetails === 'object'
          ? currentAsset.meshDetails
          : {};
        const asCount = (value: unknown): number | null =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

        const faces = asCount(
          modelStats?.triangles ??
          (currentAsset.statsAvailable || currentAsset.faces > 0 ? currentAsset.faces : undefined)
        );
        const vertices = asCount(
          modelStats?.vertices ??
          (currentAsset.statsAvailable || currentAsset.vertices > 0 ? currentAsset.vertices : undefined)
        );
        const edges = asCount(modelStats?.edges ?? details.edge_count ?? details.edges);
        const materials = asCount(
          modelStats?.materials ??
          currentAsset.materialCount ??
          (currentAsset.materials?.length ? currentAsset.materials.length : undefined)
        );

        const formatBytes = (bytes: number) => {
          if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
          if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
          if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${bytes} B`;
        };
        const sizeBytes = asCount(details.file_size_bytes);
        const sizeMb = asCount(details.file_size_mb);
        const fileSize = currentAsset.fileSize?.trim() ||
          (sizeBytes !== null && sizeBytes > 0
            ? formatBytes(sizeBytes)
            : sizeMb !== null && sizeMb > 0
              ? `${sizeMb.toFixed(1)} MB`
              : null);

        const compact = (value: number) =>
          new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
        const rawMetrics: { key: string; label: string; value: string | null }[] = [
          { key: 'faces', label: 'Faces', value: faces === null ? null : compact(faces) },
          { key: 'vertices', label: 'Verts', value: vertices === null ? null : compact(vertices) },
          { key: 'edges', label: 'Edges', value: edges === null ? null : compact(edges) },
          { key: 'materials', label: 'Materials', value: materials === null ? null : compact(materials) },
          { key: 'size', label: 'Size', value: fileSize ?? null },
        ];
        const metrics = rawMetrics.filter(
          (metric): metric is { key: string; label: string; value: string } => metric.value !== null
        );

        if ((faces === null && vertices === null) || metrics.length === 0) return null;

        const glyphs: Record<string, React.ReactNode> = {
          faces: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="h-8 w-8 text-[#F9CF00]">
              <path d="M12 3 21 20H3L12 3Z" />
            </svg>
          ),
          vertices: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8 text-zinc-200">
              <path d="M5 5H19V19H5Z" strokeDasharray="3 3" />
              <circle cx="5" cy="5" r="2" fill="#F9CF00" stroke="#F9CF00" />
              <circle cx="19" cy="5" r="2" fill="currentColor" />
              <circle cx="5" cy="19" r="2" fill="#F9CF00" stroke="#F9CF00" />
              <circle cx="19" cy="19" r="2" fill="currentColor" />
            </svg>
          ),
          edges: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8 text-zinc-200">
              <path d="M5 19 19 5" />
              <circle cx="5" cy="19" r="3" fill="#0d0e10" stroke="currentColor" />
              <circle cx="19" cy="5" r="3" fill="#0d0e10" stroke="#F9CF00" />
            </svg>
          ),
          materials: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="h-8 w-8 text-[#F9CF00]">
              <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
              <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
            </svg>
          ),
          size: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="h-8 w-8 text-zinc-200">
              <path d="m12 2.8 8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4L12 2.8Z" />
              <path d="M3.5 7.4 12 12l8.5-4.6M12 12v9.2" />
              <path d="M12 2.8V12" stroke="#F9CF00" />
            </svg>
          ),
        };

        return (
          <section
            id="viewport-mesh-details"
            aria-label="Mesh details"
            className={`pointer-events-auto absolute bottom-[176px] left-3 z-20 w-[min(700px,calc(100%_-_24px))] overflow-hidden rounded-[22px] shadow-[0_14px_44px_rgba(0,0,0,0.62)] backdrop-blur-xl ${isRightPanelOpen ? 'hidden md:block' : ''}`}
            style={{
              border: '1px solid transparent',
              background: 'linear-gradient(#0d0e10,#0d0e10) padding-box, linear-gradient(115deg,#F9CF00 0%,rgba(255,255,255,0.24) 48%,#F9CF00 100%) border-box',
              maxWidth: isRightPanelOpen ? 'min(700px, calc(100% - 300px))' : undefined,
            }}
          >
            <button
              type="button"
              onClick={() => setIsMeshDetailsExpanded((expanded) => !expanded)}
              aria-expanded={isMeshDetailsExpanded}
              aria-controls="viewport-mesh-details-content"
              className="flex h-16 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F9CF00]"
            >
              <svg viewBox="0 0 28 28" fill="none" stroke="#F9CF00" strokeWidth="1.8" strokeLinejoin="round" className="h-9 w-9 shrink-0">
                <path d="M14 3 3.5 23H24.5L14 3Z" />
                <path d="M14 3 14 14M3.5 23 14 14 24.5 23" />
                <circle cx="14" cy="3" r="2.1" fill="#0d0e10" />
                <circle cx="3.5" cy="23" r="2.1" fill="#0d0e10" />
                <circle cx="24.5" cy="23" r="2.1" fill="#0d0e10" />
              </svg>
              <span className="min-w-0 flex-1 text-base font-semibold tracking-wide text-white sm:text-lg">Mesh Details</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-6 w-6 shrink-0 text-white transition-transform duration-200 motion-reduce:transition-none ${isMeshDetailsExpanded ? '' : 'rotate-180'}`}
              >
                <path d="m5 14 7-7 7 7" />
              </svg>
            </button>

            <div
              id="viewport-mesh-details-content"
              className={`grid border-t border-white/[0.12] ${isMeshDetailsExpanded ? '' : 'hidden'}`}
              style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}
            >
              {metrics.map((metric, index) => (
                <div
                  key={metric.key}
                  className={`flex min-w-0 flex-col items-center justify-center gap-1.5 px-1.5 py-4 sm:py-5 ${index < metrics.length - 1 ? 'border-r border-white/[0.1]' : ''}`}
                >
                  {glyphs[metric.key]}
                  <span className="max-w-full truncate text-[19px] font-semibold tabular-nums text-white sm:text-[21px]">{metric.value}</span>
                  <span className="max-w-full truncate text-[13px] text-zinc-400 sm:text-sm">{metric.label}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
    </div>
  );
};
