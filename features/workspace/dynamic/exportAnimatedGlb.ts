import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { downloadArtifact } from '../lib/artifactDownload';

export interface ExportAnimatedGlbOptions {
  activeModelObject: THREE.Object3D | null;
  activeThreeClip: THREE.AnimationClip | null;
  assetId?: string | null;
  assetName?: string | null;
}

export async function exportAnimatedModelAsGlb({
  activeModelObject,
  activeThreeClip,
  assetId,
  assetName,
}: ExportAnimatedGlbOptions): Promise<void> {
  const filename = `${assetName || 'motion_clip'}.glb`;

  // If no custom Three clip is bound client-side, try backend GLB artifact download first
  if (!activeThreeClip && assetId) {
    try {
      await downloadArtifact(
        `/api/v1/system/jobs/${encodeURIComponent(assetId)}/download?artifact_format=glb`,
        filename,
        'glb'
      );
      return;
    } catch {
      // Fall through to client GLTFExporter
    }
  }

  if (!activeModelObject) {
    throw new Error('No active 3D model available to export.');
  }

  const animations: THREE.AnimationClip[] = activeThreeClip
    ? [activeThreeClip]
    : activeModelObject.animations?.length
      ? activeModelObject.animations
      : [];

  const exporter = new GLTFExporter();
  await new Promise<void>((resolve, reject) => {
    exporter.parse(
      activeModelObject,
      (gltf) => {
        const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
        resolve();
      },
      reject,
      { binary: true, animations }
    );
  });
}
