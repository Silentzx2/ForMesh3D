/**
 * Mesh Processing Bridge — Unified Dispatcher & Extensible Script Registry
 * 
 * Bridges studio UI panels with both:
 * 1. ⚡ Neural AI Models (GPU Scheduled via FastAPI / Multiprocess Scheduler)
 * 2. 🛠️ Classic Algorithmic Scripts (Python / Trimesh / XAtlas / Headless Blender via SSE)
 * 
 * Adding a new Python or Blender script in the future is 100% plug-and-play:
 * simply call `registerScript(...)` or add to `DEFAULT_SCRIPTS`.
 */

import { ModelAsset } from '../types';

export type EngineMode = 'ai' | 'script';
export type ToolType = 'remesh' | 'uv' | 'segment';

export interface ScriptDefinition {
  id: string;
  name: string;
  tool: ToolType;
  engine: EngineMode;
  description: string;
  requiresGpu: boolean;
  endpoint: string;
  defaultParams: Record<string, any>;
}

// Extensible Script Registry
const SCRIPT_REGISTRY: Map<string, ScriptDefinition> = new Map();

// Canonical default engines & scripts registered in the bridge
export const DEFAULT_SCRIPTS: ScriptDefinition[] = [
  // --- RETOPOLOGY ---
  {
    id: 'fastmesh_neural',
    name: 'FastMesh Neural Retopology (V1K)',
    tool: 'remesh',
    engine: 'ai',
    description: 'FastMesh V1K checkpoint with fixed output of approximately 1K vertices.',
    requiresGpu: true,
    endpoint: '/api/v1/mesh-retopology/retopologize-mesh',
    defaultParams: { variant: 'V1K' },
  },
  {
    id: 'trimesh_autoretopo',
    name: 'Trimesh AutoRetopo & Taubin Smoothing',
    tool: 'remesh',
    engine: 'script',
    description: 'Fast CPU-based isotropic remesher with curvature-adaptive surface drift gates.',
    requiresGpu: false,
    endpoint: '/api/v1/mesh-tools/auto-retopo',
    defaultParams: { target_faces: 50000, quads: true, watertight: false, adaptive: true },
  },

  // --- SMART UV ---
  {
    id: 'partuv_neural',
    name: 'PartUV Deep Island Unwrapper',
    tool: 'uv',
    engine: 'ai',
    description: 'Neural boundary and packing optimizer for dense organic characters.',
    requiresGpu: true,
    endpoint: '/api/v1/mesh-uv-unwrapping/unwrap-mesh',
    defaultParams: { distortion_threshold: 1.25, unwrap_strategy: 'hybrid', atlas_resolution: 2048 },
  },
  {
    id: 'xatlas_fast',
    name: 'XAtlas Native C++/Python Atlas',
    tool: 'uv',
    engine: 'script',
    description: 'Ultra-fast, zero-GPU seam generation and non-overlapping chart packing.',
    requiresGpu: false,
    endpoint: '/api/v1/mesh-tools/auto-uv',
    defaultParams: { resolution: 2048, padding_texels: 4, method: 'xatlas' },
  },
  {
    id: 'blender_smart_uv',
    name: 'Blender Smart UV Project',
    tool: 'uv',
    engine: 'script',
    description: 'Headless Blender operator projecting islands based on dihedral angle thresholds.',
    requiresGpu: false,
    endpoint: '/api/v1/mesh-tools/auto-uv',
    defaultParams: { resolution: 2048, padding_texels: 4, method: 'auto', max_cone_deg: 66.0 },
  },

  // --- SEGMENTATION ---
  {
    id: 'neural_part_seg',
    name: 'Neural Semantic Part Segmentation',
    tool: 'segment',
    engine: 'ai',
    description: 'Deep learning semantic part parsing with hierarchical anatomical labeling.',
    requiresGpu: true,
    endpoint: '/api/v1/mesh-segmentation/segment-mesh',
    defaultParams: { num_parts: 8, output_format: 'glb' },
  },
  {
    id: 'trimesh_decomposition',
    name: 'Trimesh Geometric Decomposition',
    tool: 'segment',
    engine: 'script',
    description: 'Curvature, thickness SDF and connected component part clustering on CPU.',
    requiresGpu: false,
    endpoint: '/api/v1/mesh-tools/segment',
    defaultParams: { num_parts: 8 },
  },
];

// Initialize default scripts
DEFAULT_SCRIPTS.forEach((s) => SCRIPT_REGISTRY.set(s.id, s));

/**
 * Register a new Python or Blender script dynamically in 1 line
 */
export function registerCustomScript(script: ScriptDefinition): void {
  SCRIPT_REGISTRY.set(script.id, script);
}

/**
 * Query registered scripts for a given tool and engine mode
 */
export function getRegisteredScripts(tool: ToolType, engine?: EngineMode): ScriptDefinition[] {
  const all = Array.from(SCRIPT_REGISTRY.values()).filter((s) => s.tool === tool);
  return engine ? all.filter((s) => s.engine === engine) : all;
}

export interface ExecutionOptions {
  tool: ToolType;
  engine: EngineMode;
  scriptId?: string;
  meshFile?: File | Blob;
  meshUrl?: string;
  meshRef?: { mesh_file_id?: string; mesh_path?: string };
  params: Record<string, any>;
  onProgress?: (step: string, percent: number, stage?: string) => void;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  success: boolean;
  modelUrl: string;
  format: string;
  stats?: Record<string, any>;
  previewUrl?: string;
}

/**
 * Single unified dispatcher: executes either Neural AI (GPU scheduler) or Script (Python/Blender SSE)
 */
export async function executeMeshOperation(options: ExecutionOptions): Promise<ExecutionResult> {
  const { tool, engine, scriptId, meshFile, meshUrl, meshRef, params, onProgress, onLog, signal } = options;

  if (signal?.aborted) {
    throw new Error('Operation cancelled by user');
  }

  try {
    onProgress?.(
      engine === 'ai' ? 'Submitting to GPU Model Scheduler...' : 'Executing Python Algorithmic Script...',
      15
    );

    // 1. PYTHON / BLENDER SCRIPT MODE (Direct Fast SSE Route)
    if (engine === 'script') {
      let fileToUpload: File | Blob | null = meshFile || null;

      // If meshFile wasn't provided directly as a File/Blob, fetch from URL
      if (!fileToUpload && meshUrl) {
        onProgress?.('Fetching mesh buffer for script processing...', 25);
        const res = await fetch(meshUrl, { signal });
        if (!res.ok) throw new Error(`Failed to read mesh file for script: ${res.statusText}`);
        fileToUpload = await res.blob();
      }

      if (!fileToUpload) {
        throw new Error('Mesh file buffer is required for Python/Blender script execution.');
      }

      const endpoint =
        tool === 'remesh'
          ? '/api/v1/mesh-tools/auto-retopo'
          : tool === 'uv'
          ? '/api/v1/mesh-tools/auto-uv'
          : '/api/v1/mesh-tools/segment';

      // Format options payload according to backend schema
      let scriptOptions: Record<string, any> = {};
      if (tool === 'remesh') {
        scriptOptions = {
          target_faces: Number(params.targetPolycount ?? params.target_faces ?? 50000),
          quads: params.polyType === 'quad' || params.quads === true,
          watertight: params.watertight === true,
          adaptive: params.adaptive !== false,
          ...(params.featureAngle !== undefined || params.feature_angle !== undefined
            ? { feature_angle: Number(params.featureAngle ?? params.feature_angle) }
            : {}),
          preserve_features: params.preserveEdges !== false,
        };
      } else if (tool === 'uv') {
        scriptOptions = {
          resolution: Number(params.atlasResolution || params.resolution || 2048),
          padding_texels: Number(params.islandMargin || params.padding_texels || 4),
          method: params.packMethod === 'blender' ? 'auto' : 'xatlas',
          max_cone_deg: params.unwrapStrategy === 'organic' ? 60.0 : 45.0,
        };
      } else if (tool === 'segment') {
        scriptOptions = {
          num_parts: Number(params.numParts ?? params.num_parts ?? 8),
          ...(params.proxyFaces !== undefined || params.proxy_faces !== undefined
            ? { proxy_faces: Number(params.proxyFaces ?? params.proxy_faces) }
            : {}),
          ...(params.sdfRays !== undefined || params.sdf_rays !== undefined
            ? { sdf_rays: Number(params.sdfRays ?? params.sdf_rays) }
            : {}),
        };
      }

      const formData = new FormData();
      formData.append(
        'meshFile',
        fileToUpload instanceof File ? fileToUpload : new File([fileToUpload], 'input_mesh.glb', { type: 'model/gltf-binary' })
      );
      formData.append('options', JSON.stringify(scriptOptions));
      formData.append('format', 'glb');

      onProgress?.('Streaming Python script execution...', 45);

      const sseResponse = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        signal,
      });

      if (!sseResponse.ok) {
        const errText = await sseResponse.text();
        throw new Error(`Script processing failed: ${errText || sseResponse.statusText}`);
      }

      // Stream SSE Response chunks
      const reader = sseResponse.body?.getReader();
      if (!reader) throw new Error('SSE stream body not readable');

      const decoder = new TextDecoder();
      let doneResult: any = null;
      let buffer = '';

      while (true) {
        if (signal?.aborted) {
          try { await reader.cancel(); } catch {}
          throw new Error('Operation cancelled by user');
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.replace(/^data:\s*/, ''));
              if (data.type === 'progress') {
                onProgress?.(data.message || 'Processing script...', Math.round((data.frac || 0.5) * 100), data.stage);
                if (typeof data.log === 'string' && data.log.length > 0) {
                  onLog?.(data.log);
                }
              } else if (data.type === 'done') {
                doneResult = data;
              } else if (data.type === 'error') {
                throw new Error(data.detail || 'Script encountered an error');
              }
            } catch (e: any) {
              if (e.message?.includes('Script encountered') || e.message?.includes('Operation cancelled')) throw e;
            }
          }
        }
      }

      if (!doneResult || !doneResult.mesh_b64) {
        throw new Error('Script execution completed without returning valid output geometry.');
      }

      // Reconstruct GLB Blob from base64
      const byteChars = atob(doneResult.mesh_b64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNums);
      const blob = new Blob([byteArray], { type: 'model/gltf-binary' });
      const localUrl = URL.createObjectURL(blob);

      onProgress?.('Presenting generated mesh in 3D viewport...', 100);

      return {
        success: true,
        modelUrl: localUrl,
        format: doneResult.format || 'glb',
        stats: doneResult.stats,
        previewUrl: doneResult.preview_b64 ? `data:image/png;base64,${doneResult.preview_b64}` : undefined,
      };
    }

    // 2. NEURAL AI MODE (Dispatched via Scheduler Router)
    const aiEndpoint =
      tool === 'remesh'
        ? '/api/v1/mesh-retopology/retopologize-mesh'
        : tool === 'uv'
        ? '/api/v1/mesh-uv-unwrapping/unwrap-mesh'
        : '/api/v1/mesh-segmentation/segment-mesh';

    const body: Record<string, any> = {
      output_format: 'glb',
      ...meshRef,
      ...params,
    };

    const res = await fetch(aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.detail || errData?.message || `AI Job creation failed with HTTP ${res.status}`);
    }

    const data = await res.json();
    const jobId = data.job_id || data.id;
    if (!jobId) throw new Error('AI Scheduler did not return a valid Job ID');

    onProgress?.(`AI Job queued on GPU (ID: ${jobId.slice(0, 8)})...`, 35);

    return {
      success: true,
      modelUrl: '', // Will be resolved by WorkspaceContext polling
      format: 'glb',
      stats: { jobId },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted || err?.message?.toLowerCase().includes('abort') || err?.message === 'Operation cancelled by user') {
      throw new Error('Operation cancelled by user');
    }
    throw err;
  }
}
