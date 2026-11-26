// Shared predicates for the adaptive backend-job poller.
const BACKEND_JOB_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9][a-z0-9-]{0,39}_[a-f0-9]{6,8})$/i;

export interface PollingTaskIdentity {
  id: string;
  status: string;
}

export function canApplyPolledTaskUpdate(status: string | undefined): boolean {
  return status === 'queued' || status === 'running';
}

export function isPollableBackendTask(task: PollingTaskIdentity | null | undefined): boolean {
  return Boolean(task?.id && BACKEND_JOB_ID_RE.test(task.id) && canApplyPolledTaskUpdate(task.status));
}

export function hasActiveBackendTasks(tasks: Record<string, PollingTaskIdentity>): boolean {
  return Object.values(tasks).some(isPollableBackendTask);
}
