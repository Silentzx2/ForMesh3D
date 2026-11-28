import * as THREE from 'three';
import type { MeshOrientationAxis } from './viewportEvents';

const AXIS_DIRECTIONS: Record<MeshOrientationAxis, THREE.Vector3> = {
  'positive-x': new THREE.Vector3(1, 0, 0),
  'negative-x': new THREE.Vector3(-1, 0, 0),
  'positive-y': new THREE.Vector3(0, 1, 0),
  'negative-y': new THREE.Vector3(0, -1, 0),
  'positive-z': new THREE.Vector3(0, 0, 1),
  'negative-z': new THREE.Vector3(0, 0, -1),
};

/**
 * Rotate a mesh group so the selected local axis faces the current camera.
 * Only the mesh quaternion is changed; camera position, target and controls are untouched.
 */
export function orientMeshAxisToView(
  group: THREE.Group,
  axis: MeshOrientationAxis,
  cameraDirection: THREE.Vector3,
): void {
  const directionLengthSq = cameraDirection.lengthSq();
  if (!Number.isFinite(directionLengthSq) || directionLengthSq < 1e-12) return;

  const targetDirection = cameraDirection.clone().normalize();
  const currentAxisDirection = AXIS_DIRECTIONS[axis]
    .clone()
    .applyQuaternion(group.quaternion)
    .normalize();

  const worldRotation = new THREE.Quaternion().setFromUnitVectors(
    currentAxisDirection,
    targetDirection,
  );

  group.quaternion.premultiply(worldRotation).normalize();
  group.updateMatrixWorld(true);
}
