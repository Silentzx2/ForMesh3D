import * as THREE from 'three';
import { getApiClient, normalizeBackendAssetUrl } from '@/services/apiClient';
import { mapRetargetBones } from '@/stores/useAnimationStore';

export interface MotionPresetItem {
  id: string;
  name: string;
  duration: number | null;
  fps: number | null;
  frame_count: number | null;
  thumbnail_url: string | null;
  clip_url: string;
  source?: 'uploaded' | 'generated';
}

export interface MotionPresetsResponse {
  schema_version: 1;
  presets: MotionPresetItem[];
}

export interface MotionClipFrame {
  rotations: [number, number, number, number][];
  root_translation: [number, number, number];
}

export interface MotionClipV1 {
  schema_version: 1;
  id: string;
  name: string;
  fps: number;
  frame_count: number;
  duration: number;
  skeleton_profile: string;
  coordinate_system: string;
  translation_units: string;
  rotation_format: 'quaternion_xyzw';
  joint_names: string[];
  frames: MotionClipFrame[];
}

export type MotionClientErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNPROCESSABLE_ENTITY'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'MALFORMED_CLIP'
  | 'MALFORMED_RESPONSE';

export class MotionClientError extends Error {
  readonly code: MotionClientErrorCode;
  readonly status?: number;

  constructor(message: string, code: MotionClientErrorCode, status?: number) {
    super(message);
    this.name = 'MotionClientError';
    this.code = code;
    this.status = status;
  }
}

const MAX_JOINTS = 512;
const MAX_FRAMES = 36000;

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function toMotionClientError(err: unknown, fallbackMessage: string): MotionClientError {
  if (err instanceof MotionClientError) return err;

  const status = typeof (err as any)?.status === 'number' ? (err as any).status : undefined;
  const rawMessage = typeof (err as any)?.message === 'string' && (err as any).message.trim()
    ? (err as any).message.trim()
    : fallbackMessage;

  switch (status) {
    case 400:
      return new MotionClientError(rawMessage || 'Invalid motion request or clip.', 'BAD_REQUEST', 400);
    case 404:
      return new MotionClientError(rawMessage || 'Motion preset or clip no longer exists.', 'NOT_FOUND', 404);
    case 413:
      return new MotionClientError(rawMessage || 'Uploaded NPZ file exceeds size limit.', 'PAYLOAD_TOO_LARGE', 413);
    case 415:
      return new MotionClientError(rawMessage || 'Unsupported media format. Please upload a valid .npz file.', 'UNSUPPORTED_MEDIA_TYPE', 415);
    case 422:
      return new MotionClientError(rawMessage || 'Motion clip failed validation.', 'UNPROCESSABLE_ENTITY', 422);
    case 429:
      return new MotionClientError(rawMessage || 'Too many motion requests. Please wait and retry.', 'RATE_LIMITED', 429);
    default:
      if (status !== undefined && status >= 500) {
        return new MotionClientError(rawMessage || 'Motion service unavailable. Please retry.', 'SERVER_ERROR', status);
      }
      if ((err as any)?.code === 'NETWORK_ERROR') {
        return new MotionClientError(rawMessage || 'Network error reaching motion service.', 'NETWORK_ERROR');
      }
      return new MotionClientError(rawMessage, 'SERVER_ERROR', status);
  }
}

export function validateMotionClipV1(raw: unknown): MotionClipV1 {
  if (!isPlainObject(raw)) {
    throw new MotionClientError('Motion clip response is not an object.', 'MALFORMED_CLIP');
  }
  if (raw.schema_version !== 1) {
    throw new MotionClientError(`Unsupported motion clip schema_version: ${String(raw.schema_version)}`, 'MALFORMED_CLIP');
  }
  if (raw.rotation_format !== 'quaternion_xyzw') {
    throw new MotionClientError(`Unsupported rotation_format: ${String(raw.rotation_format)}`, 'MALFORMED_CLIP');
  }
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) {
    throw new MotionClientError('Motion clip is missing required id or name.', 'MALFORMED_CLIP');
  }
  if (
    !isNonEmptyString(raw.skeleton_profile) ||
    !isNonEmptyString(raw.coordinate_system) ||
    !isNonEmptyString(raw.translation_units)
  ) {
    throw new MotionClientError('Motion clip is missing skeleton or coordinate metadata.', 'MALFORMED_CLIP');
  }
  if (!isFiniteNumber(raw.fps) || raw.fps <= 0) {
    throw new MotionClientError('Motion clip fps must be a positive finite number.', 'MALFORMED_CLIP');
  }
  if (!isFiniteNumber(raw.frame_count) || !Number.isInteger(raw.frame_count) || raw.frame_count < 1 || raw.frame_count > MAX_FRAMES) {
    throw new MotionClientError('Motion clip frame_count is out of bounds.', 'MALFORMED_CLIP');
  }
  if (!isFiniteNumber(raw.duration) || raw.duration <= 0) {
    throw new MotionClientError('Motion clip duration must be a positive finite number.', 'MALFORMED_CLIP');
  }

  const expectedDuration = raw.frame_count / raw.fps;
  const durationTolerance = Math.max(0.15, 2.0 / raw.fps);
  if (Math.abs(raw.duration - expectedDuration) > durationTolerance) {
    throw new MotionClientError('Motion clip duration is inconsistent with frame_count and fps.', 'MALFORMED_CLIP');
  }

  if (!Array.isArray(raw.joint_names) || raw.joint_names.length < 1 || raw.joint_names.length > MAX_JOINTS) {
    throw new MotionClientError('Motion clip joint_names must contain 1 to 512 joints.', 'MALFORMED_CLIP');
  }
  const jointNames: string[] = [];
  for (let j = 0; j < raw.joint_names.length; j++) {
    const jn = raw.joint_names[j];
    if (!isNonEmptyString(jn)) {
      throw new MotionClientError(`Invalid joint name at index ${j}.`, 'MALFORMED_CLIP');
    }
    jointNames.push(jn);
  }

  if (!Array.isArray(raw.frames) || raw.frames.length !== raw.frame_count) {
    throw new MotionClientError('Motion clip frames length does not match frame_count.', 'MALFORMED_CLIP');
  }

  const validatedFrames: MotionClipFrame[] = new Array(raw.frame_count);
  const jointCount = jointNames.length;

  for (let i = 0; i < raw.frame_count; i++) {
    const frame = raw.frames[i];
    if (!isPlainObject(frame)) {
      throw new MotionClientError(`Frame ${i} is not an object.`, 'MALFORMED_CLIP');
    }
    if (!Array.isArray(frame.rotations) || frame.rotations.length !== jointCount) {
      throw new MotionClientError(`Frame ${i} rotations length does not match joint_names.`, 'MALFORMED_CLIP');
    }
    const rotations: [number, number, number, number][] = new Array(jointCount);
    for (let j = 0; j < jointCount; j++) {
      const q = frame.rotations[j];
      if (
        !Array.isArray(q) ||
        q.length !== 4 ||
        !isFiniteNumber(q[0]) ||
        !isFiniteNumber(q[1]) ||
        !isFiniteNumber(q[2]) ||
        !isFiniteNumber(q[3])
      ) {
        throw new MotionClientError(`Frame ${i} joint ${j} has an invalid quaternion.`, 'MALFORMED_CLIP');
      }
      rotations[j] = [q[0], q[1], q[2], q[3]];
    }

    const rt = frame.root_translation;
    if (
      !Array.isArray(rt) ||
      rt.length !== 3 ||
      !isFiniteNumber(rt[0]) ||
      !isFiniteNumber(rt[1]) ||
      !isFiniteNumber(rt[2])
    ) {
      throw new MotionClientError(`Frame ${i} has an invalid root_translation.`, 'MALFORMED_CLIP');
    }
    validatedFrames[i] = {
      rotations,
      root_translation: [rt[0], rt[1], rt[2]],
    };
  }

  return {
    schema_version: 1,
    id: raw.id,
    name: raw.name,
    fps: raw.fps,
    frame_count: raw.frame_count,
    duration: raw.duration,
    skeleton_profile: raw.skeleton_profile,
    coordinate_system: raw.coordinate_system,
    translation_units: raw.translation_units,
    rotation_format: 'quaternion_xyzw',
    joint_names: jointNames,
    frames: validatedFrames,
  };
}

export function validateMotionPresetsResponse(raw: unknown): MotionPresetsResponse {
  if (!isPlainObject(raw) || raw.schema_version !== 1) {
    throw new MotionClientError('Invalid motion presets response format.', 'MALFORMED_RESPONSE');
  }
  const list = Array.isArray(raw.presets)
    ? raw.presets
    : Array.isArray((raw as any).uploads)
      ? (raw as any).uploads
      : null;
  if (!list) {
    throw new MotionClientError('Invalid motion list response format.', 'MALFORMED_RESPONSE');
  }
  const presets: MotionPresetItem[] = list.map((item, idx) => {
    if (!isPlainObject(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.name) || !isNonEmptyString(item.clip_url)) {
      throw new MotionClientError(`Invalid motion entry at index ${idx}.`, 'MALFORMED_RESPONSE');
    }
    return {
      id: item.id,
      name: item.name,
      duration: isFiniteNumber(item.duration) && item.duration > 0 ? item.duration : null,
      fps: isFiniteNumber(item.fps) && item.fps > 0 ? item.fps : null,
      frame_count: isFiniteNumber(item.frame_count) && item.frame_count >= 0 ? item.frame_count : null,
      thumbnail_url: isNonEmptyString(item.thumbnail_url) ? item.thumbnail_url : null,
      clip_url: item.clip_url,
      source: item.source === 'generated' ? 'generated' : item.source === 'uploaded' ? 'uploaded' : undefined,
    };
  });
  return { schema_version: 1, presets };
}

export function getPresetThumbnailUrl(preset: MotionPresetItem): string | null {
  if (!preset.thumbnail_url) return null;
  return normalizeBackendAssetUrl(preset.thumbnail_url) ?? null;
}

export async function listMotionPresets(): Promise<MotionPresetsResponse> {
  try {
    const data = await getApiClient().get<unknown>('/api/v1/motion/presets');
    return validateMotionPresetsResponse(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to load motion presets.');
  }
}


export interface WorkspaceAnimatedAsset {
  id: string;
  asset_id: string;
  asset_type: 'animated_mesh';
  workspace_id: string;
  operation_id: string;
  source_asset_id: string;
  motion_clip_id: string;
  name: string;
  category: 'mesh';
  format: 'GLB';
  file_size_mb: number;
  thumbnail: string;
  dateCreated: string | null;
  tags: string[];
  is_base_mesh: false;
  source: { filename: string; subfolder: string; type: string; fileId: string; viewUrl: string };
  file_url: string;
}

export async function listWorkspaceAnimatedMeshes(workspaceId: string): Promise<WorkspaceAnimatedAsset[]> {
  if (!isNonEmptyString(workspaceId)) throw new MotionClientError('Workspace ID is required.', 'BAD_REQUEST', 400);
  try {
    const data = await getApiClient().get<unknown>('/api/v1/motion/workspaces/' + encodeURIComponent(workspaceId) + '/animations');
    if (!isPlainObject(data) || !Array.isArray(data.assets)) {
      throw new MotionClientError('Invalid workspace animation list response.', 'MALFORMED_RESPONSE');
    }
    return data.assets as WorkspaceAnimatedAsset[];
  } catch (err) {
    throw toMotionClientError(err, 'Failed to load workspace animations.');
  }
}

export async function saveAnimatedMeshToWorkspace(args: {
  workspaceId: string;
  sourceAssetId: string;
  motionClipId: string;
  clipName: string;
  glb: Blob;
}): Promise<WorkspaceAnimatedAsset> {
  if (!isNonEmptyString(args.workspaceId) || !isNonEmptyString(args.sourceAssetId) || !isNonEmptyString(args.motionClipId)) {
    throw new MotionClientError('Workspace, source asset and motion clip IDs are required.', 'BAD_REQUEST', 400);
  }
  const safeName = (args.clipName || 'animation').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || 'animation';
  const formData = new FormData();
  formData.append('file', new File([args.glb], safeName + '.glb', { type: 'model/gltf-binary' }));
  formData.append('source_asset_id', args.sourceAssetId);
  formData.append('motion_clip_id', args.motionClipId);
  formData.append('clip_name', safeName);
  try {
    const data = await getApiClient().post<unknown>(
      '/api/v1/motion/workspaces/' + encodeURIComponent(args.workspaceId) + '/animations',
      formData,
    );
    if (!isPlainObject(data) || !isPlainObject(data.asset) || !isNonEmptyString(data.asset.asset_id) || !isNonEmptyString(data.asset.file_url)) {
      throw new MotionClientError('Invalid saved workspace animation response.', 'MALFORMED_RESPONSE');
    }
    return data.asset as unknown as WorkspaceAnimatedAsset;
  } catch (err) {
    throw toMotionClientError(err, 'Failed to save animated mesh to workspace.');
  }
}

export async function saveGeneratedMotionClip(clipId: string): Promise<MotionClipV1> {
  if (!isNonEmptyString(clipId)) {
    throw new MotionClientError('Clip ID is required.', 'BAD_REQUEST', 400);
  }
  try {
    const data = await getApiClient().post<unknown>(
      `/api/v1/motion/uploads/from-clip/${encodeURIComponent(clipId)}`,
      {}
    );
    return validateMotionClipV1(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to save generated motion to My Presets.');
  }
}

export async function getMotionClip(clipId: string): Promise<MotionClipV1> {
  if (!isNonEmptyString(clipId)) {
    throw new MotionClientError('Clip ID is required.', 'BAD_REQUEST', 400);
  }
  const url = `/api/v1/motion/clips/${encodeURIComponent(clipId)}`;
  try {
    const data = await getApiClient().get<unknown>(url);
    return validateMotionClipV1(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to load motion clip.');
  }
}

export async function getMotionClipFromUrl(clipUrl: string): Promise<MotionClipV1> {
  const normalized = normalizeBackendAssetUrl(clipUrl);
  if (!normalized) {
    throw new MotionClientError('Invalid motion clip URL.', 'BAD_REQUEST', 400);
  }
  try {
    const data = await getApiClient().get<unknown>(normalized);
    return validateMotionClipV1(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to load motion clip.');
  }
}

export async function previewNpzMotionClip(file: File): Promise<MotionClipV1> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const data = await getApiClient().post<unknown>('/api/v1/motion/clips/preview', formData);
    return validateMotionClipV1(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to preview NPZ motion clip.');
  }
}

export async function listUploadedMotionClips(): Promise<MotionPresetsResponse> {
  try {
    const data = await getApiClient().get<unknown>('/api/v1/motion/uploads');
    return validateMotionPresetsResponse(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to load uploaded motion clips.');
  }
}

export async function uploadMotionClip(file: File): Promise<MotionClipV1> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const data = await getApiClient().post<unknown>('/api/v1/motion/uploads', formData);
    return validateMotionClipV1(data);
  } catch (err) {
    throw toMotionClientError(err, 'Failed to upload NPZ motion clip.');
  }
}

export async function deleteUploadedMotionClip(clipId: string): Promise<void> {
  if (!isNonEmptyString(clipId)) {
    throw new MotionClientError('Clip ID is required.', 'BAD_REQUEST', 400);
  }
  const url = `/api/v1/motion/uploads/${encodeURIComponent(clipId)}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (typeof body?.detail === 'string') detail = body.detail;
        else if (typeof body?.message === 'string') detail = body.message;
      } catch {
        // ignore non-json error body
      }
      throw toMotionClientError({ status: res.status, message: detail }, 'Failed to delete uploaded motion clip.');
    }
  } catch (err) {
    throw toMotionClientError(err, 'Failed to delete uploaded motion clip.');
  }
}

/**
 * Converts a validated MotionClipV1 into a Three.js AnimationClip,
 * optionally retargeting joint names to match a target skeleton's bone names.
 */
export function motionClipV1ToThreeClip(
  clip: MotionClipV1,
  targetBoneNames?: string[] | null,
  preferredMapping?: Record<string, string>
): { threeClip: THREE.AnimationClip; mappedJointCount: number } {
  const mapping =
    targetBoneNames && targetBoneNames.length > 0
      ? mapRetargetBones(clip.joint_names, targetBoneNames, preferredMapping)
      : Object.fromEntries(clip.joint_names.map((j) => [j, j]));

  // Fallback for generic/numbered bone rigs (e.g., SkinTokens bone_0..N) when no names match
  if (targetBoneNames && targetBoneNames.length > 0 && Object.keys(mapping).length === 0) {
    const count = Math.min(clip.joint_names.length, targetBoneNames.length);
    for (let i = 0; i < count; i++) {
      mapping[clip.joint_names[i]] = targetBoneNames[i];
    }
  }

  const times = new Float32Array(clip.frame_count);
  for (let f = 0; f < clip.frame_count; f++) {
    times[f] = f / clip.fps;
  }

  const tracks: THREE.KeyframeTrack[] = [];
  let mappedJointCount = 0;

  for (let j = 0; j < clip.joint_names.length; j++) {
    const sourceJoint = clip.joint_names[j];
    const targetBone = mapping[sourceJoint];
    if (!targetBone) continue;

    mappedJointCount += 1;
    const quatValues = new Float32Array(clip.frame_count * 4);
    for (let f = 0; f < clip.frame_count; f++) {
      const q = clip.frames[f].rotations[j];
      const offset = f * 4;
      quatValues[offset] = q[0];
      quatValues[offset + 1] = q[1];
      quatValues[offset + 2] = q[2];
      quatValues[offset + 3] = q[3];
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${targetBone}.quaternion`, times, quatValues));
  }

  if (tracks.length === 0) {
    throw new MotionClientError(
      'No compatible skeleton joints found between this motion clip and the active 3D model.',
      'MALFORMED_CLIP'
    );
  }

  const rootTarget = mapping[clip.joint_names[0]];
  if (rootTarget) {
    const posValues = new Float32Array(clip.frame_count * 3);
    for (let f = 0; f < clip.frame_count; f++) {
      const rt = clip.frames[f].root_translation;
      const offset = f * 3;
      posValues[offset] = rt[0];
      posValues[offset + 1] = rt[1];
      posValues[offset + 2] = rt[2];
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${rootTarget}.position`, times, posValues));
  }

  const threeClip = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  return { threeClip, mappedJointCount };
}
