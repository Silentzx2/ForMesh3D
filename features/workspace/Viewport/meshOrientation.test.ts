import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { orientMeshAxisToView } from './meshOrientation';
import type { MeshOrientationAxis } from './viewportEvents';

const AXES: Array<[MeshOrientationAxis, THREE.Vector3]> = [
  ['positive-x', new THREE.Vector3(1, 0, 0)],
  ['negative-x', new THREE.Vector3(-1, 0, 0)],
  ['positive-y', new THREE.Vector3(0, 1, 0)],
  ['negative-y', new THREE.Vector3(0, -1, 0)],
  ['positive-z', new THREE.Vector3(0, 0, 1)],
  ['negative-z', new THREE.Vector3(0, 0, -1)],
];

describe('orientMeshAxisToView', () => {
  for (const [axis, localDirection] of AXES) {
    it(`points ${axis} toward the current view without changing the view direction`, () => {
      const group = new THREE.Group();
      group.quaternion.setFromEuler(new THREE.Euler(0.37, -0.61, 0.23));

      const cameraDirection = new THREE.Vector3(0.31, 0.72, 0.62).normalize();
      const originalCameraDirection = cameraDirection.clone();

      orientMeshAxisToView(group, axis, cameraDirection);

      const resultingAxis = localDirection.clone().applyQuaternion(group.quaternion).normalize();
      assert.ok(resultingAxis.dot(cameraDirection) > 0.999999);
      assert.ok(cameraDirection.distanceTo(originalCameraDirection) < 1e-12);
      assert.ok(Math.abs(group.quaternion.length() - 1) < 1e-12);
    });
  }

  it('ignores a zero-length view direction', () => {
    const group = new THREE.Group();
    group.rotation.set(0.2, 0.4, -0.3);
    const originalQuaternion = group.quaternion.clone();

    orientMeshAxisToView(group, 'positive-x', new THREE.Vector3());

    assert.ok(group.quaternion.angleTo(originalQuaternion) < 1e-12);
  });
});
