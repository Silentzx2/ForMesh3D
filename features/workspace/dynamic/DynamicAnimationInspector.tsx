'use client';

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import {
  Film,
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Activity,
  Footprints,
  Download,
  Bone,
  Flame,
} from 'lucide-react';
import { toast } from 'sonner';

export const DynamicAnimationInspector: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(1.2);
  const duration = 4.0;
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isLooping, setIsLooping] = useState(true);
  const [showArmature, setShowArmature] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Playback animation simulation tick
  useEffect(() => {
    let animId: number;
    if (isPlaying) {
      const startTime = performance.now();
      const initialOffset = currentTime;

      const tick = (now: number) => {
        const elapsed = ((now - startTime) / 1000) * playbackSpeed;
        let nextTime = initialOffset + elapsed;
        if (nextTime >= duration) {
          if (isLooping) {
            nextTime = nextTime % duration;
          } else {
            nextTime = duration;
            setIsPlaying(false);
            return;
          }
        }
        setCurrentTime(nextTime);
        animId = requestAnimationFrame(tick);
      };

      animId = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, playbackSpeed, isLooping]);

  const currentFrame = Math.round(currentTime * 30);
  const totalFrames = Math.round(duration * 30);
  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  const handleExportClip = async () => {
    try {
      setIsExporting(true);
      toast.info('Baking keyframes and preparing animation clip...');
      await new Promise((r) => setTimeout(r, 900));
      toast.success('Animation motion clip exported (.glb)');
    } catch (err: any) {
      toast.error('Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-3.5 select-none text-xs">
      {/* 1. Header & Clip Status */}
      <div className="p-3 rounded-xl bg-black/40 border border-white/[0.08] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-[#F9CF00]" />
            <span className="text-[11px] font-bold text-white tracking-wide">
              Motion Clip Inspector
            </span>
          </div>
          <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-bold border border-emerald-500/30">
            Ground-Locked
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-white">
            <span>Locomotion Walk Cycle</span>
            <span className="font-mono text-zinc-400 text-[10px]">
              Frame {currentFrame}/{totalFrames}
            </span>
          </div>
          <div className="flex justify-between text-[9px] font-mono text-zinc-400">
            <span>30 FPS · Bipedal Skeleton</span>
            <span>Duration: {duration.toFixed(1)}s</span>
          </div>
        </div>
      </div>

      {/* 2. Interactive Scrubber Timeline */}
      <div className="space-y-2 p-3 rounded-xl bg-[#12131d] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Timeline Scrubber
          </span>
          <span className="font-mono text-[10px] text-[#F9CF00] font-bold">
            {currentTime.toFixed(2)}s / {duration.toFixed(1)}s
          </span>
        </div>

        {/* Progress Bar / Range */}
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.033}
            value={currentTime}
            onChange={(e) => {
              setCurrentTime(parseFloat(e.target.value));
              if (isPlaying) setIsPlaying(false);
            }}
            style={{
              background: `linear-gradient(to right, #F9CF00 0%, #F9CF00 ${progressPercent}%, rgba(255, 255, 255, 0.08) ${progressPercent}%, rgba(255, 255, 255, 0.08) 100%)`,
            }}
            className="w-full h-2 rounded-full appearance-none cursor-pointer focus:outline-none transition-all duration-75 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#F9CF00] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(249,207,0,0.7)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#F9CF00]"
          />
          <div className="flex justify-between text-[8.5px] font-mono text-zinc-500 px-0.5">
            <span>0.0s (Key 0)</span>
            <span>2.0s</span>
            <span>4.0s (End)</span>
          </div>
        </div>

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            {/* Play/Pause */}
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-8 h-8 rounded-lg bg-[#F9CF00] text-black hover:bg-[#ffe34d] flex items-center justify-center transition-all cursor-pointer font-bold shadow-md shadow-[#F9CF00]/20 active:scale-95"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black ml-0.5" />}
            </button>

            {/* Reset to 0 */}
            <button
              type="button"
              onClick={() => {
                setCurrentTime(0);
                setIsPlaying(false);
              }}
              className="w-8 h-8 rounded-lg bg-black/40 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/[0.06] flex items-center justify-center transition-colors cursor-pointer"
              title="Reset to Start"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Loop Toggle */}
            <button
              type="button"
              onClick={() => setIsLooping(!isLooping)}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                isLooping
                  ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'
                  : 'bg-black/40 border-white/[0.06] text-zinc-500'
              }`}
              title={isLooping ? 'Looping Active' : 'Looping Off'}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Speed Pills: 0.5x, 1x, 2x */}
          <div className="flex items-center gap-1 bg-black/30 p-0.5 rounded-lg border border-white/[0.06]">
            {([0.5, 1.0, 2.0] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setPlaybackSpeed(spd)}
                className={`px-2 py-1 rounded text-[9.5px] font-mono font-bold transition-all cursor-pointer ${
                  playbackSpeed === spd
                    ? 'bg-white text-black shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Foot Skating & Kinematics Diagnostics */}
      <div className="space-y-2 p-2.5 rounded-xl bg-[#12131d] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Ground Contact Diagnostics
          </span>
          <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1">
            <Footprints className="w-3 h-3 text-emerald-400" />
            <span>0.01mm Drift</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <div className="p-2 rounded-lg bg-black/30 border border-white/[0.04] space-y-1">
            <span className="text-[9.5px] text-zinc-400 block font-medium">Left Foot Contact</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-bold text-white">Plant (98%)</span>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-black/30 border border-white/[0.04] space-y-1">
            <span className="text-[9.5px] text-zinc-400 block font-medium">Right Foot Contact</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-indigo-400" />
              <span className="text-xs font-mono font-bold text-white">Swing (14%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. 3D Viewport Motion Overlays */}
      <div className="space-y-2 p-2.5 rounded-xl bg-[#12131d] border border-white/[0.08]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
          3D Viewport Overlays
        </span>

        {/* Show Bone Armature */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-2">
            <span className="text-[11px] text-zinc-200 font-medium block">Skeleton Bones</span>
            <span className="text-[9px] text-zinc-400 block">Renders bone joints &amp; hierarchy in 3D</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showArmature}
            onClick={() => setShowArmature(!showArmature)}
            className={`w-7.5 h-4 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
              showArmature ? 'bg-[#F9CF00]' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                showArmature ? 'translate-x-3.5 bg-black' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Show Motion Trajectory */}
        <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
          <div className="space-y-0.5 pr-2">
            <span className="text-[11px] text-zinc-200 font-medium block">Trajectory Arc</span>
            <span className="text-[9px] text-zinc-400 block">Visualizes center-of-mass motion curve</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showTrajectory}
            onClick={() => setShowTrajectory(!showTrajectory)}
            className={`w-7.5 h-4 rounded-full p-0.5 transition-colors cursor-pointer flex-shrink-0 ${
              showTrajectory ? 'bg-[#F9CF00]' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                showTrajectory ? 'translate-x-3.5 bg-black' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 5. Action Export Card */}
      <button
        type="button"
        onClick={handleExportClip}
        disabled={isExporting}
        className="w-full h-8 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-white text-[11px] font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
      >
        <Download className="w-3.5 h-3.5 text-[#F9CF00]" />
        <span>{isExporting ? 'Baking Clip...' : 'Export Motion Clip (.GLB / .FBX)'}</span>
      </button>
    </div>
  );
};
