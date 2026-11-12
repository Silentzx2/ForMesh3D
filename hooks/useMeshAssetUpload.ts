'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadMeshAsset, type MeshUploadStage, type ModelAsset } from '@/features/workspace/types';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import { getUploadPercent } from '@/features/workspace/lib/uploadProgress';

export interface MeshAssetUploadState {
  status: 'idle' | MeshUploadStage | 'saved' | 'error';
  fileName: string;
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  error: string | null;
}

const initialState: MeshAssetUploadState = {
  status: 'idle',
  fileName: '',
  loadedBytes: 0,
  totalBytes: null,
  percent: 0,
  error: null,
};

export function useMeshAssetUpload() {
  const queryClient = useQueryClient();
  const { addAsset, setCurrentAsset, updateAssetProperties } = useWorkspace();
  const [state, setState] = useState(initialState);
  const uploadInProgress = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setState(initialState);
  }, []);

  const upload = useCallback(async (file: File): Promise<ModelAsset | null> => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (uploadInProgress.current) return null;
    uploadInProgress.current = true;

    const extension = file.name.split('.').pop()?.toLowerCase() || 'glb';
    const formats: Record<string, ModelAsset['format']> = {
      glb: 'GLB', gltf: 'GLTF', obj: 'OBJ', ply: 'PLY', fbx: 'FBX', stl: 'STL',
    };
    const cleanStem = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const shortHash = Math.random().toString(36).substring(2, 8);
    const friendlyLocalId = `${cleanStem}_${shortHash}`;
    const localBlobUrl = URL.createObjectURL(file);
    const localAsset: ModelAsset = {
      id: friendlyLocalId,
      fileId: friendlyLocalId,
      name: file.name.replace(/\.[^/.]+$/, ''),
      category: 'mesh',
      meshType: 'custom',
      thumbnail: '',
      faces: 0,
      vertices: 0,
      triangles: 0,
      statsAvailable: false,
      format: formats[extension] || 'GLB',
      fileSize: `${(file.size / 1048576).toFixed(1)} MB`,
      source: {
        filename: file.name,
        subfolder: 'models',
        type: 'upload',
        viewUrl: localBlobUrl,
        localUrl: localBlobUrl,
        fileId: friendlyLocalId,
      },
      topology: 'Triangle',
      dateCreated: new Date().toISOString(),
      tags: ['Custom', 'User-Upload', 'Mesh'],
    };

    // 1. Immediately mount local asset so user sees their 3D model in the viewport without waiting
    addAsset(localAsset);
    setCurrentAsset(localAsset);

    // Reflect the uploaded mesh in the URL so it's bookmarkable: /workspace/generate/<name>_<hash>
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/workspace/generate/${friendlyLocalId}`);
    }

    setState({ status: 'uploading', fileName: file.name, loadedBytes: 0, totalBytes: file.size, percent: 0, error: null });

    try {
      const serverAsset = await uploadMeshAsset(file, {
        onStage: (status) => setState((current) => ({ ...current, status })),
        onProgress: (loadedBytes, totalBytes) => setState((current) => {
          const nextLoadedBytes = Math.max(current.loadedBytes, loadedBytes);
          const nextTotalBytes = Number.isFinite(totalBytes) && totalBytes! > 0 ? totalBytes! : null;
          const nextPercent = getUploadPercent(nextLoadedBytes, nextTotalBytes);
          return {
            ...current,
            status: 'uploading',
            loadedBytes: nextLoadedBytes,
            totalBytes: nextTotalBytes,
            percent: nextPercent === null ? null : Math.max(current.percent ?? 0, nextPercent),
          };
        }),
      });

      // Synchronize with server asset info while preserving the fast local blob URL for smooth viewing
      const mergedAsset: ModelAsset = {
        ...serverAsset,
        id: serverAsset.id || friendlyLocalId,
        source: {
          ...serverAsset.source,
          filename: serverAsset.source?.filename || file.name,
          subfolder: serverAsset.source?.subfolder || 'models',
          type: serverAsset.source?.type || 'upload',
          localUrl: localBlobUrl,
        },
      };
      updateAssetProperties(localAsset.id, mergedAsset);
      setCurrentAsset(mergedAsset);
      queryClient.invalidateQueries({ queryKey: ['uploaded-assets'] });
      setState({ status: 'saved', fileName: file.name, loadedBytes: file.size, totalBytes: file.size, percent: 100, error: null });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setState(initialState);
      }, 2000);
      return mergedAsset;
    } catch (error) {
      // Backend is unavailable or disconnected; keep the active local mesh rendered seamlessly in the viewport!
      // Emit the live `error` state so MeshUploadStatus can surface the failure instead of faking success.
      console.warn('Backend mesh upload failed or offline; active in client-side preview mode:', error);
      setState({
        status: 'error',
        fileName: file.name,
        loadedBytes: file.size,
        totalBytes: file.size,
        percent: 100,
        error: error instanceof Error ? error.message : String(error),
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setState(initialState);
      }, 2000);
      return localAsset;
    } finally {
      uploadInProgress.current = false;
    }
  }, [addAsset, setCurrentAsset, updateAssetProperties, queryClient]);

  return { state, upload, reset };
}