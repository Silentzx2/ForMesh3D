import * as THREE from 'three';
import type { ModelMeshStats } from '@/stores/useViewerStore';

const MAX_EDGE_STAT_FACES = 250_000;

function countUniqueGeometryEdges(geometry: THREE.BufferGeometry): number | null {
  const position = geometry.getAttribute('position');
  if (!position) return null;

  const index = geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  const drawStart = Math.min(geometry.drawRange.start, elementCount);
  const drawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.min(geometry.drawRange.count, elementCount - drawStart)
    : elementCount - drawStart;
  if (Math.floor(drawCount / 3) > MAX_EDGE_STAT_FACES) return null;

  const stride = position.count + 1;
  if (!Number.isSafeInteger(position.count * stride)) return null;

  const vertexIds = index ? null : new Map<string, number>();
  const edges = new Set<number>();

  const vertexId = (elementOffset: number): number => {
    if (index) return index.getX(elementOffset);

    const key = `${position.getX(elementOffset)},${position.getY(elementOffset)},${position.getZ(elementOffset)}`;
    const existing = vertexIds!.get(key);
    if (existing !== undefined) return existing;

    const next = vertexIds!.size;
    vertexIds!.set(key, next);
    return next;
  };

  const addEdge = (first: number, second: number) => {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    edges.add(low * stride + high);
  };

  const end = drawStart + drawCount;
  for (let offset = drawStart; offset + 2 < end; offset += 3) {
    const a = vertexId(offset);
    const b = vertexId(offset + 1);
    const c = vertexId(offset + 2);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  return edges.size;
}

/**
 * Read mesh statistics from the loaded Three.js scene before MeshViewer
 * recenters/scales it for presentation.
 */
export function collectMeshStats(object: THREE.Object3D): ModelMeshStats | null {
  const geometryInstances = new Map<THREE.BufferGeometry, number>();
  const materials = new Set<THREE.Material>();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const instanceCount = child instanceof THREE.InstancedMesh ? child.count : 1;
    geometryInstances.set(
      child.geometry,
      (geometryInstances.get(child.geometry) ?? 0) + instanceCount,
    );

    const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
    meshMaterials.forEach((material) => {
      if (material) materials.add(material);
    });
  });

  if (geometryInstances.size === 0) return null;

  let vertices = 0;
  let triangles = 0;
  let totalFaces = 0;

  for (const [geometry, instances] of geometryInstances) {
    const position = geometry.getAttribute('position');
    if (!position || instances <= 0) continue;

    const faces = Math.floor((geometry.getIndex()?.count ?? position.count) / 3);
    vertices += position.count * instances;
    triangles += faces * instances;
    totalFaces += faces * instances;
  }

  if (vertices === 0 && triangles === 0) return null;

  let edges: number | undefined;
  // ponytail: cap edge enumeration at 250K faces to bound UI-thread work and memory;
  // move this metric to a worker/native mesh-stat path if larger exact counts are required.
  if (totalFaces <= MAX_EDGE_STAT_FACES) {
    let edgeTotal = 0;
    let allEdgesAvailable = true;

    for (const [geometry, instances] of geometryInstances) {
      const geometryEdges = countUniqueGeometryEdges(geometry);
      if (geometryEdges === null) {
        allEdgesAvailable = false;
        break;
      }
      edgeTotal += geometryEdges * instances;
    }

    if (allEdgesAvailable) edges = edgeTotal;
  }

  const bounds = new THREE.Box3().setFromObject(object);
  const dimensions = bounds.isEmpty()
    ? new THREE.Vector3()
    : bounds.getSize(new THREE.Vector3());

  return {
    vertices,
    triangles,
    dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
    ...(edges !== undefined ? { edges } : {}),
    materials: materials.size,
  };
}
