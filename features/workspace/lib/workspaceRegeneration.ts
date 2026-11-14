export interface WorkspaceRegenerationSnapshot {
  endpoint: string;
  body: Record<string, unknown>;
}

export interface WorkspaceRegenerationRequest {
  endpoint: string;
  body: Record<string, unknown>;
}

/** Build a fresh request from the immutable original image-to-mesh submission. */
export function createWorkspaceRegenerationRequest(
  snapshot: WorkspaceRegenerationSnapshot,
  workspaceId: string,
  parentOperationId: string,
): WorkspaceRegenerationRequest {
  if (!snapshot || !snapshot.body || typeof snapshot.body !== 'object' || Array.isArray(snapshot.body)) {
    throw new Error('The original generation request snapshot is unavailable.');
  }
  if (!workspaceId || !parentOperationId) {
    throw new Error('Workspace and parent operation identities are required.');
  }
  const allowedEndpoints = new Set([
    '/api/v1/mesh-generation/image-to-raw-mesh',
    '/api/v1/mesh-generation/image-to-textured-mesh',
  ]);
  if (!allowedEndpoints.has(snapshot.endpoint)) {
    throw new Error('This operation type does not support regeneration.');
  }
  const body = JSON.parse(JSON.stringify(snapshot.body)) as Record<string, unknown>;
  body.workspace_id = workspaceId;
  body.parent_operation_id = parentOperationId;
  return { endpoint: snapshot.endpoint, body };
}
