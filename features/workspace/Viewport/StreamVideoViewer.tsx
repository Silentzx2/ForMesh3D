'use client';

import React from 'react';
import { useWebSocketStream } from '../hooks/useWebSocketStream';
import { HugeiconsIcon } from '@hugeicons/react';
import { SparklesIcon, RefreshCw, AlertCircle } from '@hugeicons/core-free-icons';

interface StreamVideoViewerProps {
  workspaceId?: string | null;
  modelUrl?: string | null;
  shadingMode?: string;
  showWireframe?: boolean;
  className?: string;
}

export const StreamVideoViewer: React.FC<StreamVideoViewerProps> = ({
  workspaceId,
  modelUrl,
  shadingMode = 'clay',
  showWireframe = false,
  className = '',
}) => {
  const {
    canvasRef,
    connectionState,
    streamTransport,
    fps,
    latencyMs,
    errorMessage,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    retry,
  } = useWebSocketStream({
    workspaceId,
    modelUrl,
    enabled: true,
    shadingMode,
    showWireframe,
  });

  return (
    <div
      className={`relative w-full h-full overflow-hidden select-none bg-[#121316] ${className}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      style={{ touchAction: 'none' }}
    >
      {/* WebSocket Canvas (universal streaming channel) */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-300 ${
          streamTransport === 'websocket' && connectionState === 'streaming' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Telemetry Badge — Top Right */}
      {connectionState === 'streaming' && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/60 border border-[#F9CF00]/30 shadow-lg backdrop-blur-md text-[11px] font-mono text-zinc-300 pointer-events-none">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F9CF00] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F9CF00]" />
          </span>
          <span className="text-[#F9CF00] font-semibold">⚡ Cloud Stream</span>
          <span className="text-zinc-500">|</span>
          <span>{fps > 0 ? `${fps} FPS` : 'Live'}</span>
          {latencyMs > 0 && (
            <>
              <span className="text-zinc-500">|</span>
              <span>{latencyMs}ms</span>
            </>
          )}
          <span className="text-zinc-500">|</span>
          <span className="text-zinc-400 uppercase text-[9px]">{streamTransport}</span>
        </div>
      )}

      {/* Loading state indicator */}
      {connectionState === 'connecting' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none bg-black/40 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-black/70 border border-white/10 shadow-2xl">
            <HugeiconsIcon icon={SparklesIcon} size={28} className="text-[#F9CF00] animate-pulse" />
            <div className="flex flex-col items-center">
              <span className="text-xs font-semibold text-white">Starting Cloud 3D Stream</span>
              <span className="text-[10px] text-zinc-400 mt-0.5">Connecting to GPU offscreen renderer…</span>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {connectionState === 'error' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-4 bg-black/60">
          <div className="max-w-sm flex flex-col items-center text-center p-4 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 shadow-xl">
            <HugeiconsIcon icon={AlertCircle} size={24} className="text-red-400 mb-2" />
            <span className="text-xs font-semibold">Stream Connection Failed</span>
            <span className="text-[11px] text-red-300/80 mt-1">{errorMessage || 'Unable to start remote stream session.'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                retry();
              }}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={RefreshCw} size={14} />
              <span>Retry Stream</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
