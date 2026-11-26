'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { ActiveMeshBar, isValidMeshAsset } from '../components';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useViewerStore } from '@/stores/useViewerStore';
import { exportAnimatedModelAsGlb } from '../dynamic/exportAnimatedGlb';
import {
  listMotionPresets,
  saveAnimatedMeshToWorkspace,
  listUploadedMotionClips,
  uploadMotionClip,
  deleteUploadedMotionClip,
  getMotionClipFromUrl,
  getPresetThumbnailUrl,
  motionClipV1ToThreeClip,
  type MotionPresetItem,
  type MotionClipV1,
} from '@/services/motionClient';
import {
  listSavedMotionClips,
  saveMotionClip,
  deleteSavedMotionClip,
  type SavedMotionClipRecord,
} from '@/services/motionStorage';
import {
  Film,
  RotateCw,
  Trash2,
} from '@/components/icons/hugeicons-components';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel, SearchIcon, UploadIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

type LibraryTab = 'preset' | 'saved';
type LoadStatus = 'loading' | 'ready' | 'empty' | 'error';

const DURATION_MIN = 0.5;
const DURATION_MAX = 30.0;

interface PresetCardProps {
  preset: MotionPresetItem;
  isActive: boolean;
  isExportSelected: boolean;
  onSelect: (preset: MotionPresetItem) => void;
  onToggleExport: (presetId: string) => void;
}

const PresetCard: React.FC<PresetCardProps> = ({ preset, isActive, isExportSelected, onSelect, onToggleExport }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const thumbUrl = getPresetThumbnailUrl(preset);

  return (
    <div className={`relative rounded-xl border p-2 transition-colors ${isActive
      ? 'bg-[hsl(var(--accent))]/15 border-[hsl(var(--accent))] text-white'
      : 'bg-[hsl(var(--surface-2))] border-white/[0.08] text-zinc-200'}`}>
      <button type="button" onClick={() => onSelect(preset)} className="w-full text-left cursor-pointer flex flex-col gap-1.5">
        <div className="w-full aspect-square rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.06] overflow-hidden flex items-center justify-center">
          {thumbUrl && !imgFailed ? (
            <img src={thumbUrl} alt={preset.name} onError={() => setImgFailed(true)} className="w-full h-full object-cover" />
          ) : (
            <Film className="w-6 h-6 text-zinc-500" />
          )}
        </div>
        <div className="min-w-0 space-y-0.5 pr-1">
          <div className="text-xs font-medium text-white truncate">{preset.name}</div>
          {(preset.duration !== null || preset.fps !== null) && (
            <div className="text-[11px] font-mono text-zinc-400 truncate">
              {[
                preset.duration !== null ? `${preset.duration.toFixed(1)}s` : null,
                preset.fps !== null ? `${preset.fps} FPS` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={() => onToggleExport(preset.id)}
        aria-pressed={isExportSelected}
        aria-label={isExportSelected ? 'Remove preset from workspace export selection' : 'Select preset for workspace export'}
        className={`absolute top-3 right-3 min-w-6 h-6 px-1.5 rounded-md border text-[10px] font-semibold cursor-pointer ${isExportSelected
          ? 'bg-[hsl(var(--primary))] text-black border-[hsl(var(--primary))]'
          : 'bg-black/60 text-white border-white/20 hover:bg-black/80'}`}
      >
        {isExportSelected ? '✓' : '+'}
      </button>
    </div>
  );
};

export const AnimationPanel: React.FC = () => {
  const {
    isExecuting,
    executionProgress,
    executionStep,
    cancelExecution,
    currentAsset,
    workspaceId,
    addAsset,
    runMotionGeneration,
  } = useWorkspace();

  const activeModelObject = useViewerStore((s) => s.activeModelObject);
  const loadedSkeletonBoneNames = useAnimationStore((s) => s.loadedSkeletonBoneNames);
  const retargetMapping = useAnimationStore((s) => s.retargetMapping);
  const activeMotionClip = useAnimationStore((s) => s.activeMotionClip);
  const setClipState = useAnimationStore((s) => s.setClipState);
  const setIsPlaying = useAnimationStore((s) => s.setIsPlaying);
  const bindMotionClip = useAnimationStore((s) => s.bindMotionClip);
  const setClipError = useAnimationStore((s) => s.setClipError);

  const hasValidMesh = isValidMeshAsset(currentAsset);
  const hasRiggedMesh = hasValidMesh && Boolean(loadedSkeletonBoneNames?.length);
  const sourceCandidate = (currentAsset as any)?.asset_id || currentAsset?.id;
  const sourceAssetId = typeof sourceCandidate === 'string' && /^ast_[a-f0-9]{12}$/i.test(sourceCandidate)
    ? sourceCandidate
    : null;
  const targetWorkspaceId = workspaceId || currentAsset?.workspace_id || null;

  // Create Motion state
  const [motionPrompt, setMotionPrompt] = useState<string>('');
  const [duration, setDuration] = useState<number>(4.0);
  const [seed, setSeed] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Library tabs & search
  const [activeTab, setActiveTab] = useState<LibraryTab>('preset');
  const [searchQuery, setSearchQuery] = useState('');

  // Preset state
  const [presetStatus, setPresetStatus] = useState<LoadStatus>('loading');
  const [presets, setPresets] = useState<MotionPresetItem[]>([]);
  const [selectedExportPresetIds, setSelectedExportPresetIds] = useState<string[]>([]);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  // My Presets state (server uploads/generated copies + IndexedDB cache)
  const [savedStatus, setSavedStatus] = useState<LoadStatus>('loading');
  const [savedClips, setSavedClips] = useState<SavedMotionClipRecord[]>([]);
  const [uploadedClips, setUploadedClips] = useState<MotionPresetItem[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);

  // NPZ preview upload
  const npzInputRef = useRef<HTMLInputElement>(null);
  const [isPreviewUploading, setIsPreviewUploading] = useState(false);
  const clipRequestIdRef = useRef(0);

  const loadPresets = useCallback(async () => {
    setPresetStatus('loading');
    setPresetError(null);
    try {
      const res = await listMotionPresets();
      setPresets(res.presets);
      setPresetStatus(res.presets.length > 0 ? 'ready' : 'empty');
    } catch (err: unknown) {
      setPresetError(err instanceof Error ? err.message : 'Failed to load presets.');
      setPresetStatus('error');
    }
  }, []);

  const loadSaved = useCallback(async () => {
    setSavedStatus('loading');
    setSavedError(null);
    try {
      const [localResult, uploadsResult] = await Promise.allSettled([
        listSavedMotionClips(),
        listUploadedMotionClips(),
      ]);

      const records = localResult.status === 'fulfilled' ? localResult.value : [];
      const uploads = uploadsResult.status === 'fulfilled' ? uploadsResult.value.presets : [];

      setSavedClips(records);
      setUploadedClips(uploads);

      if (records.length === 0 && uploads.length === 0) {
        if (localResult.status === 'rejected' && uploadsResult.status === 'rejected') {
          setSavedError('Failed to load saved or uploaded clips.');
          setSavedStatus('error');
          return;
        }
        setSavedStatus('empty');
      } else {
        setSavedStatus('ready');
      }
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : 'Failed to read My Presets.');
      setSavedStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadPresets();
    void loadSaved();
  }, [loadPresets, loadSaved]);

  useEffect(() => {
    if (activeMotionClip?.id) void loadSaved();
  }, [activeMotionClip?.id, loadSaved]);

  useEffect(() => {
    clipRequestIdRef.current += 1;
  }, [currentAsset?.id]);

  useEffect(() => {
    setSelectedExportPresetIds([]);
  }, [currentAsset?.id]);

  const bindValidatedClip = useCallback(
    (clip: MotionClipV1) => {
      if (!hasRiggedMesh) {
        toast.error('Select or upload a rigged 3D mesh before applying a motion clip.');
        return;
      }
      setClipState('binding_clip', null);
      const { threeClip } = motionClipV1ToThreeClip(
        clip,
        loadedSkeletonBoneNames,
        retargetMapping
      );
      bindMotionClip(clip, threeClip);
    },
    [hasRiggedMesh, loadedSkeletonBoneNames, retargetMapping, setClipState, bindMotionClip]
  );

  const handleSelectPreset = async (preset: MotionPresetItem) => {
    if (!hasRiggedMesh) {
      toast.error('Please select or upload a 3D mesh first.');
      return;
    }
    const reqId = ++clipRequestIdRef.current;
    try {
      setClipState('loading_clip', null);
      const clip = await getMotionClipFromUrl(preset.clip_url);
      if (clipRequestIdRef.current !== reqId) return;

      setClipState('validating_clip', null);
      bindValidatedClip(clip);
    } catch (err: unknown) {
      if (clipRequestIdRef.current !== reqId) return;
      const msg = err instanceof Error ? err.message : 'Failed to load preset clip.';
      setClipError(msg);
      toast.error(msg);
    }
  };

  const toggleExportPreset = (presetId: string) => {
    setSelectedExportPresetIds((current) => current.includes(presetId)
      ? current.filter((id) => id !== presetId)
      : [...current, presetId]);
  };

  const handleSaveSelectedPresets = async () => {
    if (!hasRiggedMesh || !activeModelObject || !targetWorkspaceId || !sourceAssetId ||
        (currentAsset as any)?.asset_type === 'animated_mesh' || selectedExportPresetIds.length === 0) {
      toast.error('Select the original rigged workspace mesh and at least one preset.');
      return;
    }

    setIsBatchExporting(true);
    setIsPlaying(false);
    setClipState('exporting', null);
    let savedCount = 0;
    const savedAssets: any[] = [];
    const failures: string[] = [];
    try {
      for (const presetId of selectedExportPresetIds) {
        const preset = presets.find((item) => item.id === presetId);
        if (!preset) continue;
        try {
          const clip = await getMotionClipFromUrl(preset.clip_url);
          const { threeClip } = motionClipV1ToThreeClip(clip, loadedSkeletonBoneNames, retargetMapping);
          const glb = await exportAnimatedModelAsGlb({ activeModelObject, activeThreeClip: threeClip });
          const saved = await saveAnimatedMeshToWorkspace({
            workspaceId: targetWorkspaceId,
            sourceAssetId,
            motionClipId: clip.id,
            clipName: clip.name,
            glb,
          });
          savedAssets.push({
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
          savedCount += 1;
        } catch (error) {
          failures.push(preset.name + ': ' + (error instanceof Error ? error.message : 'save failed'));
        }
      }
      savedAssets.forEach((asset) => addAsset(asset));
      if (savedCount > 0) toast.success('Saved ' + savedCount + ' animated mesh asset' + (savedCount === 1 ? '' : 's') + ' to workspace');
      if (failures.length > 0) toast.warning(failures.length + ' preset export(s) failed: ' + failures.slice(0, 2).join('; '));
      setSelectedExportPresetIds([]);
    } finally {
      setIsBatchExporting(false);
      setClipState('paused', null);
    }
  };

  const handleSelectSaved = (record: SavedMotionClipRecord) => {
    if (!hasRiggedMesh) {
      toast.error('Please select or upload a 3D mesh first.');
      return;
    }
    try {
      setClipState('validating_clip', null);
      bindValidatedClip(record.clip);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to bind saved clip.';
      setClipError(msg);
      toast.error(msg);
    }
  };

  const handleDeleteSaved = async (id: string, isServerUpload: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (isServerUpload) {
        await deleteUploadedMotionClip(id);
      }
      await deleteSavedMotionClip(id).catch(() => {});
      await loadSaved();
      toast.success('Removed saved clip');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete saved clip.');
    }
  };

  const handleNpzUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (npzInputRef.current) npzInputRef.current.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.npz')) {
      toast.error('Please select a .npz motion file.');
      return;
    }

    const reqId = ++clipRequestIdRef.current;
    setIsPreviewUploading(true);
    try {
      setClipState('loading_clip', null);
      const clip = await uploadMotionClip(file);
      if (clipRequestIdRef.current !== reqId) return;

      setClipState('validating_clip', null);
      await saveMotionClip(clip, 'preset').catch((cacheError) => {
        console.warn('Motion clip local cache unavailable:', cacheError);
      });
      await loadSaved();
      setActiveTab('saved');

      if (hasRiggedMesh) {
        bindValidatedClip(clip);
      } else {
        setClipState('ready', null);
        toast.success(`Imported "${clip.name}". Select a rigged mesh to play.`);
      }
    } catch (err: unknown) {
      if (clipRequestIdRef.current !== reqId) return;
      const msg = err instanceof Error ? err.message : 'NPZ upload failed.';
      setClipError(msg);
      toast.error(msg);
    } finally {
      setIsPreviewUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!hasRiggedMesh) {
      toast.error('Please select or upload a 3D mesh first.');
      return;
    }
    if (!motionPrompt.trim()) {
      toast.error('Please enter a motion description.');
      return;
    }
    const clampedDuration = Math.min(DURATION_MAX, Math.max(DURATION_MIN, duration));
    setIsSubmitting(true);
    try {
      await runMotionGeneration({
        prompt: motionPrompt.trim(),
        duration: clampedDuration,
        seed: seed === '' ? undefined : Number(seed),
      });
    } catch (err: unknown) {
      toast.error(`Animation generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelExecution();
      toast.info('Animation cancelled');
    } catch (err: unknown) {
      toast.error(`Cancel failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredPresets = normalizedQuery
    ? presets.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : presets;

  const uploadedIdSet = new Set(uploadedClips.map((u) => u.id));
  const mergedSavedItems = [
    ...uploadedClips.map((u) => ({
      id: u.id,
      name: u.name,
      duration: u.duration,
      fps: u.fps,
      subtitle: [
        u.duration !== null ? `${u.duration.toFixed(1)}s` : null,
        u.fps !== null ? `${u.fps} FPS` : null,
        u.source === 'generated' ? 'Generated' : 'Uploaded',
      ]
        .filter(Boolean)
        .join(' · '),
      isServerUpload: true,
      presetItem: u,
      localRecord: null as SavedMotionClipRecord | null,
    })),
    ...savedClips
      .filter((c) => !uploadedIdSet.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        duration: c.clip.duration,
        fps: c.clip.fps,
        subtitle: `${c.clip.duration.toFixed(1)}s · ${c.clip.fps} FPS · ${c.clip.joint_names.length}J · Local cache`,
        isServerUpload: false,
        presetItem: null as MotionPresetItem | null,
        localRecord: c,
      })),
  ];

  const filteredSaved = normalizedQuery
    ? mergedSavedItems.filter((c) => c.name.toLowerCase().includes(normalizedQuery))
    : mergedSavedItems;

  const durationPct = Math.round(((duration - DURATION_MIN) / (DURATION_MAX - DURATION_MIN)) * 100);

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h2 className="text-[13px] font-semibold text-white">Animation</h2>
        </div>
        <button
          type="button"
          onClick={() => npzInputRef.current?.click()}
          disabled={isPreviewUploading}
          className="h-7 px-2.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.08] text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          title="Import an NPZ motion clip into My Presets"
        >
          <HugeiconsIcon icon={UploadIcon} size={14} className="text-[hsl(var(--primary))]" />
          <span>{isPreviewUploading ? 'Importing...' : 'Import NPZ'}</span>
        </button>
        <input
          ref={npzInputRef}
          type="file"
          accept=".npz"
          onChange={handleNpzUpload}
          className="hidden"
        />
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 workspace-tool-body">
        <ActiveMeshBar />
        {hasValidMesh && !hasRiggedMesh && (
          <p role="status" className="text-xs text-amber-300">The selected mesh has no loaded skeleton. Run Auto Rigging and select the rigged asset before generating or applying motion.</p>
        )}

        {/* Create Motion Card */}
        <section
          aria-label="Create Motion"
          className="p-3 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white">Create Motion</h3>
            <span className="text-[11px] font-mono text-zinc-400">ARDY 20 FPS</span>
          </div>

          <textarea
            rows={3}
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value)}
            placeholder="Describe a motion... e.g. &quot;Make the character walk forward&quot;"
            aria-label="Motion prompt"
            className="w-full px-2.5 py-2 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08] focus:border-[hsl(var(--accent))] focus:outline-none text-xs text-white placeholder:text-zinc-500 resize-none"
          />

          {/* Duration (0.5s - 30.0s) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="motion-duration-slider" className="text-zinc-300 font-medium">
                Duration
              </label>
              <span className="font-mono text-[11px] text-white bg-[hsl(var(--surface-0))] px-1.5 py-0.5 rounded border border-white/[0.08]">
                {duration.toFixed(1)} s
              </span>
            </div>
            <input
              id="motion-duration-slider"
              type="range"
              min={DURATION_MIN}
              max={DURATION_MAX}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(parseFloat(e.target.value))}
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${durationPct}%, rgba(255, 255, 255, 0.08) ${durationPct}%, rgba(255, 255, 255, 0.08) 100%)`,
              }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[hsl(var(--primary))]"
            />
          </div>

          {/* Seed */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="motion-seed-input" className="text-xs text-zinc-300 font-medium shrink-0">
              Seed
            </label>
            <input
              id="motion-seed-input"
              type="number"
              min={0}
              placeholder="Random"
              value={seed}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setSeed('');
                } else {
                  const parsed = parseInt(raw, 10);
                  if (!Number.isNaN(parsed) && parsed >= 0) setSeed(parsed);
                }
              }}
              className="flex-1 min-w-0 h-7 px-2 rounded-lg bg-[hsl(var(--surface-0))] border border-white/[0.08] text-xs font-mono text-white placeholder:text-zinc-500 focus:border-[hsl(var(--accent))] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => setSeed(Math.floor(Math.random() * 900000) + 100000)}
              aria-label="Randomize seed"
              title="Randomize seed"
              className="h-7 px-2 rounded-lg bg-[hsl(var(--surface-3))] hover:bg-white/15 border border-white/[0.08] text-zinc-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0"
            >
              <RotateCw className="w-3 h-3" />
              <span>New</span>
            </button>
          </div>

          {/* Primary Generate / Progress Line */}
          {isExecuting ? (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 truncate">{executionStep || 'Generating motion...'}</span>
                <span className="font-mono text-[11px] text-[hsl(var(--primary))] font-semibold">
                  {Math.round(executionProgress)}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[hsl(var(--surface-0))] overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--primary))] transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, Math.round(executionProgress)))}%` }}
                />
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className="w-full h-7 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-200 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel} size={13} />
                <span>Cancel</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!hasRiggedMesh || !motionPrompt.trim() || isSubmitting}
              className="w-full h-8 rounded-full bg-[hsl(var(--primary))] hover:opacity-90 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>{isSubmitting ? 'Queueing...' : 'Generate'}</span>
            </button>
          )}
        </section>

        {/* Preset / Saved Library */}
        <section aria-label="Motion Library" className="space-y-2">
          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-1.5">
            <div className="flex items-center gap-3" role="tablist" aria-label="Motion clip sources">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'preset'}
                onClick={() => setActiveTab('preset')}
                className={`text-xs font-semibold pb-1 border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'preset'
                    ? 'text-white border-[hsl(var(--primary))]'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200'
                }`}
              >
                Premade
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'saved'}
                onClick={() => {
                  setActiveTab('saved');
                  void loadSaved();
                }}
                className={`text-xs font-semibold pb-1 border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'saved'
                    ? 'text-white border-[hsl(var(--primary))]'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200'
                }`}
              >
                My Presets ({mergedSavedItems.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => (activeTab === 'preset' ? void loadPresets() : void loadSaved())}
              aria-label="Refresh motion list"
              title="Refresh"
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <HugeiconsIcon icon={SearchIcon} size={14} className="text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clips..."
              aria-label="Search motion clips"
              className="w-full h-7.5 pl-8 pr-2.5 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] text-xs text-white placeholder:text-zinc-500 focus:border-[hsl(var(--accent))] focus:outline-none"
            />
          </div>

          {/* Tab Panel: Premade */}
          {activeTab === 'preset' && (
            <div role="tabpanel" aria-label="Premade motion clips">
              {presetStatus === 'loading' && (
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map((idx) => (
                    <div key={idx} className="h-28 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] animate-pulse" />
                  ))}
                </div>
              )}
              {presetStatus === 'error' && (
                <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 space-y-2">
                  <p>{presetError || 'Unable to load presets.'}</p>
                  <button
                    type="button"
                    onClick={() => void loadPresets()}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}
              {presetStatus === 'empty' && (
                <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] text-center text-xs text-zinc-400">
                  No premade presets are installed yet. Add reviewed NPZ files to backend/motion_presets/. User imports and generated clips appear in My Presets.
                </div>
              )}
              {presetStatus === 'ready' && filteredPresets.length === 0 && (
                <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] text-center text-xs text-zinc-400">
                  No presets match &quot;{searchQuery}&quot;.
                </div>
              )}
              {presetStatus === 'ready' && filteredPresets.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveSelectedPresets()}
                    disabled={isBatchExporting || !hasRiggedMesh || !activeModelObject || selectedExportPresetIds.length === 0 ||
                      !targetWorkspaceId || !sourceAssetId || (currentAsset as any)?.asset_type === 'animated_mesh'}
                    className="w-full h-7 rounded-lg bg-[hsl(var(--primary))] text-black text-[11px] font-semibold disabled:opacity-40 cursor-pointer"
                    title="Each selected preset is exported as a separate immutable animated GLB in this workspace"
                  >
                    {isBatchExporting ? 'Saving selected...' : 'Save selected to Workspace (' + selectedExportPresetIds.length + ')'}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                  {filteredPresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      isActive={activeMotionClip?.id === preset.id}
                      isExportSelected={selectedExportPresetIds.includes(preset.id)}
                      onSelect={handleSelectPreset}
                      onToggleExport={toggleExportPreset}
                    />
                  ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab Panel: My Presets (server-backed) */}
          {activeTab === 'saved' && (
            <div role="tabpanel" aria-label="My user motion presets" className="space-y-1.5">
              {savedStatus === 'loading' && (
                <div className="space-y-1.5">
                  {[0, 1].map((idx) => (
                    <div key={idx} className="h-12 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] animate-pulse" />
                  ))}
                </div>
              )}
              {savedStatus === 'error' && (
                <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 space-y-2">
                  <p>{savedError || 'Unable to read the My Presets library.'}</p>
                  <button
                    type="button"
                    onClick={() => void loadSaved()}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}
              {savedStatus === 'empty' && (
                <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] text-center text-xs text-zinc-400">
                  No user presets yet. Import an NPZ or generate motion; both are saved in backend/storage/presets/.
                </div>
              )}
              {savedStatus === 'ready' && filteredSaved.length === 0 && (
                <div className="p-4 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.06] text-center text-xs text-zinc-400">
                  No My Presets match &quot;{searchQuery}&quot;.
                </div>
              )}
              {savedStatus === 'ready' && filteredSaved.length > 0 && (
                <div className="space-y-1.5">
                  {filteredSaved.map((item) => {
                    const isActive = activeMotionClip?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (item.presetItem) {
                            void handleSelectPreset(item.presetItem);
                          } else if (item.localRecord) {
                            handleSelectSaved(item.localRecord);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (item.presetItem) {
                              void handleSelectPreset(item.presetItem);
                            } else if (item.localRecord) {
                              handleSelectSaved(item.localRecord);
                            }
                          }
                        }}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-[hsl(var(--accent))]/15 border-[hsl(var(--accent))] text-white'
                            : 'bg-[hsl(var(--surface-2))] border-white/[0.08] hover:border-white/20 text-zinc-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{item.name}</div>
                          <div className="text-[11px] font-mono text-zinc-400">{item.subtitle}</div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteSaved(item.id, item.isServerUpload, e)}
                          aria-label={`Delete ${item.name}`}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-white/10 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
