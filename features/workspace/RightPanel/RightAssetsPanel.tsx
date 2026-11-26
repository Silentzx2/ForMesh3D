import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAppStore } from '@/stores/useAppStore';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import { MeshUploadStatus } from '../Panels/MeshUploadStatus';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUp01Icon,
  Box,
  CheckIcon,
  CheckmarkCircle02Icon,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpenIcon,
  GridIcon,
  MoreVerticalIcon,
  StarIcon,
  Trash2,
  ZoomInIcon,
} from '@hugeicons/core-free-icons';
import { QualityBadge } from '../Panels/GeneratePanel';

export const RightAssetsPanel: React.FC = () => {
  const { 
    assets, 
    currentAsset, 
    setCurrentAsset, 
    assetFilter, 
    setAssetFilter,
    duplicateAsset,
    deleteAsset,
    updateAssetProperties,
    workspaceId,
  } = useWorkspace();

  const { assetCollections, addAssetCollection, assetCollectionAssignments, setAssetCollectionAssignment, assetFavorites, setAssetFavorite } = useAppStore();

  const [activePage, setActivePage] = useState(1);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(() => new Set());
  const [activeMenuAssetId, setActiveMenuAssetId] = useState<string | null>(null);
  const [collectionName, setCollectionName] = useState('');
  const [collectionAssetId, setCollectionAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const collectionMenuRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { state: meshUploadState, upload: uploadMesh, reset: resetMeshUpload } = useMeshAssetUpload();
  const uploadActive = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';

  const ITEMS_PER_PAGE = 8;

  useEffect(() => {
    setActivePage(1);
  }, [assetFilter, showFavoritesOnly, selectedCollection, workspaceId]);

  // Handle outside click and Escape key for dropdown menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(e.target as Node)) {
        setCollectionMenuOpen(false);
      }
      const targetMenu = (e.target as HTMLElement).closest('[data-asset-menu]');
      if (activeMenuAssetId && targetMenu?.getAttribute('data-asset-menu') !== activeMenuAssetId) {
        setActiveMenuAssetId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCollectionMenuOpen(false);
        setActiveMenuAssetId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuAssetId, collectionMenuOpen]);

  const processModelFile = useCallback(async (file: File) => {
    await uploadMesh(file);
  }, [uploadMesh]);

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processModelFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) processModelFile(file);
  };

  const scopedBaseAssets = React.useMemo(() => {
    const DERIVED_TYPES = new Set([
      'retopology',
      'remesh',
      'uv',
      'segmentation',
      'segment',
      'rigging',
      'rig',
      'animation',
      'animate',
      'texture',
      'pbr',
      'edit',
      'refine',
    ]);

    const isDerivedOrTempAsset = (asset: typeof assets[number]) => {
      if (asset.asset_type === 'animated_mesh') return false;
      if (asset.isLocalDuplicate) return false;
      if (asset.id.startsWith('preview_')) return true;
      if (asset.is_base_mesh === false) return true;

      // Exclude temp / unsaved generation previews
      const persistenceStatus = (asset as { persistence_status?: string }).persistence_status;
      if (persistenceStatus === 'not_saved' || persistenceStatus === 'discarded') return true;
      if (asset.source?.subfolder === 'temp' || asset.source?.type === 'temp') return true;

      // Exclude post-operation derived meshes unless explicitly marked as a base mesh
      const opType = String(asset.operation_type || '').toLowerCase();
      if (opType && DERIVED_TYPES.has(opType) && asset.is_base_mesh !== true) return true;

      const cat = String(asset.category || '').toLowerCase();
      if (DERIVED_TYPES.has(cat)) return true;

      return false;
    };

    const stripIdPrefix = (id: string) => id.replace(/^(?:hist_|upload_|local_|job-)/, '');

    const withFavorites = assets
      .filter((asset) => !isDerivedOrTempAsset(asset))
      .map((asset) => {
        const favoriteKey = asset.isLocalDuplicate
          ? asset.id
          : asset.id.startsWith('local_')
            ? (asset.source?.fileId || asset.fileId || asset.id).replace(/^job-/, '')
            : asset.id.replace(/^(?:hist_|upload_)/, '');
        return assetFavorites[favoriteKey] === undefined
          ? asset
          : { ...asset, isFavorite: assetFavorites[favoriteKey] };
      });

    // Deduplicate uploaded & base workspace meshes by canonical identity (workspace_id + fileId / id)
    const seen = new Map<string, typeof withFavorites[number]>();
    for (const asset of withFavorites) {
      const rawFileId = (asset.source?.fileId || asset.fileId || '').replace(/^job-/, '');
      const key = asset.isLocalDuplicate
        ? `dup:${asset.id}`
        : asset.workspace_id && rawFileId
          ? `ws:${asset.workspace_id}:${rawFileId}`
          : asset.workspace_id
            ? `ws:${asset.workspace_id}`
            : `id:${rawFileId || stripIdPrefix(asset.id)}`;

      const existing = seen.get(key);
      if (
        !existing ||
        (asset.is_base_mesh && !existing.is_base_mesh) ||
        (asset.sourceType === 'upload' && existing.sourceType !== 'upload') ||
        (asset.thumbnail && !existing.thumbnail)
      ) {
        seen.set(key, asset);
      }
    }
    return Array.from(seen.values());
  }, [assets, assetFavorites]);

  const filteredAssets = scopedBaseAssets.filter(a => {
    if (showFavoritesOnly && !a.isFavorite) return false;
    const collection = a.collection || assetCollectionAssignments[a.id];
    if (selectedCollection && collection !== selectedCollection && !a.tags?.includes(selectedCollection)) return false;
    if (assetFilter === 'all') return true;
    if (assetFilter === 'models') return a.category === 'generation' || a.category === 'mesh';
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / ITEMS_PER_PAGE));
  useEffect(() => {
    if (activePage > totalPages) setActivePage(totalPages);
  }, [activePage, totalPages]);
  const safePage = Math.min(activePage, totalPages);
  const paginatedAssets = filteredAssets.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  return (
    <>
    <div id="panel-assets-library" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none">
      {/* Hidden file input for uploading custom 3D files */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.obj,.fbx,.stl,.ply"
        className="hidden"
        disabled={uploadActive}
        onChange={handleModelUpload}
      />

      {/* Top Action Sub-bar matching Studio Reference */}
      <div className="px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-1))]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {/* Grid / All View */}
            <SimpleTooltip label="All Assets">
              <button
                type="button"
                aria-label="All Assets"
                onClick={() => { setShowFavoritesOnly(false); setAssetFilter('all'); }}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  !showFavoritesOnly && assetFilter === 'all'
                    ? 'bg-[hsl(var(--surface-2))] text-primary'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))]/60'
                }`}
              >
                <HugeiconsIcon icon={GridIcon} size={15} />
              </button>
            </SimpleTooltip>

            {/* Favorite Filter */}
            <SimpleTooltip label="Favorites">
              <button
                type="button"
                aria-label="Favorites"
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  showFavoritesOnly
                    ? 'bg-[hsl(var(--surface-2))] text-primary'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))]/60'
                }`}
              >
                <HugeiconsIcon icon={StarIcon} size={15} />
              </button>
            </SimpleTooltip>

          </div>

          <div className="relative" ref={collectionMenuRef}>
            <button type="button" aria-label="Filter by collection" aria-expanded={collectionMenuOpen}
              onClick={() => setCollectionMenuOpen((open) => !open)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer flex items-center gap-1.5 ${selectedCollection ? 'text-primary bg-primary/10 border-primary/30' : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))] bg-[hsl(var(--surface-2))] border-[hsl(var(--border))]'}`}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} className="text-[hsl(var(--muted-foreground))]" />
              <span>{selectedCollection || 'Collections'}</span>
            </button>
            {collectionMenuOpen && <div className="absolute right-0 top-full mt-1.5 w-52 max-h-56 overflow-y-auto rounded-xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] shadow-2xl z-50 py-1 text-xs">
              <button type="button" onClick={() => { setSelectedCollection(null); setCollectionMenuOpen(false); }} className="w-full px-3 py-2 text-left text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between cursor-pointer">
                <span>All collections</span>{!selectedCollection && <HugeiconsIcon icon={CheckIcon} size={13} className="text-primary" />}
              </button>
              {assetCollections.map((collection) => <button key={collection} type="button" onClick={() => { setSelectedCollection(collection); setCollectionMenuOpen(false); }} className="w-full px-3 py-2 text-left text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between cursor-pointer">
                <span className="truncate">{collection}</span>{selectedCollection === collection && <HugeiconsIcon icon={CheckIcon} size={13} className="text-primary" />}
              </button>)}
              {assetCollections.length === 0 && <div className="px-3 py-2 text-[hsl(var(--muted-foreground))]">No collections yet</div>}
            </div>}
          </div>
        </div>
      </div>

      {/* Main Asset Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <MeshUploadStatus state={meshUploadState} onDismiss={resetMeshUpload} />

        {/* Upload 3D Model Dropzone Card */}
        <div
          id="btn-upload-3d-model-card"
          role="button"
          tabIndex={0}
          aria-label="Upload 3D model"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploadActive && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!uploadActive) fileInputRef.current?.click();
            }
          }}
          aria-disabled={uploadActive}
          className={`group relative w-full rounded-2xl border border-dashed ${
            uploadActive ? 'cursor-wait opacity-60' : 'cursor-pointer'
          } p-4 flex flex-col items-center justify-center text-center transition-colors bg-[hsl(var(--surface-0))] ${
            isDragOver
              ? 'border-primary bg-[hsl(var(--surface-2))] ring-2 ring-primary/30'
              : 'border-[hsl(var(--border))] hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--surface-2))]/50'
          }`}
        >
          <div className="flex flex-col items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform mb-2.5">
              <HugeiconsIcon icon={ArrowUp01Icon} size={18} className="stroke-[2.5]" />
            </div>
            <span className="text-xs font-semibold text-[hsl(var(--foreground))] tracking-wide">
              Upload 3D Model
            </span>
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
              GLB, GLTF, OBJ, FBX, STL, PLY
            </span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]/80 font-mono mt-0.5">
              Size ≤ 200MB
            </span>
          </div>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="py-6 px-2 text-center text-[hsl(var(--muted-foreground))]">
            <HugeiconsIcon icon={FolderOpenIcon} size={16} className="w-8 h-8 mx-auto mb-2 opacity-60" />
            <div className="text-xs font-semibold text-[hsl(var(--foreground))]">No base meshes yet</div>
            <div className="text-[11px] mt-1">Generate a model or upload a 3D file above.</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* Asset Items */}
            {paginatedAssets.map((asset) => {
            const isSelected = currentAsset?.id === asset.id;
            const favoriteKey = asset.isLocalDuplicate
              ? asset.id
              : asset.id.startsWith('local_')
                ? (asset.source?.fileId || asset.fileId || asset.id).replace(/^job-/, '')
                : asset.id.replace(/^(?:hist_|upload_)/, '');

            return (
              <div
                key={asset.id}
                id={`asset-card-${asset.id}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify(asset));
                  e.dataTransfer.setData('text/plain', asset.id);
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
                onClick={() => setCurrentAsset(asset)}
                className={`group relative rounded-xl cursor-grab active:cursor-grabbing transition-all aspect-square flex flex-col ${
                  isSelected
                    ? 'ring-2 ring-[hsl(var(--primary))] bg-[hsl(var(--surface-2))] shadow-md shadow-[hsl(var(--primary))]/15'
                    : 'border border-[hsl(var(--border))] bg-[hsl(var(--surface-0))] hover:border-[hsl(var(--foreground))]/25 hover:bg-[hsl(var(--surface-2))]'
                }`}
                title={`Click or drag "${asset.name}" into 3D Viewport`}
              >
                {/* 3D Asset Thumbnail */}
                <div className="relative w-full flex-1 bg-[hsl(var(--surface-0))] overflow-hidden rounded-t-xl">
                  {asset.thumbnail && !failedThumbnails.has(`${asset.id}:${asset.thumbnail}`) ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      crossOrigin="anonymous"
                      onError={() => {
                        setFailedThumbnails((prev) => new Set(prev).add(`${asset.id}:${asset.thumbnail}`));
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-[hsl(var(--surface-1))] gap-1 p-1">
                      <div className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] flex items-center justify-center">
                        <HugeiconsIcon icon={Box} size={16} className="w-4 h-4 text-zinc-400" />
                      </div>
                      <span className="text-[9px] font-bold text-zinc-400 uppercase">
                        {asset.format}
                      </span>
                    </div>
                  )}

                  {asset.thumbnail && (
                    <div
                      className="absolute top-1.5 left-1.5 z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={asset.thumbnail}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex p-1 rounded-md bg-black/75 hover:bg-black text-zinc-200 hover:text-primary border border-white/15 shadow transition-colors"
                        title="Zoom preview"
                      >
                        <HugeiconsIcon icon={ZoomInIcon} size={14} className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}

                  <button
                    type="button"
                    aria-label={`Delete ${asset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAsset(asset.id);
                    }}
                    className="absolute top-1.5 right-1.5 z-20 p-1 rounded-md bg-black/75 hover:bg-black text-zinc-200 hover:text-rose-400 border border-white/15 shadow transition-colors cursor-pointer"
                    title="Delete asset"
                  >
                    <HugeiconsIcon icon={Trash2} size={14} className="w-3.5 h-3.5" />
                  </button>

                  {isSelected && (
                    <div className="absolute bottom-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-primary flex items-center justify-center text-black shadow-md">
                      <HugeiconsIcon icon={CheckIcon} size={14} className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Bottom Asset Label */}
                <div className="px-2 py-1.5 bg-[hsl(var(--surface-1))] border-t border-white/[0.06] rounded-b-xl flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-xs truncate font-medium ${isSelected ? 'text-primary font-bold' : 'text-zinc-200'}`}>
                      {asset.name}
                    </span>
                    <QualityBadge asset={asset} size="sm" />
                  </div>

                  {/* 3-Dots Menu */}
                  <div className="relative flex items-center flex-shrink-0" data-asset-menu={asset.id}>
                    <button
                      type="button"
                      aria-label={`Options for ${asset.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuAssetId(activeMenuAssetId === asset.id ? null : asset.id);
                      }}
                      className="p-1 rounded-md text-zinc-300 bg-white/[0.05] hover:text-white hover:bg-white/[0.12] border border-white/[0.06] transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={MoreVerticalIcon} size={14} className="w-3.5 h-3.5" />
                    </button>

                      {activeMenuAssetId === asset.id && (
                        <div className="absolute right-0 top-full mt-1 w-52 py-1.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.1] shadow-2xl z-50 text-xs font-medium animate-in fade-in zoom-in-95 duration-100">
                          <button
                            type="button"
                            aria-pressed={Boolean(asset.isFavorite)}
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextFavorite = !asset.isFavorite;
                              setAssetFavorite(favoriteKey, nextFavorite);
                              setActiveMenuAssetId(null);
                              toast.success(nextFavorite ? 'Added to favorites' : 'Removed from favorites');
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-zinc-200 hover:bg-[hsl(var(--surface-3))] flex items-center gap-1.5 cursor-pointer"
                          >
                            <HugeiconsIcon icon={StarIcon} size={15} className={asset.isFavorite ? 'w-3.5 h-3.5 text-primary fill-current' : 'w-3.5 h-3.5 text-zinc-400'} />
                            <span>{asset.isFavorite ? 'Remove Favorite' : 'Add to Favorites'}</span>
                          </button>
                          <div className="border-t border-white/[0.06] my-1" />
                          {asset.collection && (
                            <>
                              <div className="px-2.5 py-1 text-[9px] font-mono text-primary truncate flex items-center justify-between">
                                <span>Group: {asset.collection}</span>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const prevCol = asset.collection;
                                  updateAssetProperties(asset.id, {
                                    collection: undefined,
                                    tags: (asset.tags || []).filter((t) => t !== prevCol),
                                  });
                                  setAssetCollectionAssignment(asset.id, null);
                                  setActiveMenuAssetId(null);
                                  toast.success(`Removed from "${prevCol}"`);
                                }}
                                className="w-full text-left px-2.5 py-1 text-amber-300 hover:bg-[hsl(var(--surface-3))] flex items-center gap-1.5 cursor-pointer text-[11px]"
                              >
                                <HugeiconsIcon icon={FolderOpenIcon} size={14} className="w-3 h-3 text-amber-400" />
                                <span>Remove from Group</span>
                              </button>
                              <div className="border-t border-white/[0.06] my-1" />
                            </>
                          )}

                          <div className="px-2.5 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                            Add to Collection
                          </div>
                          {assetCollections.map((col) => (
                            <button
                              key={col}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateAssetProperties(asset.id, {
                                  collection: col,
                                  tags: Array.from(new Set([...(asset.tags || []), col])),
                                });
                                setAssetCollectionAssignment(asset.id, col);
                                setActiveMenuAssetId(null);
                                toast.success(`Added to "${col}"`);
                              }}
                              className={`w-full text-left px-2.5 py-1 text-[11px] hover:bg-[hsl(var(--surface-3))] flex items-center justify-between cursor-pointer ${
                                asset.collection === col ? 'text-primary font-bold' : 'text-zinc-300'
                              }`}
                            >
                              <span className="truncate">{col}</span>
                              {asset.collection === col && <HugeiconsIcon icon={CheckIcon} size={12} className="w-3 h-3 text-primary" />}
                            </button>
                          ))}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollectionAssetId(asset.id);
                              setCollectionName('');
                            }}
                            className="w-full text-left px-2.5 py-1 text-[10px] text-primary hover:underline font-bold cursor-pointer"
                          >
                            + Create New
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateAsset(asset.id);
                              setActiveMenuAssetId(null);
                            }}
                           className="w-full text-left px-2.5 py-1.5 text-zinc-200 hover:bg-[hsl(var(--surface-3))] flex items-center gap-1.5 cursor-pointer"
                         >
                           <HugeiconsIcon icon={Copy} size={16} className="w-3 h-3 text-primary" />
                           <span>Duplicate</span>
                         </button>
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             deleteAsset(asset.id);
                             setActiveMenuAssetId(null);
                           }}
                           className="w-full text-left px-2.5 py-1.5 text-rose-400 hover:bg-rose-500/10 flex items-center gap-1.5 cursor-pointer"
                         >
                           <HugeiconsIcon icon={Trash2} size={16} className="w-3 h-3" />
                           <span>Delete</span>
                         </button>
                        </div>
                      )}
                   </div>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="px-3 py-2 border-t border-white/[0.08] bg-[hsl(var(--surface-1))] flex items-center justify-between text-xs text-zinc-400">
        <span className="text-[10px] text-zinc-500 font-mono">
          Page {safePage} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            onClick={() => setActivePage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            className="p-1 rounded-lg hover:text-white hover:bg-[hsl(var(--surface-2))] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ChevronLeft} size={16} className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <button
              key={page}
              type="button"
              aria-label={`Page ${page}`}
              onClick={() => setActivePage(page)}
              className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold transition-all cursor-pointer ${
                safePage === page ? 'bg-primary text-black shadow-sm font-extrabold' : 'hover:text-white hover:bg-[hsl(var(--surface-2))] text-zinc-400'
              }`}
            >
              {page}
            </button>
          ))}

          <button
            type="button"
            aria-label="Next page"
            onClick={() => setActivePage(Math.min(totalPages, safePage + 1))}
            disabled={safePage >= totalPages}
            className="p-1 rounded-lg hover:text-white hover:bg-[hsl(var(--surface-2))] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ChevronRight} size={16} className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
    <Dialog open={collectionAssetId !== null} onOpenChange={open => {
      if (!open) {
        setCollectionAssetId(null);
        setActiveMenuAssetId(null);
      }
    }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New collection</DialogTitle></DialogHeader>
        <form onSubmit={event => {
          event.preventDefault();
          const asset = assets.find(item => item.id === collectionAssetId);
          const name = collectionName.trim();
          if (!asset || !name) return;
          addAssetCollection(name);
          updateAssetProperties(asset.id, { collection: name, tags: Array.from(new Set([...(asset.tags || []), name])) });
          setAssetCollectionAssignment(asset.id, name);
          toast.success(`Created "${name}" and added asset`);
          setCollectionAssetId(null);
          setActiveMenuAssetId(null);
        }}>
          <Input autoFocus aria-label="Collection name" value={collectionName} onChange={event => setCollectionName(event.target.value)} />
          <DialogFooter><button type="submit" disabled={!collectionName.trim()} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Create collection</button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
};
