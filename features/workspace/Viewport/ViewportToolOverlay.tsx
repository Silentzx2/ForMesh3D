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
  RotateCw,
  SettingsIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';

export const ViewportToolOverlay: React.FC = () => {
  const {
    showWireframe,
    setShowWireframe,
    showGrid,
    setShowGrid,
    isTurntable,
    setIsTurntable,
  } = useWorkspace();

  const [activePreset, setActivePreset] = useState<'Front' | 'Top' | 'Side' | 'Iso'>('Iso');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 1. Camera Snapshot
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
      a.download = `formesh3d-${Date.now()}.png`;
      a.click();
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

  return (
    <div
      id="viewport-tool-overlay"
      className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-3 overflow-hidden select-none"
    >
      {/* Top-Right Control Cluster (Orientation Gizmo + Vertical Tool Dock) */}
      <div className="flex items-start justify-end w-full">
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          {/* 3D Orientation Gizmo */}
          <div className="p-1 rounded-2xl bg-[#1c1c20]/90 backdrop-blur-md border border-white/[0.08] shadow-xl flex flex-col items-center gap-1">
            <div className="flex items-center gap-0.5 p-0.5">
              {(['Front', 'Side', 'Top', 'Iso'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSnapCamera(p)}
                  className={`px-1.5 py-0.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                    activePreset === p
                      ? 'bg-[#F9CF00] text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Vertical Floating Tool Dock matching .brain/ reference */}
          <div className="relative p-1 rounded-2xl bg-[#1c1c20]/90 backdrop-blur-md border border-white/[0.08] shadow-xl flex flex-col items-center gap-1">
            {/* 1. Settings button */}
            <SimpleTooltip label="Viewport Settings" side="left">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`p-2 rounded-xl transition-all cursor-pointer ${
                  isSettingsOpen
                    ? 'bg-[#F9CF00] text-black shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <HugeiconsIcon icon={SettingsIcon} size={16} />
              </button>
            </SimpleTooltip>

            {/* 2. Camera Snapshot button */}
            <SimpleTooltip label="Capture Snapshot" side="left">
              <button
                type="button"
                onClick={handleSnapshot}
                className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
              >
                <HugeiconsIcon icon={CameraIcon} size={16} />
              </button>
            </SimpleTooltip>

            {/* 3. Wireframe / Grid toggle */}
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
              >
                <HugeiconsIcon icon={GridIcon} size={16} />
              </button>
            </SimpleTooltip>

            {/* 4. Help / Navigation shortcuts */}
            <SimpleTooltip
              label="Orbit: Left Drag · Pan: Right Drag · Zoom: Scroll"
              side="left"
            >
              <button
                type="button"
                className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
              >
                <HugeiconsIcon icon={HelpCircleIcon} size={16} />
              </button>
            </SimpleTooltip>

            {/* Settings Dropdown Popover */}
            {isSettingsOpen && (
              <div className="absolute right-full mr-2 top-0 w-48 p-2.5 rounded-2xl bg-[#1c1c20]/95 backdrop-blur-xl border border-white/10 shadow-2xl z-30 space-y-2 text-xs">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Viewport Controls
                </p>

                {/* Turntable Auto-rotate */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">Auto Rotate</span>
                  <button
                    type="button"
                    onClick={() => setIsTurntable(!isTurntable)}
                    className={`w-8 h-4 rounded-full p-0.5 transition-all cursor-pointer ${
                      isTurntable ? 'bg-[#F9CF00]' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-black transition-all ${
                        isTurntable ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Ground Grid Toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">Ground Grid</span>
                  <button
                    type="button"
                    onClick={() => setShowGrid(showGrid === false ? true : false)}
                    className={`w-8 h-4 rounded-full p-0.5 transition-all cursor-pointer ${
                      showGrid !== false ? 'bg-[#F9CF00]' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-black transition-all ${
                        showGrid !== false ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
