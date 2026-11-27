'use client';

import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { downloadAnimatedGlb, exportAnimatedModelAsGlb } from './exportAnimatedGlb';
import {
  Film,
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Download,
} from '@/components/icons/hugeicons-components';
import { toast } from 'sonner';

export const DynamicAnimationInspector: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const activeModelObject = useViewerStore((s) => s.activeModelObject);

  const clipState = useAnimationStore((s) => s.clipState);
  const clipError = useAnimationStore((s) => s.clipError);
  const activeMotionClip = useAnimationStore((s) => s.activeMotionClip);
  const activeThreeClip = useAnimationStore((s) => s.activeThreeClip);
  const mappedJointCount = useAnimationStore((s) => s.mappedJointCount);
  const hasRootMotion = useAnimationStore((s) => s.hasRootMotion);
  const setHasRootMotion = useAnimationStore((s) => s.setHasRootMotion);
  const isPlaying = useAnimationStore((s) => s.isPlaying);
  const togglePlay = useAnimationStore((s) => s.togglePlay);
  const setIsPlaying = useAnimationStore((s) => s.setIsPlaying);
  const currentTime = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);
  const duration = useAnimationStore((s) => s.duration);
  const fps = useAnimationStore((s) => s.fps);
  const playbackSpeed = useAnimationStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useAnimationStore((s) => s.setPlaybackSpeed);
  const isLooping = useAnimationStore((s) => s.isLooping);
  const setIsLooping = useAnimationStore((s) => s.setIsLooping);
  const setClipState = useAnimationStore((s) => s.setClipState);
  const dismissClipError = useAnimationStore((s) => s.dismissClipError);
  const displayOptions = useAnimationStore((s) => s.displayOptions);
  const setDisplayOptions = useAnimationStore((s) => s.setDisplayOptions);

  const [exportError, setExportError] = useState<string | null>(null);

  const isExporting = clipState === 'exporting';
  const hasClip = Boolean(activeThreeClip);
  const safeFps = fps > 0 ? fps : 20;
  const currentFrame = Math.round(currentTime * safeFps);
  const totalFrames = Math.round(duration * safeFps);
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const clipName = activeMotionClip?.name ?? activeThreeClip?.name ?? 'No Clip Attached';

  const handleExportClip = async () => {
    setIsPlaying(false);
    setClipState('exporting');
    setExportError(null);
    toast.info('Preparing animation motion clip export...');
    try {
      const glb = await exportAnimatedModelAsGlb({ activeModelObject, activeThreeClip });
      downloadAnimatedGlb(glb, currentAsset?.name || clipName);
      toast.success('Animation motion clip exported (.glb)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      setExportError(msg);
      toast.error(`Export failed: ${msg}`);
    } finally {
      setClipState(hasClip ? 'paused' : 'idle');
    }
  };

  const statusBadge = (() => {
    switch (clipState) {
      case 'playing':
        return { label: 'Playing', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      case 'paused':
      case 'ready':
        return { label: 'Ready', cls: 'bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))] border-[hsl(var(--accent))]/30' };
      case 'loading_clip':
      case 'validating_clip':
      case 'binding_clip':
        return { label: 'Loading', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
      case 'exporting':
        return { label: 'Exporting', cls: 'bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] border-[hsl(var(--primary))]/30' };
      case 'clip_error':
        return { label: 'Error', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
      default:
        return { label: 'Idle', cls: 'bg-white/[0.06] text-zinc-400 border-white/[0.08]' };
    }
  })();

  return (
    <div className="space-y-2.5 select-none text-xs">
      {/* Clip Info Card */}
      <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Film className="w-3.5 h-3.5 text-[hsl(var(--primary))] shrink-0" />
            <span className="text-xs font-semibold text-white truncate">{clipName}</span>
          </div>
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-mono font-medium border shrink-0 ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>

        <div className="flex justify-between text-[11px] font-mono text-zinc-400">
          <span>Frame {currentFrame}/{totalFrames}</span>
          <span>{duration.toFixed(1)}s · {safeFps} FPS</span>
        </div>

        {activeMotionClip && (
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 border-t border-white/[0.06] pt-1">
            <span className="truncate">{activeMotionClip.skeleton_profile}</span>
            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-zinc-200">
              Mapped Joints {mappedJointCount}/{activeMotionClip.joint_names.length}
            </span>
          </div>
        )}
      </div>

      {/* Error State Banner */}
      {clipState === 'clip_error' && clipError && (
        <div role="alert" className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 space-y-1.5">
          <p className="text-[11px] leading-snug">{clipError}</p>
          <button
            type="button"
            onClick={dismissClipError}
            className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Scrubber Timeline */}
      <div className="space-y-1.5 p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-zinc-300">Timeline</span>
          <span className="font-mono text-[11px] text-[hsl(var(--primary))] font-semibold">
            {currentTime.toFixed(2)}s / {duration.toFixed(1)}s
          </span>
        </div>

        <input
          type="range"
          aria-label="Animation timeline scrubber"
          min={0}
          max={Math.max(0.05, duration)}
          step={1 / safeFps}
          value={currentTime}
          disabled={!hasClip || isExporting}
          onChange={(e) => {
            setCurrentTime(parseFloat(e.target.value));
            if (isPlaying) setIsPlaying(false);
          }}
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${progressPercent}%, rgba(255, 255, 255, 0.08) ${progressPercent}%, rgba(255, 255, 255, 0.08) 100%)`,
          }}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none disabled:opacity-40 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[hsl(var(--primary))]"
        />

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!hasClip || isExporting}
              className="w-7 h-7 rounded-lg bg-[hsl(var(--primary))] text-black hover:opacity-90 flex items-center justify-center transition-opacity cursor-pointer font-bold disabled:opacity-40"
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
              disabled={!hasClip || isExporting}
              className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-3))] text-zinc-300 hover:text-white border border-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
              aria-label="Reset to start"
              title="Reset to start"
            >
              <RotateCcw className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={() => setIsLooping(!isLooping)}
              aria-label={isLooping ? 'Disable loop' : 'Enable loop'}
              aria-pressed={isLooping}
              className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                isLooping
                  ? 'bg-[hsl(var(--accent))]/20 border-[hsl(var(--accent))]/50 text-[hsl(var(--accent))]'
                  : 'bg-[hsl(var(--surface-1))] border-white/[0.08] text-zinc-400 hover:text-white'
              }`}
              title={isLooping ? 'Looping Active' : 'Looping Off'}
            >
              <Repeat className="w-3 h-3" />
            </button>
          </div>

          {/* Speed Pills */}
          <div className="flex items-center gap-0.5 bg-[hsl(var(--surface-1))] p-0.5 rounded-lg border border-white/[0.08]">
            {([0.5, 1.0, 2.0] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setPlaybackSpeed(spd)}
                className={`h-6 px-1.5 rounded text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                  playbackSpeed === spd ? 'bg-[hsl(var(--accent))] text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3D Overlays & Playback Options */}
      <div className="p-2.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-200 font-medium">Skeleton Armature</span>
          <button
            type="button"
            role="switch"
            aria-checked={displayOptions.showSkeleton}
            aria-label="Toggle skeleton armature"
            onClick={() => setDisplayOptions({ showSkeleton: !displayOptions.showSkeleton })}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${
              displayOptions.showSkeleton ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full shadow-sm transition-transform ${
                displayOptions.showSkeleton ? 'translate-x-3 bg-black' : 'translate-x-0 bg-white'
              }`}
            />
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
          <span className="text-xs text-zinc-200 font-medium">In-Place (Lock X/Z)</span>
          <button
            type="button"
            role="switch"
            aria-checked={!hasRootMotion}
            aria-label="Toggle in-place mode"
            onClick={() => setHasRootMotion(!hasRootMotion)}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${
              !hasRootMotion ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full shadow-sm transition-transform ${
                !hasRootMotion ? 'translate-x-3 bg-black' : 'translate-x-0 bg-white'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={handleExportClip}
          disabled={isExporting || !activeModelObject}
          className="w-full h-8 px-3 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
          <span>{isExporting ? 'Exporting Motion Clip...' : 'Export Motion Clip (.GLB)'}</span>
        </button>
        {exportError && (
          <div role="alert" className="text-[11px] text-rose-400">{exportError}</div>
        )}
      </div>
    </div>
  );
};
