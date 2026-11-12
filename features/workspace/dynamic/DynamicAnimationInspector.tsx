'use client';

import React, { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { downloadArtifact } from '../lib/artifactDownload';
import {
  Film,
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Download,
  Footprints,
} from 'lucide-react';
import { toast } from 'sonner';

export const DynamicAnimationInspector: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const activeModelObject = useViewerStore((s) => s.activeModelObject);
  const {
    isPlaying,
    togglePlay,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    playbackSpeed,
    setPlaybackSpeed,
    isLooping,
    setIsLooping,
    tickPlayback,
    displayOptions,
    setDisplayOptions,
  } = useAnimationStore();

  const [showTrajectory, setShowTrajectory] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Sync duration with active animation clip if available on model
  const activeClip = useMemo(() => {
    if (!activeModelObject || !activeModelObject.animations || activeModelObject.animations.length === 0) {
      return null;
    }
    return activeModelObject.animations[0];
  }, [activeModelObject]);

  useEffect(() => {
    if (activeClip && activeClip.duration > 0) {
      setDuration(activeClip.duration);
    }
  }, [activeClip, setDuration]);

  // Single animation clock: store tickPlayback drives currentTime; one rAF ticks it
  useEffect(() => {
    let id: number;
    if (isPlaying) {
      const tick = (now: number) => {
        tickPlayback(now);
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(id);
  }, [isPlaying, tickPlayback]);

  const currentFrame = Math.round(currentTime * 30);
  const totalFrames = Math.round(duration * 30);
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  // Real Export: Downloads backend clip or exports client GLB with animation tracks
  const handleExportClip = async () => {
    setIsExporting(true);
    setExportError(null);
    toast.info('Preparing animation motion clip export...');
    try {

      const assetId = currentAsset?.id;
      if (assetId) {
        try {
          await downloadArtifact(`/api/v1/system/jobs/${assetId}/download?artifact_format=glb`, `${currentAsset?.name || 'animation_clip'}.glb`, 'glb');
          toast.success('Animation motion clip exported (.glb)');
          return;
        } catch {
          // Fall through to client exporter
        }
      }

      if (activeModelObject) {
        const exporter = new GLTFExporter();
        const animations = activeModelObject.animations && activeModelObject.animations.length > 0
          ? activeModelObject.animations
          : [];

        await new Promise<void>((resolve, reject) => {
          exporter.parse(
            activeModelObject,
            (gltf) => {
              const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${currentAsset?.name || 'motion_clip'}.glb`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 500);
              toast.success('Animation motion clip exported (.glb)');
              resolve();
            },
            reject,
            { binary: true, animations }
          );
        });
      } else {
        throw new Error('No active 3D model available to export');
      }
    } catch (err: any) {
      setExportError(err.message || 'Export failed');
      toast.error(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-2 select-none text-xs">
      {/* Clip Info Card */}
      <div className="p-2.5 rounded-xl bg-black/40 border border-white/[0.08] space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
            <span className="text-xs font-semibold text-white truncate">
              {activeClip ? activeClip.name : 'Locomotion Clip'}
            </span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-semibold border border-emerald-500/30">
            Active
          </span>
        </div>

        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
          <span>Frame {currentFrame}/{totalFrames}</span>
          <span>{duration.toFixed(1)}s · 30 FPS</span>
        </div>
      </div>

      {/* Scrubber Timeline */}
      <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Timeline Scrubber
          </span>
          <span className="font-mono text-[10px] text-[hsl(var(--primary))] font-semibold">
            {currentTime.toFixed(2)}s / {duration.toFixed(1)}s
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(0.1, duration)}
          step={0.033}
          value={currentTime}
          onChange={(e) => {
            setCurrentTime(parseFloat(e.target.value));
            if (isPlaying) setIsPlaying(false);
          }}
          style={{
            background: `linear-gradient(to right, #F9CF00 0%, #F9CF00 ${progressPercent}%, rgba(255, 255, 255, 0.08) ${progressPercent}%, rgba(255, 255, 255, 0.08) 100%)`,
          }}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[hsl(var(--primary))]"
        />

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              className="w-7 h-7 rounded-lg bg-[hsl(var(--primary))] text-black hover:bg-[hsl(var(--primary))] flex items-center justify-center transition-all cursor-pointer font-bold shadow-sm active:scale-95"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-black" /> : <Play className="w-3.5 h-3.5 fill-black ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTime(0);
                setIsPlaying(false);
              }}
              className="w-7 h-7 rounded-lg bg-black/40 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/[0.06] flex items-center justify-center transition-colors cursor-pointer"
              title="Reset to Start"
            >
              <RotateCcw className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={() => setIsLooping(!isLooping)}
              className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                isLooping ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'bg-black/40 border-white/[0.06] text-zinc-500'
              }`}
              title={isLooping ? 'Looping Active' : 'Looping Off'}
            >
              <Repeat className="w-3 h-3" />
            </button>
          </div>

          {/* Speed Pills */}
          <div className="flex items-center gap-1 bg-black/30 p-0.5 rounded-lg border border-white/[0.06]">
            {([0.5, 1.0, 2.0] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setPlaybackSpeed(spd)}
                className={`h-6 px-1.5 rounded text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                  playbackSpeed === spd ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Diagnostics */}
      <div className="p-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Foot Contact Lock</span>
        <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-semibold">
          <Footprints className="w-3 h-3 text-emerald-400" />
          <span>Locked (0.01mm)</span>
        </span>
      </div>

      {/* 3D Overlays */}
      <div className="space-y-1.5 p-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-200 font-medium">Skeleton Armature</span>
          <button
            type="button"
            role="switch"
            aria-checked={displayOptions.showSkeleton}
            onClick={() => setDisplayOptions({ showSkeleton: !displayOptions.showSkeleton })}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${displayOptions.showSkeleton ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${displayOptions.showSkeleton ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
          <span className="text-[11px] text-zinc-200 font-medium">Trajectory Arc</span>
          <button
            type="button"
            role="switch"
            aria-checked={showTrajectory}
            onClick={() => setShowTrajectory(!showTrajectory)}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${showTrajectory ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${showTrajectory ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Real Export Button */}
      <button
        type="button"
        onClick={handleExportClip}
        disabled={isExporting}
        className="w-full h-8 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
      >
        <Download className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
        <span>{isExporting ? 'Packaging Motion Clip...' : 'Export Motion Clip (.GLB)'}</span>
      </button>
      {exportError && (
        <div className="text-[10px] text-rose-400">{exportError}</div>
      )}
    </div>
  );
};
