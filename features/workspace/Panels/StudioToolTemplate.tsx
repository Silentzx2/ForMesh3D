'use client';

import React, { useRef, useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { uploadMeshAsset } from '../types';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  UploadIcon,
  ArrowRight01Icon,
  AlertCircle,
  CheckmarkCircle02Icon,
  Box,
} from '@hugeicons/core-free-icons';

export interface StudioToolConfig {
  title: string;
  icon: any;
  heroType:
    | 'segment'
    | 'retopo'
    | 'uv'
    | 'texture'
    | 'pbr'
    | 'rig'
    | 'animate';
  actionLabel: string;
  constraintsBadge?: string;
  unavailableCards?: Array<{ label: string; icon: any }>;
  supportCards?: Array<{ label: string; icon: any }>;
  onExecute?: () => Promise<void> | void;
}

export const StudioToolTemplate: React.FC<StudioToolConfig> = ({
  title,
  icon: ToolIcon,
  heroType,
  actionLabel,
  constraintsBadge,
  unavailableCards,
  supportCards,
  onExecute,
}) => {
  const { currentAsset, addAsset, setCurrentAsset, isExecuting } = useWorkspace();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      toast.info(`Uploading 3D model: ${file.name}...`);
      const asset = await uploadMeshAsset(file);
      addAsset(asset);
      setCurrentAsset(asset);
      toast.success(`Model loaded: ${asset.name}`);
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message || 'Network error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleActionClick = async () => {
    if (!currentAsset) {
      toast.warning('Please select a 3D model from Assets or upload one first.');
      return;
    }
    if (onExecute) {
      try {
        await onExecute();
      } catch (err: any) {
        toast.error(`Operation failed: ${err.message || 'Unknown error'}`);
      }
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] overflow-y-auto overflow-x-hidden p-3.5 space-y-4">
      {/* 1. Tool Header */}
      <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
        <HugeiconsIcon icon={ToolIcon} size={18} className="text-[#F9CF00]" />
        <h2 className="text-xs font-bold text-[hsl(var(--foreground))] tracking-wide uppercase">{title}</h2>
      </div>

      {/* 2. Hero Transformation Banner matching reference */}
      <div className="p-4 rounded-2xl bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] flex items-center justify-center gap-3 relative overflow-hidden shadow-sm">
        {/* Left Input Graphic */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-14 h-14 rounded-xl bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] flex items-center justify-center text-[hsl(var(--muted-foreground))]">
            <HugeiconsIcon icon={Box} size={28} />
          </div>
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium">Input Mesh</span>
        </div>

        {/* Arrow */}
        <div className="p-1 rounded-full bg-[hsl(var(--surface-3))] text-[#F9CF00]">
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
        </div>

        {/* Right Output Graphic */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-14 h-14 rounded-xl bg-[#F9CF00]/10 border border-[#F9CF00]/30 flex items-center justify-center text-[#F9CF00] shadow-lg shadow-[#F9CF00]/5">
            <HugeiconsIcon icon={ToolIcon} size={28} />
          </div>
          <span className="text-[10px] text-[#F9CF00] font-semibold">Processed</span>
        </div>
      </div>

      {/* 3. Instruction Callout with #F9CF00 Highlight */}
      <div className="text-center px-2 py-1">
        <p className="text-xs text-zinc-300 leading-relaxed">
          Select a model from Assets on the right or{' '}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[#F9CF00] font-bold underline cursor-pointer hover:opacity-80 bg-transparent p-0 border-0 inline font-inherit"
          >
            upload your own
          </button>{' '}
          for {title}
        </p>
      </div>

      {/* 4. Direct Upload 3D Model Trigger Button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.obj,.fbx,.stl"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="px-5 py-2.5 rounded-full bg-[#F9CF00] hover:bg-[#ffdb29] text-black font-bold text-xs flex items-center gap-2 shadow-md shadow-[#F9CF00]/10 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          <HugeiconsIcon icon={UploadIcon} size={15} className="stroke-[2.5]" />
          <span>{isUploading ? 'Uploading...' : 'Upload 3D Model'}</span>
        </button>
      </div>

      {/* 5. Tool Specific Constraints / Badges */}
      {constraintsBadge && (
        <div className="text-center pt-1">
          <span className="inline-block px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-mono text-zinc-300">
            {constraintsBadge}
          </span>
        </div>
      )}

      {/* Unavailable for section (Segmentation) */}
      {unavailableCards && unavailableCards.length > 0 && (
        <div className="pt-2 border-t border-white/[0.08] space-y-2">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Unavailable for
          </p>
          <div className="grid grid-cols-2 gap-2">
            {unavailableCards.map((c, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06] flex items-center gap-2"
              >
                <div className="w-5 h-5 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center flex-shrink-0">
                  <HugeiconsIcon icon={AlertCircle} size={12} />
                </div>
                <span className="text-[10px] text-zinc-300 font-medium truncate">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* We Offer Support For section (Rigging) */}
      {supportCards && supportCards.length > 0 && (
        <div className="pt-2 border-t border-white/[0.08] space-y-2">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            We Offer Support For
          </p>
          <div className="grid grid-cols-2 gap-2">
            {supportCards.map((c, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06] flex items-center gap-2"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
                </div>
                <span className="text-[10px] text-zinc-300 font-medium truncate">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Model Status pill */}
      {currentAsset && (
        <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="text-white font-medium truncate">{currentAsset.name}</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono">
            {currentAsset.format || 'GLB'}
          </span>
        </div>
      )}

      {/* 6. Bottom Action Button */}
      <div className="pt-3 mt-auto">
        <button
          type="button"
          onClick={handleActionClick}
          disabled={!currentAsset || isExecuting}
          className={`w-full py-3 rounded-full font-extrabold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
            currentAsset && !isExecuting
              ? 'bg-[#F9CF00] hover:bg-[#e5be00] text-black shadow-lg shadow-[#F9CF00]/10 active:scale-[0.98]'
              : 'bg-white/10 text-zinc-500 cursor-not-allowed'
          }`}
        >
          {isExecuting ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <span>{actionLabel}</span>
          )}
        </button>
      </div>
    </div>
  );
};
