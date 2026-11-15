import { create } from 'zustand';
import type * as THREE from 'three';

export interface AssetItem {
  id: string;
  name: string;
  prompt: string;
  format: string;
  timestamp: string;
  thumbnailUrl?: string | null;
  modelUrl?: string | null;
  isFavorite?: boolean;
  job?: { id: string; status: string; prompt: string; result?: { downloadUrls?: { glb?: string; obj?: string } } };
  type?: 'image' | 'model';
}

export type ShadingPreset = 'default' | 'clay' | 'metallic' | 'wireframe' | 'normal' | 'gold' | 'cyberpunk' | 'uv';

export type WorkspaceExecutionState = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
export type WorkspacePersistenceState = 'not_saved' | 'saving' | 'saved' | 'save_failed' | 'discarded';

export interface ModelMeshStats {
  vertices: number;
  triangles: number;
  edges?: number;
  materials?: number;
  dimensions: { x: number; y: number; z: number };
  surfaceArea?: number;
  volume?: number;
  isManifold?: boolean;
  nonManifoldEdges?: number;
  boundaryEdges?: number;
  uvCharts?: number;
}

export interface RigInfo {
  boneCount: number;
  jointHierarchy: string;
  rigWeightMap: 'Complete' | 'Partial' | 'None' | string;
}

export interface AnimationInfo {
  preset: string;
  speed: number;
  isPlaying: boolean;
  duration: number;
  fps?: number;
  frameCount?: number;
}

export type ContextTabType = 'assets' | 'inspector' | 'materials' | 'jobs';

export interface CompareCameraState {
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Global persistent 3D workspace viewer store.
 * Holds canonical loaded model, viewport camera, mesh statistics,
 * material shading state, and context panel tab.
 */
interface ViewerState {
  loadedModelUrl: string | null;
  loadedModelName: string | null;
  selectedAsset: AssetItem | null;
  modelStats: ModelMeshStats | null;
  shadingMode: ShadingPreset;
  wireframeOverlay: boolean;
  activeContextTab: ContextTabType;
  viewport: { cameraPosition: [number, number, number]; target: [number, number, number] } | null;
  compareMode: boolean;
  compareSyncCamera: boolean;
  compareLeftAssetId: string | null;
  compareRightAssetId: string | null;
  workspaceId: string | null;
  activeMeshAssetId: string | null;
  executionState: WorkspaceExecutionState;
  persistenceState: WorkspacePersistenceState;

  // Explicit mesh selection / viewer loading state machine (Part II §14.7).
  // States: idle | selecting | verifying | loading | ready | error
  assetSelectionState: 'idle' | 'selecting' | 'verifying' | 'loading' | 'ready' | 'error';
  assetLoadError: string | null;
  // Stale-response guard: only the most recent selection request may commit.
  selectionRequestId: number;

  setLoadedModel: (url: string | null, name?: string | null, asset?: AssetItem | null) => void;
  setSelectedAsset: (asset: AssetItem | null) => void;
  setModelStats: (stats: ModelMeshStats | null) => void;
  setShadingMode: (mode: ShadingPreset) => void;
  setWireframeOverlay: (enabled: boolean) => void;
  toggleWireframeOverlay: () => void;
  setActiveContextTab: (tab: ContextTabType) => void;
  setViewport: (viewport: { cameraPosition: [number, number, number]; target: [number, number, number] }) => void;
  setCompareMode: (enabled: boolean) => void;
  setCompareSyncCamera: (enabled: boolean) => void;
  setCompareLeftAsset: (assetId: string | null) => void;
  setCompareRightAsset: (assetId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  setActiveMeshAssetId: (assetId: string | null) => void;
  setExecutionState: (executionState: WorkspaceExecutionState) => void;
  setPersistenceState: (persistenceState: WorkspacePersistenceState) => void;
  // Explicit transitions through the selection/viewer loading lifecycle.
  requestAssetSelection: (asset: AssetItem | null) => number;
  verifyAsset: (requestId: number) => void;
  beginAssetLoad: (requestId: number) => void;
  completeAssetLoad: (requestId: number, url: string, name: string | null, stats: ModelMeshStats | null) => void;
  failAssetLoad: (requestId: number, error: string) => void;
  activeModelObject: THREE.Object3D | null;
  setActiveModelObject: (obj: THREE.Object3D | null) => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  loadedModelUrl: null,
  loadedModelName: null,
  selectedAsset: null,
  modelStats: null,
  shadingMode: 'default',
  wireframeOverlay: false,
  activeContextTab: 'assets',
  viewport: null,
  compareMode: false,
  compareSyncCamera: false,
  compareLeftAssetId: null,
  compareRightAssetId: null,
  workspaceId: null,
  activeMeshAssetId: null,
  executionState: 'idle',
  persistenceState: 'not_saved',
  // Mesh selection / viewer loading state machine initial values.
  assetSelectionState: 'idle',
  assetLoadError: null,
  selectionRequestId: 0,
  activeModelObject: null,
  setActiveModelObject: (obj) => set({ activeModelObject: obj }),
  setWorkspaceId: (workspaceId) => set({ workspaceId }),
  setActiveMeshAssetId: (activeMeshAssetId) => set({ activeMeshAssetId }),
  setExecutionState: (executionState) => set({ executionState }),
  setPersistenceState: (persistenceState) => set({ persistenceState }),

  // Request a new mesh selection. Starts the selection request counter so that
  // slow earlier responses cannot overwrite a newer user selection (§14.7).
  requestAssetSelection: (asset) => {
    const nextId = (get().selectionRequestId || 0) + 1;
    set({
      selectionRequestId: nextId,
      assetSelectionState: asset ? 'selecting' : 'idle',
      assetLoadError: null,
    });
    return nextId;
  },

  // Verify the selected asset before loading. Only the most recent request may proceed.
  verifyAsset: (requestId) => {
    const state = get();
    if (state.selectionRequestId !== requestId) return; // stale request; ignore
    if (!state.selectedAsset) {
      set({ assetSelectionState: 'idle' });
      return;
    }
    set({ assetSelectionState: 'verifying' });
  },

  // Begin loading the verified asset into the viewer.
  beginAssetLoad: (requestId) => {
    const state = get();
    if (state.selectionRequestId !== requestId) return; // stale request; ignore
    set({ assetSelectionState: 'loading', assetLoadError: null });
  },

  // Commit a successful asset load. Only the most recent request may commit.
  completeAssetLoad: (requestId, url, name, stats) => {
    const state = get();
    if (state.selectionRequestId !== requestId) return; // stale request; ignore
    set({
      loadedModelUrl: url,
      loadedModelName: name,
      modelStats: stats ?? null,
      assetSelectionState: 'ready',
      assetLoadError: null,
    });
  },

  // Record a load failure while keeping the last valid selection visible.
  failAssetLoad: (requestId, error) => {
    const state = get();
    if (state.selectionRequestId !== requestId) return; // stale request; ignore
    set({
      assetSelectionState: 'error',
      assetLoadError: error,
      // Do not clear loadedModelUrl / modelStats: keep last valid mesh visible.
    });
  },

  setLoadedModel: (url, name = null, asset = null) => {
    const prev = get().loadedModelUrl;
    if (prev && prev !== url && prev.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prev);
      } catch {
        /* ignore */
      }
    }
    set({
      loadedModelUrl: url,
      loadedModelName: name,
      selectedAsset: asset !== undefined ? asset : get().selectedAsset,
    });
  },

  setSelectedAsset: (asset) => set({ selectedAsset: asset }),
  setModelStats: (stats) => set({ modelStats: stats }),
  setShadingMode: (shadingMode) => set({ shadingMode }),
  setWireframeOverlay: (wireframeOverlay) => set({ wireframeOverlay }),
  toggleWireframeOverlay: () => set((s) => ({ wireframeOverlay: !s.wireframeOverlay })),
  setActiveContextTab: (activeContextTab) => set({ activeContextTab }),
  setViewport: (viewport) => set({ viewport }),
  setCompareMode: (compareMode) => set({ compareMode }),
  setCompareSyncCamera: (compareSyncCamera) => set({ compareSyncCamera }),
  setCompareLeftAsset: (compareLeftAssetId) => set({ compareLeftAssetId }),
  setCompareRightAsset: (compareRightAssetId) => set({ compareRightAssetId }),
}));

/** Single entry point used by panels / drag-drop to load a model everywhere. */
export function loadModelInViewer(url: string, name?: string | null, asset?: AssetItem | null) {
  useViewerStore.getState().setLoadedModel(url, name ?? null, asset ?? null);
  // Keep the legacy window event for any listener that hasn't migrated.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('load-glb-model', { detail: { url, name: name ?? null } }));
  }
}


