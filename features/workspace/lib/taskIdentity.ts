export interface BackendBoundTaskIdentity {
  id: string;
  backendJobId?: string;
}

/** Resolve a backend job ID to the local key used by the workspace task map. */
export function findTaskKeyForBackendJob(
  tasks: Record<string, BackendBoundTaskIdentity>,
  backendJobId: string,
): string | null {
  for (const [key, task] of Object.entries(tasks)) {
    if (key === backendJobId || task.id === backendJobId || task.backendJobId === backendJobId) {
      return key;
    }
  }
  return null;
}
