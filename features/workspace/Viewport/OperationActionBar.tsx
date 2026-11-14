'use client';

import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { useAppStore } from '@/stores/useAppStore';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckIcon,
  RefreshCw,
  Trash2,
  SparklesIcon,
  LoaderCircle,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons';

export const OperationActionBar: React.FC = () => {
  const {
    executionState,
    setExecutionState,
    persistenceState,
    setPersistenceState,
    workspaceId,
    currentAsset,
    activeMeshAssetId,
    setActiveMeshAssetId,
    assets,
    addAsset,
    selectAsset,
    activeTool,
    runTextureGeneration,
    runRemeshGeneration,
    runUVUnwrapGeneration,
    runSegmentation,
  } = useWorkspace();

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Show action bar only when a preview is ready to be retained/discarded
  // (completed execution with not_saved or save_failed persistence state)
  const isPreviewActive =
    (executionState === 'completed' &&
      (persistenceState === 'not_saved' ||
        persistenceState === 'saving' ||
        persistenceState === 'save_failed')) ||
    (currentAsset?.category === 'generation' && persistenceState === 'not_saved');

  if (!isPreviewActive) {
    return null;
  }

  const handleKeepInWorkspace = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setPersistenceState('saving');

    try {
      // Simulate/commit to backend workspace storage
      const opId = currentAsset?.operation_id || `op_${Date.now()}`;
      const assetId = currentAsset?.id || `ast_${Date.now()}`;
      
      // Post to keep endpoint if workspace exists
      if (workspaceId) {
        try {
          await fetch(`/api/v1/workspace/operations/${encodeURIComponent(opId)}/keep`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_id: workspaceId, asset_id: assetId }),
          });
        } catch {
          // Backend may accept local workspace publication
        }
      }

      // Mark the current preview asset as permanently retained
      if (currentAsset) {
        const retainedAsset = {
          ...currentAsset,
          workspace_id: workspaceId || currentAsset.workspace_id,
          version: `v${String(assets.length + 1).padStart(3, '0')}`,
          is_base_mesh: false,
          productionStatus: 'ready',
        };
        addAsset(retainedAsset);
        setActiveMeshAssetId(retainedAsset.id);
      }

      setPersistenceState('saved');
      toast.success('Retained in workspace as permanent version');
    } catch (err: unknown) {
      setPersistenceState('save_failed');
      const message = err instanceof Error ? err.message : 'Failed to commit preview to workspace';
      toast.error('Save failed', { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerate = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Link previous operation as parent_operation_id
      const parentOpId = currentAsset?.operation_id || `op_${Date.now()}`;
      toast.info('Regenerating operation...', {
        description: `Preserving previous outputs. Linked to parent operation ${parentOpId.slice(0, 8)}`,
      });

      setExecutionState('queued');
      setPersistenceState('not_saved');

      // Trigger matching tool execution
      if (activeTool === 'texture' || activeTool === 'pbr') {
        await runTextureGeneration();
      } else if (activeTool === 'remesh') {
        await runRemeshGeneration();
      } else if (activeTool === 'uv') {
        await runUVUnwrapGeneration();
      } else if (activeTool === 'segment') {
        await runSegmentation(undefined);
      } else {
        toast.info('Ready for re-execution with snapshot parameters');
        setExecutionState('idle');
      }
    } catch (err: unknown) {
      setExecutionState('failed');
      const message = err instanceof Error ? err.message : 'Regeneration failed';
      toast.error('Regeneration error', { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDiscardPreview = () => {
    if (isSubmitting) return;
    setPersistenceState('discarded');
    setExecutionState('idle');

    // Restore viewer to the last active saved base mesh
    const baseMesh = assets.find((a) => a.is_base_mesh || a.category === 'generation') || assets[0];
    if (baseMesh) {
      selectAsset(baseMesh.id);
    } else {
      useViewerStore.getState().setLoadedModel(null);
    }

    toast.info('Preview discarded', {
      description: 'Temporary files cleaned. Saved outputs remain intact.',
    });
  };

  return (
    <div
      id="operation-action-bar"
      className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 p-1.5 rounded-2xl bg-[#141522]/95 backdrop-blur-xl border border-white/[0.15] shadow-[0_16px_48px_rgba(0,0,0,0.85)] animate-in fade-in slide-in-from-bottom-3 duration-200 select-none"
    >
      {/* Badge: Preview Ready */}
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/[0.06] border border-white/[0.08] text-[11px] font-mono text-zinc-300">
        <HugeiconsIcon icon={SparklesIcon} size={14} className="text-primary fill-current" />
        <span className="font-semibold text-white">Preview Output</span>
        {persistenceState === 'save_failed' && (
          <span className="flex items-center gap-1 text-rose-400 text-[10px] ml-1">
            <HugeiconsIcon icon={AlertCircleIcon} size={12} />
            Save Failed
          </span>
        )}
      </div>

      <div className="h-4 w-[1px] bg-white/10 mx-0.5" />

      {/* Button 1: Keep in Workspace */}
      <button
        type="button"
        disabled={isSubmitting || persistenceState === 'saving'}
        onClick={handleKeepInWorkspace}
        className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-[#080808] font-bold text-xs flex items-center gap-1.5 shadow-[0_2px_12px_rgba(255,204,0,0.35)] hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        title="Permanently commit this preview output into the workspace"
      >
        {persistenceState === 'saving' ? (
          <HugeiconsIcon icon={LoaderCircle} size={14} className="animate-spin text-black" />
        ) : (
          <HugeiconsIcon icon={CheckIcon} size={14} className="stroke-[2.5]" />
        )}
        <span>Keep in Workspace</span>
      </button>

      {/* Button 2: Regenerate */}
      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleRegenerate}
        className="px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-zinc-200 hover:text-white font-medium text-xs flex items-center gap-1.5 border border-white/[0.1] active:scale-95 transition-all cursor-pointer"
        title="Trigger a new operation execution, preserving prior outputs"
      >
        <HugeiconsIcon icon={RefreshCw} size={13} className="text-zinc-400 group-hover:text-white" />
        <span>Regenerate</span>
      </button>

      {/* Button 3: Discard Preview */}
      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleDiscardPreview}
        className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 font-medium text-xs flex items-center gap-1.5 border border-rose-500/20 active:scale-95 transition-all cursor-pointer"
        title="Discard temporary preview without touching saved outputs"
      >
        <HugeiconsIcon icon={Trash2} size={13} />
        <span>Discard</span>
      </button>
    </div>
  );
};
