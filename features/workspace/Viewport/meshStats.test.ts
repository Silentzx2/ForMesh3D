import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectMeshStats } from './meshStats';

describe('collectMeshStats', () => {
  it('counts indexed faces, vertices, unique edges and material instances', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const material = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));

    const stats = collectMeshStats(group);

    assert.equal(stats?.vertices, 4);
    assert.equal(stats?.triangles, 2);
    assert.equal(stats?.edges, 5);
    assert.equal(stats?.materials, 1);
    assert.deepEqual(stats?.dimensions, { x: 1, y: 1, z: 0 });

    geometry.dispose();
    material.dispose();
  });

  it('deduplicates coincident positions when counting non-indexed edges', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 1, 0, 0, 1, 0,
    ], 3));
    const material = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));

    const stats = collectMeshStats(group);

    assert.equal(stats?.vertices, 6);
    assert.equal(stats?.triangles, 2);
    assert.equal(stats?.edges, 5);

    geometry.dispose();
    material.dispose();
  });

  it('counts instanced geometry once per instance', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    const material = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.add(new THREE.InstancedMesh(geometry, material, 2));

    const stats = collectMeshStats(group);

    assert.equal(stats?.vertices, 6);
    assert.equal(stats?.triangles, 2);
    assert.equal(stats?.edges, 6);
    assert.equal(stats?.materials, 1);

    geometry.dispose();
    material.dispose();
  });
});
