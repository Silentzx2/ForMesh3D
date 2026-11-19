/**
 * Mesh Processing Bridge — Unified Dispatcher & Extensible Script Registry
 * 
 * Bridges studio UI panels with both:
 * 1. ⚡ Neural AI Models (GPU Scheduled via FastAPI / Multiprocess Scheduler)
 * 2. 🛠️ Classic Algorithmic Scripts (Python / Trimesh / XAtlas / Headless Blender via canonical JSON APIs)
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
    endpoint: '/api/v1/retopo',
    defaultParams: { variant: 'V1K' },
  },
  {
    id: 'trimesh_autoretopo',
    name: 'Trimesh AutoRetopo & Taubin Smoothing',
    tool: 'remesh',
    engine: 'script',
    description: 'Fast CPU-based isotropic remesher with curvature-adaptive surface drift gates.',
    requiresGpu: false,
    endpoint: '/api/v1/retopo',
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
    endpoint: '/api/v1/unwrap',
    defaultParams: { distortion_threshold: 1.25, unwrap_strategy: 'hybrid', atlas_resolution: 2048 },
  },
  {
    id: 'xatlas_fast',
    name: 'XAtlas Native C++/Python Atlas',
    tool: 'uv',
    engine: 'script',
    description: 'Ultra-fast, zero-GPU seam generation and non-overlapping chart packing.',
    requiresGpu: false,
    endpoint: '/api/v1/unwrap',
    defaultParams: { resolution: 2048, padding_texels: 4, method: 'xatlas' },
  },
  {
    id: 'blender_smart_uv',
    name: 'Blender Smart UV Project',
    tool: 'uv',
    engine: 'script',
    description: 'Headless Blender operator projecting islands based on dihedral angle thresholds.',
    requiresGpu: false,
    endpoint: '/api/v1/unwrap',
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
    endpoint: '/api/v1/segment',
    defaultParams: { num_parts: 8, output_format: 'glb' },
  },
  {
    id: 'trimesh_decomposition',
    name: 'Trimesh Geometric Decomposition',
    tool: 'segment',
    engine: 'script',
    description: 'Curvature, thickness SDF and connected component part clustering on CPU.',
    requiresGpu: false,
    endpoint: '/api/v1/segment',
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
  workspaceId?: string;
  parentOperationId?: string;
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
  jobId?: string;
  workspaceId?: string;
  operationId?: string;
}

/**
 * Single unified dispatcher: executes either Neural AI (GPU scheduler) or direct Python/Blender Script pipelines
 */
export async function executeMeshOperation(options: ExecutionOptions): Promise<ExecutionResult> {
  const { tool, engine, scriptId, meshFile, meshUrl, meshRef, workspaceId, parentOperationId, params, onProgress, onLog, signal } = options;

  if (signal?.aborted) {
    throw new Error('Operation cancelled by user');
  }

  try {
    onProgress?.(
      engine === 'ai' ? 'Submitting to GPU Model Scheduler...' : 'Executing Python Algorithmic Script...',
      15
    );

    // 1. DETERMINISTIC SCRIPT MODE (canonical JSON routes; no AI scheduler)
    if (engine === 'script') {
      if (!workspaceId) {
        throw new Error('Script operations require an active workspace.');
      }

      const scriptDef = scriptId ? SCRIPT_REGISTRY.get(scriptId) : undefined;
      const endpoint = scriptDef?.endpoint ?? (tool === 'remesh'
        ? '/api/v1/retopo'
        : tool === 'uv'
        ? '/api/v1/unwrap'
        : '/api/v1/segment');

      let scriptOptions: Record<string, any> = {
        ...(scriptDef?.defaultParams ?? {}),
        workspace_id: workspaceId,
        parent_operation_id: parentOperationId,
      };

      if (tool === 'remesh') {
        scriptOptions = {
          ...scriptOptions,
          target_polycount: Number(params.targetPolycount ?? params.target_faces ?? 50000),
          poly_type: params.polyType === 'quad' || params.quads === true ? 'quad' : 'tri',
          preserve_features: params.preserveEdges !== false,
          feature_angle: Number(params.featureAngle ?? params.feature_angle ?? 45),
          adaptive: params.adaptiveDensity ?? params.adaptive ?? true,
          watertight: params.watertightHealing ?? params.watertight ?? false,
          output_format: params.outputFormat || 'glb',
        };
      } else if (tool === 'uv') {
        scriptOptions = {
          ...scriptOptions,
          atlas_resolution: Number(params.atlasResolution || params.resolution || 2048),
          island_margin: Number(params.islandMargin ?? params.padding_texels ?? 4),
          pack_method: params.packMethod === 'blender' || scriptId === 'blender_smart_uv'
            ? 'blender'
            : params.packMethod === 'auto' ? 'auto' : 'xatlas',
          max_cone_deg: Number(params.maxConeDeg ?? params.max_cone_deg ?? 66),
          unwrap_strategy: params.unwrapStrategy || 'hybrid',
          save_individual_parts: Boolean(params.saveIndividualParts),
          output_format: params.outputFormat || 'glb',
        };
      } else if (tool === 'segment') {
        scriptOptions = {
          ...scriptOptions,
          num_parts: Number(params.numParts ?? params.num_parts ?? 8),
          method: params.method || 'geometric',
          hierarchical: Boolean(params.hierarchical),
          colorize_preview: params.colorizePreview !== false,
          save_individual_parts: Boolean(params.saveIndividualParts),
          output_format: params.outputFormat || 'glb',
        };
      }

      onProgress?.('Submitting deterministic pipeline...', 35);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(meshRef || {}),
          ...scriptOptions,
          engine: 'script',
        }),
        signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || data?.message || `Script processing failed with HTTP ${response.status}`);
      }
      if (!data.operation_id || !data.preview_url) {
        throw new Error('Script API did not return a durable operation ID and preview URL.');
      }

      onProgress?.('Loading staged workspace preview...', 90);
      return {
        success: true,
        modelUrl: data.preview_url,
        previewUrl: data.preview_url,
        format: data.format || 'glb',
        stats: data.stats,
        workspaceId: data.workspace_id || workspaceId,
        operationId: data.operation_id,
        jobId: data.job_id || data.operation_id,
      };
    }

    // 2. NEURAL AI MODE (Dispatched via Scheduler Router)
    const aiEndpoint =
      tool === 'remesh'
        ? '/api/v1/retopo'
        : tool === 'uv'
        ? '/api/v1/unwrap'
        : '/api/v1/segment';

    const body: Record<string, any> = {
      output_format: 'glb',
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      ...(parentOperationId ? { parent_operation_id: parentOperationId } : {}),
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
    onLog?.(`AI Job queued on GPU (ID: ${jobId.slice(0, 8)})`);

    return {
      success: true,
      modelUrl: '', // Will be resolved by WorkspaceContext polling
      format: 'glb',
      jobId,
      workspaceId: data.workspace_id || workspaceId,
      operationId: data.operation_id,
      stats: { jobId },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted || err?.message?.toLowerCase().includes('abort') || err?.message === 'Operation cancelled by user') {
      throw new Error('Operation cancelled by user');
    }
    throw err;
  }
}
