'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { normalizeModelAsset } from '../types';
import { toast } from 'sonner';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CameraIcon,
  HelpCircleIcon,
  LayersIcon,
  SettingsIcon,
} from '@hugeicons/core-free-icons';
import { Download, RotateCcw } from '@/components/icons/hugeicons-components';
import type { LightTone, ShadingMode } from '../types';
import { useViewerStore, loadModelInViewer } from '@/stores/useViewerStore';
import { getApiClient } from '@/services/apiClient';
import { requestMeshOrientation } from '../components/MeshOrientationModal';
import { CameraTriad } from './CameraTriad';
import { AnimationPlayerBar } from './AnimationPlayerBar';
import {
  dispatchCameraPreset,
  dispatchViewportExposure,
  dispatchViewportLighting,
  dispatchViewportSnapshot,
  type CameraPresetKey,
} from './viewportEvents';

interface ViewportToolOverlayProps {
  isRightPanelOpen?: boolean;
}

const SHORTCUTS = [
  { keys: 'Left Drag', action: 'Orbit camera' },
  { keys: 'Right Drag', action: 'Pan view' },
  { keys: 'Scroll', action: 'Zoom in / out' },
  { keys: 'XYZ Triad', action: 'Snap to axis view' },
  { keys: 'Reset Button', action: 'Fit & reset camera' },
] as const;

export const ViewportToolOverlay: React.FC<ViewportToolOverlayProps> = ({
  isRightPanelOpen: propRightPanelOpen,
}) => {
  const {
    showWireframe,
    wireframeMode,
    setWireframeMode,
    currentAsset,
    setCurrentAsset,
    showGrid,
    setShowGrid,
    isTurntable,
    setIsTurntable,
    shadingMode,
    setShadingMode,
    isRightPanelOpen: contextRightPanelOpen,
    workspaceId,
    activeMeshAssetId,
    workspaceVersions,
    updateAssetProperties,
    selectAsset,
    assets,
    resetCamera,
    setIsExportModalOpen,
    isExecuting,
  } = useWorkspace();

  type OrientationState = 'idle' | 'downloading' | 'editing' | 'saving';
  const [orientationState, setOrientationState] = useState<OrientationState>('idle');
  const isOrienting = orientationState !== 'idle';
  const loadedModelUrl = useViewerStore((state) => state.loadedModelUrl);
  const viewerLoadState = useViewerStore((state) => state.assetSelectionState);
  const viewerSelectedAsset = useViewerStore((state) => state.selectedAsset);
  const orientationRequestIdRef = useRef(0);
  const currentAssetRef = useRef(currentAsset);
  useEffect(() => { currentAssetRef.current = currentAsset; }, [currentAsset]);
  useEffect(() => {
    if (
      orientationState !== 'idle' &&
      (!loadedModelUrl || viewerLoadState !== 'ready' || viewerSelectedAsset?.id !== currentAsset?.id)
    ) {
      orientationRequestIdRef.current += 1;
      setOrientationState('idle');
    }
  }, [orientationState, loadedModelUrl, viewerLoadState, viewerSelectedAsset?.id, currentAsset?.id]);

  const workspaceMeshVersions = React.useMemo(() => {
    if (!workspaceId) return [];

    const byKey = new Map<string, { id: string; label: string; url: string; asset?: (typeof assets)[number] }>();

    // 1. Authoritative workspaceVersions (includes post-operation derived meshes not in Assets)
    for (let i = 0; i < (workspaceVersions?.length ?? 0); i++) {
      const v = workspaceVersions[i];
      if (!v?.asset_id || !v?.url) continue;
      const canonicalKey = v.asset_id;
      if (byKey.has(canonicalKey)) continue;
      const matchingAsset = assets.find((a) => a.id === v.asset_id);
      const label = v.version_label
        ? `${v.name || 'Mesh'} (${v.version_label})`
        : v.name || `Version ${String(i + 1).padStart(3, '0')}`;
      byKey.set(canonicalKey, {
        id: v.asset_id,
        label,
        url: v.url,
        asset: matchingAsset,
      });
    }

    // 2. Fallback: base/workspace meshes from assets not already listed
    const wsAssets = assets.filter(
      (a) =>
        a.category !== 'texture' &&
        a.format !== 'IMAGE' &&
        a.format !== 'FILE' &&
        (a.workspace_id === workspaceId ||
          a.id === `local_${workspaceId}` ||
          a.id === workspaceId ||
          (a.source?.fileId && a.source.fileId.includes(workspaceId)) ||
          (a.id === currentAsset?.id && (currentAsset.workspace_id === workspaceId || currentAsset.id.includes(workspaceId)))),
    );

    wsAssets.forEach((asset, index) => {
      const url = asset.source?.viewUrl || asset.source?.localUrl || asset.artifacts?.gameReady || asset.artifacts?.source || '';
      if (!url || byKey.has(asset.id)) return;
      // Also deduplicate by URL so the same mesh never appears twice under different IDs
      for (const existing of byKey.values()) {
        if (existing.url === url) return;
      }
      const isBase = Boolean(asset.is_base_mesh) || (index === 0 && asset.category === 'generation');
      const versionNumber = String(byKey.size + 1).padStart(3, '0');
      const label = isBase
        ? 'Base Mesh (v001)'
        : (asset.name || `${asset.category ? asset.category.charAt(0).toUpperCase() + asset.category.slice(1) : 'Mesh'} (v${versionNumber})`);
      byKey.set(asset.id, {
        id: asset.id,
        label,
        url,
        asset,
      });
    });

    const list = Array.from(byKey.values());
    return list.length > 1 ? list : [];
  }, [workspaceId, workspaceVersions, assets, currentAsset]);

  const isRightPanelOpen = propRightPanelOpen ?? contextRightPanelOpen ?? false;
  const modelStats = useViewerStore((s) => s.modelStats);
  const hasRenderableMesh = Boolean(
    currentAsset &&
      currentAsset.category !== 'texture' &&
      currentAsset.format !== 'IMAGE' &&
      currentAsset.format !== 'FILE' &&
      (currentAsset.source?.viewUrl ||
        currentAsset.source?.localUrl ||
        currentAsset.artifacts?.gameReady ||
        currentAsset.artifacts?.source),
  );

  const [activePreset, setActivePreset] = useState<'Front' | 'Top' | 'Side' | 'Iso'>('Iso');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [lightingTone, setLightingTone] = useState<LightTone>('studio');
  const [exposure, setExposure] = useState<number>(1.15);

  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const helpPopoverRef = useRef<HTMLDivElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);

  // Close settings or help popover on outside click or Escape
  useEffect(() => {
    if (!isSettingsOpen && !isHelpOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        isSettingsOpen &&
        settingsPopoverRef.current &&
        !settingsPopoverRef.current.contains(target) &&
        settingsTriggerRef.current &&
        !settingsTriggerRef.current.contains(target)
      ) {
        setIsSettingsOpen(false);
      }
      if (
        isHelpOpen &&
        helpPopoverRef.current &&
        !helpPopoverRef.current.contains(target) &&
        helpTriggerRef.current &&
        !helpTriggerRef.current.contains(target)
      ) {
        setIsHelpOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSettingsOpen(false);
        setIsHelpOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen, isHelpOpen]);

  const handleAdjustMeshOrientation = async () => {
    const selectedAsset = currentAsset;
    if (!selectedAsset || !workspaceId || isOrienting || isExecuting || !loadedModelUrl) return;

    const orientationRequestId = ++orientationRequestIdRef.current;
    const selectedAssetId = selectedAsset.asset_id || selectedAsset.id;
    if (!selectedAssetId || selectedAssetId.startsWith('local_')) {
      toast.error('Save this mesh to the workspace before changing its orientation');
      return;
    }
    if (selectedAsset.workspace_id && selectedAsset.workspace_id !== workspaceId) {
      toast.error('Select a mesh from the current workspace first');
      return;
    }

    const viewerState = useViewerStore.getState();
    if (viewerState.assetSelectionState !== 'ready' || viewerState.selectedAsset?.id !== selectedAsset.id) {
      toast.error('Wait until the selected mesh has finished loading');
      return;
    }

    const isStillSameLoadedMesh = () => {
      const latest = useViewerStore.getState();
      return currentAssetRef.current?.id === selectedAsset.id
        && latest.selectedAsset?.id === selectedAsset.id
        && latest.loadedModelUrl === loadedModelUrl
        && latest.assetSelectionState === 'ready';
    };

    try {
      setOrientationState('downloading');
      const blob = await getApiClient().downloadWorkspaceMesh(selectedAssetId);
      if (!isStillSameLoadedMesh()) {
        toast.info('The active mesh changed. Reopen orientation for the newly selected mesh.');
        return;
      }

      const extension = (selectedAsset.format || 'GLB').toLowerCase();
      const filename = selectedAsset.source?.filename || `${selectedAsset.name || 'mesh'}.${extension}`;
      const sourceFile = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

      setOrientationState('editing');
      const orientedFile = await requestMeshOrientation(sourceFile);
      if (!orientedFile) return;
      if (orientedFile === sourceFile) {
        toast.info('No orientation changes were applied');
        return;
      }
      if (!isStillSameLoadedMesh()) {
        toast.error('The active mesh changed while the orientation editor was open. Nothing was saved.');
        return;
      }

      setOrientationState('saving');
      const saved = await getApiClient().replaceWorkspaceMeshFile(workspaceId, selectedAssetId, orientedFile);
      const cacheToken = Date.now();
      const baseUrl = saved.url || `/api/v1/system/jobs/${encodeURIComponent(selectedAssetId)}/download`;
      const savedUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${cacheToken}`;
      const thumbnailUrl = saved.thumbnail_url
        ? `${saved.thumbnail_url}${saved.thumbnail_url.includes('?') ? '&' : '?'}v=${cacheToken}`
        : '';

      const updatedAsset = normalizeModelAsset({
        ...selectedAsset,
        id: selectedAsset.id,
        asset_id: selectedAssetId,
        workspace_id: workspaceId,
        name: selectedAsset.name,
        category: selectedAsset.category,
        format: 'GLB',
        file_size_mb: saved.file_size_mb,
        thumbnail: thumbnailUrl || selectedAsset.thumbnail,
        faces: saved.mesh_stats?.polygon_count ?? selectedAsset.faces,
        triangles: saved.mesh_stats?.polygon_count ?? selectedAsset.triangles,
        vertices: saved.mesh_stats?.vertex_count ?? selectedAsset.vertices,
        statsAvailable: true,
        source: {
          ...selectedAsset.source,
          filename: saved.filename || orientedFile.name,
          subfolder: selectedAsset.source?.subfolder || 'mesh',
          type: selectedAsset.source?.type || 'output',
          viewUrl: savedUrl,
          fileId: selectedAssetId,
        },
      });

      updateAssetProperties(selectedAsset.id, updatedAsset);
      if (isStillSameLoadedMesh()) {
        setCurrentAsset(updatedAsset);
        loadModelInViewer(savedUrl, updatedAsset.name, updatedAsset as any);
        toast.success('Mesh orientation saved', {
          description: 'The existing workspace mesh file and asset record were updated in place.',
        });
      } else {
        toast.success('Mesh orientation saved', {
          description: 'The original mesh was updated. Your newer viewer selection was left unchanged.',
        });
      }
    } catch (error) {
      toast.error('Could not save mesh orientation', {
        description: error instanceof Error ? error.message : 'Unexpected orientation error',
      });
    } finally {
      if (orientationRequestIdRef.current === orientationRequestId) {
        setOrientationState('idle');
      }
    }
  };

  const handleSnapCamera = (preset: 'Front' | 'Top' | 'Side' | 'Iso') => {
    setActivePreset(preset);
    const key: CameraPresetKey = preset === 'Iso' ? 'perspective' : (preset.toLowerCase() as CameraPresetKey);
    dispatchCameraPreset(key);
  };

  const handleLightingChange = (tone: LightTone) => {
    setLightingTone(tone);
    dispatchViewportLighting(tone);
  };

  const handleExposureChange = (val: number) => {
    setExposure(val);
    dispatchViewportExposure(val);
  };

  const handleShadingChange = (mode: ShadingMode) => {
    setShadingMode(mode);
  };

  return (
    <div
      id="viewport-tool-overlay"
      className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none"
    >
      {/* Dynamic Mesh Versions Selector (Hidden if only base raw mesh exists) */}
      {workspaceMeshVersions.length > 1 && (
        <div className="pointer-events-auto absolute top-4 left-4 md:left-6 flex items-center gap-2 z-20">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/95 backdrop-blur-md border border-[hsl(var(--border))] shadow-lg text-xs text-foreground">
            <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
              Mesh Version
            </span>
            <select
              value={activeMeshAssetId || currentAsset?.id || ''}
              onChange={(e) => {
                const selectedId = e.target.value;
                const version = workspaceMeshVersions.find((v) => v.id === selectedId);
                if (version) {
                  if (version.asset) {
                    selectAsset(version.asset.id);
                    loadModelInViewer(version.url, version.asset.name, version.asset as any);
                  } else {
                    loadModelInViewer(version.url, version.label);
                  }
                } else {
                  toast.error('Selected mesh version is unavailable');
                }
              }}
              className="bg-[hsl(var(--surface-2))] rounded-lg px-2 py-0.5 text-xs text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer border border-[hsl(var(--border))]"
              aria-label="Select Mesh Version"
            >
              {workspaceMeshVersions.map((v) => (
                <option key={v.id} value={v.id} className="bg-[hsl(var(--surface-1))] text-zinc-100">
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Top-Right Borderless Telemetry HUD + Interactive XYZ Triad */}
      <div className="pointer-events-auto absolute top-4 right-4 flex items-center gap-3.5 z-20">
        {hasRenderableMesh && modelStats && (
          <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[11px] leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            <span className="text-zinc-400 text-right">Topology</span>
            <span className="font-mono text-zinc-100 tabular-nums">Triangle</span>
            <span className="text-zinc-400 text-right">Faces</span>
            <span className="font-mono text-zinc-100 tabular-nums">
              {modelStats.triangles.toLocaleString()}
            </span>
            <span className="text-zinc-400 text-right">Vertices</span>
            <span className="font-mono text-zinc-100 tabular-nums">
              {modelStats.vertices.toLocaleString()}
            </span>
          </div>
        )}
        <CameraTriad />
      </div>

      {loadedModelUrl && viewerLoadState === 'ready' && viewerSelectedAsset?.id === currentAsset?.id
        && currentAsset && workspaceId && currentAsset.category !== 'texture'
        && currentAsset.format !== 'IMAGE' && currentAsset.format !== 'FILE' && (
        <div className="pointer-events-auto absolute bottom-20 left-4 md:left-6 z-30">
          <SimpleTooltip label="Adjust Mesh Orientation" side="right">
            <button
              type="button"
              onClick={() => void handleAdjustMeshOrientation()}
              disabled={isOrienting || isExecuting}
              aria-label="Adjust and save mesh orientation"
              title="Adjust Mesh Orientation"
              className="w-10 h-10 rounded-full bg-[hsl(var(--surface-1))]/95 border border-white/[0.1] shadow-lg flex items-center justify-center text-zinc-200 hover:text-primary hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className={`w-4 h-4 ${isOrienting ? 'animate-spin' : ''}`} />
            </button>
          </SimpleTooltip>
        </div>
      )}

      {/* Right Viewport Dock: 3-icon grouped pill + detached Help (?) + detached Reset */}
      <div className="pointer-events-auto absolute top-24 right-4 flex flex-col items-center gap-2 z-20">
        {/* 3-Icon Grouped Pill (Settings, Snapshot, Wireframe/Grid) */}
        <div className="relative p-1 rounded-full bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-lg flex flex-col items-center gap-0.5">
          {/* 1. Viewport Settings */}
          <SimpleTooltip label="Viewport Settings" side="left">
            <button
              ref={settingsTriggerRef}
              type="button"
              onClick={() => {
                setIsHelpOpen(false);
                setIsSettingsOpen((prev) => !prev);
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isSettingsOpen
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08]'
              }`}
              aria-label="Viewport Settings"
              aria-expanded={isSettingsOpen}
            >
              <HugeiconsIcon icon={SettingsIcon} size={16} />
            </button>
          </SimpleTooltip>

          <div className="w-4 h-px bg-white/[0.08]" />

          {/* 2. Snapshot */}
          <SimpleTooltip label="Capture Snapshot (PNG)" side="left">
            <button
              type="button"
              onClick={dispatchViewportSnapshot}
              className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] transition-colors cursor-pointer"
              aria-label="Capture Snapshot"
            >
              <HugeiconsIcon icon={CameraIcon} size={16} />
            </button>
          </SimpleTooltip>

          <div className="w-4 h-px bg-white/[0.08]" />

          {/* 3. Wireframe / Topology Overlay */}
          <SimpleTooltip
            label={
              wireframeMode === 'overlay'
                ? 'Wireframe: Overlay (Click for X-Ray)'
                : wireframeMode === 'xray'
                  ? 'Wireframe: X-Ray (Click to Turn Off)'
                  : 'Wireframe: Off (Click for Overlay)'
            }
            side="left"
          >
            <button
              type="button"
              onClick={() =>
                setWireframeMode(
                  wireframeMode === 'off' ? 'overlay' : wireframeMode === 'overlay' ? 'xray' : 'off',
                )
              }
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                wireframeMode === 'overlay'
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : wireframeMode === 'xray'
                    ? 'bg-accent/25 text-accent-foreground ring-1 ring-accent'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08]'
              }`}
              aria-label="Toggle Wireframe Mode"
              aria-pressed={showWireframe}
            >
              <HugeiconsIcon icon={LayersIcon} size={16} />
            </button>
          </SimpleTooltip>

          {/* Viewport Settings Popover */}
          {isSettingsOpen && (
            <div
              ref={settingsPopoverRef}
              role="dialog"
              aria-label="Viewport Settings"
              className="absolute right-full mr-2.5 top-0 w-64 p-3 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-2xl z-30 space-y-3 text-xs text-zinc-100"
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.08]">
                <span className="text-xs font-semibold text-zinc-200">
                  Viewport Settings
                </span>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-6 h-6 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer"
                  aria-label="Close settings"
                >
                  ✕
                </button>
              </div>

              {/* Camera Angle Snap */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-zinc-400 block">
                  Camera Angle
                </span>
                <div className="grid grid-cols-4 gap-1">
                  {(['Front', 'Side', 'Top', 'Iso'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSnapCamera(p)}
                      className={`py-1 px-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                        activePreset === p
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-[hsl(var(--surface-2))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-3))]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lighting Tone */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-zinc-400 block">
                  Lighting
                </span>
                <div className="grid grid-cols-2 gap-1">
                  {([
                    { id: 'studio', label: 'Studio' },
                    { id: 'neutral', label: 'Neutral' },
                    { id: 'warm', label: 'Warm' },
                    { id: 'cool', label: 'Cool' },
                  ] as const).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleLightingChange(t.id)}
                      className={`py-1 px-2 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                        lightingTone === t.id
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-[hsl(var(--surface-2))] text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-3))]'
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
                  <span className="text-[11px] font-medium text-zinc-400">
                    Exposure
                  </span>
                  <span className="text-[11px] font-mono text-zinc-200 tabular-nums">
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
                  aria-label="Viewport Exposure"
                  className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[hsl(var(--accent))]"
                />
              </div>

              {/* Ground Grid & Turntable Toggles */}
              <div className="pt-1 border-t border-white/[0.08] flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowGrid(showGrid === false ? true : false)}
                  aria-pressed={showGrid !== false}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    showGrid !== false
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-[hsl(var(--surface-2))] text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  Grid: {showGrid !== false ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsTurntable(!isTurntable)}
                  aria-pressed={isTurntable}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    isTurntable
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-[hsl(var(--surface-2))] text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-3))]'
                  }`}
                >
                  Turntable: {isTurntable ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detached ? Help Button (Real interactive button opening shortcuts popover) */}
        <div className="relative">
          <SimpleTooltip label="Keyboard & Orbit Shortcuts" side="left">
            <button
              ref={helpTriggerRef}
              type="button"
              onClick={() => {
                setIsSettingsOpen(false);
                setIsHelpOpen((prev) => !prev);
              }}
              aria-label="Keyboard and orbit shortcuts"
              aria-expanded={isHelpOpen}
              className={`w-9 h-9 rounded-full border border-white/[0.08] shadow-lg flex items-center justify-center transition-colors cursor-pointer ${
                isHelpOpen
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-[hsl(var(--surface-1))]/95 text-zinc-400 hover:text-zinc-100 hover:bg-[hsl(var(--surface-3))]'
              }`}
            >
              <HugeiconsIcon icon={HelpCircleIcon} size={16} />
            </button>
          </SimpleTooltip>

          {isHelpOpen && (
            <div
              ref={helpPopoverRef}
              role="dialog"
              aria-label="Viewport Shortcuts"
              className="absolute right-full mr-2.5 top-0 w-60 p-3 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-2xl z-30 space-y-2 text-xs text-zinc-100"
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.08]">
                <span className="text-xs font-semibold text-zinc-200">
                  Viewport Shortcuts
                </span>
                <button
                  type="button"
                  onClick={() => setIsHelpOpen(false)}
                  className="w-6 h-6 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer"
                  aria-label="Close shortcuts"
                >
                  ✕
                </button>
              </div>
              <ul className="space-y-1.5">
                {SHORTCUTS.map((item) => (
                  <li key={item.keys} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-zinc-400">{item.action}</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[hsl(var(--surface-2))] border border-white/[0.08] font-mono text-[10px] text-zinc-200">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Detached Reset Camera Button */}
        <SimpleTooltip label="Reset Camera View" side="left">
          <button
            type="button"
            onClick={resetCamera}
            aria-label="Reset camera view"
            className="w-9 h-9 rounded-full bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-[hsl(var(--surface-3))] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </SimpleTooltip>
      </div>

      {/* Bottom Stack: Floating Animation Player (when active) + Flat Action Bar */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20 max-w-[calc(100%-2rem)]">
        <AnimationPlayerBar />
        <div
          id="viewport-material-dock"
          className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/95 border border-white/[0.08] shadow-lg select-none"
        >
        <SimpleTooltip label="Reset Camera View" side="top">
          <button
            type="button"
            onClick={resetCamera}
            aria-label="Reset View"
            className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-3))] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </SimpleTooltip>

        <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

        {/* Shading Modes */}
        <SimpleTooltip label="PBR Textured" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('textured')}
            aria-label="PBR Textured Shader"
            aria-pressed={shadingMode === 'textured'}
            className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
              shadingMode === 'textured'
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] scale-105'
                : 'opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#3b82f6] via-[#a855f7] to-[#f59e0b]" />
          </button>
        </SimpleTooltip>

        <SimpleTooltip label="Clay Matte" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('clay')}
            aria-label="Clay Matte Shader"
            aria-pressed={shadingMode === 'clay'}
            className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
              shadingMode === 'clay'
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] scale-105'
                : 'opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#64748b] via-[#94a3b8] to-[#cbd5e1]" />
          </button>
        </SimpleTooltip>

        <SimpleTooltip label="Surface Normals" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('normals')}
            aria-label="Surface Normals Shader"
            aria-pressed={shadingMode === 'normals' || shadingMode === 'matcap-normal'}
            className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
              shadingMode === 'normals' || shadingMode === 'matcap-normal'
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] scale-105'
                : 'opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#6366f1] via-[#06b6d4] to-[#f43f5e]" />
          </button>
        </SimpleTooltip>

        <SimpleTooltip label="Wireframe" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('wireframe')}
            aria-label="Wireframe Topology Shader"
            aria-pressed={shadingMode === 'wireframe'}
            className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
              shadingMode === 'wireframe'
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] scale-105'
                : 'opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-[hsl(var(--background))] border border-[#10b981] flex items-center justify-center">
              <span className="text-[10px] text-[#10b981] font-mono leading-none">#</span>
            </div>
          </button>
        </SimpleTooltip>

        <SimpleTooltip label="Gold MatCap" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('matcap-gold')}
            aria-label="Gold MatCap Metallic"
            aria-pressed={shadingMode === 'matcap-gold'}
            className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
              shadingMode === 'matcap-gold'
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] scale-105'
                : 'opacity-80 hover:opacity-100'
            }`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#b45309] via-[#f59e0b] to-[#fef08a]" />
          </button>
        </SimpleTooltip>

        <SimpleTooltip label="UV Checker" side="top">
          <button
            type="button"
            onClick={() => handleShadingChange('uv-checker')}
            aria-label="UV Checker Shader"
            aria-pressed={shadingMode === 'uv-checker'}
            className={`w-6 h-6 rounded-full transition-transform cursor-pointer overflow-hidden ${
              shadingMode === 'uv-checker'
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--surface-1))] scale-105'
                : 'opacity-80 hover:opacity-100'
            }`}
          >
            <div
              className="w-full h-full rounded-full border border-white/20"
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

        <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

        {/* Export Button */}
        <button
          type="button"
          onClick={() => setIsExportModalOpen(true)}
          disabled={!hasRenderableMesh}
          aria-label="Export model"
          className="h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-semibold bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>
        </div>
      </div>
    </div>
  );
};
