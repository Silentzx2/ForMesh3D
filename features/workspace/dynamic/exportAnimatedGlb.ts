import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export interface ExportAnimatedGlbOptions {
  activeModelObject: THREE.Object3D | null;
  activeThreeClip: THREE.AnimationClip | null;
}

export async function exportAnimatedModelAsGlb({
  activeModelObject,
  activeThreeClip,
}: ExportAnimatedGlbOptions): Promise<Blob> {
  if (!activeModelObject) throw new Error('No active 3D model available to export.');
  if (!activeThreeClip) throw new Error('No active motion clip is bound to the selected rig.');

  const exporter = new GLTFExporter();
  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      activeModelObject,
      (gltf) => {
        if (!(gltf instanceof ArrayBuffer)) {
          reject(new Error('GLTFExporter did not return a binary GLB payload.'));
          return;
        }
        resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
      },
      reject,
      { binary: true, animations: [activeThreeClip] },
    );
  });
}

export function downloadAnimatedGlb(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.glb') ? filename : filename + '.glb';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
