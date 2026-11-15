/**
 * Build generation parameters for model inference.
 * Pure function - no React dependencies, fully testable.
 *
 * Output settings and production budgets are separated from adapter inference.
 * Adapter-owned inference profiles are authoritative.
 */

import type { GenerationSettings } from '../types.ts';

export interface ModelCapabilities {
  raw_mesh?: boolean;
  paint_autochain?: boolean;
  supports_texture?: boolean;
}

/** Native target triangle capability classification per model. */
export type NativeTargetCapability =
  | 'NATIVE_EXACT_TARGET'        // Upstream accepts exact face/triangle target
  | 'NATIVE_TARGET_APPROXIMATE'  // Upstream accepts approximate face target
  | 'NATIVE_MAX_LIMIT'           // Upstream accepts max face limit (post-process only)
  | 'NATIVE_INDIRECT_CONTROL'    // Upstream has indirect resolution control (octree, etc.)
  | 'UNSUPPORTED'                // No native face/vertex count control
  | 'UNVERIFIED';                // Capability not yet verified

/** Mapping from user target triangles to model's native parameter. */
export interface NativeTargetMapping {
  capability: NativeTargetCapability;
  /** The native parameter name (e.g., 'vertex_count', 'octree_resolution', 'faces') */
  parameterName: string | null;
  /** The native parameter value to pass */
  parameterValue: number | null;
  /** Unit of the native parameter */
  parameterUnit: 'vertices' | 'faces' | 'triangles' | 'resolution' | null;
  /** Human-readable semantics */
  semantics: string;
  /** Whether this mapping reaches upstream generation (vs post-process only) */
  reachesUpstream: boolean;
  /** Evidence source for this mapping */
  evidence: string;
}

/** Map a user triangle target into a model's native parameter value. */
type NativeTargetMapValue = (triangles: number) => number | string | null;

/** Extended native target mapping with a value converter. */
export interface NativeTargetMappingEx extends NativeTargetMapping {
  mapValue?: NativeTargetMapValue;
}

/** Per-model native target capability registry (evidence-backed, Part I §4 research gate). */
const NATIVE_TARGET_REGISTRY: Record<string, NativeTargetMappingEx> = {
  stable_fast_3d_image_to_textured_mesh: {
    capability: 'NATIVE_INDIRECT_CONTROL',
    parameterName: 'vertex_count',
    parameterUnit: 'vertices',
    semantics: 'Indirect triangle budget via vertex_count; upstream treats it as a resolution hint, exact triangle output not guaranteed.',
    reachesUpstream: true,
    evidence: 'Adapter derives vertex_count = native_target_polycount // 2 and passes to upstream SF3D generation pipeline (target_vertex_count).',
    mapValue: (triangles) => Math.max(100, Math.floor(triangles / 2)),
  },
  triposg_image_to_raw_mesh: {
    capability: 'NATIVE_MAX_LIMIT',
    parameterName: 'faces',
    parameterUnit: 'faces',
    semantics: 'Upstream `faces` is a decimation cap / maximum face limit applied post-generation, not a native generation-time triangle target.',
    reachesUpstream: false,
    evidence: 'TripoSG adapter maps native_target_polycount to upstream `faces` only when enable_postprocess is true; count forcing removed from the raw path.',
    mapValue: (triangles) => triangles,
  },
  hunyuan3d_shape_v21_image_to_raw_mesh: {
    capability: 'NATIVE_INDIRECT_CONTROL',
    parameterName: 'octree_resolution',
    parameterUnit: 'resolution',
    semantics: 'Indirect detail control via octree_resolution; does not specify a final triangle count.',
    reachesUpstream: true,
    evidence: 'Hunyuan3D-2.1 uses octree_resolution as a generation-time resolution hint; no direct face-count parameter exists.',
    mapValue: (triangles) => Math.min(512, Math.max(160, Math.round(Math.sqrt(triangles / 1000)) * 16)),
  },
  hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh: {
    capability: 'NATIVE_INDIRECT_CONTROL',
    parameterName: 'octree_resolution',
    parameterUnit: 'resolution',
    semantics: 'Indirect detail control via octree_resolution; does not specify a final triangle count.',
    reachesUpstream: true,
    evidence: 'Hunyuan3D Mini Turbo uses octree_resolution as a generation-time resolution hint; no direct face-count parameter exists.',
    mapValue: (triangles) => Math.min(512, Math.max(160, Math.round(Math.sqrt(triangles / 1000)) * 16)),
  },
  pixal3d_image_to_raw_mesh: {
    capability: 'NATIVE_INDIRECT_CONTROL',
    parameterName: 'pipeline_type',
    parameterUnit: null,
    semantics: 'Indirect detail control via pipeline_type preset; does not specify a final triangle count.',
    reachesUpstream: true,
    evidence: 'Pixal3D exposes pipeline_type presets as indirect resolution controls; no direct face-count parameter exists.',
    mapValue: () => '1536_cascade',
  },
  trellis_image_to_raw_mesh: {
    capability: 'UNSUPPORTED',
    parameterName: null,
    parameterUnit: null,
    semantics: 'No native face-count parameter; target is logged only, never enforced.',
    reachesUpstream: false,
    evidence: 'TRELLIS upstream path exposes no direct generation-time face-count control.',
  },
  trellis2_image_to_raw_mesh: {
    capability: 'UNSUPPORTED',
    parameterName: null,
    parameterUnit: null,
    semantics: 'No native face-count parameter; target is logged only, never enforced.',
    reachesUpstream: false,
    evidence: 'TRELLIS.2 upstream path exposes no direct generation-time face-count control.',
  },
  unique3d_image_to_raw_mesh: {
    capability: 'UNSUPPORTED',
    parameterName: null,
    parameterUnit: null,
    semantics: 'No native face-count parameter; target is logged only, never enforced.',
    reachesUpstream: false,
    evidence: 'Unique3D upstream path exposes no direct generation-time face-count control.',
  },
  taoflowforge_image_to_raw_mesh: {
    capability: 'UNVERIFIED',
    parameterName: null,
    parameterUnit: null,
    semantics: 'target_num_vertices is unwired; capability not yet verified.',
    reachesUpstream: false,
    evidence: 'TaoFlowForge target_num_vertices exists but is not connected to generation.',
  },
};

/** Resolve the native target capability for a model, defaulting to UNVERIFIED. */
export function getNativeTargetCapability(modelId: string): NativeTargetMapping {
  const entry = NATIVE_TARGET_REGISTRY[modelId];
  if (!entry) {
    return {
      capability: 'UNVERIFIED',
      parameterName: null,
      parameterValue: null,
      parameterUnit: null,
      semantics: 'No verified native count control for this model; target is reported only, not applied.',
      reachesUpstream: false,
      evidence: 'No research data available',
    };
  }
  return {
    capability: entry.capability,
    parameterName: entry.parameterName ?? null,
    parameterValue: entry.mapValue ? entry.mapValue(0) : null,
    parameterUnit: entry.parameterUnit ?? null,
    semantics: entry.semantics,
    reachesUpstream: entry.reachesUpstream,
    evidence: entry.evidence,
    // mapValue is attached at runtime so callers can convert a user target to
    // the native parameter value. It is not part of the declared UI contract.
    mapValue: entry.mapValue ?? null,
  };
}

export interface BuildParamsResult {
  endpoint: string;
  body: Record<string, unknown>;
  modelParameters: Record<string, unknown>;
  isTextured: boolean;
  isRawModel: boolean;
  isPaintModel: boolean;
  /** Native target triangle capability mapping for the selected model */
  nativeTargetMapping: NativeTargetMapping;
}

const FORBIDDEN_PARAMETER_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isJsonParameterValue(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 512 && value.every(item => isJsonParameterValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 512 && entries.every(([key, item]) =>
    key.length <= 200 && !FORBIDDEN_PARAMETER_KEYS.has(key) && isJsonParameterValue(item, depth + 1)
  );
}

/** Validate imported/free-form parameter JSON (kept for backward-compatibility checks). */
export function parseModelParameterOverrides(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || !isJsonParameterValue(value)) {
    throw new Error('Model parameter overrides must be a safe JSON object (finite values, max depth 16).');
  }
  return { ...(value as Record<string, unknown>) };
}

/**
 * Keep the user's explicit model authoritative. Intent resolution may suggest a
 * fallback only when the request does not already name a model.
 */
export function resolveGenerationModelChoice(
  explicitModelId: string | null | undefined,
  presetModelId: string | null | undefined,
): string {
  if (typeof explicitModelId === 'string' && explicitModelId.trim()) return explicitModelId;
  if (typeof presetModelId === 'string' && presetModelId.trim()) return presetModelId;
  return '';
}

/** Derive routing capabilities from selected-model manifest metadata. */
export function resolveGenerationModelCapabilities(
  modelId: string,
  declaredCapabilities: Record<string, unknown> = {},
): ModelCapabilities {
  const rawMesh = declaredCapabilities.raw_mesh === true || modelId.endsWith('_image_to_raw_mesh');
  const textureCapability = declaredCapabilities.texture_generation;
  return {
    raw_mesh: rawMesh,
    paint_autochain: declaredCapabilities.paint_autochain === true,
    supports_texture: typeof textureCapability === 'boolean' ? textureCapability : !rawMesh,
  };
}

export function buildGenerationParameters(
  settings: GenerationSettings,
  modelCapabilities: ModelCapabilities = {}
): BuildParamsResult {
  const isRawModel = modelCapabilities.raw_mesh === true;
  const isPaintModel = modelCapabilities.paint_autochain === true;
  const enablePostprocess = settings.enablePostprocess !== false;

  // Texture generation is independent of mesh decimation/retopology postprocessing.
  // When enablePostprocess is false, decimation and LODs are bypassed,
  // but texture generation options remain active if texture is enabled.
  const textureEnabled = Boolean(
    settings.texture_enabled ??
    settings.textureEnabled ??
    (settings.generateTexture !== false)
  );

  const textureResolutionPreset: '512' | '1K' | '2K' | '4K' | '8K' =
    settings.texture_resolution ||
    settings.textureResolution ||
    (
      settings.textureQuality === 'low' ? '1K' :
      settings.textureQuality === 'medium' ? '1K' :
      settings.textureQuality === 'high' ? '4K' :
      settings.textureQuality === '8k' ? '8K' :
      '2K'
    );

  const numericTextureResolution = (
    textureResolutionPreset === '512' ? 512 :
    textureResolutionPreset === '1K' ? 1024 :
    textureResolutionPreset === '2K' ? 2048 :
    textureResolutionPreset === '4K' ? 4096 :
    8192
  );

  const isTextured = textureEnabled;

  // Runtime model parameters: only caller-controlled seed reaches adapters.
  // Numeric inference profiles (steps, guidance, octree resolution, samplers) live in adapters.
  const modelParameters: Record<string, unknown> = {};
  if (typeof settings.seed === 'number' && Number.isSafeInteger(settings.seed) && settings.seed >= 0) {
    modelParameters.seed = settings.seed;
  }

  // Determine endpoint and body
  const imageInput: Record<string, unknown> = {};
  if (settings.imageFileId) {
    imageInput.image_file_id = settings.imageFileId;
  } else if (typeof settings.image === 'string' && settings.image.startsWith('data:')) {
    imageInput.image_base64 = settings.image;
  }
  if (Object.keys(imageInput).length === 0) {
    throw new Error('No usable image input. Upload an image or pick a sample first.');
  }

  const cleanStem = (settings.imageName || settings.prompt || 'asset')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'asset';

  const requestedCandidateCount = Number(settings.candidateCount ?? 1);
  const candidateCount = Number.isFinite(requestedCandidateCount)
    ? Math.max(1, Math.min(4, Math.floor(requestedCandidateCount)))
    : 1;

  // LOD production options. The post-processing pipeline builds at most 4 levels
  // (LOD0-LOD3), so the request is clamped to the levels the consumer supports.
  const lodEnabled = enablePostprocess && settings.generateLOD !== false;
  // Treat imported/legacy values as untrusted; the backend supports named LOD profiles only.
  const lodPreset = ['mobile', 'low', 'medium', 'high', 'cinematic'].includes(settings.lodPreset ?? '')
    ? settings.lodPreset!
    : 'high';

  // Keep topology as one canonical choice. Legacy boolean state is only a fallback.
  const requestedTopologyMode = settings.topologyMode;
  const topologyMode: 'triangle' | 'quad' =
    requestedTopologyMode === 'quad' ? 'quad'
      : requestedTopologyMode === 'triangle' ? 'triangle'
        : settings.quadTopology ? 'quad' : 'triangle';

  // Auto-rig accepts only the three modes exposed by the backend contract.
  const autoRigMode = settings.autoRigMode === 'skeleton' || settings.autoRigMode === 'skin'
    ? settings.autoRigMode
    : 'full';
  const lodCount = Math.max(2, Math.min(4, Math.floor(Number(settings.lodCount) || 4)));

  // Route by the model's declared capability, not the transient texture toggle.
  // SF3D is textured-only (FEATURE_TYPE = image_to_textured_mesh, no raw mesh):
  // it can never serve the raw-mesh endpoint even when texture is left off.
  const isTexturedOnlyModel = Boolean(
    modelCapabilities.supports_texture && !modelCapabilities.raw_mesh,
  );
  const endpoint = isTexturedOnlyModel
    ? '/api/v1/mesh-generation/image-to-textured-mesh'
    : '/api/v1/mesh-generation/image-to-raw-mesh';

  const rawTargetPolycount =
    (settings as any).polycount ??
    (settings as any).targetPolycount ??
    (settings as any).target_polycount ??
    settings.autoOptimizeSettings?.targetPolycount;

  const parsedPolycount = Number(rawTargetPolycount);
  const clampedPolycount = Number.isFinite(parsedPolycount) && parsedPolycount > 0
    ? Math.max(500, Math.min(1000000, Math.round(parsedPolycount)))
    : 0;

  // Get native target capability for the selected model
  const modelPreference = resolveGenerationModelChoice(settings.aiModel, undefined);
  const nativeTargetMapping = getNativeTargetCapability(modelPreference);

  // Authoritative user polycount reaches the adapter directly for honest
  // requested-vs-actual reporting (Part I §8). No adapter passes it to upstream
  // generation, so it is informational only.
  const nativeTargetPolycount = clampedPolycount;
  const targetPolycount = enablePostprocess ? clampedPolycount : 0;

  // Populate adapter-owned native target parameters from the user's triangle
  // target so the honest requested-vs-actual contract reaches the adapter.
  // No adapter applies these as post-generation topology forcing; they are
  // generation-hint inputs only (Part I §8).
  if (nativeTargetMapping.parameterName && clampedPolycount > 0) {
    const nativeValue = nativeTargetMapping.mapValue
      ? nativeTargetMapping.mapValue(clampedPolycount)
      : clampedPolycount;
    if (nativeValue !== null && nativeValue !== undefined) {
      modelParameters[nativeTargetMapping.parameterName] = nativeValue;
    }
  }

  const body: Record<string, unknown> = {
    ...imageInput,
    candidate_count: candidateCount,
    asset_name: cleanStem,
    image_name: cleanStem,
    output_format: 'glb',
    model_preference: modelPreference || undefined,
    auto_mode: false,
    preprocessing_artifact_id: settings.preprocessingArtifactId || undefined,
    preprocessing_review_override: Boolean(settings.preprocessingReviewOverride),
    enhancement_enabled: Boolean(settings.enhancementEnabled),
    enable_printability_check: enablePostprocess && Boolean(settings.enablePrintabilityCheck),
    enable_auto_repair: enablePostprocess && Boolean(settings.enableAutoRepair),
    enable_auto_rig: enablePostprocess && Boolean(settings.enableAutoRig),
    auto_rig_mode: autoRigMode,
    enable_postprocess: enablePostprocess,
    target_polycount: targetPolycount,
    native_target_polycount: nativeTargetPolycount,
    generate_lod: lodEnabled,
    lod_preset: lodEnabled ? lodPreset : undefined,
    lod_count: lodEnabled ? lodCount : undefined,
    model_parameters: modelParameters,
    physics_enabled: enablePostprocess && Boolean(settings.generateCollision),
    physics_config: undefined,
    topology_mode: enablePostprocess ? topologyMode : 'triangle',
    quad_topology: enablePostprocess && topologyMode === 'quad',
    part_count_range: enablePostprocess ? settings.partCountRange : undefined,
    rig_type: enablePostprocess ? settings.rigType : undefined,
    export_formats: enablePostprocess ? settings.exportFormats : undefined,
    slicer_handoff: enablePostprocess ? Boolean(settings.slicerHandoff) : undefined,
    bake_normal_maps: Boolean(settings.highResolutionNormalBaking ?? true),
    texture_enabled: textureEnabled,
    generate_texture: textureEnabled,
    ...(textureEnabled ? {
      texture_resolution: numericTextureResolution,
      texture_resolution_preset: textureResolutionPreset,
    } : {}),
    ...(settings.texture_settings ? { texture_settings: settings.texture_settings } : {}),
  };

  return {
    endpoint,
    body,
    modelParameters,
    isTextured,
    isRawModel,
    isPaintModel,
    nativeTargetMapping,
  };
}
