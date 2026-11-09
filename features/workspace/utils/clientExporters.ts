import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';

export type ClientSupportedExportFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'ply';

/**
 * Exports a Three.js Object3D into a binary or text Blob directly in the browser.
 */
export async function exportThreeObject(
  object: THREE.Object3D,
  format: ClientSupportedExportFormat
): Promise<Blob> {
  const normFormat = format.toLowerCase() as ClientSupportedExportFormat;

  switch (normFormat) {
    case 'glb': {
      const exporter = new GLTFExporter();
      const gltf = await exporter.parseAsync(object, { binary: true });
      if (gltf instanceof ArrayBuffer) {
        return new Blob([gltf], { type: 'model/gltf-binary' });
      }
      throw new Error('GLTFExporter failed to generate binary GLB data');
    }

    case 'gltf': {
      const exporter = new GLTFExporter();
      const gltf = await exporter.parseAsync(object, { binary: false });
      const jsonStr = typeof gltf === 'string' ? gltf : JSON.stringify(gltf, null, 2);
      return new Blob([jsonStr], { type: 'application/json' });
    }

    case 'obj': {
      const exporter = new OBJExporter();
      const output = exporter.parse(object);
      return new Blob([output], { type: 'text/plain' });
    }

    case 'stl': {
      const exporter = new STLExporter();
      const output = exporter.parse(object, { binary: true });
      if (typeof output === 'string') {
        return new Blob([output], { type: 'text/plain' });
      }
      return new Blob([output], { type: 'application/octet-stream' });
    }

    case 'ply': {
      const exporter = new PLYExporter();
      return new Promise<Blob>((resolve, reject) => {
        try {
          let resolved = false;
          const doneHandler = (output: string | ArrayBuffer) => {
            if (resolved) return;
            resolved = true;
            if (output instanceof ArrayBuffer) {
              resolve(new Blob([output], { type: 'application/octet-stream' }));
            } else {
              resolve(new Blob([output], { type: 'text/plain' }));
            }
          };

          const direct = exporter.parse(object, doneHandler, { binary: true });
          if (direct && !resolved) {
            doneHandler(direct);
          }
        } catch (err) {
          reject(err);
        }
      });
    }

    default:
      throw new Error(`Unsupported client export format: ${format}`);
  }
}

/**
 * Triggers an instant browser download of a generated Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Combined helper: Exports a Three.js object and triggers browser download.
 */
export async function triggerClientExport(
  object: THREE.Object3D,
  format: ClientSupportedExportFormat,
  filename: string
): Promise<void> {
  const blob = await exportThreeObject(object, format);
  downloadBlob(blob, filename);
}
