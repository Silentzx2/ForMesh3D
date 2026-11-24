import type { ModelAsset } from '../types';

export interface AssetComparisonPair {
  beforeUrl: string;
  afterUrl: string;
}

/**
 * A wipe is meaningful only for a renderable, completed mesh output with
 * distinct predecessor and result URLs. Callers pass execution state so an
 * old pair cannot stay interactive while a new operation runs.
 */
export function getAssetComparisonPair(
  asset?: ModelAsset | null,
  isExecuting = false,
): AssetComparisonPair | null {
  if (
    !asset ||
    isExecuting ||
    asset.category === 'texture' ||
    asset.format === 'IMAGE' ||
    asset.format === 'FILE' ||
    asset.productionStatus === 'failed' ||
    asset.postprocessStatus === 'failed'
  ) {
    return null;
  }

  const beforeUrl = asset.artifacts?.source;
  const afterUrl =
    asset.source?.viewUrl ||
    asset.source?.localUrl ||
    asset.artifacts?.gameReady;

  if (!beforeUrl || !afterUrl || beforeUrl === afterUrl) return null;
  return { beforeUrl, afterUrl };
}

export interface ComparisonSourceAssetIdentity {
  taskSourceAssetId?: string | null;
  operationInputAssetId?: string | null;
  operationInputFileType?: string | null;
}

/**
 * A generation operation may have an image as its input asset. Persisted
 * operation lineage is a comparison source only when the DB confirms it is a mesh.
 */
export function resolveComparisonSourceAssetId({
  taskSourceAssetId,
  operationInputAssetId,
  operationInputFileType,
}: ComparisonSourceAssetIdentity): string | undefined {
  if (taskSourceAssetId) return taskSourceAssetId;
  return operationInputFileType === 'mesh' ? operationInputAssetId || undefined : undefined;
}
