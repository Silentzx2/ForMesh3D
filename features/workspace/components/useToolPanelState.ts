'use client';

import type { WorkspaceExecutionStatus } from '../store/WorkspaceContext';

export type DownstreamToolPanelState =
  | 'downstream_empty'
  | 'downstream_uploading'
  | 'downstream_ready'
  | 'tool_executing'
  | 'tool_completed'
  | 'tool_failed'
  | 'tool_cancelled';

export function deriveDownstreamToolState(params: {
  hasValidMesh: boolean;
  isUploading: boolean;
  executionStatus?: WorkspaceExecutionStatus;
  isExecuting?: boolean;
}): DownstreamToolPanelState {
  const { hasValidMesh, isUploading, executionStatus, isExecuting } = params;

  if (isExecuting || executionStatus === 'queued' || executionStatus === 'running') {
    return 'tool_executing';
  }
  if (isUploading) {
    return 'downstream_uploading';
  }
  if (!hasValidMesh) {
    return 'downstream_empty';
  }
  if (executionStatus === 'completed') {
    return 'tool_completed';
  }
  if (executionStatus === 'failed' || executionStatus === 'interrupted') {
    return 'tool_failed';
  }
  if (executionStatus === 'cancelled') {
    return 'tool_cancelled';
  }
  return 'downstream_ready';
}
