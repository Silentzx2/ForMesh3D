'use client';

import React, { useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, RefreshCw, Trash2, SparklesIcon, LoaderCircle, AlertCircleIcon } from '@hugeicons/core-free-icons';

export const OperationActionBar: React.FC = () => {
  const {
    executionState, persistenceState, setPersistenceState,
    workspaceId, currentAsset, activeTask, jobsById, activeTool, addAsset, selectAsset,
    workspaceVersions, setWorkspaceVersions, restorePreviewBaseline,
  } = useWorkspace();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previewTask = currentAsset?.operation_id
    ? Object.values(jobsById).find(task => task.operationId === currentAsset.operation_id) ||
      (activeTask?.operationId === currentAsset.operation_id ? activeTask : undefined)
    : activeTask;
  const operationId = currentAsset?.operation_id || previewTask?.operationId || null;
  const taskWorkspaceId = previewTask?.workspaceId || currentAsset?.workspace_id || workspaceId;
  const isPreviewActive = executionState === 'completed' &&
    (persistenceState === 'not_saved' || persistenceState === 'saving' || persistenceState === 'save_failed');
  if (!isPreviewActive) return null;

  const readResponse = async (response: Response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.message || `Request failed (HTTP ${response.status})`);
    return payload;
  };

  const handleKeepInWorkspace = async () => {
    if (isSubmitting) return;
    if (!operationId || !currentAsset || !taskWorkspaceId) {
      toast.error('Cannot keep preview', { description: 'A real operation ID, preview asset, and workspace are required.' });
      return;
    }
    setIsSubmitting(true);
    setPersistenceState('saving');
    try {
      const response = await fetch(`/api/v1/workspace/operations/${encodeURIComponent(operationId)}/keep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await readResponse(response);
      if (!result.asset_id) throw new Error('Backend Keep response did not include a retained asset ID.');

      const assetId = String(result.asset_id);
      const relativePath = String(result.relative_mesh_path || '');
      const filename = relativePath.split(/[\\/]/).pop() || currentAsset.name;
      const downloadUrl = `/api/v1/system/jobs/${encodeURIComponent(assetId)}/download`;
      const retainedAsset = {
        ...currentAsset,
        id: assetId,
        workspace_id: taskWorkspaceId,
        operation_id: operationId,
        category: 'mesh' as const,
        name: filename.replace(/\.[^.]+$/, ''),
        thumbnail: result.relative_thumbnail_path
          ? `/api/v1/system/jobs/${encodeURIComponent(assetId)}/thumbnail`
          : currentAsset.thumbnail,
        fileId: undefined,
        source: { filename, subfolder: relativePath.split('/').slice(0, -1).join('/'), type: 'output', viewUrl: downloadUrl },
        version: `v${String(workspaceVersions.length + 1).padStart(3, '0')}`,
        is_base_mesh: false,
        productionStatus: 'ready' as const,
      };

      addAsset(retainedAsset);
      selectAsset(assetId);
      setWorkspaceVersions(previous => [
        ...previous.filter(item => item.asset_id !== assetId),
        {
          asset_id: assetId,
          name: retainedAsset.name,
          version_label: retainedAsset.version!,
          operation_type: previewTask?.type || activeTool,
          url: downloadUrl,
          thumbnail_url: retainedAsset.thumbnail || null,
        },
      ]);
      setPersistenceState('saved');
      toast.success('Preview retained in workspace', { description: `Saved as ${retainedAsset.version}` });
    } catch (error) {
      setPersistenceState('save_failed');
      toast.error('Keep failed', { description: error instanceof Error ? error.message : 'Unable to retain preview.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDiscardPreview = async () => {
    if (isSubmitting) return;
    const baseline = previewTask?.previewBaseline;
    if (!baseline) {
      toast.error('Cannot restore preview', { description: 'This preview has no in-memory baseline. Reloaded previews cannot be discarded safely.' });
      return;
    }
    if (previewTask?.workspaceId && previewTask.workspaceId !== workspaceId) {
      toast.error('Cannot restore preview', { description: 'The preview belongs to a different workspace.' });
      return;
    }
    if (baseline.workspaceId && baseline.workspaceId !== workspaceId) {
      toast.error('Cannot restore preview', { description: 'The baseline belongs to a different workspace.' });
      return;
    }
    if (previewTask?.backendJobId && !operationId) {
      toast.error('Cannot discard preview', { description: 'The backend operation ID is missing. The temporary output was not deleted.' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (operationId) {
        const response = await fetch(`/api/v1/workspace/operations/${encodeURIComponent(operationId)}/discard`, { method: 'POST' });
        await readResponse(response);
      }
      restorePreviewBaseline(previewTask?.id);
      toast.info('Preview discarded', { description: 'Previous workspace and viewer state restored. Saved assets remain intact.' });
    } catch (error) {
      toast.error('Discard failed', { description: error instanceof Error ? error.message : 'Unable to discard preview.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="operation-action-bar" className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 p-1.5 rounded-2xl bg-[#141522]/95 backdrop-blur-xl border border-white/[0.15] shadow-[0_16px_48px_rgba(0,0,0,0.85)] animate-in fade-in slide-in-from-bottom-3 duration-200 select-none">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/[0.06] border border-white/[0.08] text-[11px] font-mono text-zinc-300">
        <HugeiconsIcon icon={SparklesIcon} size={14} className="text-primary fill-current" />
        <span className="font-semibold text-white">Preview Output</span>
        {persistenceState === 'save_failed' && <span className="flex items-center gap-1 text-rose-400 text-[10px] ml-1"><HugeiconsIcon icon={AlertCircleIcon} size={12} />Save Failed</span>}
      </div>
      <div className="h-4 w-[1px] bg-white/10 mx-0.5" />
      <button type="button" disabled={isSubmitting || persistenceState === 'saving' || !operationId} onClick={handleKeepInWorkspace}
        className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-[#080808] font-bold text-xs flex items-center gap-1.5 shadow-[0_2px_12px_rgba(255,204,0,0.35)] hover:brightness-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        title={!operationId ? 'Backend operation identity is unavailable' : 'Permanently retain this preview'}>
        {persistenceState === 'saving' ? <HugeiconsIcon icon={LoaderCircle} size={14} className="animate-spin text-black" /> : <HugeiconsIcon icon={CheckIcon} size={14} className="stroke-[2.5]" />}
        <span>Keep in Workspace</span>
      </button>
      <button type="button" disabled className="px-3 py-1.5 rounded-xl bg-white/[0.08] text-zinc-500 font-medium text-xs flex items-center gap-1.5 border border-white/[0.1] cursor-not-allowed opacity-60" title="Regenerate operation lineage is implemented in Batch 3C">
        <HugeiconsIcon icon={RefreshCw} size={13} /><span>Regenerate</span>
      </button>
      <button type="button" disabled={isSubmitting || !previewTask?.previewBaseline} onClick={handleDiscardPreview}
        className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 font-medium text-xs flex items-center gap-1.5 border border-rose-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title={!previewTask?.previewBaseline ? 'Discard requires an in-memory pre-operation baseline' : 'Discard preview and restore the exact previous state'}>
        <HugeiconsIcon icon={Trash2} size={13} /><span>Discard Preview</span>
      </button>
    </div>
  );
};
