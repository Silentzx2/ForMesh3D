'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@/components/icons/hugeicons-components';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel, FolderOpenIcon, UploadIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { useWorkspace } from '../store/WorkspaceContext';
import type { ModelAsset } from '../types';
import { useMeshAssetUpload, type MeshAssetUploadState } from '@/hooks/useMeshAssetUpload';

const MESH_EXTENSIONS = ['.glb', '.gltf', '.obj', '.fbx', '.stl', '.ply'];

export function isValidMeshAsset(asset?: ModelAsset | null): asset is ModelAsset {
  if (!asset) return false;
  return asset.category !== 'texture' && asset.format !== 'IMAGE' && asset.format !== 'FILE';
}

function isMeshFile(file: File): boolean {
  const dotIdx = file.name.lastIndexOf('.');
  if (dotIdx < 0) return false;
  return MESH_EXTENSIONS.includes(file.name.slice(dotIdx).toLowerCase());
}

function formatFaceCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toLocaleString();
}

export interface ActiveMeshBarProps {
  /** Optional external upload state when parent tracks upload lifecycle directly */
  uploadState?: MeshAssetUploadState;
  onUploadFile?: (file: File) => Promise<ModelAsset | null>;
  onCancelUpload?: () => void;
  onResetUpload?: () => void;
  onUploadingChange?: (isUploading: boolean) => void;
  onMeshUploaded?: (asset: ModelAsset) => void;
  className?: string;
}

export const ActiveMeshBar: React.FC<ActiveMeshBarProps> = ({
  uploadState: externalUploadState,
  onUploadFile,
  onCancelUpload,
  onResetUpload,
  onUploadingChange,
  onMeshUploaded,
  className = '',
}) => {
  const { currentAsset, setActiveRightTab, setIsRightPanelOpen } = useWorkspace();
  const internalUpload = useMeshAssetUpload();

  const uploadState = externalUploadState ?? internalUpload.state;
  const uploadMesh = onUploadFile ?? internalUpload.upload;
  const cancelUpload = onCancelUpload ?? internalUpload.cancel;
  const resetUpload = onResetUpload ?? internalUpload.reset;

  const isUploading = uploadState.status === 'uploading' || uploadState.status === 'verifying';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    onUploadingChange?.(isUploading);
  }, [isUploading, onUploadingChange]);

  const validMesh = isValidMeshAsset(currentAsset) ? currentAsset : null;
  const faceCount = validMesh ? (validMesh.triangles || validMesh.faces || 0) : 0;

  const handleOpenAssets = () => {
    setActiveRightTab('assets');
    setIsRightPanelOpen(true);
  };

  const processMeshFile = async (file: File) => {
    if (!isMeshFile(file)) {
      toast.error('Please upload a valid 3D mesh file (GLB, GLTF, OBJ, FBX, STL, PLY)');
      return;
    }
    const asset = await uploadMesh(file);
    if (asset) {
      onMeshUploaded?.(asset);
      toast.success(`3D Mesh loaded: ${file.name}`);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (file) await processMeshFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !isUploading) {
      await processMeshFile(file);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isUploading) setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        const related = e.relatedTarget as Node | null;
        if (!related || !e.currentTarget.contains(related)) setIsDragOver(false);
      }}
      onDrop={handleDrop}
      className={`rounded-xl border transition-colors ${
        isDragOver
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--surface-2))]'
          : 'border-white/[0.08] bg-[hsl(var(--surface-2))]'
      } ${className}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.obj,.fbx,.stl,.ply"
        onChange={handleFileChange}
        className="hidden"
      />

      {isUploading ? (
        <div className="p-2.5 space-y-1.5" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-3 h-3 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-xs font-medium text-white truncate">
                {uploadState.fileName || 'Uploading mesh...'}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] font-mono font-semibold text-[hsl(var(--primary))]">
                {uploadState.percent === null ? '...' : `${uploadState.percent}%`}
              </span>
              <button
                type="button"
                onClick={cancelUpload}
                className="px-2 py-0.5 rounded-md bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 hover:text-white text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                aria-label="Cancel mesh upload"
              >
                <HugeiconsIcon icon={Cancel} size={11} />
                <span>Cancel</span>
              </button>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label={`Uploading ${uploadState.fileName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadState.percent ?? undefined}
            aria-valuetext={uploadState.percent === null ? (uploadState.status === 'verifying' ? 'Verifying mesh' : 'Uploading mesh') : `${uploadState.percent}%`}
            className="w-full h-1 rounded-full bg-white/10 overflow-hidden"
          >
            <div
              className={`h-full bg-[hsl(var(--primary))] transition-all duration-200 rounded-full ${uploadState.percent === null ? 'animate-pulse' : ''}`}
              style={{ width: uploadState.percent === null ? '35%' : `${Math.max(4, Math.min(100, uploadState.percent))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>
              {uploadState.totalBytes
                ? `${(uploadState.loadedBytes / 1048576).toFixed(1)} / ${(uploadState.totalBytes / 1048576).toFixed(1)} MB`
                : `${(uploadState.loadedBytes / 1048576).toFixed(1)} MB`}
            </span>
            <span>{uploadState.status === 'verifying' ? 'Verifying...' : 'Uploading...'}</span>
          </div>
        </div>
      ) : validMesh ? (
        <div className="p-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            {validMesh.thumbnail ? (
              <img
                src={validMesh.thumbnail}
                alt={validMesh.name}
                className="w-8 h-8 rounded-lg object-cover bg-black/40 border border-white/[0.08] flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[hsl(var(--primary))] flex-shrink-0">
                <Box className="w-4 h-4" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-100 truncate" title={validMesh.name}>
                {validMesh.name}
              </p>
              <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 whitespace-nowrap truncate">
                <span>{validMesh.format || 'GLB'}</span>
                {faceCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatFaceCount(faceCount)} tris</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={handleOpenAssets}
              className="h-7 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 hover:text-white text-[11px] font-medium transition-colors cursor-pointer"
              title="Switch active mesh from Assets"
            >
              Switch
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 hover:text-white text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
              title="Upload a new 3D mesh"
            >
              <HugeiconsIcon icon={UploadIcon} size={12} />
              <span>Upload</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-400 flex-shrink-0">
              <Box className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] text-zinc-400 whitespace-nowrap">No mesh</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={handleOpenAssets}
              className="h-7 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 hover:text-white text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={FolderOpenIcon} size={12} />
              <span>Assets</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2 rounded-lg bg-[hsl(var(--primary))]/15 hover:bg-[hsl(var(--primary))]/25 border border-[hsl(var(--primary))]/30 text-[hsl(var(--primary))] text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={UploadIcon} size={12} />
              <span>Upload</span>
            </button>
          </div>
        </div>
      )}

      {uploadState.status === 'error' && uploadState.error && (
        <div
          role="alert"
          className="px-2.5 py-1.5 border-t border-rose-500/20 bg-rose-500/10 text-[11px] text-rose-300 flex items-center justify-between gap-2 rounded-b-xl"
        >
          <span className="truncate">{uploadState.error}</span>
          <button
            type="button"
            onClick={resetUpload}
            className="text-rose-200 hover:text-white flex-shrink-0 cursor-pointer"
            aria-label="Dismiss upload error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
