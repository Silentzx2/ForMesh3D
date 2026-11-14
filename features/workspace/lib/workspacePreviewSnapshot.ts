import type { ModelAsset, WorkspaceExecutionState, WorkspacePersistenceState, WorkspaceVersionItem } from '../types';
import type { AssetItem, ContextTabType, ModelMeshStats, ShadingPreset } from '@/stores/useViewerStore';

export interface WorkspacePreviewViewerSnapshot {
  loadedModelUrl: string | null;
  loadedModelName: string | null;
  selectedAsset: AssetItem | null;
  modelStats: ModelMeshStats | null;
  shadingMode: ShadingPreset;
  wireframeOverlay: boolean;
  activeContextTab: ContextTabType;
  viewport: {
    cameraPosition: [number, number, number];
    target: [number, number, number];
  } | null;
  compareMode: boolean;
  compareSyncCamera: boolean;
  compareLeftAssetId: string | null;
  compareRightAssetId: string | null;
  workspaceId: string | null;
  activeMeshAssetId: string | null;
}

export interface WorkspacePreviewBaselineSnapshot {
  schemaVersion: 1;
  capturedAt: number;
  workspaceId: string | null;
  selectedAssetId: string | null;
  selectedAsset: ModelAsset | null;
  activeMeshAssetId: string | null;
  workspaceVersions: WorkspaceVersionItem[];
  executionState: WorkspaceExecutionState;
  persistenceState: WorkspacePersistenceState;
  viewer: WorkspacePreviewViewerSnapshot;
}

export type WorkspacePreviewBaselineInput = Omit<
  WorkspacePreviewBaselineSnapshot,
  'schemaVersion' | 'capturedAt'
> & {
  capturedAt?: number;
};

export type WorkspacePreviewRestorePlan = Omit<
  WorkspacePreviewBaselineSnapshot,
  'schemaVersion' | 'capturedAt'
>;

/** Copy JSON-shaped workspace state so later UI mutations cannot rewrite the baseline. */
function cloneSnapshotValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Capture the pre-operation workspace/viewer state.
 * This is a UI rollback snapshot only; SQLite operation and asset records remain authoritative.
 */
export function captureWorkspacePreviewBaseline(
  input: WorkspacePreviewBaselineInput,
): WorkspacePreviewBaselineSnapshot {
  const copied = cloneSnapshotValue(input);
  return {
    ...copied,
    schemaVersion: 1,
    capturedAt: input.capturedAt ?? Date.now(),
  };
}

/**
 * Build a detached restore plan and reject stale snapshots from another workspace.
 * Applying this plan is intentionally owned by the Keep/Discard integration batch.
 */
export function createWorkspacePreviewRestorePlan(
  snapshot: WorkspacePreviewBaselineSnapshot,
  currentWorkspaceId: string | null,
): WorkspacePreviewRestorePlan {
  if (!snapshot || snapshot.schemaVersion !== 1) {
    throw new Error('Unsupported workspace preview baseline snapshot');
  }
  if (snapshot.workspaceId !== currentWorkspaceId) {
    throw new Error('Workspace preview baseline belongs to a different workspace');
  }

  const { schemaVersion: _schemaVersion, capturedAt: _capturedAt, ...restorePlan } = snapshot;
  return cloneSnapshotValue(restorePlan);
}
