'use client';

import React, { useEffect, useRef } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import {
  getMotionClip,
  saveAnimatedMeshToWorkspace,
  saveGeneratedMotionClip,
  motionClipV1ToThreeClip,
  extractTargetRestQuaternions,
} from '@/services/motionClient';
import { saveMotionClip } from '@/services/motionStorage';
import { downloadAnimatedGlb, exportAnimatedModelAsGlb } from '../dynamic/exportAnimatedGlb';
import {
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Download,
  Film,
} from '@/components/icons/hugeicons-components';
import { toast } from 'sonner';

export const AnimationPlayerBar: React.FC = () => {
  const { currentAsset, workspaceId, addAsset } = useWorkspace();
  const activeModelObject = useViewerStore((s) => s.activeModelObject);

  const clipState = useAnimationStore((s) => s.clipState);
  const clipError = useAnimationStore((s) => s.clipError);
  const activeMotionClip = useAnimationStore((s) => s.activeMotionClip);
  const activeThreeClip = useAnimationStore((s) => s.activeThreeClip);
  const mappedJointCount = useAnimationStore((s) => s.mappedJointCount);
  const hasRootMotion = useAnimationStore((s) => s.hasRootMotion);
  const pendingMotionClipId = useAnimationStore((s) => s.pendingMotionClipId);
  const pendingMotionClipAssetId = useAnimationStore((s) => s.pendingMotionClipAssetId);
  const currentAssetId = (currentAsset as any)?.asset_id || currentAsset?.id || null;
  const isPlaying = useAnimationStore((s) => s.isPlaying);
  const currentTime = useAnimationStore((s) => s.currentTime);
  const duration = useAnimationStore((s) => s.duration);
  const fps = useAnimationStore((s) => s.fps);
  const playbackSpeed = useAnimationStore((s) => s.playbackSpeed);
  const isLooping = useAnimationStore((s) => s.isLooping);
  const loadedSkeletonBoneNames = useAnimationStore((s) => s.loadedSkeletonBoneNames);
  const retargetMapping = useAnimationStore((s) => s.retargetMapping);

  const togglePlay = useAnimationStore((s) => s.togglePlay);
  const setIsPlaying = useAnimationStore((s) => s.setIsPlaying);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);
  const setPlaybackSpeed = useAnimationStore((s) => s.setPlaybackSpeed);
  const setIsLooping = useAnimationStore((s) => s.setIsLooping);
  const setHasRootMotion = useAnimationStore((s) => s.setHasRootMotion);
  const setClipState = useAnimationStore((s) => s.setClipState);
  const setPendingMotionClipId = useAnimationStore((s) => s.setPendingMotionClipId);
  const bindMotionClip = useAnimationStore((s) => s.bindMotionClip);
  const setClipError = useAnimationStore((s) => s.setClipError);
  const dismissClipError = useAnimationStore((s) => s.dismissClipError);

  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      isMountedRef.current = false;
    };
  }, []);

  // Resolve completed motion independently of the selected left panel.
  // Persist first, then bind only when the original rigged asset is still active.
  useEffect(() => {
    if (!pendingMotionClipId) return;
    const reqId = ++requestIdRef.current;
    const clipId = pendingMotionClipId;
    (async () => {
      try {
        setClipState('loading_clip', null);
        let clip: Awaited<ReturnType<typeof getMotionClip>>;
        let serverSaved = clipId.startsWith('gen_') || clipId.startsWith('upl_');
        if (serverSaved) {
          clip = await getMotionClip(clipId);
        } else {
          try {
            clip = await saveGeneratedMotionClip(clipId);
            serverSaved = true;
          } catch (saveError) {
            serverSaved = false;
            const detail = saveError instanceof Error ? saveError.message : 'Unknown storage error';
            toast.warning('Motion could not be saved to My Presets yet: ' + detail);
            clip = await getMotionClip(clipId);
          }
        }
        if (cancelledRef.current || !isMountedRef.current || requestIdRef.current !== reqId) return;
        if (pendingMotionClipAssetId && currentAssetId !== pendingMotionClipAssetId) {
          setPendingMotionClipId(null);
          toast.info('Motion was saved to My Presets, but the active mesh changed. Select the source rigged mesh to apply it.');
          return;
        }
        if (!currentAssetId) {
          setClipError('Select the source rigged mesh to apply this motion clip.');
          setPendingMotionClipId(null);
          return;
        }
        if (!loadedSkeletonBoneNames?.length) {
          setClipState('loading_clip', null);
          return;
        }
        setClipState('validating_clip', null);
        if (serverSaved) {
          void saveMotionClip(clip, 'generated').catch((cacheError) => {
            console.warn('Motion clip local cache unavailable:', cacheError);
          });
        }
        setClipState('binding_clip', null);
        const { threeClip, mappedJointCount: resolvedMapped } = motionClipV1ToThreeClip(
          clip,
          loadedSkeletonBoneNames,
          retargetMapping,
          { inPlace: !hasRootMotion, restQuaternions: extractTargetRestQuaternions(activeModelObject) }
        );
        if (cancelledRef.current || !isMountedRef.current || requestIdRef.current !== reqId) return;
        bindMotionClip(clip, threeClip, resolvedMapped);
        setPendingMotionClipId(null);
      } catch (err: unknown) {
        if (cancelledRef.current || !isMountedRef.current || requestIdRef.current !== reqId) return;
        const msg = err instanceof Error ? err.message : 'Failed to load generated motion clip.';
        setClipError(msg);
        setPendingMotionClipId(null);
        toast.error(msg);
      }
    })();
  }, [pendingMotionClipId, pendingMotionClipAssetId, currentAssetId, loadedSkeletonBoneNames, retargetMapping,
      hasRootMotion, activeModelObject, setPendingMotionClipId, setClipState, bindMotionClip, setClipError]);

  // Re-bind active clip when In-Place mode is toggled
  const prevHasRootMotionRef = useRef(hasRootMotion);
  useEffect(() => {
    if (prevHasRootMotionRef.current === hasRootMotion) return;
    prevHasRootMotionRef.current = hasRootMotion;
    if (!activeMotionClip || !loadedSkeletonBoneNames?.length) return;
    const { threeClip, mappedJointCount: resolvedMapped } = motionClipV1ToThreeClip(
      activeMotionClip,
      loadedSkeletonBoneNames,
      retargetMapping,
      { inPlace: !hasRootMotion, restQuaternions: extractTargetRestQuaternions(activeModelObject) }
    );
    bindMotionClip(activeMotionClip, threeClip, resolvedMapped);
  }, [hasRootMotion, activeMotionClip, loadedSkeletonBoneNames, retargetMapping, activeModelObject, bindMotionClip]);

  // Hide player when idle and no clip is attached
  if (clipState === 'idle' && !activeThreeClip) {
    return null;
  }

  const isLoadingPhase =
    clipState === 'loading_clip' ||
    clipState === 'validating_clip' ||
    clipState === 'binding_clip';

  if (clipState === 'clip_error') {
    return (
      <div
        id="viewport-animation-player"
        role="alert"
        className="pointer-events-auto flex items-center gap-3 px-3 py-2 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-rose-500/40 shadow-lg text-xs text-rose-200 max-w-md"
      >
        <Film className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        <span className="truncate">{clipError || 'Failed to bind motion clip.'}</span>
        <button
          type="button"
          onClick={dismissClipError}
          className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium shrink-0 cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (isLoadingPhase) {
    const label =
      clipState === 'loading_clip'
        ? 'Loading clip...'
        : clipState === 'validating_clip'
          ? 'Validating MotionClipV1...'
          : 'Binding to skeleton...';
    return (
      <div
        id="viewport-animation-player"
        role="status"
        className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-lg text-xs text-zinc-200"
      >
        <div className="w-3.5 h-3.5 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin" />
        <span>{label}</span>
      </div>
    );
  }

  if (!activeThreeClip) return null;

  const safeFps = fps > 0 ? fps : 20;
  const currentFrame = Math.round(currentTime * safeFps);
  const totalFrames = Math.round(duration * safeFps);
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const isExporting = clipState === 'exporting';
  const clipName = activeMotionClip?.name ?? activeThreeClip.name ?? 'Motion Clip';

  const exportOptions = { activeModelObject, activeThreeClip };
  const handleDownload = async () => {
    setIsPlaying(false);
    setClipState('exporting');
    try {
      const blob = await exportAnimatedModelAsGlb(exportOptions);
      downloadAnimatedGlb(blob, clipName);
      toast.success('Animated GLB downloaded');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setClipState('paused');
    }
  };

  const sourceCandidate = (currentAsset as any)?.asset_id || currentAsset?.id;
  const sourceAssetId = typeof sourceCandidate === 'string' && /^ast_[a-f0-9]{12}$/i.test(sourceCandidate)
    ? sourceCandidate
    : null;
  const targetWorkspaceId = workspaceId || currentAsset?.workspace_id || null;
  const canSaveToWorkspace = Boolean(
    targetWorkspaceId &&
    sourceAssetId &&
    activeMotionClip?.id &&
    activeMotionClip.id !== 'preview' &&
    (currentAsset as any)?.asset_type !== 'animated_mesh'
  );

  const handleSaveToWorkspace = async () => {
    if (!canSaveToWorkspace || !targetWorkspaceId || !sourceAssetId || !activeMotionClip?.id) {
      toast.error('Select the original rigged mesh inside a workspace before saving.');
      return;
    }
    setIsPlaying(false);
    setClipState('exporting');
    try {
      const blob = await exportAnimatedModelAsGlb(exportOptions);
      const saved = await saveAnimatedMeshToWorkspace({
        workspaceId: targetWorkspaceId,
        sourceAssetId,
        motionClipId: activeMotionClip.id,
        clipName,
        glb: blob,
      });
      addAsset({
        id: saved.asset_id,
        asset_id: saved.asset_id,
        asset_type: 'animated_mesh',
        workspace_id: saved.workspace_id,
        operation_id: saved.operation_id,
        operation_type: 'animation',
        source_asset_id: saved.source_asset_id,
        motion_clip_id: saved.motion_clip_id,
        is_base_mesh: false,
        name: saved.name,
        category: 'mesh',
        thumbnail: '',
        meshType: 'custom',
        faces: 0,
        vertices: 0,
        triangles: 0,
        statsAvailable: false,
        topology: 'Triangle',
        format: 'GLB',
        dateCreated: saved.dateCreated || new Date().toISOString(),
        tags: ['Animation', 'Workspace'],
        fileId: saved.asset_id,
        source: saved.source,
      } as any);
      toast.success('Animated mesh saved to workspace');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save animated mesh');
    } finally {
      setClipState('paused');
    }
  };

  return (
    <div
      id="viewport-animation-player"
      aria-label="Animation player"
      className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-lg select-none max-w-[680px] w-max"
    >
      {/* Play / Pause */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={isExporting}
        aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
        className="w-7 h-7 rounded-lg bg-[hsl(var(--primary))] text-black hover:opacity-90 flex items-center justify-center transition-opacity cursor-pointer shrink-0 disabled:opacity-50"
      >
        {isPlaying ? (
          <Pause className="w-3.5 h-3.5 fill-black" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
        )}
      </button>

      {/* Reset */}
      <button
        type="button"
        onClick={() => {
          setCurrentTime(0);
          setIsPlaying(false);
        }}
        disabled={isExporting}
        aria-label="Reset animation to start"
        title="Reset to start"
        className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] text-zinc-300 hover:text-white border border-white/[0.08] flex items-center justify-center transition-colors cursor-pointer shrink-0"
      >
        <RotateCcw className="w-3 h-3" />
      </button>

      {/* Loop */}
      <button
        type="button"
        onClick={() => setIsLooping(!isLooping)}
        aria-label={isLooping ? 'Disable loop' : 'Enable loop'}
        aria-pressed={isLooping}
        title={isLooping ? 'Looping On' : 'Looping Off'}
        className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
          isLooping
            ? 'bg-[hsl(var(--accent))]/20 border-[hsl(var(--accent))]/50 text-[hsl(var(--accent))]'
            : 'bg-[hsl(var(--surface-2))] border-white/[0.08] text-zinc-400 hover:text-white'
        }`}
      >
        <Repeat className="w-3 h-3" />
      </button>

      {/* In-Place */}
      <button
        type="button"
        onClick={() => setHasRootMotion(!hasRootMotion)}
        aria-label={hasRootMotion ? 'Enable in-place mode' : 'Disable in-place mode'}
        aria-pressed={!hasRootMotion}
        title={!hasRootMotion ? 'In-Place On (X/Z root locked)' : 'Root Motion On'}
        className={`h-7 px-2 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
          !hasRootMotion
            ? 'bg-[hsl(var(--accent))]/20 border-[hsl(var(--accent))]/50 text-[hsl(var(--accent))]'
            : 'bg-[hsl(var(--surface-2))] border-white/[0.08] text-zinc-400 hover:text-white'
        }`}
      >
        In-Place
      </button>

      {activeMotionClip && (
        <span
          title={`${mappedJointCount} of ${activeMotionClip.joint_names.length} clip joints mapped to skeleton`}
          className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-zinc-300 shrink-0"
        >
          Mapped Joints {mappedJointCount}/{activeMotionClip.joint_names.length}
        </span>
      )}

      {/* Scrubber & Time */}
      <div className="flex flex-col gap-0.5 min-w-[160px] sm:min-w-[200px]">
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-zinc-300 leading-none">
          <span className="truncate max-w-[100px] font-sans text-zinc-200 font-medium">{clipName}</span>
          <span className="text-zinc-400 shrink-0">
            {currentTime.toFixed(2)}s / {duration.toFixed(1)}s · F{currentFrame}/{totalFrames}
          </span>
        </div>
        <input
          type="range"
          aria-label="Animation timeline scrubber"
          min={0}
          max={Math.max(0.05, duration)}
          step={1 / safeFps}
          value={currentTime}
          onChange={(e) => {
            setCurrentTime(parseFloat(e.target.value));
            if (isPlaying) setIsPlaying(false);
          }}
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${progressPercent}%, rgba(255, 255, 255, 0.1) ${progressPercent}%, rgba(255, 255, 255, 0.1) 100%)`,
          }}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[hsl(var(--primary))]"
        />
      </div>

      {/* Speed Pills */}
      <div className="flex items-center gap-0.5 bg-[hsl(var(--surface-2))] p-0.5 rounded-lg border border-white/[0.08] shrink-0">
        {([0.5, 1.0, 2.0] as const).map((spd) => (
          <button
            key={spd}
            type="button"
            onClick={() => setPlaybackSpeed(spd)}
            aria-label={`Playback speed ${spd}x`}
            className={`h-6 px-1.5 rounded text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
              playbackSpeed === spd
                ? 'bg-[hsl(var(--accent))] text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {spd}x
          </button>
        ))}
      </div>

      {/* Persist the animated mesh in this workspace or download a standalone GLB. */}
      <button
        type="button"
        onClick={handleSaveToWorkspace}
        disabled={isExporting || !activeModelObject || !canSaveToWorkspace}
        aria-label="Save animated mesh to workspace"
        title={canSaveToWorkspace ? 'Save an immutable animated mesh version to this workspace' : 'Select the original rigged workspace mesh to save'}
        className="h-7 px-2.5 rounded-lg bg-[hsl(var(--primary))] hover:opacity-90 text-black text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-40"
      >
        <span>{isExporting ? 'Saving...' : 'Save'}</span>
      </button>
      <button
        type="button"
        onClick={handleDownload}
        disabled={isExporting || !activeModelObject}
        aria-label="Download animated GLB"
        title="Download animated GLB to this device"
        className="h-7 px-2.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] text-zinc-200 hover:text-white text-[11px] font-medium flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
      >
        <Download className="w-3 h-3 text-[hsl(var(--primary))]" />
        <span>Download</span>
      </button>
    </div>
  );
};
