import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAppStore } from '@/stores/useAppStore';
import { useMeshAssetUpload } from '@/hooks/useMeshAssetUpload';
import { MeshUploadStatus } from '../Panels/MeshUploadStatus';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUp01Icon,
  Box,
  CheckIcon,
  CheckmarkCircle02Icon,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilterIcon,
  FolderOpenIcon,
  GridIcon,
  MoreVerticalIcon,
  StarIcon,
  Trash2,
  ZoomInIcon,
} from '@hugeicons/core-free-icons';
import { settingsPersistence } from '@/services/settingsPersistence';
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
  } = useWorkspace();

  const { assetCollections, addAssetCollection } = useAppStore();

  const [activePage, setActivePage] = useState(1);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [activeMenuAssetId, setActiveMenuAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { state: meshUploadState, upload: uploadMesh } = useMeshAssetUpload();
  const uploadActive = meshUploadState.status === 'uploading' || meshUploadState.status === 'verifying';

  const ITEMS_PER_PAGE = 8;

  useEffect(() => {
    setActivePage(1);
  }, [assetFilter, showFavoritesOnly, selectedCollection]);

  // Handle outside click and Escape key for dropdown menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
      if (activeMenuAssetId && !(e.target as HTMLElement).closest(`[data-asset-menu="${activeMenuAssetId}"]`)) {
        setActiveMenuAssetId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFilterMenuOpen(false);
        setActiveMenuAssetId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuAssetId]);

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

  const filteredAssets = assets.filter(a => {
    if (showFavoritesOnly && !a.isFavorite) return false;
    if (selectedCollection && a.collection !== selectedCollection && !a.tags?.includes(selectedCollection)) return false;
    if (assetFilter === 'all') return true;
    if (assetFilter === 'models') return a.category === 'generation' || a.category === 'mesh';
    if (assetFilter === 'textures') return a.category === 'texture' || a.tags?.includes('PBR');
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / ITEMS_PER_PAGE));
  const safePage = Math.min(activePage, totalPages);
  const paginatedAssets = filteredAssets.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  return (
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
                    ? 'bg-white/10 text-[#F9CF00]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
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
                    ? 'bg-white/10 text-[#F9CF00]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <HugeiconsIcon icon={StarIcon} size={15} />
              </button>
            </SimpleTooltip>

            {/* Category Filter */}
            <div className="relative" ref={filterMenuRef}>
              <SimpleTooltip label="Filter by Type">
                <button
                  type="button"
                  aria-label="Filter by Type"
                  onClick={() => setFilterMenuOpen(!filterMenuOpen)}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    assetFilter !== 'all'
                      ? 'bg-white/10 text-[#F9CF00]'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <HugeiconsIcon icon={FilterIcon} size={15} />
                </button>
              </SimpleTooltip>

              {filterMenuOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-36 py-1.5 rounded-xl bg-[#242428] border border-white/[0.1] shadow-2xl z-50 text-xs font-medium animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => { setAssetFilter('all'); setFilterMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-zinc-200 cursor-pointer flex items-center justify-between"
                  >
                    <span>All Assets</span>
                    {assetFilter === 'all' && <HugeiconsIcon icon={CheckIcon} size={14} className="text-[#F9CF00]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAssetFilter('models'); setFilterMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-zinc-200 cursor-pointer flex items-center justify-between"
                  >
                    <span>3D Models</span>
                    {assetFilter === 'models' && <HugeiconsIcon icon={CheckIcon} size={14} className="text-[#F9CF00]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAssetFilter('textures'); setFilterMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-zinc-200 cursor-pointer flex items-center justify-between"
                  >
                    <span>PBR Textures</span>
                    {assetFilter === 'textures' && <HugeiconsIcon icon={CheckIcon} size={14} className="text-[#F9CF00]" />}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Manage Pill Button matching Reference */}
          <button
            type="button"
            onClick={() => {
              if (selectedCollection) setSelectedCollection(null);
            }}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-zinc-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-all cursor-pointer flex items-center gap-1.5"
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} className="text-zinc-400" />
            <span>Manage</span>
          </button>
        </div>
      </div>

      {/* Main Asset Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 no-scrollbar">
        <MeshUploadStatus state={meshUploadState} />

        {/* Upload 3D Model Dropzone Card - Matching Studio Reference */}
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
          } p-4 flex flex-col items-center justify-center text-center transition-all bg-[#12131F] [background-image:linear-gradient(45deg,#18192A_25%,transparent_25%),linear-gradient(-45deg,#18192A_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18192A_75%),linear-gradient(-45deg,transparent_75%,#18192A_75%)] [background-size:14px_14px] [background-position:0_0,0_7px,7px_-7px,-7px_0px] shadow-inner ${
            isDragOver
              ? 'border-[#6366F1] bg-[#18192A] shadow-[0_0_16px_rgba(99,102,241,0.25)]'
              : 'border-[#48457D]/50 hover:border-[#6366F1]'
          }`}
        >
          <div className="flex flex-col items-center justify-center">
            {/* Purple / Indigo circular button with upward arrow matching reference */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-b from-[#6366F1] to-[#4F46E5] text-white flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform mb-2.5">
              <HugeiconsIcon icon={ArrowUp01Icon} size={18} className="stroke-[2.5]" />
            </div>
            <span className="text-xs font-bold text-white tracking-wide">
              Upload 3D Model
            </span>
            <span className="text-[10px] text-zinc-400 mt-1 font-medium">
              OBJ, FBX, STL, GLB
            </span>
            <span className="text-[9.5px] text-zinc-500 font-mono mt-0.5">
              Size ≤ 150MB
            </span>
          </div>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="py-6 px-2 text-center text-zinc-400">
            <HugeiconsIcon icon={FolderOpenIcon} size={16} className="w-8 h-8 mx-auto mb-2 text-zinc-500" />
            <div className="text-xs font-bold text-zinc-300">No outputs yet</div>
            <div className="text-[11px] mt-1 text-zinc-500">Run a generation workflow or import a 3D file above.</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* Asset Items */}
            {paginatedAssets.map((asset) => {
            const isSelected = currentAsset?.id === asset.id;

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
                className={`group relative rounded-xl overflow-hidden cursor-grab active:cursor-grabbing transition-all aspect-square flex flex-col ${
                  isSelected
                    ? 'ring-2 ring-[hsl(var(--primary))] bg-[hsl(var(--surface-2))] shadow-md shadow-[hsl(var(--primary))]/15'
                    : 'border border-white/[0.08] bg-[hsl(var(--surface-0))] hover:border-white/[0.2] hover:bg-[#1A1B1F]'
                }`}
                title={`Click or drag "${asset.name}" into 3D Viewport`}
              >
                {/* 3D Asset Thumbnail */}
                <div className="relative w-full flex-1 bg-[#121316] overflow-hidden">
                  {asset.thumbnail ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      crossOrigin="anonymous"
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
                      className="absolute top-1.5 left-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={asset.thumbnail}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-md bg-black/70 hover:bg-black text-zinc-300 hover:text-primary border border-white/20 shadow transition-colors"
                        title="Zoom preview"
                      >
                        <HugeiconsIcon icon={ZoomInIcon} size={16} className="w-3 h-3" />
                      </a>
                    </div>
                  )}

                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-black shadow">
                      <HugeiconsIcon icon={CheckIcon} size={16} className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Bottom Asset Label */}
                <div className="px-2 py-1.5 bg-[hsl(var(--surface-1))] border-t border-white/[0.06] flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-xs truncate font-medium ${isSelected ? 'text-primary font-bold' : 'text-zinc-200'}`}>
                      {asset.name}
                    </span>
                    <QualityBadge asset={asset} size="sm" />
                  </div>

                  {/* 3-Dots Menu */}
                  <div className="relative" data-asset-menu={asset.id}>
                    <button
                      type="button"
                      aria-label={`Options for ${asset.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuAssetId(activeMenuAssetId === asset.id ? null : asset.id);
                      }}
                      className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-2))] transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={MoreVerticalIcon} size={16} className="w-3.5 h-3.5" />
                    </button>

                      {activeMenuAssetId === asset.id && (
                        <div className="absolute right-0 bottom-full mb-1 w-44 py-1.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.1] shadow-2xl z-50 text-xs font-medium animate-in fade-in zoom-in-95 duration-100">
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
                              const name = window.prompt('New collection name:');
                              if (name && name.trim()) {
                                const trimmed = name.trim();
                                addAssetCollection(trimmed);
                                updateAssetProperties(asset.id, {
                                  collection: trimmed,
                                  tags: Array.from(new Set([...(asset.tags || []), trimmed])),
                                });
                                toast.success(`Created "${trimmed}" and added asset`);
                              }
                              setActiveMenuAssetId(null);
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
            onClick={() => setActivePage(Math.max(1, activePage - 1))}
            disabled={activePage <= 1}
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
            onClick={() => setActivePage(Math.min(totalPages, activePage + 1))}
            disabled={activePage >= totalPages}
            className="p-1 rounded-lg hover:text-white hover:bg-[hsl(var(--surface-2))] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ChevronRight} size={16} className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
