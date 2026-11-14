import { useEffect, useCallback, useRef, useState } from 'react';
import { getApiClient, normalizeBackendAssetUrl } from '@/services/apiClient';
import { useAppStore } from '@/stores/useAppStore';
import type { JobStatus, JobInfo } from '@/types/api';

export interface UseTaskPollingOptions {
  initialInterval?: number; // default: 1500 (1.5s)
  backoffInterval?: number; // default: 5000 (5s)
  backoffDelayMs?: number;  // default: 120000 (2 minutes)
  enabled?: boolean;
}

// Skip local placeholder ids: only real backend generation jobs (uuid) are pollable
const BACKEND_JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BACKEND_STATUS: Record<JobStatus, 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'> = {
  queued: 'queued',
  processing: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export type PollingLifecycleStatus = 'idle' | 'polling' | 'paused' | 'stopped';

/**
 * Consolidated adaptive poller for workspace generation tasks:
 * - 1.5s initial cadence
 * - 5s backoff after 2 minutes (120s) of active execution
 * - Pauses automatically when tab is hidden (document.hidden / visibilitychange)
 * - Stops completely on terminal state (completed, failed, cancelled, interrupted)
 */
export const useTaskPolling = (options: UseTaskPollingOptions = {}) => {
  const {
    initialInterval = 1500,
    backoffInterval = 5000,
    backoffDelayMs = 120000,
    enabled = true,
  } = options;

  const tasks = useAppStore((state) => state.tasks);
  const setTask = useAppStore((state) => state.setTask);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pollingStatus, setPollingStatus] = useState<PollingLifecycleStatus>('idle');
  const isPolling = pollingStatus === 'polling';
  const isPollingRef = useRef(false);
  const pollingStartTimeRef = useRef<number | null>(null);

  const pollTaskStatus = useCallback(async (task: (typeof tasks)[string]) => {
    if (!task.id || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return;
    }

    try {
      const apiClient = getApiClient();
      const jobInfo: JobInfo = await apiClient.getJobStatus(task.id);
      const status = BACKEND_STATUS[jobInfo.status] || (jobInfo.status as any);
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
    if (isPollingRef.current) return;

    // Check visibility: pause if tab is hidden
    if (typeof document !== 'undefined' && document.hidden) {
      setPollingStatus('paused');
      return;
    }

    const currentTasks = useAppStore.getState().tasks;
    const activeTasks = Object.values(currentTasks).filter(
      (task) =>
        task.id &&
        BACKEND_JOB_ID_RE.test(task.id) &&
        (task.status === 'queued' || task.status === 'running')
    );

    if (activeTasks.length === 0) {
      pollingStartTimeRef.current = null;
      setPollingStatus('idle');
      return;
    }

    if (!pollingStartTimeRef.current) {
      pollingStartTimeRef.current = Date.now();
    }

    isPollingRef.current = true;
    setPollingStatus('polling');

    try {
      await Promise.allSettled(activeTasks.map((task) => pollTaskStatus(task)));
    } catch (error) {
      console.error('[TaskPolling] Error during polling cycle:', error);
    } finally {
      isPollingRef.current = false;
      const remainingTasks = Object.values(useAppStore.getState().tasks).filter(
        (task) =>
          task.id &&
          BACKEND_JOB_ID_RE.test(task.id) &&
          (task.status === 'queued' || task.status === 'running')
      );
      if (remainingTasks.length === 0) {
        pollingStartTimeRef.current = null;
        setPollingStatus('idle');
      }
    }
  }, [pollTaskStatus]);

  // Adaptive scheduling loop with tab visibility awareness
  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const scheduleNext = () => {
      if (!isMounted) return;

      // Determine current interval: 1.5s initial, 5s after 2 minutes of active polling
      const elapsed = pollingStartTimeRef.current ? Date.now() - pollingStartTimeRef.current : 0;
      const currentInterval = elapsed >= backoffDelayMs ? backoffInterval : initialInterval;

      timerRef.current = setTimeout(async () => {
        if (!isMounted) return;
        if (typeof document === 'undefined' || !document.hidden) {
          await pollAllActiveTasks();
        }
        scheduleNext();
      }, currentInterval);
    };

    // Immediate initial poll
    void pollAllActiveTasks();
    scheduleNext();

    const handleVisibilityChange = () => {
      if (!isMounted) return;
      if (!document.hidden) {
        // Tab became visible again: poll immediately and resume
        void pollAllActiveTasks();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMounted = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, initialInterval, backoffInterval, backoffDelayMs, pollAllActiveTasks]);

  return {
    isPolling,
    pollingStatus,
    pollTask: pollTaskStatus,
    pollAllTasks: pollAllActiveTasks,
  };
};
