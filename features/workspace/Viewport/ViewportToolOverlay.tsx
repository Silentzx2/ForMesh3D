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

  // XYZ Gizmo axis tap -> camera preset (MeshViewer listens for setCameraPreset)
  const snapGizmo = (key: 'front' | 'back' | 'top' | 'bottom' | 'right' | 'left') => {
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

      {/* XYZ Gizmo — 64×64 glass disc; taps snap the camera, drags pass through to orbit */}
      <div className="pointer-events-none absolute top-12 right-3 z-20 w-16 h-16 rounded-full bg-black/30 backdrop-blur-sm border border-white/10 flex items-center justify-center">
        <button
          type="button"
          onClick={() => snapGizmo('right')}
          className="pointer-events-auto absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-red-500 ring-1 ring-white/20 text-[9px] font-mono text-white font-bold shadow-md hover:scale-110 active:scale-90 transition-transform"
          aria-label="Snap to Right view (+X)"
          title="+X"
        >
          +X
        </button>
        <button
          type="button"
          onClick={() => snapGizmo('left')}
          className="pointer-events-auto absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-red-500 ring-1 ring-white/20 text-[9px] font-mono text-white font-bold shadow-md hover:scale-110 active:scale-90 transition-transform"
          aria-label="Snap to Left view (-X)"
          title="-X"
        >
          -X
        </button>
        <button
          type="button"
          onClick={() => snapGizmo('top')}
          className="pointer-events-auto absolute top-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-emerald-500 ring-1 ring-white/20 text-[9px] font-mono text-white font-bold shadow-md hover:scale-110 active:scale-90 transition-transform"
          aria-label="Snap to Top view (+Y)"
          title="+Y"
        >
          +Y
        </button>
        <button
          type="button"
          onClick={() => snapGizmo('bottom')}
          className="pointer-events-auto absolute bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-emerald-500 ring-1 ring-white/20 text-[9px] font-mono text-white font-bold shadow-md hover:scale-110 active:scale-90 transition-transform"
          aria-label="Snap to Bottom view (-Y)"
          title="-Y"
        >
          -Y
        </button>
        <button
          type="button"
          onClick={() => snapGizmo('front')}
          className="pointer-events-auto absolute top-1 right-1 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-blue-500 ring-1 ring-white/20 text-[9px] font-mono text-white font-bold shadow-md hover:scale-110 active:scale-90 transition-transform"
          aria-label="Snap to Front view (+Z)"
          title="+Z"
        >
          +Z
        </button>
        <button
          type="button"
          onClick={() => snapGizmo('back')}
          className="pointer-events-auto absolute bottom-1 left-1 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-blue-500 ring-1 ring-white/20 text-[9px] font-mono text-white font-bold shadow-md hover:scale-110 active:scale-90 transition-transform"
          aria-label="Snap to Back view (-Z)"
          title="-Z"
        >
          -Z
        </button>
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

      {/* Mesh Stats Chip — bottom-left pill; hidden when no model is loaded */}
      {currentAsset && currentAsset.faces > 0 && (
        <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[11px] font-mono text-zinc-300 shadow-md whitespace-nowrap">
          <span>[ ▲ {currentAsset.faces.toLocaleString()} Tris ]</span>
          <span className="mx-1">·</span>
          <span>[ ● {currentAsset.vertices.toLocaleString()} Verts ]</span>
          <span className="mx-1">·</span>
          <span>[ ⬡ {currentAsset.topology} ]</span>
        </div>
      )}
    </div>
  );
};
