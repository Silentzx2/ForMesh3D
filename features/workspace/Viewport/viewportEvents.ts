import type { LightTone } from './MeshViewer';

/**
 * Authoritative Viewport Event Contract.
 * All viewport custom events and their typed payloads are declared here.
 */
export const VIEWPORT_EVENTS = {
  /** Request MeshViewer to schedule a single on-demand render frame. */
  INVALIDATE_RENDER: 'invalidateViewportRender',
  /** Broadcast live Three.js camera orientation quaternion [x, y, z, w]. */
  CAMERA_ORIENTATION: 'viewport:cameraOrientation',
  /** Request MeshViewer to snap the camera to a cardinal or perspective preset. */
  SET_CAMERA_PRESET: 'setCameraPreset',
  /** Request MeshViewer to capture a 1080p PNG snapshot of the mesh. */
  TAKE_SNAPSHOT: 'takeViewportSnapshot',
  /** Update MeshViewer studio lighting tone. */
  SET_LIGHTING: 'setViewportLighting',
  /** Update MeshViewer tone-mapping exposure. */
  SET_EXPOSURE: 'setViewportExposure',
} as const;

export type CameraPresetKey =
  | 'front'
  | 'back'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'perspective';

export interface CameraOrientationDetail {
  quaternion: [number, number, number, number];
}

export const invalidateViewportRender = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(VIEWPORT_EVENTS.INVALIDATE_RENDER));
  }
};

export const dispatchCameraOrientation = (
  quaternion: [number, number, number, number],
): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<CameraOrientationDetail>(VIEWPORT_EVENTS.CAMERA_ORIENTATION, {
        detail: { quaternion },
      }),
    );
  }
};

export const dispatchCameraPreset = (preset: CameraPresetKey): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<CameraPresetKey>(VIEWPORT_EVENTS.SET_CAMERA_PRESET, {
        detail: preset,
      }),
    );
  }
};

export const dispatchViewportSnapshot = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VIEWPORT_EVENTS.TAKE_SNAPSHOT));
  }
};

export const dispatchViewportLighting = (tone: LightTone): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ tone: LightTone }>(VIEWPORT_EVENTS.SET_LIGHTING, {
        detail: { tone },
      }),
    );
  }
};

export const dispatchViewportExposure = (exposure: number): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<number>(VIEWPORT_EVENTS.SET_EXPOSURE, {
        detail: exposure,
      }),
    );
  }
};
