'use client';

import React, { useState } from 'react';
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
    showGrid,
    setShowGrid,
    isTurntable,
    setIsTurntable,
    shadingMode,
    setShadingMode,
    isRightPanelOpen: contextRightPanelOpen,
  } = useWorkspace();

  const isRightPanelOpen = propRightPanelOpen ?? contextRightPanelOpen ?? false;

  const [activePreset, setActivePreset] = useState<'Front' | 'Top' | 'Side' | 'Iso'>('Iso');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [lightingTone, setLightingTone] = useState<LightTone>('studio');
  const [exposure, setExposure] = useState<number>(1.15);

  // 1. Camera Snapshot (downloads full-resolution PNG)
  const handleSnapshot = () => {
    const canvas = document.querySelector('#center-viewport-stage canvas') as HTMLCanvasElement;
    if (!canvas) {
      toast.error('Canvas not ready for snapshot');
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `formesh3d-snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success('Screenshot saved to Downloads');
    } catch {
      toast.error('Failed to capture screenshot');
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
      {/* Top-Right Control Cluster (Orientation Gizmo + Vertical Tool Dock) */}
      <div
        className={`pointer-events-auto absolute top-3.5 flex flex-col items-center gap-2 transition-[right] duration-200 ease-out ${
          isRightPanelOpen ? 'hidden md:flex' : 'flex'
        }`}
        style={{
          right: isRightPanelOpen ? '265px' : '16px',
        }}
      >
        {/* 3D Orientation Gizmo */}
        <div className="p-1 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] shadow-xl flex items-center gap-1">
          <div className="px-1.5 py-1 flex items-center gap-1 border-r border-white/[0.08] text-zinc-400">
            <HugeiconsIcon icon={CompassIcon} size={13} className="text-[#F9CF00]" />
            <span className="text-[10px] font-black tracking-wider text-zinc-300">3D</span>
          </div>
          <div className="flex items-center gap-0.5">
            {(['Front', 'Side', 'Top', 'Iso'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleSnapCamera(p)}
                className={`px-2 py-1 rounded-xl text-[10px] font-bold transition-all cursor-pointer ${
                  activePreset === p
                    ? 'bg-[#F9CF00] text-black shadow-sm font-black'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                }`}
                title={`Snap to ${p} view`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Vertical Floating Tool Dock */}
        <div className="relative p-1 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] shadow-xl flex flex-col items-center gap-1">
          {/* 1. Viewport Settings button */}
          <SimpleTooltip label="Viewport Settings" side="left">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isSettingsOpen
                  ? 'bg-[#F9CF00] text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
              aria-label="Viewport Settings"
            >
              <HugeiconsIcon icon={SettingsIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 2. Wireframe toggle button */}
          <SimpleTooltip
            label={showWireframe ? 'Wireframe: ON' : 'Wireframe: OFF'}
            side="left"
          >
            <button
              type="button"
              onClick={() => setShowWireframe(!showWireframe)}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                showWireframe
                  ? 'bg-[#F9CF00] text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
              aria-label="Toggle Wireframe"
            >
              <HugeiconsIcon icon={LayersIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 3. Turntable 360° Auto-Rotate toggle button */}
          <SimpleTooltip
            label={isTurntable ? 'Turntable: ON' : 'Turntable: OFF'}
            side="left"
          >
            <button
              type="button"
              onClick={() => setIsTurntable(!isTurntable)}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isTurntable
                  ? 'bg-[#F9CF00] text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
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

          {/* 4. Ground Grid toggle button */}
          <SimpleTooltip
            label={showGrid !== false ? 'Grid: ON' : 'Grid: OFF'}
            side="left"
          >
            <button
              type="button"
              onClick={() => setShowGrid(showGrid === false ? true : false)}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                showGrid !== false
                  ? 'bg-[#F9CF00] text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
              aria-label="Toggle Ground Grid"
            >
              <HugeiconsIcon icon={GridIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 5. Camera Snapshot button */}
          <SimpleTooltip label="Capture Snapshot (PNG)" side="left">
            <button
              type="button"
              onClick={handleSnapshot}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer active:scale-95"
              aria-label="Capture Snapshot"
            >
              <HugeiconsIcon icon={CameraIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* 6. Help / Navigation shortcuts */}
          <SimpleTooltip
            label="Orbit: Left Drag · Pan: Right Drag · Zoom: Scroll"
            side="left"
          >
            <button
              type="button"
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
              aria-label="Navigation Shortcuts"
            >
              <HugeiconsIcon icon={HelpCircleIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* Settings Popover */}
          {isSettingsOpen && (
            <div className="absolute right-full mr-2.5 top-0 w-64 p-3 rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] shadow-2xl z-30 space-y-3.5 text-xs text-white">
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

              {/* Shading Mode */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Shading Mode
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'textured', label: 'Texture' },
                      { id: 'clay', label: 'Clay' },
                      { id: 'wireframe', label: 'Wire' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleShadingChange(m.id)}
                      className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                        shadingMode === m.id
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
    </div>
  );
};
