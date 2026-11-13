import { useEffect, useCallback, useRef, useState } from 'react';
import { getApiClient, normalizeBackendAssetUrl } from '@/services/apiClient';
import { useAppStore } from '@/stores/useAppStore';
import type { JobStatus, JobInfo } from '@/types/api';

export interface UseTaskPollingOptions {
  pollingInterval?: number;
  enabled?: boolean;
}

// Skip local placeholder ids (slugs like 'generate-abc123'): they have no
// backend job under /api/v1/system/jobs/{id} and would 404 on every poll.
const BACKEND_JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BACKEND_STATUS: Record<JobStatus, 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'> = {
  queued: 'queued',
  processing: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export type PollingLifecycleStatus = 'idle' | 'polling' | 'stopped';

export const useTaskPolling = (options: UseTaskPollingOptions = {}) => {
  const {
    pollingInterval = 5000,
    enabled = true,
  } = options;

  const tasks = useAppStore((state) => state.tasks);
  const setTask = useAppStore((state) => state.setTask);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pollingStatus, setPollingStatus] = useState<PollingLifecycleStatus>('idle');
  const isPolling = pollingStatus === 'polling';
  const isPollingRef = useRef(false);

  const pollTaskStatus = useCallback(async (task: (typeof tasks)[string]) => {
    if (!task.id || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return;
    }

    try {
      const apiClient = getApiClient();
      const jobInfo: JobInfo = await apiClient.getJobStatus(task.id);
      const status = BACKEND_STATUS[jobInfo.status];
      const rawProgress = Number(jobInfo.progress ?? 0);
      const normalizedProgress = Math.max(
        0,
        Math.min(100, Math.round(rawProgress <= 1 ? rawProgress * 100 : rawProgress)),
      );

      const needsUpdate =
        status !== task.status ||
        normalizedProgress !== task.progress ||
        (jobInfo.input_image_url && !task.metadata?.inputImageUrl) ||
        (jobInfo.model_preference && !task.metadata?.modelPreference) ||
        Boolean(jobInfo.result?.production_status && task.metadata?.productionStatus !== jobInfo.result.production_status);

      if (!needsUpdate) {
        return;
      }

      const metadata: Record<string, unknown> = {
        ...(task.metadata ?? {}),
        ...(jobInfo.input_image_url ? { inputImageUrl: jobInfo.input_image_url } : {}),
        ...(jobInfo.model_preference ? { modelPreference: jobInfo.model_preference } : {}),
      };

      const updatedTask = {
        ...task,
        status,
        progress: status === 'completed' ? 100 : status === 'failed' || status === 'cancelled' ? 0 : normalizedProgress,
        updatedAt: Date.now(),
        metadata,
      };

      if (jobInfo.status === 'completed') {
        updatedTask.metadata = {
          ...metadata,
          ...(jobInfo.processing_time !== undefined ? { processingTime: jobInfo.processing_time } : {}),
        };
        if (jobInfo.result) {
          updatedTask.metadata = {
            ...updatedTask.metadata,
            ...(jobInfo.result.mesh_url ? { outputPath: normalizeBackendAssetUrl(jobInfo.result.mesh_url) } : {}),
            ...(jobInfo.result.thumbnail_url ? { previewImageUrl: normalizeBackendAssetUrl(jobInfo.result.thumbnail_url) } : {}),
            ...(jobInfo.result.production_status ? { productionStatus: jobInfo.result.production_status } : {}),
            ...(jobInfo.result.degraded_reasons ? { degradedReasons: jobInfo.result.degraded_reasons } : {}),
            ...(jobInfo.result.source_model_url ? { sourceModelUrl: jobInfo.result.source_model_url } : {}),
            ...(jobInfo.result.high_fidelity_url ? { highFidelityUrl: jobInfo.result.high_fidelity_url } : {}),
            ...(jobInfo.result.game_ready_url ? { gameReadyUrl: jobInfo.result.game_ready_url } : {}),
            ...(jobInfo.result.quality_mode ? { qualityMode: jobInfo.result.quality_mode } : {}),
            ...(jobInfo.result.target_polycount !== undefined ? { targetPolycount: jobInfo.result.target_polycount } : {}),
            ...(jobInfo.result.texture_resolution !== undefined ? { textureResolution: jobInfo.result.texture_resolution } : {}),
          };
          try {
            const resultInfo = await apiClient.getJobResultInfo(task.id);
            if (resultInfo.mesh_download_urls?.direct_download) {
              const fileInfo = resultInfo.file_info;
              updatedTask.metadata = {
                ...updatedTask.metadata,
                downloadUrl: resultInfo.mesh_download_urls.direct_download,
                ...(fileInfo?.file_size_mb !== undefined ? { fileSize: fileInfo.file_size_mb } : {}),
                ...(fileInfo?.file_extension ? { format: fileInfo.file_extension } : {}),
              };
            }
          } catch (err) {
            console.warn('[TaskPolling] Failed to get result info:', err);
          }
        }
      }

      if (jobInfo.status === 'failed') {
        updatedTask.metadata = { ...updatedTask.metadata, error: 'Task failed during processing' };
      }

      setTask(updatedTask);
    } catch (error) {
      console.error('[TaskPolling] Failed to poll task status:', error);
    }
  }, [setTask]);

  const pollAllActiveTasks = useCallback(async () => {
    if (isPollingRef.current) {
      return;
    }

    isPollingRef.current = true;
    setPollingStatus('polling');

    try {
      const activeTasks = Object.values(tasks).filter(
        (task) =>
          task.id &&
          BACKEND_JOB_ID_RE.test(task.id) &&
          (task.status === 'queued' || task.status === 'running'),
      );

      if (activeTasks.length === 0) {
        setPollingStatus('idle');
        return;
      }

      await Promise.allSettled(activeTasks.map((task) => pollTaskStatus(task)));
    } catch (error) {
      console.error('[TaskPolling] Error during polling cycle:', error);
    } finally {
      isPollingRef.current = false;
      setPollingStatus('idle');
    }
  }, [tasks, pollTaskStatus]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(pollAllActiveTasks, pollingInterval);
    void pollAllActiveTasks();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, pollingInterval, pollAllActiveTasks]);

  return {
    isPolling,
    pollingStatus,
    pollTask: pollTaskStatus,
    pollAllTasks: pollAllActiveTasks,
  };
};
