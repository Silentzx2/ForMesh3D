import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ToolType,
  MainNavRoute,
  ShadingMode,
  ModelAsset,
  MaterialConfig,
  SystemStats,
  GenerationSettings,
  RemeshSettings,
  TextureSettings,
  SculptSettings,
  PaintBrushSettings,
  ActiveTask,
  EnvironmentSettings,
  normalizeModelAsset,
  WorkspaceExecutionState,
  WorkspacePersistenceState,
  WorkspaceVersionItem,
} from '../types';
import type { BatchQueueItem } from '@/types';
import { apiClient } from '../lib/api';
import { parseWorkspaceRouteIdentity, transitionWorkspaceToolRoute, mintWorkspaceId } from '../lib/workspaceRouteContract';
import { captureWorkspacePreviewBaseline, createWorkspacePreviewRestorePlan } from '../lib/workspacePreviewSnapshot';
import { createWorkspaceRegenerationRequest } from '../lib/workspaceRegeneration';
import { resolveAssetDeletionTarget } from '../lib/assetDeletion';
import { getApiClient, normalizeBackendAssetUrl } from '@/services/apiClient';
import { useAppStore } from '@/stores/useAppStore';
import { useViewerStore, loadModelInViewer } from '@/stores/useViewerStore';
import { findTaskKeyForBackendJob } from '../lib/taskIdentity';
import { useTaskManager } from '@/hooks/useTaskManager';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import { prefetchGLB } from '../lib/glbCache';
import { shadingModeToPreset, presetToShadingMode } from '@/lib/storeAdapter';
import { diagnoseJobError } from '@/lib/jobDiagnostics';
import { useRouter, usePathname } from 'next/navigation';
import {
  buildGenerationParameters,
  resolveGenerationModelCapabilities,
  resolveGenerationModelChoice,
} from '../utils/buildGenerationParameters';
import { buildTextureGenerationParameters } from '../utils/buildTextureGenerationParameters';
import { taskPersistence } from '@/services/taskPersistence';

interface ComparisonGroup {
  id: string;
  name: string;
  sourceImage: string | null;
  sourceImageName: string | null;
  modelIds: string[];
  prompts: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  completedAt: number | null;
  results: Record<string, ActiveTask | null>; // modelId -> task
  selectedModelId: string | null;
}

export type WorkspaceExecutionStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';

interface WorkspaceContextType {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  mainNav: MainNavRoute;
  setMainNav: (nav: MainNavRoute) => void;
  assets: ModelAsset[];
  isAssetsLoading?: boolean;
  selectedAssetId: string | null;
  refreshAssets: () => Promise<void>;
  currentAsset: ModelAsset | null;
  selectAsset: (id: string) => void;
  updateAssetProperties: (id: string, updates: Partial<ModelAsset>) => void;
  updateMaterialConfig: (updates: Partial<MaterialConfig>) => void;
  deleteAsset: (id: string) => void;
  addAsset: (asset: ModelAsset) => void;
  shadingMode: ShadingMode;
  setShadingMode: (mode: ShadingMode) => void;
  showWireframe: boolean;
  setShowWireframe: (show: boolean) => void;
  wireframeMode: 'off' | 'overlay' | 'xray';
  setWireframeMode: (mode: 'off' | 'overlay' | 'xray') => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  showBones: boolean;
  setShowBones: (show: boolean) => void;
  isTurntable: boolean;
  setIsTurntable: (turntable: boolean) => void;
  activeTransformTool: 'select' | 'rotate' | 'pan' | 'frame';
  setActiveTransformTool: (tool: 'select' | 'rotate' | 'pan' | 'frame') => void;
  viewportResetTrigger: number;
  resetCamera: () => void;
  fitToScreen: () => void;
  activeRightTab: 'assets' | 'property' | 'properties';
  setActiveRightTab: (tab: 'assets' | 'property' | 'properties') => void;
  rightPanelMode: 'assets' | 'property' | 'properties';
  setRightPanelMode: (mode: 'assets' | 'property' | 'properties') => void;
  isLeftPanelOpen: boolean;
  setIsLeftPanelOpen: (open: boolean) => void;
  toolPanelOpen: boolean;
  setToolPanelOpen: (open: boolean) => void;
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: boolean) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  environmentSettings: EnvironmentSettings;
  setEnvironmentSettings: React.Dispatch<React.SetStateAction<EnvironmentSettings>>;
  setCurrentAsset: (asset: ModelAsset | null) => void;
  assetFilter: string;
  setAssetFilter: (filter: string) => void;
  duplicateAsset: (id: string) => void;
  systemStats: SystemStats;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isExportModalOpen: boolean;
  setIsExportModalOpen: (open: boolean) => void;
  refreshSystemStats: () => Promise<void>;
  leftPanelWidth: number;
  setLeftPanelWidth: (width: number) => void;
  rightPanelWidth: number;
  setRightPanelWidth: (width: number) => void;
  activeTask: ActiveTask | null;
  hoveredPartId: string | null;
  setHoveredPartId: (id: string | null) => void;
  jobsById: Record<string, ActiveTask>;
  dismissActiveTask: () => void;
  isExecuting: boolean;
  executionStatus?: WorkspaceExecutionStatus;
  executionState: WorkspaceExecutionState;
  setExecutionState: (state: WorkspaceExecutionState) => void;
  persistenceState: WorkspacePersistenceState;
  setPersistenceState: (state: WorkspacePersistenceState) => void;
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
  activeMeshAssetId: string | null;
  setActiveMeshAssetId: (id: string | null) => void;
  workspaceVersions: WorkspaceVersionItem[];
  setWorkspaceVersions: React.Dispatch<React.SetStateAction<WorkspaceVersionItem[]>>;
  restorePreviewBaseline: (taskId?: string) => void;
  regeneratePreview: (taskId?: string) => Promise<void>;
  executionProgress: number;
  executionStep: string;
  cancelExecution: () => Promise<void>;
  generationSettings: GenerationSettings;
  setGenerationSettings: React.Dispatch<React.SetStateAction<GenerationSettings>>;
  postprocessingEnabled: boolean;
  setPostprocessingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  remeshSettings: RemeshSettings;
  setRemeshSettings: React.Dispatch<React.SetStateAction<RemeshSettings>>;
  textureSettings: TextureSettings;
  setTextureSettings: React.Dispatch<React.SetStateAction<TextureSettings>>;
  sculptSettings: SculptSettings;
  setSculptSettings: React.Dispatch<React.SetStateAction<SculptSettings>>;
  paintBrushSettings: PaintBrushSettings;
  setPaintBrushSettings: React.Dispatch<React.SetStateAction<PaintBrushSettings>>;
  generate3DModel: () => Promise<void>;
  runModelGeneration: () => Promise<void>;
  runRemeshGeneration: (customSettings?: {
    polyType?: string;
    targetPolycount?: number;
    preserveEdges?: boolean;
    featureAngle?: number;
    adaptiveDensity?: boolean;
    watertightHealing?: boolean;
    outputFormat?: string;
  }) => Promise<void>;
  runTextureGeneration: () => Promise<void>;
  runUVUnwrapGeneration: (customSettings?: {
    distortionThreshold?: number;
    packMethod?: string;
    outputFormat?: string;
    saveIndividualParts?: boolean;
    unwrapStrategy?: 'organic' | 'hard_surface' | 'hybrid' | string;
    atlasResolution?: number | string;
    islandMargin?: number;
    boundaryPacker?: boolean;
    symmetryStacking?: boolean;
    modelParameters?: Record<string, any>;
  }) => Promise<void>;
  runSegmentation: (customSettings?: {
    numParts?: number;
    method?: string;
    hierarchical?: boolean;
    minFaceIslandThreshold?: number;
    colorizePreview?: boolean;
    saveIndividualParts?: boolean;
    outputFormat?: string;
    modelParameters?: Record<string, any>;
    modelPreference?: string;
  } | number) => Promise<void>;
  runAutoRigging: (options?: {
    skeletonTemplate?: string;
    bindPose?: string;
    exportFormat?: string;
    modelPreference?: string;
    modelParameters?: Record<string, any>;
    customSettings?: Record<string, any>;
  }) => Promise<void>;
  runMotionGeneration: (options?: {
    prompt?: string;
    duration?: number;
    seed?: number;
    frameRate?: string;
    targetSkeleton?: string;
    footSkatingCleanup?: boolean;
    modelParameters?: Record<string, any>;
    customSettings?: Record<string, any>;
  }) => Promise<void>;
  processBatchQueue: () => Promise<void>;
  cancelBatchProcessing: () => Promise<void>;
  retryFailedBatchItems: () => Promise<void>;
  dismissJob: (jobId: string) => void;
  selectJobToView: (jobId: string) => void;
  queueGenerationJob: (customSettings?: Partial<GenerationSettings>) => Promise<string | null>;
  navigateToTool: (tool: ToolType) => void;
  navigateToMain: (nav: MainNavRoute) => void;
  navigateToMainNav: (nav: MainNavRoute) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const TOOL_TO_ROUTE: Record<ToolType, string> = {
  tools: '/workspace/generate',
  model: '/workspace/generate',
  remesh: '/workspace/retopology',
  texture: '/workspace/texture',
  uv: '/workspace/smart-uv',
  segment: '/workspace/segmentation',
  edit: '/workspace/texture-edit',
  pbr: '/workspace/texture-pbr',
  environment: '/workspace/generate',
  animation: '/workspace/animate',
  rigging: '/workspace/rigging',
};

async function parseApiData<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (payload?.success === false) {
    throw new Error(payload?.message || 'Backend request failed');
  }
  return (payload?.data ?? payload) as T;
}

async function parseApiError(response: Response): Promise<Error> {
  try {
    const payload = await response.json();
    return new Error(payload?.detail || payload?.message || `Backend returned HTTP ${response.status}`);
  } catch {
    return new Error(`Backend returned HTTP ${response.status}`);
  }
}

// ── Real backend (3DAIGC-API) job contract ────────────────────────────────
// Submit image-to-mesh jobs through the canonical POST /api/v1/generate endpoint.
//   → { job_id, status, message }
// Status: GET /api/v1/system/jobs/{job_id}
//   → { job_id, status: queued|processing|completed|failed|cancelled,
//       progress: 0..1 fraction, result: { mesh_url, thumbnail_url, ... },
//       error: string|null }
// Backend result URLs may be absolute or relative; rewrite them to the
// same-origin /api/v1 proxy path so the browser can always reach them.
const toProxyUrl = normalizeBackendAssetUrl;


interface BackendJobPayload {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  stage?: string;
  message?: string;
  logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
  metadata?: { logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[] };
  result?: Record<string, any>;
  error?: string | null;
  error_code?: string;
}

function previewSourceUrl(result?: Record<string, any>): string | undefined {
  const source = result?.source_model_url || result?.high_fidelity_url || result?.artifacts?.source;
  return typeof source === 'string' ? source : (typeof source?.url === 'string' ? source.url : undefined);
}

function isNativeRawPreview(result?: Record<string, any>): boolean {
  const target = Number(result?.target_polycount ?? result?.requested_target_polycount);
  return Boolean(result && Number.isFinite(target) && target <= 0 && previewSourceUrl(result));
}

function preferredGenerationPreviewUrl(result?: Record<string, any>): string | undefined {
  if (isNativeRawPreview(result)) return previewSourceUrl(result);
  return result?.active_model_url || result?.textured_model_url || result?.model_url || result?.mesh_url || result?.url;
}

function preferredPreviewStats(result?: Record<string, any>): Record<string, any> {
  if (!result) return {};
  if (typeof result.actual_face_count === 'number' || typeof result.actual_vertex_count === 'number') {
    return {
      faces: result.actual_face_count ?? result.polygon_count,
      vertices: result.actual_vertex_count ?? result.vertex_count,
    };
  }
  return isNativeRawPreview(result)
    ? (result?.quality_trace?.source || {})
    : (result?.quality_trace?.game_ready || {});
}

function normalizeBackendJob(raw: BackendJobPayload) {
  const rawProgress = Number(raw.progress ?? 0);
  const normalizedProgress = rawProgress <= 1 ? rawProgress * 100 : rawProgress;
  // Prefer the canonical game-ready GLB URL; mesh_url is the legacy raw path
  const modelUrl = toProxyUrl(raw.result?.model_url ?? raw.result?.mesh_url);
  const activeModelUrl = toProxyUrl(
    raw.result?.active_model_url ?? raw.result?.textured_model_url ?? raw.result?.model_url ?? raw.result?.mesh_url
  );
  const texturedModelUrl = raw.result?.textured_model_url
    ? toProxyUrl(raw.result.textured_model_url)
    : undefined;
  const sourceModelUrl = previewSourceUrl(raw.result)
    ? toProxyUrl(previewSourceUrl(raw.result)!)
    : undefined;
  return {
    status: raw.status,
    progress: Math.max(0, Math.min(100, Math.round(normalizedProgress))),
    stage: raw.stage || raw.status,
    message: raw.message || (raw.status === 'processing' ? 'Processing' : raw.status === 'queued' ? 'Queued' : undefined),
    error_message: typeof raw.error === 'string' ? raw.error : undefined,
    error_code: raw.error_code,
    logs: Array.isArray(raw.logs)
      ? raw.logs
      : Array.isArray(raw.metadata?.logs)
        ? raw.metadata.logs
        : undefined,
    result: raw.result ? {
      ...raw.result,
      ...(modelUrl ? { model_url: modelUrl } : {}),
      ...(activeModelUrl ? { active_model_url: activeModelUrl } : {}),
      ...(texturedModelUrl ? { textured_model_url: texturedModelUrl } : {}),
      ...(sourceModelUrl ? { source_model_url: sourceModelUrl, high_fidelity_url: sourceModelUrl } : {}),
      ...(raw.result.thumbnail_url ? { thumbnail_url: toProxyUrl(raw.result.thumbnail_url) } : {}),
    } : undefined,
  } as {
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    stage: string;
    message?: string;
    error_message?: string;
    logs?: { stage: string; progress: number; message: string; level: string; timestamp: string }[];
    result?: (Record<string, any> & {
      model_url?: string;
      active_model_url?: string;
      textured_model_url?: string;
      thumbnail_url?: string;
    }) | undefined;
  };
}

// Deterministic short id for a route so the URL stably addresses the same
// asset/job instead of minting a fresh random hash on every click. Known
// id prefixes (local_/upload_/hist_/job-) are stripped so they never leak
// into the visible route hash, and the visible part is a short hash of the
// source name so routes stay short (e.g. /workspace/generate/name_abc123).
export function routeShortId(source: string | undefined): string {
  const raw = (source || '')
    .replace(/^(?:local_|upload_|hist_|job-)+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'asset';
  // Deterministic string hash -> short 6-char hex-like suffix
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  const shortHash = Math.abs(h).toString(36).slice(0, 6);
  return `${raw.slice(0, 16)}_${shortHash}` || 'asset';
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const autoRotatePreference = useAppStore((state) => state.viewer?.autoRotate);
  const hasRunningBatchJobs = useAppStore((state) => state.batchQueue.some((item) => item.status === 'running' && item.jobId));
  const updateBatchItem = useAppStore((state) => state.updateBatchItem);
  const setViewerShadingMode = useViewerStore((state) => state.setShadingMode);
  const router = useRouter();
  const pathname = usePathname();

  const [activeTool, setActiveToolState] = useState<ToolType>('model');
  const [mainNav, setMainNavState] = useState<MainNavRoute>('workspace');
  const [activeRightTab, setActiveRightTab] = useState<'assets' | 'property' | 'properties'>('assets');
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [assetFilter, setAssetFilter] = useState<string>('all');
   const [deletedAssetIds, setDeletedAssetIds] = useState<Set<string>>(() => new Set());
   const batchJobIdMap = useRef<Record<string, string>>({}); // Maps jobId to batchQueueItemId
   const batchAbortControllerRef = useRef<AbortController | null>(null);
   const batchPollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
   
   // React Query for System Stats
  const { data: polledSystemStats, refetch: queryRefetchSystemStats } = useQuery({
    queryKey: ['system-stats'],
    queryFn: async () => {
      const stats = await apiClient.getSystemStats();
      return stats as unknown as SystemStats;
    },
    refetchInterval: 30000, // Refresh resource telemetry every 30s
    staleTime: 10000,
  });

  const refreshSystemStats = useCallback(async () => {
    await queryRefetchSystemStats();
  }, [queryRefetchSystemStats]);

  const [localAssets, setLocalAssets] = useState<ModelAsset[]>([]);

  // React Query for History
  const { data: historyAssets, isLoading: isHistoryLoading } = useQuery({
    queryKey: ['history-assets'],
    queryFn: async () => {
      const history = await apiClient.getHistory() as Record<string, any>;
      return Object.entries(history).filter(([, h]) => h.status?.completed).map(([id, h], i) => {
        const rawPrompt = (h.prompt?.[1] as string)?.trim();
        const promptName = rawPrompt && !rawPrompt.startsWith('workflow:') && rawPrompt !== 'generate'
          ? (rawPrompt.charAt(0).toUpperCase() + rawPrompt.slice(1)).slice(0, 40)
          : null;
        const name = promptName || `Model_${id.slice(0, 8)}`;
        const outputs = (h.outputs || {}) as Record<string, any>;
        const outputUrl = toProxyUrl(preferredGenerationPreviewUrl(outputs) || (outputs.glb as string) || (outputs.model_url as string) || (outputs.download_url as string) || `/api/v1/system/jobs/${id}/download?artifact_format=glb`);
        const targetWsId = outputs.workspace_id || (h as any).workspace_id || id;
        return normalizeModelAsset({
          id: id || `hist-${i}`,
          workspace_id: targetWsId,
          name,
          category: 'generation',
          thumbnail: (outputs.thumbnail as string) || (outputs.thumbnail_url as string) || '',
          source: { filename: `${id}.glb`, subfolder: 'generated', type: 'output', viewUrl: outputUrl, fileId: `job-${id}` },
          meshType: 'custom',
          polygon_count: outputs.polygon_count,
          vertex_count: outputs.vertex_count,
          faces: outputs.polygon_count ?? outputs.faces,
          vertices: outputs.vertex_count ?? outputs.vertices,
          triangles: outputs.polygon_count ?? outputs.triangles,
          statsAvailable: outputs.statsAvailable ?? ((outputs.polygon_count ?? 0) > 0 || (outputs.vertex_count ?? 0) > 0),
          topology: outputs.topology || 'Triangle',
          format: outputs.format || 'GLB',
          dimensions: outputs.dimensions,
          boundingBox: outputs.bounding_box || outputs.boundingBox,
          objectCount: outputs.object_count ?? outputs.objectCount,
          componentCount: outputs.component_count ?? outputs.componentCount,
          materialCount: outputs.material_count ?? outputs.materialCount,
          meshDetails: outputs.mesh_details || outputs.meshDetails,
           postprocessStatus: outputs.production_status || outputs.postprocess_status || 'unknown',
          dateCreated: '',
          tags: ['AI Generated'],
          materials: [],
          model_url: outputUrl,
          game_ready_url: (outputs.game_ready_url as string) || outputUrl,
          source_model_url: (outputs.source_model_url as string) || (outputs.source as string) || undefined,
          collision_url: outputs.collision_url,
          pbr_maps: outputs.pbr_maps,
          game_ready_formats: outputs.game_ready_formats,
          zip_url: outputs.zip_url,
          qa_report: outputs.qa_report,
          quality_trace: outputs.quality_trace,
          artifacts: outputs.artifacts,
        });
      }) as ModelAsset[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // React Query for Uploaded Assets
  const { data: uploadedAssets, isLoading: isUploadedLoading } = useQuery({
    queryKey: ['uploaded-assets'],
    queryFn: async () => {
      const res = await fetch('/api/v1/file-upload/list');
      if (!res.ok) return [];
      const data = await res.json();
      const files = Array.isArray(data) ? data : (data?.files || []);
      return files
        .filter((m: any) => m.file_id && !String(m.file_id).startsWith('job-') && m.file_type !== 'image')
        .map((m: any) => {
        const cleanName = m.filename?.replace(/\.[^.]+$/, '') || '3D Model';
        const formattedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        const ext = m.filename?.split('.').pop()?.toUpperCase() || (m.file_type === 'mesh' ? 'GLB' : 'GLB');
        const viewUrl = m.file_id ? `/api/v1/file-upload/download/${m.file_id}` : '';
        const thumbUrl = m.thumbnail_url || (m.file_id ? `/api/v1/file-upload/thumbnail/${m.file_id}` : '');
        return normalizeModelAsset({
          id: m.file_id || m.filename,
          fileId: m.file_id,
          name: formattedName,
          category: 'mesh',
          meshType: 'custom',
          thumbnail: thumbUrl,
          polygon_count: 0,
          vertex_count: 0,
          faces: 0,
          vertices: 0,
          triangles: 0,
          statsAvailable: false,
          source: { filename: m.filename, subfolder: '', type: 'upload', viewUrl, fileId: m.file_id },
          topology: 'Triangle',
          format: ext,
          dateCreated: m.upload_time || '',
          tags: ['Uploaded', 'Model'],
        });
      }) as ModelAsset[];
    },
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const [assets, setAssets] = useState<ModelAsset[]>([]);

  const refreshAssets = useCallback(async () => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['history-assets'] }),
      queryClient.invalidateQueries({ queryKey: ['uploaded-assets'] }),
    ]);
  }, [queryClient]);

  // Merge assets
  useEffect(() => {
    const history = historyAssets || [];
    const uploaded = uploadedAssets || [];
    const local = localAssets;

    setAssets(prevAssets => {
      // Prioritize local session assets, then uploaded, then history
      // When merging, preserve authoritative metadata from prevAssets if incoming has statsAvailable: false
      const prevMap = new Map((prevAssets || []).map(a => [a.id, a]));
      const all = [...local, ...uploaded, ...history].map(rawItem => {
        const a = normalizeModelAsset(rawItem);
        // Add prefix to IDs to prevent collisions (MED-002)
        if (local.includes(rawItem as any)) {
          // Preserve operation previews and canonical asset IDs across refreshes.
          if (!a.id.startsWith('local_') && !a.id.startsWith('preview_') && !a.id.startsWith('ast_')) {
            a.id = `local_${a.id}`;
          }
        } else if (uploaded.includes(rawItem as any)) {
          if (!a.id.startsWith('upload_')) a.id = `upload_${a.id}`;
        } else if (history.includes(rawItem as any)) {
          if (!a.id.startsWith('hist_')) a.id = `hist_${a.id}`;
        }
        a.sourceType = local.includes(rawItem as any) ? 'local' : (uploaded.includes(rawItem as any) ? 'upload' : 'history');
        const existing = prevMap.get(a.id);
        if (existing && existing.statsAvailable && !a.statsAvailable) {
          return {
            ...a,
            faces: existing.faces,
            vertices: existing.vertices,
            triangles: existing.triangles,
            statsAvailable: true,
            dimensions: existing.dimensions || a.dimensions,
            boundingBox: existing.boundingBox || a.boundingBox,
            objectCount: existing.objectCount ?? a.objectCount,
            componentCount: existing.componentCount ?? a.componentCount,
            materialCount: existing.materialCount ?? a.materialCount,
            topology: existing.topology || a.topology,
            meshDetails: existing.meshDetails || a.meshDetails,
          };
        }
        return a;
      });
      const seenIds = new Set<string>();
      const seenFilenames = new Set<string>();
      const seenUrls = new Set<string>();
      const seenJobUuids = new Set<string>();

      const extractUuid = (str?: string) => str?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase();

      const filtered = all.filter(a => {
        if (!a || !a.id) return false;
        if (deletedAssetIds.has(a.id)) return false;
        if (seenIds.has(a.id)) return false;

        const rawUrl = a.source?.viewUrl || a.source?.localUrl;
        const normUrl = rawUrl?.replace(/^\/+/, '')?.toLowerCase();
        if (normUrl && seenUrls.has(normUrl)) return false;

        const assetUuid = extractUuid(a.id) || extractUuid(a.fileId) || extractUuid(a.source?.fileId) || extractUuid(rawUrl);
        if (assetUuid && !a.isLocalDuplicate) {
          if (seenJobUuids.has(assetUuid)) return false;
          seenJobUuids.add(assetUuid);
        }
        const fn = a.source?.filename?.trim();
        const filenameKey = a.workspace_id && fn && fn !== 'model.glb' ? `${a.workspace_id}:${fn.toLowerCase()}` : null;
        if (!a.isLocalDuplicate && filenameKey && seenFilenames.has(filenameKey)) return false;
        if (!a.isLocalDuplicate && normUrl && seenUrls.has(normUrl)) return false;
        seenIds.add(a.id);
        if (!a.isLocalDuplicate && filenameKey) seenFilenames.add(filenameKey);
        if (!a.isLocalDuplicate && normUrl) seenUrls.add(normUrl);
        return true;
      });

      let currentSelected = selectedAssetIdRef.current;
      
      // Resilient matching across local prefixes, clean names, and server file IDs (only run when assets have loaded)
      if (currentSelected && filtered.length > 0 && !filtered.some(a => a.id === currentSelected)) {
        const cleanCur = currentSelected.replace(/^(hist_|local_|upload_)/, '').toLowerCase();
        const matching = filtered.find(a => {
          const aCleanId = a.id.replace(/^(hist_|local_|upload_)/, '').toLowerCase();
          const aFileId = (a.fileId || a.source?.fileId || '').toLowerCase();
          const aFilename = (a.source?.filename || '').toLowerCase();
          return (
            aCleanId === cleanCur ||
            (aFileId && (aFileId === cleanCur || aFileId.startsWith(cleanCur) || cleanCur.includes(aFileId.slice(0, 8)))) ||
            (cleanCur.includes(aCleanId)) ||
            (aFilename && cleanCur.includes(aFilename.replace(/\.[^.]+$/, '')))
          );
        });
        if (matching) {
          currentSelected = matching.id;
          setSelectedAssetId(currentSelected);
        } else {
          // If the selected ID does not exist in loaded assets, clear it
          setSelectedAssetId(null);
        }
      }
      return filtered;
    });
  }, [historyAssets, uploadedAssets, localAssets, deletedAssetIds]);

  const [workspaceId, setWorkspaceIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseWorkspaceRouteIdentity(window.location.pathname).workspaceId;
  });
  const workspaceIdRef = useRef<string | null>(workspaceId);

  const [activeMeshAssetId, setActiveMeshAssetIdState] = useState<string | null>(null);
  const [executionState, setExecutionStateInternal] = useState<WorkspaceExecutionState>('idle');
  const [persistenceState, setPersistenceStateInternal] = useState<WorkspacePersistenceState>('not_saved');
  const [workspaceVersions, setWorkspaceVersions] = useState<WorkspaceVersionItem[]>([]);

  const setExecutionState = useCallback((nextState: WorkspaceExecutionState) => {
    setExecutionStateInternal(nextState);
    useAppStore.getState().setExecutionState(nextState);
    useViewerStore.getState().setExecutionState(nextState);
  }, []);

  const setPersistenceState = useCallback((nextState: WorkspacePersistenceState) => {
    setPersistenceStateInternal(nextState);
    useAppStore.getState().setPersistenceState(nextState);
    useViewerStore.getState().setPersistenceState(nextState);
  }, []);

  const setWorkspaceId = useCallback((id: string | null) => {
    workspaceIdRef.current = id;
    setWorkspaceIdState(id);
    useAppStore.getState().setActiveWorkspaceId(id);
    useViewerStore.getState().setWorkspaceId(id);
  }, []);

  const setActiveMeshAssetId = useCallback((id: string | null) => {
    setActiveMeshAssetIdState(id);
    useViewerStore.getState().setActiveMeshAssetId(id);
  }, []);

  // Deep-link route segments identify workspaces, never selected mesh assets.
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const selectedAssetIdRef = useRef(selectedAssetId);
  selectedAssetIdRef.current = selectedAssetId;
  const activeMeshAssetIdRef = useRef(activeMeshAssetId);
  activeMeshAssetIdRef.current = activeMeshAssetId;
  const workspaceVersionsRef = useRef(workspaceVersions);
  workspaceVersionsRef.current = workspaceVersions;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const mainNavRef = useRef(mainNav);
  const activeToolRef = useRef(activeTool);

  // Route identity is a workspace ID; never copy it into asset selection state.
  useEffect(() => {
    if (!pathname || !pathname.startsWith('/workspace/')) return;
    const routeIdentity = parseWorkspaceRouteIdentity(pathname);
    if (routeIdentity.workspaceId !== workspaceIdRef.current) {
      setWorkspaceId(routeIdentity.workspaceId);
      setSelectedAssetId(null);
      setActiveMeshAssetId(null);
      setWorkspaceVersions([]);
      useViewerStore.getState().requestAssetSelection(null);
      useViewerStore.getState().setLoadedModel(null, null, null);
    }
  }, [pathname, setWorkspaceId]);

  const [shadingMode, setShadingModeState] = useState<ShadingMode>('textured');
  const [wireframeMode, setWireframeMode] = useState<'off' | 'overlay' | 'xray'>('off');
  const showWireframe = wireframeMode !== 'off';
  const [showGrid, setShowGridState] = useState(false);
  const [showBones, setShowBonesState] = useState(false);
  const [isTurntable, setIsTurntableState] = useState(autoRotatePreference ?? false);
  const [activeTransformTool, setActiveTransformTool] = useState<'select' | 'rotate' | 'pan' | 'frame'>('select');
  const [viewportResetTrigger, setViewportResetTrigger] = useState(0);

  const systemStats = useMemo(() => polledSystemStats || ({
    status: 'offline' as const, host: '/api/v1', gpu: 'Unavailable',
    vramUsedGb: null, vramTotalGb: null, ramUsedGb: null, ramTotalGb: null,
    torchVramUsedGb: null, torchVramTotalGb: null, gpuType: null, gpuIndex: null,
    pythonVersion: null, torchVersion: null, apiVersion: null,
    queueRunning: 0, queuePending: 0, activePromptId: null, activeNode: null, lastPingMs: 0,
  } as SystemStats), [polledSystemStats]);
  const systemStatsStatusRef = useRef(systemStats.status);

  useEffect(() => {
    if (polledSystemStats?.status === 'offline' && systemStatsStatusRef.current !== 'offline') {
      toast.warning('Backend is offline', {
        description: 'Unable to sync with the generation engine. Check your connection.',
      });
    }
    systemStatsStatusRef.current = systemStats.status;
  }, [polledSystemStats, systemStats.status]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const [executionStatus, setExecutionStatus] = useState<WorkspaceExecutionStatus>('idle');
  const isExecuting = executionStatus === 'running';
  const setIsExecuting = useCallback((executing: boolean) => {
    setExecutionStatus(executing ? 'running' : 'idle');
  }, []);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [executionStep, setExecutionStep] = useState('');
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [jobsById, setJobsById] = useState<Record<string, ActiveTask>>({});
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);
  const [activeComparisonGroup, setActiveComparisonGroup] = useState<string | null>(null);
  const jobsByIdRef = useRef(jobsById);
  jobsByIdRef.current = jobsById;
  const activeTaskRef = useRef<ActiveTask | null>(activeTask);
  activeTaskRef.current = activeTask;
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // F5: mount the background task manager so reconnect-to-running + the
  // polling loop actually run for the whole workspace session. It self-stops
  // when no running/queued backend jobs exist, so it is a no-op until a job
  // is registered via bindBackendJob.
  const { registerTask, completeTask, startPolling } = useTaskManager();

  // B5-T4: Unified adaptive task poller (1.5s initial cadence, 5s backoff after 2min,
  // pauses on tab hidden, stops on terminal state).
  useTaskPolling({ initialInterval: 1500, backoffInterval: 5000, backoffDelayMs: 120000, enabled: true });

  const dismissActiveTask = useCallback(() => setActiveTask(null), []);

  const onExecutionProgress = useCallback((step: string, pct: number, stage?: string) => {
    setExecutionStep(step);
    setExecutionProgress(pct);
    setActiveTask(prev => prev ? {
      ...prev,
      status: 'running',
      progress: pct,
      stage: stage || prev.stage,
      currentStep: step,
    } : prev);
  }, []);

  const onExecutionLog = useCallback((message: string) => {
    setActiveTask(prev => prev ? {
      ...prev,
      logs: [...(prev.logs || []), {
        stage: prev.stage || '',
        progress: prev.progress,
        message,
        level: 'info',
        timestamp: new Date().toISOString(),
      }],
    } : prev);
  }, []);

    const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(() => ({
      mode: 'image-to-3d',
      image: null,
      aiModel: '',
      textureQuality: 'high',
      quadTopology: false, topologyMode: 'triangle', seed: Math.floor(Math.random() * 900000) + 100000, removeBackground: false,
      autoOptimizeSettings: { targetPolycount: 0 },
      highResolutionNormalBaking: true,
      generateTexture: true,
      generateCollision: true,
      generateLOD: false,
      lodPreset: "high",
      lodCount: 4,
      intent: undefined,
      preprocessingArtifactId: null,
      preprocessingReviewOverride: false,
      preprocessingPreviewUrl: null,
      preprocessingMetadata: null,
      enhancementEnabled: false,
      enablePrintabilityCheck: false,
      enableAutoRepair: false,
      enableAutoRig: false,
      autoRigMode: 'full',
      enablePostprocess: false,
      candidateCount: 1,
      partCountRange: '1',
      rigType: 'none',
      exportFormats: ['glb'],
      slicerHandoff: false,
    }));
 
   const [remeshSettings, setRemeshSettings] = useState<RemeshSettings>({
    tab: 'auto', polyType: 'quad', targetPolycount: 50000,
  });

  const [textureSettings, setTextureSettings] = useState<TextureSettings>({
    workflow: 'texture', mode: 'ai', style: 'realistic', resolution: '4K',
    paintResolution: 512,
    referenceImage: null,
    prompt: '',
    modelId: '',
    maps: { albedo: true, normal: true, roughness: true, metallic: true, ao: true, height: false },
  });

  const [sculptSettings, setSculptSettings] = useState<SculptSettings>({
    brush: 'standard',
    radius: 0.15,
    strength: 0.50,
    hardness: 0.50,
    spacing: 0.10,
    direction: 1,
    frontOnly: true,
    symmetry: { x: true, y: false, z: false },
    steadyStroke: 0.20,
    autoSmooth: 0.10,
  });

  const [paintBrushSettings, setPaintBrushSettings] = useState<PaintBrushSettings>({
    color: 'hsl(var(--primary))',
    size: 24,
    opacity: 1.0,
    flow: 0.8,
    hardness: 0.8,
    shape: 'round',
    blendMode: 'normal',
  });

  const [environmentSettings, setEnvironmentSettings] = useState<EnvironmentSettings>({
    ambientIntensity: 0.75,
    keyLightIntensity: 1.6,
    fillLightIntensity: 0.9,
    rimLightIntensity: 1.1,
    exposure: 1.0,
    gridVisible: true,
    gridColor: 'hsl(var(--surface-2))',
    backgroundColor: 'radial-gradient(ellipse 75% 70% at 50% 50%, hsl(var(--surface-4)) 0%, hsl(var(--surface-3)) 30%, hsl(var(--surface-2)) 60%, hsl(var(--surface-0)) 85%, hsl(var(--background)) 100%)',
    autoRotate: false,
    showAxes: false,
    showStats: true,
  });

   const [modelDetails, setModelDetails] = useState<Record<string, any>>({});
   const [postprocessingEnabled, setPostprocessingEnabled] = useState(false);

  useEffect(() => {
    getApiClient().getAvailableModels().then(data => {
      if ((data as any)?.model_details) {
        setModelDetails((data as any).model_details);
      }
      setPostprocessingEnabled(Boolean((data as any)?.postprocessing?.enabled));
    }).catch(err => {
      console.warn('Failed to load model details:', err);
    });
  }, []);

  const currentAsset = useMemo(() => {
    if (!selectedAssetId) return null;
    const direct = assets.find(a => a.id === selectedAssetId);
    if (direct) return direct;
    const cleanSelected = selectedAssetId.replace(/^(local_|upload_|hist_|job-)/, '').toLowerCase();
    return assets.find(a => {
      const cleanA = a.id.replace(/^(local_|upload_|hist_|job-)/, '').toLowerCase();
      const aFileId = (a.fileId || a.source?.fileId || '').replace(/^(job-)/, '').toLowerCase();
      return cleanA === cleanSelected || aFileId === cleanSelected || (cleanSelected.length >= 8 && (cleanA.includes(cleanSelected) || cleanSelected.includes(cleanA)));
    }) ?? null;
  }, [assets, selectedAssetId]);
  const currentAssetRef = useRef(currentAsset);

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
    currentAssetRef.current = currentAsset;
    mainNavRef.current = mainNav;
    activeToolRef.current = activeTool;
    systemStatsStatusRef.current = systemStats.status;
  }, [selectedAssetId, currentAsset, mainNav, activeTool, systemStats.status]);

  const addAsset = useCallback((asset: ModelAsset) => {
    // Construct user-friendly slug and name based on clean filename and short hash
    const cleanStem = (asset.name || 'mesh').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const shortHash = (asset.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(asset.id);
    const finalId = asset.id.startsWith('local_') || asset.id.startsWith('ast_') || asset.id.startsWith('preview_')
      ? asset.id
      : (asset.id.startsWith('job-') || asset.id.startsWith('upload_') || asset.id.startsWith('hist_')
          ? asset.id
          : (isUuid ? `local_${asset.id}` : `local_${cleanStem}_${shortHash}`));
    const friendlyName = asset.name ? asset.name.replace(/\.[^/.]+$/, '') : `${cleanStem.charAt(0).toUpperCase() + cleanStem.slice(1)} ${shortHash}`;
    const normalized: ModelAsset = { ...asset, id: finalId, name: friendlyName, sourceType: 'local' as const };
    const stripQuery = (u?: string) => (u ? u.split('?')[0] : '');
    const matchesExistingAsset = (candidate: ModelAsset) => {
      if (candidate.id === normalized.id) return true;
      if (normalized.isLocalDuplicate || candidate.isLocalDuplicate) return false;
      const sameWorkspace = normalized.workspace_id === candidate.workspace_id;
      const normUrl = stripQuery(normalized.source?.viewUrl);
      const candUrl = stripQuery(candidate.source?.viewUrl);
      return sameWorkspace && (
        (normalized.source?.type === 'mesh' && candidate.source?.type === 'mesh') ||
        (normalized.source?.filename && candidate.source?.filename && normalized.source.filename !== 'model.glb' && candidate.source.filename === normalized.source.filename) ||
        (normUrl && candUrl && normUrl === candUrl)
      );
    };
    setLocalAssets(prev => {
      const idx = prev.findIndex(matchesExistingAsset);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...normalized };
        return copy;
      }
      return [normalized, ...prev];
    });
    setAssets(prev => {
      const idx = prev.findIndex(matchesExistingAsset);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...normalized };
        return copy;
      }
      return [normalized, ...prev];
    });
    setSelectedAssetId(finalId);
    setViewportResetTrigger(prev => prev + 1);
    return finalId;
  }, []);

  const loadCompletedJobResult = useCallback(async (jobId: string, rawData: any, promptTitle?: string) => {
    const data = normalizeBackendJob(rawData);
    const result = data.result || (rawData as any)?.result || {};
    const matchingTask = Object.values(jobsByIdRef.current).find(task => task.backendJobId === jobId) ||
      (activeTaskRef.current?.backendJobId === jobId ? activeTaskRef.current : undefined);
    const resolvedWorkspaceId =
      rawData?.workspace_id || result?.workspace_id || matchingTask?.workspaceId || undefined;
    const resolvedOperationId =
      rawData?.operation_id || result?.operation_id || matchingTask?.operationId || undefined;
    const retainedAssetId =
      rawData?.active_mesh_asset_id ||
      rawData?.active_mesh_asset?.asset_id ||
      result?.active_mesh_asset_id ||
      undefined;
    const isRetainedResult = Boolean(
      retainedAssetId &&
      (rawData?.persistence_status === 'saved' || rawData?.operation?.persistence_status === 'saved')
    );
    const retainedAssetLookupId = isRetainedResult && retainedAssetId ? retainedAssetId : jobId;
    const retainedFilename =
      rawData?.active_mesh_asset?.original_filename ||
      rawData?.active_mesh_asset?.relative_path?.split(/[\\/]/).pop() ||
      undefined;
    const retainedFormat = retainedFilename?.toLowerCase().endsWith('.obj') ? 'OBJ' : 'GLB';
    const activeTask = activeTaskRef.current;
    const isCurrentRouteWorkspace = Boolean(
      resolvedWorkspaceId && workspaceIdRef.current === resolvedWorkspaceId
    );
    const activeTaskBelongsToResultWorkspace = Boolean(
      activeTask?.workspaceId && activeTask.workspaceId === resolvedWorkspaceId
    );
    const shouldActivatePreview = activeTask
      ? activeTask.backendJobId === jobId ||
        activeTask.id === matchingTask?.id ||
        (isCurrentRouteWorkspace && !activeTaskBelongsToResultWorkspace)
      : (!workspaceIdRef.current || isCurrentRouteWorkspace);
    if (shouldActivatePreview && resolvedWorkspaceId) setWorkspaceId(resolvedWorkspaceId);
    if (shouldActivatePreview && resolvedOperationId) {
      setActiveTask(prev => prev && (prev.backendJobId === jobId || prev.id === matchingTask?.id) ? {
        ...prev,
        workspaceId: resolvedWorkspaceId || prev.workspaceId,
        operationId: resolvedOperationId || prev.operationId,
      } : prev);
    }
    const productionStatus = result.production_status || (result.postprocess_status === 'degraded' ? 'degraded' : 'ready');
    const degradedReasons = result.degraded_reasons || (result.texture_stage?.status === 'failed' ? ['texture_generation_failed'] : []);

    const retainedModelUrl = isRetainedResult && retainedAssetId
      ? `/api/v1/system/jobs/${encodeURIComponent(retainedAssetLookupId)}/download`
      : undefined;
    const resolvedModelUrl = retainedModelUrl || (
      result?.model_url ||
      result?.active_model_url ||
      result?.textured_model_url ||
      result?.mesh_url ||
      result?.source_model_url ||
      result?.rigged_model_url ||
      result?.download_url ||
      // output_mesh_path / mesh_path / output_path / file_path are backend
      // filesystem paths (temp or canonical storage), NOT HTTP URLs.
      // normalizeBackendAssetUrl would turn them into bogus /api/v1/content/...
      // paths that 404. The job download endpoint serves the durable artifact,
      // which the scheduler already copied into storage_root (see
      // multiprocess_scheduler.py _publish step). Fall through to it below.
      undefined
    ) || `/api/v1/system/jobs/${encodeURIComponent(jobId)}/download?artifact_format=glb`;

    if (resolvedModelUrl) {
      // Ensure the preview URL is same-origin proxied so MeshViewer can always
      // reach generated assets (raw output_mesh_path/download URLs otherwise
      // break MeshViewer loading).
      const proxiedModelUrl = toProxyUrl(resolvedModelUrl);
      const modelUrl =
        preferredGenerationPreviewUrl(result) ??
        proxiedModelUrl ??
        `/api/v1/system/jobs/${encodeURIComponent(jobId)}/download?artifact_format=glb`;
      const previewStats = preferredPreviewStats(result);
      const cleanName = promptTitle && promptTitle !== 'generate' && promptTitle !== 'asset' ? promptTitle : `Model_${jobId.slice(0, 6)}`;
      const resultArtifacts = result.artifacts && typeof result.artifacts === 'object' ? result.artifacts : {};
      const artifactSource = typeof resultArtifacts.source === 'string'
        ? resultArtifacts.source
        : (typeof resultArtifacts.source?.url === 'string' ? resultArtifacts.source.url : undefined);
      const candidateSourceAssetId = matchingTask?.sourceAssetId ||
        rawData?.operation?.input_asset_id ||
        rawData?.input_asset_id ||
        result.source_asset_id ||
        undefined;
      const sourceAssetRecord = Array.isArray(rawData?.assets)
        ? rawData.assets.find((asset: any) => asset.asset_id === candidateSourceAssetId)
        : undefined;
      // Generation input_asset_id can be an image. Only a retained mesh is a valid wipe predecessor.
      const sourceAssetId = undefined;
      const sourceFilename = [sourceAssetRecord?.original_filename, sourceAssetRecord?.relative_path]
        .find((filename: string | undefined) => Boolean(filename && /\.[a-z0-9]+$/i.test(filename))) || '';
      const sourceFormat = sourceFilename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'glb';
      const sourceAssetUrl = sourceAssetId
        ? `/api/v1/system/jobs/${encodeURIComponent(sourceAssetId)}/download?artifact_format=${sourceFormat}`
        : undefined;
      const comparisonSource = matchingTask?.sourceModelUrl || sourceAssetUrl || artifactSource || previewSourceUrl(result);
      const outputArtifacts = comparisonSource
        ? { ...resultArtifacts, source: comparisonSource }
        : result.artifacts;
      void prefetchGLB(modelUrl);
      const finalAssetId = isRetainedResult && retainedAssetId
        ? retainedAssetId
        : `preview_${resolvedOperationId || jobId}`;
      const outputAsset = normalizeModelAsset({
        id: finalAssetId,
        name: rawData?.active_mesh_asset?.original_filename || cleanName,
        category: isRetainedResult ? 'mesh' : 'generation',
        workspace_id: resolvedWorkspaceId,
        operation_id: resolvedOperationId,
       sourceAssetId,
       settingsSnapshot: matchingTask?.submissionSnapshot?.body || undefined,
        thumbnail: result.thumbnail_url || `/api/v1/system/jobs/${encodeURIComponent(retainedAssetLookupId)}/thumbnail`,
        source: {
          filename: isRetainedResult && retainedFilename ? retainedFilename : `${cleanName}.glb`,
          subfolder: 'generated',
          type: 'output',
          viewUrl: modelUrl,
          fileId: isRetainedResult ? retainedAssetLookupId : `job-${jobId}`,
        },
        polygon_count: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        vertex_count: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
        faces: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        vertices: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
        triangles: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        statsAvailable: Boolean(previewStats.faces || result.polygon_count || previewStats.vertices || result.vertex_count),
        topology: (result.topology as any) || (result.quality_trace?.game_ready?.quad_dominant ? 'Quad' : 'Triangle'),
        format: isRetainedResult ? retainedFormat : 'GLB',
        postprocessStatus: productionStatus === 'degraded' ? 'degraded' : (result.production_status || result.postprocess_status || 'completed'),
        productionStatus,
        degradedReasons,
        game_ready_url: (result.game_ready_url as string) || modelUrl,
        source_model_url: (result.source_model_url as string) || (result.high_fidelity_url as string),
        tags: ['AI Generated'],
        collision_url: result.collision_url,
        pbr_maps: result.pbr_maps,
        game_ready_formats: result.game_ready_formats,
        zip_url: result.zip_url,
        qa_report: result.qa_report,
        quality_trace: result.quality_trace,
        artifacts: outputArtifacts,
        candidates: result.candidates,
      });
      addAsset(outputAsset);
      void refreshAssets();
      if (shouldActivatePreview) {
        setSelectedAssetId(finalAssetId);
        setActiveMeshAssetId(finalAssetId);
        setExecutionState('completed');
        // All operations directly persist into workspace storage
        setPersistenceState('saved');
        setViewportResetTrigger(prev => prev + 1);
        loadModelInViewer(modelUrl, cleanName, outputAsset as any);
      }
      return outputAsset;
    }
    return null;
  }, [addAsset, setWorkspaceId, refreshAssets]);

  // Hydrate a deep link by workspace identity. UUID routes remain supported as legacy job links.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const routeIdentity = parseWorkspaceRouteIdentity(window.location.pathname);
    const routeId = routeIdentity.routeId;
    if (!routeId) return;

    const workspaceRouteId = routeIdentity.workspaceId;
    if (workspaceRouteId) setWorkspaceId(workspaceRouteId);

    let backendJobId = routeIdentity.legacyJobId || routeId;
    const mappedJobId = localStorage.getItem(`fm3d:job:${routeId}`);
    if (mappedJobId) backendJobId = mappedJobId;

    const currentTask = Object.values(jobsByIdRef.current).find(task =>
      task.backendJobId === backendJobId ||
      (workspaceRouteId && task.workspaceId === workspaceRouteId)
    );
    if (!currentTask || (!currentAssetRef.current && currentTask.status === 'completed')) {
      let cancelled = false;
      fetch(`/api/v1/system/jobs/${encodeURIComponent(backendJobId)}`)
        .then(res => (res.ok ? res.json() : null))
        .then(payload => {
          if (cancelled || !payload) return;
          const raw = payload?.data ?? payload;
          if (!raw) return;
          const data = normalizeBackendJob(raw);
          const nextStatus: ActiveTask['status'] = data.status === 'completed' ? 'completed'
            : data.status === 'failed' ? 'failed'
            : data.status === 'cancelled' ? 'interrupted'
            : data.status === 'queued' ? 'queued'
            : 'running';
          const currentMessage = data.message || (data.status === 'processing' ? 'Processing...' : data.status === 'failed' ? 'Process failed' : 'Queued on backend');
          const diagnostic = (data.status === 'failed' || data.status === 'cancelled') ? diagnoseJobError({
            id: routeId,
            status: data.status,
            error: data.error_message,
            error_message: data.error_message,
            model_id: (raw as any)?.model_id || (raw as any)?.model_preference,
            provider: (raw as any)?.model_id || (raw as any)?.model_preference,
          } as any) : undefined;

          const resolvedWorkspaceId = (raw as any)?.workspace_id || workspaceRouteId || undefined;
          const activeMesh = (raw as any)?.active_mesh_asset;
          const activeMeshAssetId = (raw as any)?.active_mesh_asset_id || activeMesh?.asset_id;
          if (resolvedWorkspaceId && activeMeshAssetId) {
            const activeMeshUrl = `/api/v1/system/jobs/${encodeURIComponent(activeMeshAssetId)}/download`;
            const activeMeshName = activeMesh?.original_filename || activeMesh?.name || `Workspace_${resolvedWorkspaceId}`;
            const activeMeshAsset = normalizeModelAsset({
              asset_id: activeMeshAssetId,
              id: activeMeshAssetId,
              workspace_id: resolvedWorkspaceId,
              operation_id: activeMesh?.operation_id,
              name: activeMeshName,
              category: 'mesh',
              thumbnail: `/api/v1/system/jobs/${encodeURIComponent(activeMeshAssetId)}/thumbnail`,
              source: {
                filename: activeMeshName,
                subfolder: activeMesh?.relative_path || 'mesh',
                type: 'output',
                viewUrl: activeMeshUrl,
                fileId: activeMeshAssetId,
              },
              format: String(activeMesh?.relative_path || '').toLowerCase().endsWith('.obj') ? 'OBJ' : 'GLB',
            });
            addAsset(activeMeshAsset);
            setSelectedAssetId(activeMeshAsset.id);
            setActiveMeshAssetId(activeMeshAsset.id);
            setPersistenceState('saved');
            loadModelInViewer(activeMeshUrl, activeMeshName, activeMeshAsset as any);
            setViewportResetTrigger(prev => prev + 1);
          }
          const resolvedOperationId = (raw as any)?.operation_id || undefined;
          const resolvedBackendJobId = (raw as any)?.job_id || backendJobId;
          const hydratedTask: ActiveTask = {
            id: `route_${routeId}`,
            backendJobId: resolvedBackendJobId,
            workspaceId: resolvedWorkspaceId,
            operationId: resolvedOperationId,
            isLocal: false,
            type: 'image-to-3d',
            title: (raw as any)?.metadata?.asset_name || (raw as any)?.inputs?.asset_name || `Job_${routeId.slice(0, 6)}`,
            startedAt: raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
            status: nextStatus,
            progress: data.progress,
            stage: data.stage,
            currentStep: currentMessage,
            provider: (raw as any)?.model_id || (raw as any)?.model_preference,
            errorMessage: data.error_message,
            errorCode: (data as any).error_code,
            diagnostic,
            logs: data.logs,
            result: data.result,
          };

          if (resolvedWorkspaceId) setWorkspaceId(resolvedWorkspaceId);
          setJobsById(prev => ({ ...prev, [hydratedTask.id]: hydratedTask }));
          setActiveTask(hydratedTask);
          if (nextStatus === 'running' || nextStatus === 'queued') {
            setIsExecuting(true);
            setExecutionProgress(data.progress);
            setExecutionStep(currentMessage);
          } else {
            setIsExecuting(false);
            if (nextStatus === 'completed') {
              loadCompletedJobResult(resolvedBackendJobId, raw, hydratedTask.title);
            }
          }
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }
  }, [pathname, loadCompletedJobResult, setWorkspaceId, addAsset, setActiveMeshAssetId, setPersistenceState]);

  useEffect(() => {
    if (activeTool === 'remesh') setWireframeMode('overlay');
  }, [activeTool]);

  const setActiveTool = useCallback((tool: ToolType) => {
    setActiveToolState(tool);
  }, []);

  const setMainNav = useCallback((nav: MainNavRoute) => {
    setMainNavState(nav);
  }, []);

  const setShadingMode = useCallback((mode: ShadingMode) => {
    setShadingModeState(mode);
    setViewerShadingMode(shadingModeToPreset(mode));
  }, [setViewerShadingMode]);

  const setWireframeModeAndSync = useCallback((mode: 'off' | 'overlay' | 'xray') => {
    setWireframeMode(mode);
    useViewerStore.setState({ wireframeOverlay: mode !== 'off' });
  }, []);

  const setShowWireframe = useCallback((show: boolean) => {
    setWireframeModeAndSync(show ? 'overlay' : 'off');
  }, [setWireframeModeAndSync]);

  const setShowGrid = useCallback((show: boolean) => {
    setShowGridState(show);
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, showGrid: show } }));
  }, []);

  const setShowBones = useCallback((show: boolean) => setShowBonesState(show), []);

  const setIsTurntable = useCallback((val: boolean) => {
    setIsTurntableState(val);
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, autoRotate: val } }));
  }, []);

  useEffect(() => {
    const onProgress = (data: unknown) => {
      const d = data as { value?: number; max?: number; node?: string };
      const progress = (d.max && d.max > 0) ? Math.min(100, Math.round(((d.value ?? 0) / d.max) * 100)) : 0;
      setExecutionProgress(progress);
      setActiveTask(prev => prev ? { ...prev, status: 'running', progress, activeNode: d.node ?? prev.activeNode, currentStep: d.node ? `Executing ${d.node}` : prev.currentStep } : prev);
    };
    const onExecuting = (data: unknown) => {
      const d = data as { node?: string };
      setIsExecuting(!!d.node);
      setExecutionStep(d.node ? `Executing ${d.node}` : '');
    };
    const onExecuted = () => {
      setIsExecuting(false);
      setExecutionProgress(100);
      setExecutionStep('Completed');
      setActiveTask(prev => prev ? { ...prev, status: 'completed', progress: 100, currentStep: 'Completed' } : prev);
      const backendJobId = activeTaskRef.current?.backendJobId;
      if (backendJobId) completeTask(backendJobId, 'completed');
      toast.success('Process completed successfully', {
        description: activeTaskRef.current?.title || '3D Asset Generation finished',
      });
    };
    const onError = (data: unknown) => {
      const d = data as { exception_message?: string; message?: string };
      setIsExecuting(false);
      setExecutionProgress(0);
      setExecutionStep(d.exception_message || d.message || 'Error');
      setActiveTask(prev => prev ? { ...prev, status: 'failed', currentStep: d.exception_message || 'Error' } : prev);
      const backendJobId = activeTaskRef.current?.backendJobId;
      if (backendJobId) completeTask(backendJobId, 'failed');
      toast.error('Process failed', {
        description: d.exception_message || d.message || 'An error occurred during execution',
      });
    };
     const off1 = apiClient.on('progress', onProgress);
     const off2 = apiClient.on('executing', onExecuting);
     const off3 = apiClient.on('executed', onExecuted);
     const off4 = apiClient.on('execution_error', onError);
     return () => { off1(); off2(); off3(); off4(); };
   }, []);
    // Poll batch job statuses periodically
    useEffect(() => {
     // Start/stop the batch poller only when the queue transitions between
     // having active jobs and having none. Read queue contents fresh per tick.
     if (!hasRunningBatchJobs) {
       // Clean up any existing polling interval
       if (batchPollingIntervalRef.current) {
         clearInterval(batchPollingIntervalRef.current);
         batchPollingIntervalRef.current = null;
       }
       return;
     }
     
     // Set up polling interval if not already set
     if (!batchPollingIntervalRef.current) {
       batchPollingIntervalRef.current = setInterval(async () => {
         try {
           const batchQueue = useAppStore.getState().batchQueue;
           // Get all unique job IDs from batch queue items that are running
             const jobIds = Array.from(new Set(
               batchQueue
                 .filter(item => item.status === 'running' && item.jobId)
                 .map(item => item.jobId)
                 .filter((id): id is string => id !== null && id !== undefined)
             ));
             
             // For each job ID, check its status
             for (const jobId of jobIds) {
               try {
                 const res = await fetch(`/api/v1/system/jobs/${encodeURIComponent(jobId)}`);
                 if (!res.ok) {
                   // If we can't fetch the job, it might have been cleaned up
                   // Find and remove any batch queue items referencing this job ID
                   batchQueue.forEach(item => {
                     if (item.jobId === jobId) {
                       updateBatchItem(item.id, {
                         status: 'failed',
                         error: 'Job tracking lost',
                         completedAt: new Date(),
                       });
                       // Clean up the job ID map
                       delete batchJobIdMap.current[jobId];
                     }
                   });
                   continue;
                 }
                 
                 const payload = await res.json();
                 const raw = payload?.data ?? payload;
                 if (!raw) continue;
                 
                 const data = normalizeBackendJob(raw);
                 
                 // Find the batch queue item associated with this job
                 const batchQueueItemId = batchJobIdMap.current[jobId];
                 if (!batchQueueItemId) continue;
                 
                 // Prepare updates for the batch queue item
                 const batchUpdates: Partial<BatchQueueItem> = {
                   progress: data.progress,
                 };
                 
                 // Update status based on job status
                 if (data.status === 'completed') {
                   batchUpdates.status = 'completed';
                   batchUpdates.completedAt = new Date();
                 } else if (data.status === 'failed') {
                   batchUpdates.status = 'failed';
                   batchUpdates.error = data.error_message || 'Unknown error';
                   batchUpdates.completedAt = new Date();
                 } else if (data.status === 'cancelled') {
                   batchUpdates.status = 'cancelled';
                   batchUpdates.error = 'Job cancelled';
                   batchUpdates.completedAt = new Date();
                 } else if (data.status === 'processing' || data.status === 'queued') {
                   batchUpdates.status = 'running';
                 }
                 
                 // Update the batch queue item
                 updateBatchItem(batchQueueItemId, batchUpdates);
                 
                 // Clean up completed/failed/cancelled jobs from tracking
                 if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                   delete batchJobIdMap.current[jobId];
                 }
               } catch (err) {
                 console.error('Error polling batch job status:', err);
                 // Continue with other jobs
               }
             }
         } catch (err) {
           console.error('Error in batch job polling loop:', err);
         }
       }, 5000); // Poll every 5 seconds
     }
     
     // Cleanup function
     return () => {
       if (batchPollingIntervalRef.current) {
         clearInterval(batchPollingIntervalRef.current);
         batchPollingIntervalRef.current = null;
       }
        // Clear the job ID map
        batchJobIdMap.current = {};
      };
    }, [hasRunningBatchJobs, updateBatchItem]);


function dataURLtoFile(dataURL: string, filename: string): File {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

  // Poll all active jobs in jobsById from backend so each queued/running job updates in real time
  useEffect(() => {
    // Poll backend job status so every generation reaches a terminal state
    // (completed / failed / interrupted) instead of leaving the UI stuck on
    // the progress bar. Jobs live in jobsById under their local task id key
    // (e.g. slug-hash or queue_*), while task.backendJobId holds the real
    // backend UUID to query against /api/v1/system/jobs/{id}.
    const activeJobEntries = Object.entries(jobsById).filter(([_, task]) => {
      const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted';
      return !isTerminal && !!task.backendJobId && !task.isLocal;
    });

    if (activeJobEntries.length === 0) {
      return;
    }

    let stopped = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      try {
        await Promise.all(
          activeJobEntries.map(async ([jobId, task]) => {
            try {
              const backendJobId = task.backendJobId || jobId;
              const res = await fetch(`/api/v1/system/jobs/${encodeURIComponent(backendJobId)}`);
              if (!res.ok) return;
              const payload = await res.json();
              const raw = payload?.data ?? payload;
              if (!raw || stopped) return;

              const data = normalizeBackendJob(raw);
              const progress = data.progress;
              const currentMessage = data.message || (data.status === 'processing' ? 'Processing...' : 'Queued on backend');

              const nextStatus = data.status === 'completed' ? 'completed'
                : data.status === 'failed' ? 'failed'
                : data.status === 'cancelled' ? 'interrupted'
                : 'running';

              const resolvedWorkspaceId = raw?.workspace_id || task.workspaceId;
              const resolvedOperationId = raw?.operation_id || task.operationId;
              const nextTask: ActiveTask = {
                ...task,
                status: nextStatus,
                progress,
                stage: data.stage || task.stage,
                currentStep: currentMessage,
                errorMessage: data.error_message || task.errorMessage,
                errorCode: (data as any).error_code || task.errorCode,
                logs: data.logs || task.logs,
                result: data.result || task.result,
                workspaceId: resolvedWorkspaceId,
                operationId: resolvedOperationId,
              };
              if (resolvedWorkspaceId && resolvedWorkspaceId !== workspaceIdRef.current && activeTaskRef.current?.id === task.id) {
                setWorkspaceId(resolvedWorkspaceId);
              }
              jobsByIdRef.current[jobId] = nextTask;

              setJobsById(prev => {
                const existing = prev[jobId];
                if (!existing) return prev;
                return {
                  ...prev,
                  [jobId]: nextTask,
                };
              });

              if (activeTaskRef.current?.id === task.id || activeTaskRef.current?.backendJobId === backendJobId) {
                setExecutionProgress(progress);
                setExecutionStep(currentMessage);
                const diagnostic = (nextStatus === 'failed' || nextStatus === 'interrupted') ? diagnoseJobError({
                  id: backendJobId,
                  status: data.status,
                  error: data.error_message,
                  error_message: data.error_message,
                  model_id: (task as any)?.provider || (data as any)?.model_id,
                  provider: (task as any)?.provider || (data as any)?.model_id,
                } as any) : undefined;
                setActiveTask(prev => prev && (prev.id === task.id || prev.backendJobId === backendJobId) ? {
                  ...prev,
                  status: nextStatus,
                  progress,
                  stage: data.stage,
                  currentStep: currentMessage,
                  errorMessage: data.error_message || prev.errorMessage,
                  errorCode: (data as any).error_code || prev.errorCode,
                  diagnostic: diagnostic || prev.diagnostic,
                  logs: data.logs || prev.logs,
                  result: data.result || prev.result,
                  workspaceId: resolvedWorkspaceId || prev.workspaceId,
                  operationId: resolvedOperationId || prev.operationId,
                } : prev);
              }

               if (data.status === 'completed' && task.status !== 'completed') {
                 const result = data.result || {};
                 const productionStatus = result.production_status || (result.postprocess_status === 'degraded' ? 'degraded' : 'ready');
                 const degradedReasons = result.degraded_reasons || (result.texture_stage?.status === 'failed' ? ['texture_generation_failed'] : []);
                 let description = task.title || '3D Asset ready';
                 if (productionStatus === 'ready') {
                   toast.success('Generation complete', { description });
                 } else if (productionStatus === 'degraded') {
                   const reasons = degradedReasons.length > 0 ? degradedReasons.join(', ') : 'quality or texture issue';
                   toast.warning('Generation completed with issues', {
                     description: `${description} (${reasons})`,
                   });
                 } else if (productionStatus === 'failed') {
                   toast.error('Generation failed', {
                     description: task.title || '3D Asset failed',
                   });
                 }

                 taskPersistence.addNotification({
                   title: task.title ? `${task.title} Completed` : '3D Generation Completed',
                   description,
                   status: productionStatus === 'failed' ? 'failed' : 'completed',
                   jobId: backendJobId,
                   assetId: raw?.active_mesh_asset_id || raw?.asset_id || backendJobId,
                 });

                 loadCompletedJobResult(backendJobId, raw, task.title);
                 if (task.type === 'animation') {
                   toast.success('Motion generation completed', { description: 'Animation clip generated successfully' });
                 }
               } else if ((data.status === 'failed' || data.status === 'cancelled') && task.status !== 'failed' && task.status !== 'interrupted') {
                 const errMsg = data.error_message || 'The job encountered an error during execution';
                 toast.error('Process failed', { description: errMsg });
                 taskPersistence.addNotification({
                   title: task.title ? `${task.title} Failed` : 'Job Failed',
                   description: errMsg,
                   status: 'failed',
                   jobId: backendJobId,
                 });
               }
             } catch (jobErr) {
               // ignore single job polling error
             }
           })
         );

         // Update overall isExecuting
         const hasRemainingActive = Object.values(jobsByIdRef.current).some(
           j => j.status === 'queued' || j.status === 'running'
         );
         if (!hasRemainingActive) {
           setIsExecuting(false);
         }

         if (!stopped) {
           timerId = setTimeout(poll, document.visibilityState === 'hidden' ? 3000 : 1200);
         }
       } catch (err) {
         if (!stopped) {
           timerId = setTimeout(poll, 3000);
         }
       }
     };

     void poll();
     return () => {
       stopped = true;
       if (timerId) clearTimeout(timerId);
     };
   }, [jobsById, loadCompletedJobResult]);

  const dismissJob = useCallback((jobId: string) => {
    setJobsById(prev => {
      const copy = { ...prev };
      delete copy[jobId];
      return copy;
    });
    if (activeTaskRef.current?.id === jobId) {
      setActiveTask(null);
      setIsExecuting(false);
      setExecutionStep('');
    }
  }, []);

  const selectJobToView = useCallback(async (jobId: string) => {
    const job = jobsByIdRef.current[jobId] || (activeTaskRef.current?.id === jobId ? activeTaskRef.current : null);
    if (!job) return;

    const routeIdentity = job.workspaceId || job.backendJobId;
    if (routeIdentity) setWorkspaceId(job.workspaceId || null);
    if (typeof window !== 'undefined' && routeIdentity) {
      const toolRoute = TOOL_TO_ROUTE[activeToolRef.current] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${routeIdentity}`);
      if (job.workspaceId && job.backendJobId) {
        localStorage.setItem(`fm3d:job:${job.workspaceId}`, job.backendJobId);
      }
    }

    const result = (job.result || {}) as Record<string, any>;
    const modelUrl = preferredGenerationPreviewUrl(result);
    const previewStats = preferredPreviewStats(result);
    if (modelUrl) {
      const promptTitle = job.title;
      const cleanName = promptTitle && promptTitle !== 'generate' ? promptTitle : `Model_${jobId.slice(0, 6)}`;
      void prefetchGLB(modelUrl);
      const previewAssetId = `preview_${job.operationId || job.backendJobId || job.id}`;
      const outputAsset = normalizeModelAsset({
        id: previewAssetId,
        name: cleanName,
        category: 'generation',
        workspace_id: job.workspaceId,
        operation_id: job.operationId,
        thumbnail: result.thumbnail_url || job.inputImage || '',
        source: { filename: `${cleanName}.glb`, subfolder: 'generated', type: 'output', viewUrl: modelUrl, fileId: `job-${job.backendJobId || jobId}` },
        polygon_count: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        vertex_count: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
        faces: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        vertices: isNativeRawPreview(result) ? previewStats.vertices : (result.vertex_count ?? previewStats.vertices),
        triangles: isNativeRawPreview(result) ? previewStats.faces : (result.polygon_count ?? previewStats.faces),
        statsAvailable: Boolean(previewStats.faces || result.polygon_count || previewStats.vertices || result.vertex_count),
        topology: (result.topology as any) || (result.quality_trace?.game_ready?.quad_dominant ? 'Quad' : 'Triangle'),
        format: 'GLB',
        postprocessStatus: result.production_status === 'degraded' ? 'degraded' : (result.production_status || result.postprocess_status || 'completed'),
        productionStatus: result.production_status || (result.postprocess_status === 'degraded' ? 'degraded' : 'ready'),
        degradedReasons: result.degraded_reasons,
        game_ready_url: (result.game_ready_url as string) || modelUrl,
        source_model_url: (result.source_model_url as string) || (result.high_fidelity_url as string) || undefined,
        tags: ['AI Generated'],
        candidates: result.candidates,
      });
      addAsset(outputAsset);
      setSelectedAssetId(outputAsset.id);
      setActiveMeshAssetId(outputAsset.id);
      setExecutionState('completed');
      setPersistenceState('not_saved');
      setViewportResetTrigger(prev => prev + 1);
      loadModelInViewer(modelUrl, cleanName, outputAsset as any);
      toast.success('Loaded model in viewport', { description: cleanName });
    } else {
      toast.info('Model is still generating or has no output URL yet.');
    }
  }, [addAsset, setWorkspaceId, setActiveMeshAssetId, setExecutionState, setPersistenceState]);

  const selectAsset = useCallback((id: string) => {
    const target = assetsRef.current.find((asset) => asset.id === id);
    setSelectedAssetId(id);
    setActiveMeshAssetId(id);
    setViewportResetTrigger(prev => prev + 1);
    const viewer = useViewerStore.getState();
    if (!target) {
      viewer.requestAssetSelection(null);
      viewer.setLoadedModel(null, null, null);
      return;
    }
    if (target.category !== 'texture' && target.format !== 'IMAGE' && target.format !== 'FILE') {
      const requestId = viewer.requestAssetSelection(target as any);
      viewer.verifyAsset(requestId);
      viewer.beginAssetLoad(requestId);
    } else {
      viewer.requestAssetSelection(null);
      viewer.setLoadedModel(null, null, null);
    }
  }, [setActiveMeshAssetId]);

  const setCurrentAsset = useCallback((asset: ModelAsset | null) => {
    if (!asset) {
      setSelectedAssetId(null);
      setActiveMeshAssetId(null);
      const viewer = useViewerStore.getState();
      viewer.requestAssetSelection(null);
      viewer.setLoadedModel(null, null, null);
      return;
    }
    const selectedId = addAsset(asset);
    setSelectedAssetId(selectedId);
    setActiveMeshAssetId(selectedId);
    setViewportResetTrigger(prev => prev + 1);
    const viewer = useViewerStore.getState();
    if (asset.category !== 'texture' && asset.format !== 'IMAGE' && asset.format !== 'FILE') {
      const requestId = viewer.requestAssetSelection({ ...asset, id: selectedId } as any);
      viewer.verifyAsset(requestId);
      viewer.beginAssetLoad(requestId);
    } else {
      viewer.requestAssetSelection(null);
      viewer.setLoadedModel(null, null, null);
    }

    // Clicking an asset should open its generate workspace so the user is
    // taken back to /workspace/generate/<workspace_id> from any tab or after
    // a refresh.
    const targetWsId = asset.workspace_id || (asset.id && !asset.id.startsWith('local_') && !asset.id.startsWith('upload_') ? asset.id.replace(/^job-/, '') : null);
    if (targetWsId) {
      setWorkspaceId(targetWsId);
      const targetRoute = `/workspace/generate/${targetWsId}`;
      if (typeof window !== 'undefined' && window.location.pathname !== targetRoute) {
        setActiveTool('model');
        setMainNav('workspace');
        // In workspace shell: replaceState keeps MeshViewer mounted. Outside
        // shell: full router.push navigation.
        if (pathname.startsWith('/workspace')) {
          window.history.replaceState(null, '', targetRoute);
        } else {
          router.push(targetRoute);
        }
      }
    }
  }, [addAsset, router, pathname, setActiveTool, setMainNav, setWorkspaceId, setActiveMeshAssetId]);

  const duplicateAsset = useCallback((id: string) => {
    const existing = assets.find(a => a.id === id);
    if (!existing) return;
    const dup: ModelAsset = {
      ...existing, id: `local_dup_${crypto.randomUUID()}`, name: `${existing.name}_copy`,
      dateCreated: new Date().toISOString().split('T')[0], isLocalDuplicate: true, sourceType: 'local',
    };
    setLocalAssets(prev => [dup, ...prev]);
    setAssets(prev => [dup, ...prev]);
    setCurrentAsset(dup);
  }, [assets, setCurrentAsset]);

  const updateAssetProperties = useCallback((id: string, updates: Partial<ModelAsset>) => {
    setLocalAssets(prev => {
      const idx = prev.findIndex(a => a.id === id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...updates };
        return copy;
      }
      return prev;
    });
    setAssets(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...updates } : a);
      const found = updated.find(a => a.id === id);
      if (found) {
        setLocalAssets(loc => {
          if (!loc.some(l => l.id === id)) {
            return [found, ...loc];
          }
          return loc.map(l => l.id === id ? found : l);
        });
      }
      return updated;
    });
  }, []);

  const updateMaterialConfig = useCallback((updates: Partial<MaterialConfig>) => {
    const asset = currentAssetRef.current;
    if (!asset) return;
    const cur = asset.materialConfig || { roughness: 0.5, metalness: 0.5, color: 'hsl(0, 0%, 50%)', wireframe: false, wireframeColor: 'hsl(0, 0%, 10%)', normalScale: 1.0, aoIntensity: 0.8, style: 'realistic' };
    updateAssetProperties(asset.id, { materialConfig: { ...cur, ...updates } });
  }, [updateAssetProperties]);

  const deleteAsset = useCallback(async (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (!asset) return false;
    const sourceIdentity = (item: ModelAsset) => item.source?.fileId || item.fileId || item.source?.viewUrl || item.source?.localUrl || null;
    const identity = sourceIdentity(asset);
    const hasDuplicateAliases = !asset.isLocalDuplicate && Boolean(identity) && assets.some(
      (candidate) => candidate.id !== id && candidate.isLocalDuplicate && sourceIdentity(candidate) === identity
    );
    if (hasDuplicateAliases) {
      toast.error('Remove this asset’s local duplicates before deleting its source.');
      return false;
    }
    try {
      const target = resolveAssetDeletionTarget(asset);
      if (target.kind === 'job') {
        const response = await fetch(`/api/v1/system/jobs/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) throw new Error(`Job deletion failed (HTTP ${response.status}).`);
      } else if (target.kind === 'upload') {
        const response = await fetch(`/api/v1/file-upload/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) throw new Error(`Upload deletion failed (HTTP ${response.status}).`);
      }
    } catch (error) {
      console.warn('Asset deletion failed:', error);
      toast.error(error instanceof Error ? error.message : 'Asset could not be deleted.');
      return false;
    }
    const wasActive = id === selectedAssetIdRef.current || id === activeMeshAssetIdRef.current;
    setDeletedAssetIds(prev => new Set(prev).add(id));
    setLocalAssets(prev => prev.filter(a => a.id !== id));
    setAssets(prev => prev.filter(a => a.id !== id));
    if (wasActive) {
      const nextAsset = assets.find(a => a.id !== id && a.category !== 'texture' && a.format !== 'IMAGE' && a.format !== 'FILE');
      setCurrentAsset(nextAsset || null);
    }
    queryClient.invalidateQueries({ queryKey: ['uploaded-assets'] });
    queryClient.invalidateQueries({ queryKey: ['history-assets'] });
    toast.success('Asset deleted.');
    return true;
  }, [assets, queryClient, setCurrentAsset]);

  const resetCamera = useCallback(() => {
    setViewportResetTrigger(prev => prev + 1);
  }, []);

  const fitToScreen = useCallback(() => setViewportResetTrigger(prev => prev + 1), []);

  const cancelExecution = useCallback(async () => {
    // Batch work uses this same controller only while its task is foreground;
    // an unrelated task gets its own controller and cannot cancel the batch queue.
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }

    const currentTask = activeTaskRef.current || activeTask;
    const jobId = currentTask?.id;

    setIsExecuting(false);
    setExecutionProgress(0);
    setExecutionStep('Execution cancelled');
    setExecutionState('cancelled');

    if (!jobId) {
      toast.info('Operation cancelled');
      return;
    }

    const backendJobId = currentTask?.backendJobId ||
      jobsByIdRef.current[jobId]?.backendJobId ||
      (!jobId.startsWith('local_') ? jobId : undefined);

    if (backendJobId) {
      completeTask(backendJobId, 'cancelled');
      try {
        const data = await getApiClient().cancelGenerationJob(backendJobId);
        if (data?.cancelled || data?.status === 'cancelled') {
          toast.success('Generation job cancelled');
        } else {
          toast.info('Job cancellation requested', { description: data?.message || 'The backend accepted the cancellation request.' });
        }
      } catch (error) {
        try {
          const response = await fetch(`/api/v1/system/jobs/${encodeURIComponent(backendJobId)}/cancel`, { method: 'POST' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (postErr) {
          console.warn('Backend cancel endpoint fallback error:', postErr);
          toast.error('Backend cancellation could not be confirmed');
        }
      }
    } else {
      toast.info('Operation cancelled');
    }

    setActiveTask(prev => prev && (prev.id === jobId || Boolean(backendJobId && prev.backendJobId === backendJobId)) ? {
      ...prev,
      status: 'cancelled',
      currentStep: 'Execution cancelled',
      stage: 'cancelled',
    } : prev);

    setJobsById(prev => {
      const activeTaskMatches = activeTaskRef.current && (activeTaskRef.current.id === jobId || Boolean(backendJobId && activeTaskRef.current.backendJobId === backendJobId));
      const existing = prev[jobId] || Object.values(prev).find(task => task.id === jobId || Boolean(backendJobId && task.backendJobId === backendJobId)) || (activeTaskMatches ? activeTaskRef.current : undefined);
      if (!existing) return prev;
      const taskKey = Object.keys(prev).find(key => prev[key] === existing) || jobId;
      const updated: ActiveTask = {
        ...existing,
        status: 'cancelled',
        currentStep: 'Execution cancelled',
        stage: 'cancelled',
      };
      const next = { ...prev, [taskKey]: updated };
      jobsByIdRef.current = next;
      return next;
    });
  }, [activeTask, getApiClient, setExecutionState, setIsExecuting, completeTask]);

  const startTask = useCallback((type: ActiveTask['type'], title: string, _promptId?: string, provider?: string, inputImage?: string, inputImageName?: string, sourceModelUrl?: string) => {
    // Every execution gets its own task identity. Workspace and backend job
    // identities are attached only after the API accepts the operation.
    // Each submission captures its own signal. Starting another task must
    // not abort an already-submitted sibling operation (notably batch jobs).
    activeAbortControllerRef.current = new AbortController();

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
    const taskId = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('capture-viewer-viewport'));
    const viewerState = useViewerStore.getState();
    const selectedAsset = assetsRef.current.find(asset => asset.id === selectedAssetIdRef.current) || null;
    const previewBaseline = captureWorkspacePreviewBaseline({
      workspaceId: workspaceIdRef.current,
      selectedAssetId: selectedAssetIdRef.current,
      selectedAsset,
      activeMeshAssetId: activeMeshAssetIdRef.current,
      workspaceVersions: workspaceVersionsRef.current,
      executionState: viewerState.executionState,
      persistenceState: viewerState.persistenceState,
      viewer: {
        loadedModelUrl: viewerState.loadedModelUrl,
        loadedModelName: viewerState.loadedModelName,
        selectedAsset: viewerState.selectedAsset,
        modelStats: viewerState.modelStats,
        shadingMode: viewerState.shadingMode,
        wireframeOverlay: viewerState.wireframeOverlay,
        activeContextTab: viewerState.activeContextTab,
        viewport: viewerState.viewport,
        compareMode: viewerState.compareMode,
        compareSyncCamera: viewerState.compareSyncCamera,
        compareLeftAssetId: viewerState.compareLeftAssetId,
        compareRightAssetId: viewerState.compareRightAssetId,
        workspaceId: viewerState.workspaceId,
        activeMeshAssetId: viewerState.activeMeshAssetId,
      },
    });
    const task: ActiveTask = {
      id: taskId,
      previewBaseline,
      isLocal: true,
      workspaceId: workspaceIdRef.current || undefined,
      type,
      title,
      startedAt: Date.now(),
      status: 'queued',
      progress: 0,
      currentStep: 'Queued',
      provider,
      inputImage,
      inputImageName,
      sourceAssetId: sourceModelUrl ? selectedAsset?.id : undefined,
      sourceModelUrl,
    };
    setIsExecuting(true);
    setExecutionProgress(0);
    setExecutionStep('Queued');
    setActiveTask(task);

    if (typeof window !== 'undefined' && workspaceIdRef.current) {
      const toolRoute = TOOL_TO_ROUTE[activeToolRef.current] || '/workspace/generate';
      window.history.replaceState(null, '', `${toolRoute}/${workspaceIdRef.current}`);
    }
    setJobsById(prev => ({ ...prev, [taskId]: task }));
    return taskId;
  }, []);

  const restorePreviewBaseline = useCallback((taskId?: string) => {
    const task = taskId
      ? jobsByIdRef.current[taskId] || (activeTaskRef.current?.id === taskId ? activeTaskRef.current : undefined)
      : activeTaskRef.current;
    const snapshot = task?.previewBaseline;
    if (!snapshot) throw new Error('This preview has no in-memory baseline. Reloaded previews cannot be discarded safely.');

    const currentWorkspaceId = workspaceIdRef.current;
    if (task?.workspaceId && task.workspaceId !== currentWorkspaceId) {
      throw new Error('The preview belongs to a different workspace.');
    }
    if (snapshot.workspaceId && snapshot.workspaceId !== currentWorkspaceId) {
      throw new Error('The saved baseline belongs to a different workspace.');
    }
    if (!snapshot.workspaceId && task?.workspaceId && currentWorkspaceId !== task.workspaceId) {
      throw new Error('The preview workspace changed before restoration.');
    }

    // The baseline workspace may be null when this task created the workspace.
    const plan = createWorkspacePreviewRestorePlan(snapshot, snapshot.workspaceId);
    if (plan.selectedAsset) addAsset(plan.selectedAsset);

    setWorkspaceId(plan.workspaceId);
    setWorkspaceVersions(plan.workspaceVersions);
    selectedAssetIdRef.current = plan.selectedAssetId;
    setSelectedAssetId(plan.selectedAssetId);
    setActiveMeshAssetId(plan.activeMeshAssetId);

    setExecutionState(plan.executionState);
    setPersistenceState(plan.persistenceState);
    setExecutionStatus(plan.executionState === 'running' || plan.executionState === 'queued' ? 'running' : 'idle');
    setExecutionProgress(0);
    setExecutionStep('');

    const viewer = useViewerStore.getState();
    viewer.setLoadedModel(plan.viewer.loadedModelUrl, plan.viewer.loadedModelName, plan.viewer.selectedAsset);
    viewer.setModelStats(plan.viewer.modelStats);
    viewer.setShadingMode(plan.viewer.shadingMode);
    viewer.setWireframeOverlay(plan.viewer.wireframeOverlay);
    viewer.setActiveContextTab(plan.viewer.activeContextTab);
    if (plan.viewer.viewport) viewer.setViewport(plan.viewer.viewport);
    else useViewerStore.setState({ viewport: null });
    viewer.setCompareMode(plan.viewer.compareMode);
    viewer.setCompareSyncCamera(plan.viewer.compareSyncCamera);
    viewer.setCompareLeftAsset(plan.viewer.compareLeftAssetId);
    viewer.setCompareRightAsset(plan.viewer.compareRightAssetId);
    viewer.setWorkspaceId(plan.workspaceId);
    viewer.setActiveMeshAssetId(plan.activeMeshAssetId);

    setShadingModeState(presetToShadingMode(plan.viewer.shadingMode) as ShadingMode);
    setWireframeMode(plan.viewer.wireframeOverlay ? 'overlay' : 'off');

    if (plan.viewer.loadedModelUrl) {
      loadModelInViewer(plan.viewer.loadedModelUrl, plan.viewer.loadedModelName, plan.viewer.selectedAsset);
    } else {
      useViewerStore.getState().setLoadedModel(null, null, null);
    }
    if (typeof window !== 'undefined' && plan.viewer.viewport) {
      window.dispatchEvent(new CustomEvent('restore-viewer-viewport', { detail: plan.viewer.viewport }));
    }
    setActiveTask(null);
  }, [addAsset, setWorkspaceId, setActiveMeshAssetId, setExecutionState, setPersistenceState]);

  const bindBackendJob = useCallback((
    localTaskId: string,
    jobId: string,
    updates: Partial<ActiveTask> = {},
    identity: { workspaceId?: string | null; operationId?: string | null; routePath?: string | null } = {},
  ) => {
    const currentTask = jobsByIdRef.current[localTaskId] ||
      (activeTaskRef.current?.id === localTaskId ? activeTaskRef.current : undefined);
    const resolvedWorkspaceId = identity.workspaceId || currentTask?.workspaceId || undefined;
    const resolvedOperationId = identity.operationId || currentTask?.operationId || undefined;
    if (resolvedWorkspaceId) setWorkspaceId(resolvedWorkspaceId);
    setExecutionState('queued');

    if (typeof window !== 'undefined') {
      if (resolvedWorkspaceId) {
        const toolRoute = TOOL_TO_ROUTE[activeToolRef.current] || '/workspace/generate';
        const routePath = identity.routePath?.startsWith('/workspace/')
          ? identity.routePath
          : `${toolRoute}/${resolvedWorkspaceId}`;
        window.history.replaceState(null, '', routePath);
        localStorage.setItem(`fm3d:job:${resolvedWorkspaceId}`, jobId);
      }
      localStorage.setItem(`fm3d:task:${localTaskId}`, jobId);
    }

    setJobsById(prev => {
      const task = prev[localTaskId] ||
        (activeTaskRef.current?.id === localTaskId ? activeTaskRef.current : undefined);
      if (!task) return prev;
      const next: ActiveTask = {
        ...task,
        ...updates,
        id: localTaskId,
        backendJobId: jobId,
        workspaceId: resolvedWorkspaceId,
        operationId: resolvedOperationId,
        isLocal: false,
      };
      registerTask({
        id: jobId,
        type: 'generation',
        status: next.status === 'interrupted' ? 'cancelled' : next.status,
        progress: next.progress,
        label: task.title,
        createdAt: task.startedAt,
        updatedAt: Date.now(),
        metadata: { localTaskId, workspaceId: resolvedWorkspaceId, operationId: resolvedOperationId },
      });
      startPolling();
      return { ...prev, [localTaskId]: next };
    });
    setActiveTask(prev => prev && prev.id === localTaskId
      ? { ...prev, ...updates, id: localTaskId, backendJobId: jobId, workspaceId: resolvedWorkspaceId, operationId: resolvedOperationId, isLocal: false }
      : prev);
  }, [setWorkspaceId]);

  const queueGenerationJob = useCallback(async (customSettings?: Partial<GenerationSettings>) => {
    const effective = { ...generationSettings, ...(customSettings || {}) };
    let effectiveFileId = effective.imageFileId;
    const imageInput = effective.image;

    if (!effectiveFileId && imageInput && imageInput.startsWith('data:')) {
      try {
        const file = dataURLtoFile(imageInput, effective.imageName || 'image.jpg');
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await getApiClient().post<{ file_id: string }>(
          '/api/v1/file-upload/image',
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        if (uploadRes?.file_id) {
          effectiveFileId = uploadRes.file_id;
          setGenerationSettings(prev => ({ ...prev, imageFileId: uploadRes.file_id }));
        }
      } catch (uploadErr) {
        console.error('Failed to upload image before queueing:', uploadErr);
      }
    }

    if (!effectiveFileId && !imageInput) {
      toast.error('Image required', { description: 'Please upload or select an image to queue.' });
      return null;
    }

    const newWorkspaceId = mintWorkspaceId(effective.imageName || 'mesh');
    setWorkspaceId(newWorkspaceId);
    setSelectedAssetId(null);
    setActiveMeshAssetId(null);
    setWorkspaceVersions([]);
    useViewerStore.getState().setLoadedModel(null, null, null);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `/workspace/generate/${newWorkspaceId}`);
    }

    const localTaskId = `queue_${crypto.randomUUID()}`;
    const queueIndex = Object.keys(jobsByIdRef.current).length + 1;
    const jobTitle = effective.imageName || `Queue #${queueIndex}`;
    const inputThumbnail = imageInput || (effectiveFileId ? `/api/v1/file-upload/download/${effectiveFileId}` : undefined);

    const newTask: ActiveTask = {
      id: localTaskId,
      isLocal: true,
      workspaceId: newWorkspaceId,
      type: 'image-to-3d',
      title: jobTitle,
      inputImage: inputThumbnail,
      inputImageName: effective.imageName,
      startedAt: Date.now(),
      status: 'queued',
      progress: 0,
      currentStep: 'Queueing on backend...',
      provider: effective.aiModel || 'auto',
    };

    setJobsById(prev => ({ ...prev, [localTaskId]: newTask }));
    setIsExecuting(true);

    try {
      const resolvedModelId = effective.aiModel || '';
      const finalSettings = { ...effective, imageFileId: effectiveFileId };

      const selectedCapabilities = modelDetails[resolvedModelId]?.capabilities || {};
      const modelCapabilities = resolveGenerationModelCapabilities(resolvedModelId, selectedCapabilities);
      const { endpoint, body } = buildGenerationParameters(finalSettings, modelCapabilities);
      body.workspace_id = newWorkspaceId;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: activeAbortControllerRef.current?.signal,
      });

      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const backendJobId = data.job_id ?? data.id;
      if (!backendJobId) throw new Error('Backend did not return a job ID');

      bindBackendJob(localTaskId, backendJobId, {
        status: 'queued',
        currentStep: 'Queued on backend',
        provider: resolvedModelId,
        inputImage: inputThumbnail,
      }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });

      toast.success('Job Queued in Background', {
        description: `${jobTitle} (${resolvedModelId || 'Default'})`,
      });

      return backendJobId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to queue job';
      setJobsById(prev => {
        if (!prev[localTaskId]) return prev;
        return {
          ...prev,
          [localTaskId]: {
            ...prev[localTaskId],
            status: 'failed',
            currentStep: errMsg,
            errorMessage: errMsg,
          }
        };
      });
      toast.error('Queue submission failed', { description: errMsg });
      return null;
    }
  }, [
    generationSettings,
    modelDetails,
    bindBackendJob,
    parseApiError,
    parseApiData,
  ]);



  const generate3DModel = useCallback(async () => {
    // Project is Image-to-3D only - no text-to-3D mode
    const imageInput = generationSettings.image;
    const imageFileId = generationSettings.imageFileId;
    const modelId = generationSettings.aiModel || '';
    
    if (!imageInput && !imageFileId) {
      setExecutionStep('Please upload or select an image first');
      toast.error('Image required', { description: 'Please upload an image to generate a 3D model.' });
      return;
    }
    if (generationSettings.enhancementEnabled && !generationSettings.preprocessingArtifactId) {
      setExecutionStep('Enhancement preview must be approved before generation');
      toast.error('Enhancement approval required', {
        description: 'Accept the Generation Preview or disable enhancement before generating.',
      });
      return;
    }

    // Initiating a new mesh generation MUST NOT reuse the current workspace.
    // It must mint a fresh workspace ID and navigate immediately to the new route.
    const newWorkspaceId = mintWorkspaceId(generationSettings.imageName || 'mesh');
    setWorkspaceId(newWorkspaceId);
    setSelectedAssetId(null);
    setActiveMeshAssetId(null);
    setWorkspaceVersions([]);
    useViewerStore.getState().setLoadedModel(null, null, null);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `/workspace/generate/${newWorkspaceId}`);
    }

    const inputThumbnail = imageInput || (imageFileId ? `/api/v1/file-upload/download/${imageFileId}` : undefined);
    const localTaskId = startTask(
      'image-to-3d',
      generationSettings.imageName || 'asset',
      undefined,
      generationSettings.aiModel || undefined,
      inputThumbnail,
      generationSettings.imageName || 'asset',
    );
    const signal = activeAbortControllerRef.current?.signal;

    try {
      const effectiveSettings = generationSettings;
      const effectiveModelId = modelId;

      // Route from the selected model's declared capabilities instead of forcing raw-mesh output.
      const selectedCapabilities = modelDetails[effectiveModelId]?.capabilities || {};
      const modelCapabilities = resolveGenerationModelCapabilities(effectiveModelId, selectedCapabilities);
      const { endpoint, body } = buildGenerationParameters(effectiveSettings, modelCapabilities);
      body.workspace_id = newWorkspaceId;
      const submissionSnapshot = {
        endpoint,
        body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
      };
      setJobsById(prev => prev[localTaskId]
        ? { ...prev, [localTaskId]: { ...prev[localTaskId], submissionSnapshot } }
        : prev);
      setActiveTask(prev => prev?.id === localTaskId ? { ...prev, submissionSnapshot } : prev);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; status?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a generation job ID');
      bindBackendJob(localTaskId, jobId, {
        status: 'queued',
        currentStep: 'Queued on backend',
        provider: effectiveModelId,
        inputImage: inputThumbnail,
      }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('Generation queued on backend');
      setActiveTask(prev => prev ? {
        ...prev,
        logs: [...(prev.logs || []), {
          stage: 'synthesis',
          progress: 35,
          message: `Generation request accepted — ${effectiveModelId} queued on backend`,
          level: 'success',
          timestamp: new Date().toISOString(),
        }]
      } : null);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('Generation cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'Generation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      const diagnostic = diagnoseJobError({
        id: 'submit-error',
        status: 'failed',
        error: message,
        error_message: message,
        provider: generationSettings.aiModel || '',
      } as any);
      setActiveTask(prev => prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message, diagnostic } : null);
      toast.error('Generation failed', { description: message });
    }
  }, [
    generationSettings,
    modelDetails,
    startTask,
    bindBackendJob,
    parseApiError,
    parseApiData,
    setIsExecuting,
    setExecutionStep,
  ]);

  const regeneratePreview = useCallback(async (taskId?: string) => {
    const sourceTask = taskId
      ? jobsByIdRef.current[taskId] || (activeTaskRef.current?.id === taskId ? activeTaskRef.current : undefined)
      : activeTaskRef.current;
    if (!sourceTask || sourceTask.type !== 'image-to-3d') {
      throw new Error('Regenerate is currently supported for image-to-mesh previews.');
    }
    if (!sourceTask.operationId || !sourceTask.workspaceId || !sourceTask.submissionSnapshot) {
      throw new Error('The original operation identity or request snapshot is unavailable.');
    }
    if (sourceTask.workspaceId !== workspaceIdRef.current) {
      throw new Error('The preview belongs to a different workspace.');
    }

    const request = createWorkspaceRegenerationRequest(
      sourceTask.submissionSnapshot,
      sourceTask.workspaceId,
      sourceTask.operationId,
    );
    const localTaskId = startTask(
      'image-to-3d',
      sourceTask.title,
      undefined,
      sourceTask.provider,
      sourceTask.inputImage,
      sourceTask.inputImageName,
    );
    setJobsById(prev => prev[localTaskId]
      ? { ...prev, [localTaskId]: { ...prev[localTaskId], submissionSnapshot: sourceTask.submissionSnapshot } }
      : prev);
    setActiveTask(prev => prev?.id === localTaskId
      ? { ...prev, submissionSnapshot: sourceTask.submissionSnapshot }
      : prev);

    const signal = activeAbortControllerRef.current?.signal;
    try {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
        signal,
      });
      if (!response.ok) throw await parseApiError(response);
      const data = await parseApiData<{
        job_id?: string;
        id?: string;
        workspace_id?: string;
        operation_id?: string;
        route_path?: string;
      }>(response);
      const jobId = data.job_id ?? data.id;
      if (!jobId || !data.operation_id) {
        throw new Error('Backend did not return the new job and operation identities.');
      }
      bindBackendJob(localTaskId, jobId, {
        status: 'queued',
        currentStep: 'Regeneration queued on backend',
        provider: sourceTask.provider,
        inputImage: sourceTask.inputImage,
      }, {
        workspaceId: data.workspace_id,
        operationId: data.operation_id,
        routePath: data.route_path,
      });
      setExecutionStep('Regeneration queued on backend');
      toast.success('Regeneration queued', {
        description: 'A new operation was created. Previous outputs remain unchanged.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Regeneration submission failed';
      setIsExecuting(false);
      setExecutionState('failed');
      setExecutionStep(message);
      setJobsById(prev => prev[localTaskId]
        ? { ...prev, [localTaskId]: { ...prev[localTaskId], status: 'failed' as const, currentStep: message, errorMessage: message } }
        : prev);
      setActiveTask(prev => prev?.id === localTaskId
        ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message }
        : prev);
      toast.error('Regeneration failed', { description: message });
      throw error;
    }
  }, [startTask, bindBackendJob, parseApiError, parseApiData, setIsExecuting, setExecutionState, setExecutionStep]);

async function resolveMeshReference(asset?: ModelAsset | null, signal?: AbortSignal): Promise<{ mesh_file_id?: string; mesh_path?: string }> {
  if (!asset) {
    throw new Error('No model selected. Generate or import a model first.');
  }
  const explicitFileId = asset.source?.fileId || asset.fileId;
  if (explicitFileId) {
    return { mesh_file_id: explicitFileId };
  }
  const rawUrl = asset.source?.localUrl || asset.source?.viewUrl || '';
  if (!rawUrl) {
    throw new Error('This model has no backend file reference. Re-import it via Assets to run this tool.');
  }
  const matchFileId = rawUrl.match(/\/api\/v1\/file-upload\/download\/([^/?#]+)/i);
  if (matchFileId) {
    return { mesh_file_id: matchFileId[1] };
  }
  if (rawUrl.startsWith('blob:')) {
    try {
      const blobRes = await fetch(rawUrl, { signal });
      const blob = await blobRes.blob();
      const fileName = asset.name ? (asset.name.endsWith('.glb') || asset.name.endsWith('.obj') ? asset.name : `${asset.name}.glb`) : 'model.glb';
      const formData = new FormData();
      formData.append('file', new File([blob], fileName, { type: blob.type || 'model/gltf-binary' }));
      const uploadRes = await fetch('/api/v1/file-upload/mesh', { method: 'POST', body: formData, signal });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const fileId = uploadData.file_id || uploadData.id;
        if (fileId) {
          if (asset.source) asset.source.fileId = fileId;
          return { mesh_file_id: fileId };
        }
      }
    } catch (e: any) {
      if (signal?.aborted || e?.name === 'AbortError') throw new Error('Operation cancelled by user');
      console.warn('Auto-upload local blob mesh failed:', e);
    }
  }
  return { mesh_path: rawUrl };
}

  const runRemeshGeneration = useCallback(async (customSettings?: {
    polyType?: string;
    targetPolycount?: number;
    preserveEdges?: boolean;
    featureAngle?: number;
    adaptiveDensity?: boolean;
    watertightHealing?: boolean;
    outputFormat?: string;
  }) => {
    const localTaskId = startTask(
      'remesh',
      'Neural Remesh (TriFlow)',
      undefined,
      'triflow_retopology',
    );
    const signal = activeAbortControllerRef.current?.signal;
    try {
      setIsExecuting(true);
      const meshRef = await resolveMeshReference(currentAsset, signal);
      const targetPoly = customSettings?.targetPolycount ?? remeshSettings.targetPolycount;
      const polyType = customSettings?.polyType || remeshSettings.polyType;
      const meshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || (meshRef.mesh_file_id ? `/api/v1/file-upload/download/${meshRef.mesh_file_id}` : '');

      // AI Mode Execution
      const body: Record<string, unknown> = {
        output_format: customSettings?.outputFormat || (polyType === 'quad' ? 'obj' : 'glb'),
        model_preference: 'triflow_retopology',
        target_polycount: targetPoly,
        face_count: targetPoly,
        poly_type: polyType,
        quad_ratio: polyType === 'quad' ? 0.95 : 0.0,
        preserve_features: customSettings?.preserveEdges ?? true,
        feature_angle: customSettings?.featureAngle ?? 45,
        adaptive: customSettings?.adaptiveDensity ?? true,
        watertight: customSettings?.watertightHealing ?? false,
        workspace_id: currentAsset?.workspace_id || workspaceIdRef.current || undefined,
        ...meshRef,
      };

      const res = await fetch('/api/v1/retopo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a remesh job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('Remesh queued on backend');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('Remesh cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'Remesh submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask((prev) => (prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : null));
      toast.error('Remesh failed', { description: message });
    }
  }, [remeshSettings, currentAsset, startTask, bindBackendJob, parseApiError, parseApiData, addAsset, selectAsset, setViewportResetTrigger]);

  const runTextureGeneration = useCallback(async () => {
    // Texture generation is standalone: operates on an existing mesh + reference image.
    // The mesh reference comes from the currently selected asset; the image reference
    // comes from textureSettings (never from the mesh asset's fileId).
    if (!currentAsset) {
      const message = 'No mesh selected. Please select a 3D mesh to texture.';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : null);
      toast.error(message);
      return;
    }

    const referenceImage = textureSettings.referenceImage;
    const referenceImageFileId = textureSettings.referenceImageFileId;
    const hasImageReference = Boolean(referenceImage || referenceImageFileId);

    const modelPreference = textureSettings.modelId || 'hunyuan3d_paint_v21_image_mesh_painting';

    const localTaskId = startTask('texture', 'Texture generation', undefined, modelPreference);
    const signal = activeAbortControllerRef.current?.signal;
    try {
      const meshRef = await resolveMeshReference(currentAsset, signal);
      const { endpoint, body } = buildTextureGenerationParameters(
        { ...textureSettings, modelId: modelPreference },
        meshRef,
        {
          url: referenceImage,
          fileId: referenceImageFileId,
        },
      );

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a texture job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('Texture generation queued on backend');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('Texture generation cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'Texture generation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      const diagnostic = diagnoseJobError({
        id: 'submit-error',
        status: 'failed',
        error: message,
        error_message: message,
        provider: textureSettings.modelId || '',
      } as any);
      setActiveTask(prev => prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message, diagnostic } : null);
      toast.error('Texture generation failed', { description: message });
    }
  }, [textureSettings, currentAsset, startTask, bindBackendJob, parseApiError, parseApiData]);

  const runUVUnwrapGeneration = useCallback(async (customSettings?: {
    distortionThreshold?: number;
    packMethod?: string;
    outputFormat?: string;
    saveIndividualParts?: boolean;
    unwrapStrategy?: 'organic' | 'hard_surface' | 'hybrid' | string;
    atlasResolution?: number | string;
    islandMargin?: number;
    boundaryPacker?: boolean;
    symmetryStacking?: boolean;
    modelParameters?: Record<string, any>;
  }) => {
    const localTaskId = startTask(
      'uv',
      'Smart UV Unwrapping (PartUV)',
      undefined,
      'partuv_uv_unwrapping',
    );
    const signal = activeAbortControllerRef.current?.signal;
    try {
      setIsExecuting(true);
      const meshRef = await resolveMeshReference(currentAsset, signal);
      const meshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || (meshRef.mesh_file_id ? `/api/v1/file-upload/download/${meshRef.mesh_file_id}` : '');

      // AI Mode Execution
      const body: Record<string, unknown> = {
        workspace_id: currentAsset?.workspace_id || workspaceIdRef.current || undefined,
        distortion_threshold: customSettings?.distortionThreshold ?? 1.25,
        pack_method: customSettings?.packMethod || 'blender',
        save_individual_parts: customSettings?.saveIndividualParts ?? true,
        save_visuals: false,
        output_format: customSettings?.outputFormat || 'glb',
        model_preference: 'partuv_uv_unwrapping',
        boundary_packer: customSettings?.boundaryPacker ?? true,
        symmetry_stacking: customSettings?.symmetryStacking ?? false,
        unwrap_strategy: customSettings?.unwrapStrategy || 'hybrid',
        atlas_resolution: customSettings?.atlasResolution || 2048,
        island_margin: customSettings?.islandMargin ?? 4,
        ...meshRef,
      };
      if (customSettings?.modelParameters) {
        body.model_parameters = customSettings.modelParameters;
      }

      const res = await fetch('/api/v1/unwrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a UV unwrapping job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('UV unwrapping queued on backend');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('UV unwrapping cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'UV unwrapping submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask((prev) => (prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : null));
      toast.error('UV unwrapping failed', { description: message });
    }
  }, [currentAsset, startTask, bindBackendJob, parseApiError, parseApiData, addAsset, selectAsset, setViewportResetTrigger]);

  const runSegmentation = useCallback(async (customSettings?: {
    numParts?: number;
    method?: string;
    hierarchical?: boolean;
    minFaceIslandThreshold?: number;
    colorizePreview?: boolean;
    saveIndividualParts?: boolean;
    outputFormat?: string;
    modelParameters?: Record<string, any>;
    modelPreference?: string;
  } | number) => {
    const settingsObj = typeof customSettings === 'number' ? { numParts: customSettings } : (customSettings || {});
    const numParts = settingsObj.numParts ?? 8;
    const outputFormat = settingsObj.outputFormat ?? 'glb';
    const pref = settingsObj.modelPreference || '';

    const localTaskId = startTask(
      'segment',
      'Semantic Part Segmentation (AI)',
      undefined,
      pref || undefined,
    );
    const signal = activeAbortControllerRef.current?.signal;
    try {
      setIsExecuting(true);
      const meshRef = await resolveMeshReference(currentAsset, signal);
      const meshUrl = currentAsset?.source?.localUrl || currentAsset?.source?.viewUrl || (meshRef.mesh_file_id ? `/api/v1/file-upload/download/${meshRef.mesh_file_id}` : '');

      // AI Mode Execution
      const body: Record<string, unknown> = {
        workspace_id: currentAsset?.workspace_id || workspaceIdRef.current || undefined,
        num_parts: numParts,
        output_format: outputFormat,
        model_preference: pref || 'partfield_segmentation',
        method: settingsObj.method || 'semantic',
        hierarchical: Boolean(settingsObj.hierarchical),
        min_face_island_threshold: Number(settingsObj.minFaceIslandThreshold ?? settingsObj.modelParameters?.min_face_island_threshold ?? 50),
        colorize_preview: settingsObj.colorizePreview ?? settingsObj.modelParameters?.colorize_preview ?? true,
        save_individual_parts: settingsObj.saveIndividualParts ?? settingsObj.modelParameters?.save_individual_parts ?? false,
        ...meshRef,
      };
      if (settingsObj.modelParameters) {
        body.model_parameters = settingsObj.modelParameters;
      }

      const res = await fetch('/api/v1/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a segmentation job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Queued on backend' }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('Mesh segmentation queued on backend');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('Segmentation cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'Segmentation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask((prev) => (prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : null));
      toast.error('Segmentation failed', { description: message });
    }
  }, [currentAsset, startTask, bindBackendJob, parseApiError, parseApiData]);

  const runAutoRigging = useCallback(async (options?: {
    skeletonTemplate?: string;
    bindPose?: string;
    exportFormat?: string;
    modelPreference?: string;
    modelParameters?: Record<string, any>;
    customSettings?: Record<string, any>;
  }) => {
    const modelPref = options?.modelPreference || 'skintokens_auto_rigging';
    const localTaskId = startTask('rigging', 'Auto-Rig Character', undefined, modelPref);
    const signal = activeAbortControllerRef.current?.signal;
    try {
      const meshRef = await resolveMeshReference(currentAsset, signal);
      const body: Record<string, unknown> = {
        workspace_id: currentAsset?.workspace_id || workspaceIdRef.current || undefined,
        rig_mode: options?.skeletonTemplate || 'humanoid',
        output_format: (options?.exportFormat || 'glb').toLowerCase(),
        model_preference: modelPref,
        model_parameters: {
          ...(options?.modelParameters || {}),
          bind_pose: options?.bindPose || 't_pose',
        },
        ...meshRef,
      };

      const res = await fetch('/api/v1/rig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return an auto-rigging job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Auto-rigging queued on backend' }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('Auto-rigging queued on backend');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('Auto-rigging cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'Auto-rigging submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : null);
      toast.error('Auto-rigging failed', { description: message });
    }
  }, [currentAsset, startTask, bindBackendJob, parseApiError, parseApiData]);

  const runMotionGeneration = useCallback(async (options?: {
    prompt?: string;
    duration?: number;
    seed?: number;
    frameRate?: string;
    targetSkeleton?: string;
    footSkatingCleanup?: boolean;
    modelParameters?: Record<string, any>;
    customSettings?: Record<string, any>;
  }) => {
    const promptText = options?.prompt || 'Walking motion cycle';
    const localTaskId = startTask('animation', 'Apply Animation', promptText, 'ardy_motion_generation');
    const signal = activeAbortControllerRef.current?.signal;
    try {
      const body: Record<string, unknown> = {
        prompt: promptText,
        duration: options?.duration ?? 5.0,
        seed: options?.seed ?? Math.floor(Math.random() * 1000000),
        target_skeleton: options?.targetSkeleton || 'core',
        post_process: options?.footSkatingCleanup ?? true,
        checkpoint: 'ARDY-Core-RP-20FPS-Horizon40',
        model_preference: 'ardy_motion_generation',
      };

      const res = await fetch('/api/v1/motion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await parseApiError(res);
      const data = await parseApiData<{ job_id?: string; id?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
      const jobId = data.job_id ?? data.id;
      if (!jobId) throw new Error('Backend did not return a motion generation job ID');
      bindBackendJob(localTaskId, jobId, { status: 'queued', currentStep: 'Motion generation queued on backend' }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });
      setExecutionStep('Motion generation queued on backend');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled')))) {
        console.log('Motion generation cancelled by user');
        return;
      }
      const message = error instanceof Error ? error.message : 'Motion generation submission failed';
      setIsExecuting(false);
      setExecutionStep(message);
      setActiveTask(prev => prev ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : null);
      toast.error('Motion generation failed', { description: message });
    }
  }, [startTask, bindBackendJob, parseApiError, parseApiData]);

   // Batch processing function
    const processBatchQueue = useCallback(async () => {
      const appStore = useAppStore.getState();
      const { batchGenerationEnabled, batchQueue } = appStore;

      if (!batchGenerationEnabled) {
        toast.error('Batch generation disabled', { description: 'Enable batch generation in settings to process the queue.' });
        return;
      }
      if (batchAbortControllerRef.current) {
        toast.info('Batch processing is already running or stopping.');
        return;
      }

      const queuedItems = batchQueue.filter(item => item.status === 'queued' && !item.jobId);
      if (queuedItems.length === 0) {
        toast.info('No items to process', { description: 'The batch queue is empty or all items have been processed.' });
        return;
      }

      const batchController = new AbortController();
      batchAbortControllerRef.current = batchController;
      let submittedCount = 0;

      try {
        for (const batchItem of queuedItems) {
          if (batchController.signal.aborted) break;
          let localTaskId: string | null = null;

          try {
            if (!batchItem.imageFileId) throw new Error('Missing image file ID for batch item');

            const batchTexQuality = batchItem.textureQuality as string | undefined;
            const batchTexRes: '512' | '1K' | '2K' | '4K' | '8K' =
              batchItem.texture_resolution ??
              batchItem.textureResolution ??
              (batchTexQuality === '8k' ? '8K' : batchTexQuality === 'ultra' ? '4K' : batchTexQuality === 'high' ? '2K' : '1K');
            const batchSettings: GenerationSettings = {
              mode: 'image-to-3d',
              image: null,
              imageFileId: batchItem.imageFileId,
              aiModel: batchItem.aiModel,
              textureQuality: (batchItem.textureQuality as any) ?? 'high',
              texture_resolution: batchTexRes,
              textureResolution: batchTexRes,
              quadTopology: batchItem.quadTopology ?? false,
              topologyMode: batchItem.topologyMode ?? 'triangle',
              seed: batchItem.seed ?? (Math.floor(Math.random() * 900000) + 100000),
              removeBackground: batchItem.removeBackground ?? true,
              autoOptimizeSettings: batchItem.autoOptimizeSettings ?? { targetPolycount: 0 },
              generateTexture: batchItem.generateTexture ?? true,
              highResolutionNormalBaking: batchItem.highResolutionNormalBaking ?? true,
              generateLOD: batchItem.generateLOD ?? false,
              lodPreset: batchItem.lodPreset ?? 'high',
              lodCount: batchItem.lodCount ?? 4,
              candidateCount: batchItem.candidateCount ?? 1,
              partCountRange: batchItem.partCountRange ?? '1',
              rigType: batchItem.rigType ?? 'none',
              exportFormats: batchItem.exportFormats ?? ['glb'],
              slicerHandoff: batchItem.slicerHandoff ?? false,
              generateCollision: batchItem.generateCollision ?? true,
              preprocessingArtifactId: batchItem.preprocessingArtifactId,
              preprocessingReviewOverride: batchItem.preprocessingReviewOverride ?? false,
              preprocessingPreviewUrl: null,
              preprocessingMetadata: batchItem.preprocessingMetadata,
              enhancementEnabled: batchItem.enhancementEnabled ?? false,
              enablePrintabilityCheck: batchItem.enablePrintabilityCheck ?? false,
              enableAutoRepair: batchItem.enableAutoRepair ?? false,
              enableAutoRig: batchItem.enableAutoRig ?? false,
              autoRigMode: batchItem.autoRigMode ?? 'full',
              enablePostprocess: batchItem.enablePostprocess ?? true,
            };

            localTaskId = startTask(
              'image-to-3d',
              `Batch Item ${batchItem.id.slice(-6)}`,
              undefined,
              batchItem.aiModel || '',
            );
            activeAbortControllerRef.current = batchController;

            const effectiveModelId = batchSettings.aiModel || '';
            const selectedCapabilities = modelDetails[effectiveModelId]?.capabilities || {};
            const modelCapabilities = resolveGenerationModelCapabilities(effectiveModelId, selectedCapabilities);
            const { endpoint, body } = buildGenerationParameters(batchSettings, modelCapabilities);
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: batchController.signal,
            });
            if (!res.ok) throw await parseApiError(res);

            const data = await parseApiData<{ job_id?: string; id?: string; status?: string; workspace_id?: string; operation_id?: string; route_path?: string }>(res);
            const jobId = data.job_id ?? data.id;
            if (!jobId) throw new Error('Backend did not return a generation job ID');

            batchJobIdMap.current[jobId] = batchItem.id;
            bindBackendJob(localTaskId, jobId, {
              status: 'queued',
              currentStep: 'Queued on backend',
              provider: batchSettings.aiModel || '',
            }, { workspaceId: data.workspace_id, operationId: data.operation_id, routePath: data.route_path });

            if (batchController.signal.aborted) {
              updateBatchItem(batchItem.id, { jobId, status: 'cancelled', progress: 0, completedAt: new Date() });
              try {
                await getApiClient().cancelGenerationJob(jobId);
              } catch (cancelError) {
                try {
                  const response = await fetch(`/api/v1/system/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                } catch (fallbackError) {
                  console.warn(`Failed to cancel newly accepted batch job ${jobId}:`, fallbackError || cancelError);
                }
              }
              completeTask(jobId, 'cancelled');
              setJobsById(prev => {
                const existing = prev[localTaskId!];
                if (!existing) return prev;
                const next = { ...prev, [localTaskId!]: { ...existing, status: 'cancelled' as const, currentStep: 'Batch execution cancelled', stage: 'cancelled' } };
                jobsByIdRef.current = next;
                return next;
              });
              setActiveTask(prev => prev?.id === localTaskId ? { ...prev, status: 'cancelled' as const, currentStep: 'Batch execution cancelled', stage: 'cancelled' } : prev);
              if (activeTaskRef.current?.id === localTaskId) setExecutionState('cancelled');
              delete batchJobIdMap.current[jobId];
              break;
            }

            updateBatchItem(batchItem.id, { jobId, status: 'running', progress: 0, startedAt: new Date() });
            submittedCount += 1;
          } catch (error) {
            if (batchController.signal.aborted) {
              updateBatchItem(batchItem.id, { status: 'cancelled', completedAt: new Date() });
              if (localTaskId) {
                setJobsById(prev => {
                  const existing = prev[localTaskId!];
                  if (!existing) return prev;
                  const next = { ...prev, [localTaskId!]: { ...existing, status: 'cancelled' as const, currentStep: 'Batch execution cancelled', stage: 'cancelled' } };
                  jobsByIdRef.current = next;
                  return next;
                });
                setActiveTask(prev => prev?.id === localTaskId ? { ...prev, status: 'cancelled' as const, currentStep: 'Batch execution cancelled', stage: 'cancelled' } : prev);
                if (activeTaskRef.current?.id === localTaskId) {
                  setIsExecuting(false);
                  setExecutionProgress(0);
                  setExecutionStep('Batch execution cancelled');
                  setExecutionState('cancelled');
                }
              }
              break;
            }

            const message = error instanceof Error ? error.message : 'Batch item processing failed';
            console.error('Failed to process batch item:', error);
            updateBatchItem(batchItem.id, { status: 'failed', error: message, completedAt: new Date() });
            if (localTaskId) {
              setJobsById(prev => {
                const existing = prev[localTaskId!];
                if (!existing) return prev;
                const next = { ...prev, [localTaskId!]: { ...existing, status: 'failed' as const, currentStep: message, errorMessage: message } };
                jobsByIdRef.current = next;
                return next;
              });
              setActiveTask(prev => prev?.id === localTaskId ? { ...prev, status: 'failed' as const, currentStep: message, errorMessage: message } : prev);
              if (activeTaskRef.current?.id === localTaskId) {
                setIsExecuting(false);
                setExecutionProgress(0);
                setExecutionStep(message);
                setExecutionState('failed');
              }
            }
            toast.error(`Batch item failed: ${message}`);
          }
        }

        if (!batchController.signal.aborted) {
          toast.success('Batch processing started', { description: `${submittedCount} items submitted for processing.` });
        }
      } finally {
        if (batchAbortControllerRef.current === batchController) batchAbortControllerRef.current = null;
        if (activeAbortControllerRef.current === batchController) activeAbortControllerRef.current = null;
      }
    }, [modelDetails, startTask, bindBackendJob, getApiClient, parseApiError, parseApiData, buildGenerationParameters, completeTask, setExecutionState, setIsExecuting, setExecutionProgress, setExecutionStep, toast]);

   // Cancel batch processing function
   const cancelBatchProcessing = useCallback(async () => {
     const batchController = batchAbortControllerRef.current;
     if (batchController) batchController.abort();
     if (activeAbortControllerRef.current === batchController) activeAbortControllerRef.current = null;

     const appStore = useAppStore.getState();
     const { batchQueue, updateBatchItem } = appStore;
     const itemsToCancel = batchQueue.filter(item => item.status === 'running' || item.status === 'queued');

     if (itemsToCancel.length === 0) {
       toast.info('No items to cancel', { description: 'There are no running or queued batch items to cancel.' });
       return;
     }

     for (const item of itemsToCancel) {
       if (!item.jobId) {
         updateBatchItem(item.id, { status: 'cancelled', completedAt: new Date() });
         continue;
       }

       const backendJobId = item.jobId;
       try {
         await getApiClient().cancelGenerationJob(backendJobId);
       } catch (error) {
         try {
           const response = await fetch(`/api/v1/system/jobs/${encodeURIComponent(backendJobId)}/cancel`, { method: 'POST' });
           if (!response.ok) throw new Error(`HTTP ${response.status}`);
         } catch (fallbackError) {
           console.warn('Failed to cancel batch job via backend:', fallbackError);
         }
       }

       updateBatchItem(item.id, { status: 'cancelled', completedAt: new Date() });
       delete batchJobIdMap.current[backendJobId];
       completeTask(backendJobId, 'cancelled');

       const isForegroundTask = activeTaskRef.current?.id === backendJobId ||
         activeTaskRef.current?.backendJobId === backendJobId;
       setJobsById(prev => {
         const taskKey = findTaskKeyForBackendJob(prev, backendJobId);
         if (!taskKey) return prev;
         const existing = prev[taskKey];
         const next = { ...prev, [taskKey]: { ...existing, status: 'cancelled' as const, currentStep: 'Batch execution cancelled', stage: 'cancelled' } };
         jobsByIdRef.current = next;
         return next;
       });

       if (isForegroundTask) {
         setIsExecuting(false);
         setExecutionProgress(0);
         setExecutionStep('Batch execution cancelled');
         setExecutionState('cancelled');
         setActiveTask(prev => prev && (prev.id === backendJobId || prev.backendJobId === backendJobId)
           ? { ...prev, status: 'cancelled' as const, currentStep: 'Batch execution cancelled', stage: 'cancelled' }
           : prev);
       }
     }

     toast.success('Batch processing cancelled', { description: `${itemsToCancel.length} items cancelled.` });
   }, [getApiClient, completeTask, setExecutionState, setIsExecuting, setExecutionProgress, setExecutionStep, toast]);    // Retry failed batch items function
    const retryFailedBatchItems = useCallback(async () => {
      const appStore = useAppStore.getState();
      const { batchQueue, updateBatchItem } = appStore;
     
     // Get all batch queue items that have failed
     const failedItems = batchQueue.filter(item => 
       item.status === 'failed'
     );
     
     if (failedItems.length === 0) {
       toast.info('No failed items to retry', { description: 'There are no failed batch items to retry.' });
       return;
     }
     
       // Reset each failed item to queued status so it can be processed again
       for (const item of failedItems) {
         updateBatchItem(item.id, {
           status: 'queued',
           progress: 0,
           jobId: undefined, // Clear the job ID so it gets a new one when processed
           error: undefined,
           startedAt: undefined,
           completedAt: undefined,
           // Preserve the original per-item settings snapshot for deterministic retry.
         });
         
         // Clean up the job ID map for this item
         if (item.jobId) {
           delete batchJobIdMap.current[item.jobId];
         }
       }
     
      toast.success('Failed items reset for retry', { description: `${failedItems.length} failed items reset to queued status.` });
    }, []);

  const isWorkspaceShellActive = useCallback((path?: string | null) => {
    if (!path) return false;
    return (
      path.startsWith('/workspace')
    );
  }, []);

  const navigateToTool = useCallback((tool: ToolType) => {
    const isSameTool = tool === activeToolRef.current;
    setActiveTool(tool);
    activeToolRef.current = tool;
    setMainNav('workspace');
    mainNavRef.current = 'workspace';
    setIsLeftPanelOpen(true);
    const baseRoute = TOOL_TO_ROUTE[tool] || '/workspace/generate';

    // Resolve workspace identity only from canonical workspace state or route parsing.
    // A selected asset ID is never a valid substitute for workspace_id.
    let activeId: string | null =
      workspaceIdRef.current || currentAssetRef.current?.workspace_id || null;
    if (!activeId && typeof window !== 'undefined') {
      activeId = parseWorkspaceRouteIdentity(window.location.pathname).workspaceId;
    }

    const currentRouteState = activeId
      ? { status: 'workspace' as const, workspaceId: activeId }
      : { status: 'base' as const };
    const nextRouteState = transitionWorkspaceToolRoute(currentRouteState, {
      type: isSameTool ? 'select-same-tool' : 'select-different-tool',
    });
    const nextWorkspaceId = nextRouteState.status === 'workspace' ? nextRouteState.workspaceId : null;

    if (isSameTool) {
      // Re-entering the active tool returns it to its empty/default workspace view.
      selectedAssetIdRef.current = null;
      setSelectedAssetId(null);
      setActiveMeshAssetId(null);
      setWorkspaceId(null);
      useViewerStore.getState().setLoadedModel(null, null, null);
    }

    const route = nextWorkspaceId ? `${baseRoute}/${nextWorkspaceId}` : baseRoute;
    if (!isWorkspaceShellActive(pathname)) {
      router.push(route);
      return;
    }
    if (pathname !== route) {
      // Keep the shared WorkspaceShell and viewport mounted during tool navigation.
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', route);
      }
    }
  }, [pathname, router, setMainNav, setActiveTool, setIsLeftPanelOpen, isWorkspaceShellActive, setSelectedAssetId, setActiveMeshAssetId, setWorkspaceId]);

  const navigateToMain = useCallback((nav: MainNavRoute) => {
    setMainNav(nav);
    mainNavRef.current = nav;
    if (nav === 'settings') {
      router.push('/admin?tab=settings');
      return;
    }
    if (nav === 'models') {
      router.push('/admin?tab=models');
      return;
    }

    const routeMap: Record<string, string> = {
      assets: '/workspace/assets',
      jobs: '/workspace/jobs',
      workspace: '/workspace/generate',
    };
    const targetRoute = routeMap[nav];
    if (targetRoute) {
      if (typeof window !== 'undefined' && isWorkspaceShellActive(pathname)) {
        // Use replaceState instead of router.push to avoid full page remount.
        // This keeps the MeshViewer and 3D stage alive while switching overlay views.
        window.history.replaceState(null, '', targetRoute);
      } else {
        router.push(targetRoute);
      }
    }
  }, [pathname, router, setMainNav, isWorkspaceShellActive]);

  // Split context value into smaller memos to reduce re-render scope.
  // Each memo only recalculates when its specific dependencies change.
  const viewportValue = useMemo(() => ({
    shadingMode, setShadingMode, showWireframe, setShowWireframe, wireframeMode, setWireframeMode: setWireframeModeAndSync,
    showGrid, setShowGrid, showBones, setShowBones,
    isTurntable, setIsTurntable,
    activeTransformTool, setActiveTransformTool,
    viewportResetTrigger, resetCamera, fitToScreen,
  }), [shadingMode, setShadingMode, showWireframe, setShowWireframe, wireframeMode, setWireframeModeAndSync,
    showGrid, setShowGrid, showBones, setShowBones,
    isTurntable, setIsTurntable,
    activeTransformTool, setActiveTransformTool,
    viewportResetTrigger, resetCamera, fitToScreen]);

  const toolValue = useMemo(() => ({
    activeTool, setActiveTool, mainNav, setMainNav,
    activeRightTab, setActiveRightTab,
    rightPanelMode: activeRightTab, setRightPanelMode: setActiveRightTab,
    isLeftPanelOpen, setIsLeftPanelOpen,
    leftPanelWidth, setLeftPanelWidth,
    rightPanelWidth, setRightPanelWidth,
    toolPanelOpen: isLeftPanelOpen, setToolPanelOpen: setIsLeftPanelOpen,
    isRightPanelOpen, setIsRightPanelOpen,
    rightPanelOpen: isRightPanelOpen, setRightPanelOpen: setIsRightPanelOpen,
    navigateToTool, navigateToMain, navigateToMainNav: navigateToMain,
  }), [activeTool, setActiveTool, mainNav, setMainNav,
    activeRightTab, setActiveRightTab,
    isLeftPanelOpen, setIsLeftPanelOpen,
    leftPanelWidth, setLeftPanelWidth,
    rightPanelWidth, setRightPanelWidth,
    isRightPanelOpen, setIsRightPanelOpen,
    navigateToTool, navigateToMain]);

  const isAssetsLoading = (isHistoryLoading || isUploadedLoading) && assets.length === 0;

  const assetValue = useMemo(() => ({
    assets, isAssetsLoading, selectedAssetId, currentAsset,
    refreshAssets,
    selectAsset, updateAssetProperties, updateMaterialConfig,
    deleteAsset, addAsset, setCurrentAsset,
    assetFilter, setAssetFilter, duplicateAsset,
    workspaceId, setWorkspaceId,
    activeMeshAssetId, setActiveMeshAssetId,
    workspaceVersions, setWorkspaceVersions,
  }), [assets, isAssetsLoading, selectedAssetId, currentAsset,
    refreshAssets,
    selectAsset, updateAssetProperties, updateMaterialConfig,
    deleteAsset, addAsset, setCurrentAsset,
    assetFilter, setAssetFilter, duplicateAsset,
    workspaceId, setWorkspaceId,
    activeMeshAssetId, setActiveMeshAssetId,
    workspaceVersions, setWorkspaceVersions]);

  const systemValue = useMemo(() => ({
    systemStats, isSettingsOpen, setIsSettingsOpen,
    isExportModalOpen, setIsExportModalOpen,
    refreshSystemStats,
  }), [systemStats, isSettingsOpen, setIsSettingsOpen,
    isExportModalOpen, setIsExportModalOpen,
    refreshSystemStats]);

  const executionValue = useMemo(() => ({
    activeTask, jobsById, dismissActiveTask, restorePreviewBaseline,
    hoveredPartId, setHoveredPartId,
    isExecuting, executionStatus,
    executionState, setExecutionState,
    persistenceState, setPersistenceState,
    executionProgress, executionStep, cancelExecution,
    dismissJob, selectJobToView, queueGenerationJob,
  }), [activeTask, jobsById, dismissActiveTask, restorePreviewBaseline,
    hoveredPartId, setHoveredPartId,
    isExecuting, executionStatus,
    executionState, setExecutionState,
    persistenceState, setPersistenceState,
    executionProgress, executionStep, cancelExecution,
    dismissJob, selectJobToView, queueGenerationJob]);

  const generationSettingsValue = useMemo(() => ({
    generationSettings, setGenerationSettings,
    postprocessingEnabled, setPostprocessingEnabled,
    remeshSettings, setRemeshSettings,
    textureSettings, setTextureSettings,
    sculptSettings, setSculptSettings,
    paintBrushSettings, setPaintBrushSettings,
    environmentSettings, setEnvironmentSettings,
  }), [generationSettings, setGenerationSettings,
    postprocessingEnabled, setPostprocessingEnabled,
    remeshSettings, setRemeshSettings,
    textureSettings, setTextureSettings,
    sculptSettings, setSculptSettings,
    paintBrushSettings, setPaintBrushSettings,
    environmentSettings, setEnvironmentSettings]);

    const generationActionsValue = useMemo(() => ({
      generate3DModel,
      runModelGeneration: generate3DModel,
      regeneratePreview,
      runRemeshGeneration, runTextureGeneration,
      runUVUnwrapGeneration, runSegmentation,
      runAutoRigging,
      runMotionGeneration,
      processBatchQueue,
      cancelBatchProcessing,
      retryFailedBatchItems,
    }), [generate3DModel, regeneratePreview,
      runRemeshGeneration, runTextureGeneration,
      runUVUnwrapGeneration, runSegmentation,
      runAutoRigging,
      runMotionGeneration,
      processBatchQueue,
      cancelBatchProcessing,
      retryFailedBatchItems]);

  const value = React.useMemo(() => ({
    ...viewportValue, ...toolValue, ...assetValue, ...systemValue,
    ...executionValue, ...generationSettingsValue,
    ...generationActionsValue,
  }), [viewportValue, toolValue, assetValue, systemValue,
    executionValue, generationSettingsValue,
    generationActionsValue]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
