/**
 * Mesh Processing Bridge — Unified Dispatcher
 * 
 * Bridges studio UI panels with Neural AI Models (GPU Scheduled via FastAPI / Multiprocess Scheduler).
 */

import { ModelAsset } from '../types';

export type EngineMode = 'ai';
export type ToolType = 'remesh' | 'uv' | 'segment';

export interface ExecutionOptions {
  tool: ToolType;
  engine: EngineMode;
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
  assetId?: string;
}

/**
 * Single unified dispatcher: executes Neural AI via GPU scheduler
 */
export async function executeMeshOperation(options: ExecutionOptions): Promise<ExecutionResult> {
  const { tool, engine, meshFile, meshUrl, meshRef, workspaceId, parentOperationId, params, onProgress, onLog, signal } = options;

  if (signal?.aborted) {
    throw new Error('Operation cancelled by user');
  }

  try {
    onProgress?.('Submitting to GPU Model Scheduler...', 15);

    // NEURAL AI MODE (Dispatched via Scheduler Router)
    const aiEndpoint =
      tool === 'remesh'
        ? '/api/v1/retopo'
        : tool === 'uv'
        ? '/api/v1/unwrap'
        : '/api/v1/segment';

    const defaultModelPref =
      tool === 'segment'
        ? 'partfield_segmentation'
        : tool === 'uv'
        ? 'partuv_uv_unwrapping'
        : 'triflow_retopology';

    const body: Record<string, any> = {
      output_format: params.outputFormat || 'glb',
      target_polycount: Number(params.targetPolycount ?? params.target_faces ?? 50000),
      poly_type: params.polyType === 'quad' || params.quads === true ? 'quad' : 'tri',
      preserve_features: params.preserveEdges !== false,
      feature_angle: Number(params.featureAngle ?? params.feature_angle ?? 45),
      adaptive: params.adaptiveDensity ?? params.adaptive ?? true,
      watertight: params.watertightHealing ?? params.watertight ?? false,
      model_preference: params.model_preference || defaultModelPref,
      ...(tool === 'segment' ? {
        num_parts: Number(params.numParts ?? params.num_parts ?? 8),
        method: params.method || 'semantic',
        hierarchical: Boolean(params.hierarchical),
        min_face_island_threshold: Number(params.minFaceIslandThreshold ?? params.min_face_island_threshold ?? 50),
        colorize_preview: params.colorizePreview !== false,
        save_individual_parts: Boolean(params.saveIndividualParts),
      } : {}),
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
