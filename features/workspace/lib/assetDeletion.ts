import type { ModelAsset } from '../types';

export type AssetDeletionTarget = { kind: 'local' } | { kind: 'job'; id: string } | { kind: 'upload'; id: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ASSET_ID_PATTERN = /^ast_[0-9a-f]{12}$/i;

/** Resolve only a known backend identity; aliases and unknown IDs are local-only. */
export function resolveAssetDeletionTarget(asset: ModelAsset): AssetDeletionTarget {
  if (asset.isLocalDuplicate) return { kind: 'local' };
  const rawSourceId = asset.source?.fileId || asset.fileId || '';
  const sourceIsJob = /^job-/i.test(rawSourceId);
  const sourceId = rawSourceId.replace(/^job-/i, '');
  const isLocalAlias = /^(?:local_|asset-)/i.test(asset.id);
  const isUploadAlias = /^upload_/i.test(asset.id);
  const isUpload = isUploadAlias || asset.source?.type === 'upload' ||
    asset.sourceType === 'upload' || asset.tags?.includes('User-Upload') === true;
  const cleanAssetId = asset.id.replace(/^(?:hist_|local_|upload_)/i, '').replace(/^job-/i, '');
  if (sourceIsJob && SAFE_JOB_ID_PATTERN.test(sourceId)) return { kind: 'job', id: sourceId };
  if (!isUpload && asset.category === 'generation' && asset.workspace_id && SAFE_JOB_ID_PATTERN.test(asset.workspace_id)) {
    return { kind: 'job', id: asset.workspace_id };
  }
  if (isLocalAlias && !isUpload) return { kind: 'local' };
  if (!isUpload && UUID_PATTERN.test(cleanAssetId)) return { kind: 'job', id: cleanAssetId };
  const candidates = [sourceId, asset.fileId || '', cleanAssetId, asset.id]
    .map((value) => value.replace(/^(?:hist_|local_|upload_|job-)/i, ''));
  const uploadId = candidates.find((value) => UUID_PATTERN.test(value) || ASSET_ID_PATTERN.test(value));
  if (uploadId && (isUpload || ASSET_ID_PATTERN.test(uploadId))) return { kind: 'upload', id: uploadId };
  return { kind: 'local' };
}
