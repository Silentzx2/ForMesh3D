'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';
import type { ModelAsset, WorkspaceVersionItem } from '../types';

export interface TrashItem {
  trash_id: string;
  kind: 'workspace' | 'asset';
  workspace_id: string;
  asset_id?: string | null;
  name: string;
  asset_type?: string | null;
  operation_type?: string | null;
  trashed_at?: string;
}

function VersionPreviewCanvas({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) return;

    const w = container.clientWidth || 260;
    const h = container.clientHeight || 220;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 200);
    camera.position.set(0, 0.8, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 3);
    scene.add(ambient, key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);

    let cancelled = false;
    setLoading(true);
    setError(null);

    loader
      .loadAsync(url)
      .then((gltf) => {
        if (cancelled) return;
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const scale = 1.4 / maxDim;
        obj.scale.multiplyScalar(scale);
        obj.position.sub(center.multiplyScalar(scale));
        scene.add(obj);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Preview unavailable');
          setLoading(false);
        }
      })
      .finally(() => {
        draco.dispose();
      });

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
    };
  }, [url]);

  return (
    <div
      className="relative w-full h-52 rounded-xl overflow-hidden border border-[hsl(var(--border))]"
      style={{
        background:
          'radial-gradient(ellipse 75% 75% at 50% 45%, #34363c 0%, #24262b 55%, #18191d 100%)',
      }}
    >
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300 bg-black/30">
          Loading preview...
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
          {error}
        </div>
      )}
    </div>
  );
}

interface AssetDeleteModalProps {
  asset: ModelAsset | null;
  derivedVersions: WorkspaceVersionItem[];
  onClose: () => void;
  onDeleteWorkspace: (workspaceId: string, permanent: boolean) => Promise<void>;
  onDeleteSpecificVersion: (workspaceId: string, assetId: string, permanent: boolean) => Promise<void>;
  onDeleteStandalone: (asset: ModelAsset) => Promise<void>;
}

export function AssetDeleteModal({
  asset,
  derivedVersions,
  onClose,
  onDeleteWorkspace,
  onDeleteSpecificVersion,
  onDeleteStandalone,
}: AssetDeleteModalProps) {
  const hasDerived = Boolean(asset?.workspace_id) && derivedVersions.length > 0;
  const [mode, setMode] = useState<'specific' | 'workspace'>(hasDerived ? 'specific' : 'workspace');
  const [selectedAssetId, setSelectedAssetId] = useState<string>(derivedVersions[0]?.asset_id || '');
  const [permanent, setPermanent] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(hasDerived ? 'specific' : 'workspace');
    setSelectedAssetId(derivedVersions[0]?.asset_id || '');
    setPermanent(false);
    setCountdown(3);
  }, [asset?.id, hasDerived, derivedVersions]);

  useEffect(() => {
    if (!asset || mode !== 'workspace') return;
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [asset, mode]);

  if (!asset) return null;

  const selectedVersion = derivedVersions.find((v) => v.asset_id === selectedAssetId) || derivedVersions[0];

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'specific' && asset.workspace_id && selectedVersion) {
        await onDeleteSpecificVersion(asset.workspace_id, selectedVersion.asset_id, permanent);
      } else if (asset.workspace_id) {
        await onDeleteWorkspace(asset.workspace_id, permanent);
      } else {
        await onDeleteStandalone(asset);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-foreground shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-semibold">Delete Mesh</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close delete dialog"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {hasDerived && (
          <div className="grid grid-cols-2 gap-1 p-2 bg-[hsl(var(--surface-0))] border-b border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={() => setMode('specific')}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mode === 'specific'
                  ? 'bg-[hsl(var(--surface-2))] text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Specific Version ({derivedVersions.length})
            </button>
            <button
              type="button"
              onClick={() => setMode('workspace')}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mode === 'workspace'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-muted-foreground hover:text-rose-300'
              }`}
            >
              Entire Workspace
            </button>
          </div>
        )}

        <div className="p-5 space-y-4">
          {mode === 'specific' && selectedVersion ? (
            <>
              <VersionPreviewCanvas url={selectedVersion.url} />
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {derivedVersions.map((v) => (
                  <button
                    key={v.asset_id}
                    type="button"
                    onClick={() => setSelectedAssetId(v.asset_id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors ${
                      v.asset_id === selectedVersion.asset_id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--surface-0))] text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="truncate font-medium">{v.name || v.version_label}</span>
                    <span className="text-[10px] uppercase font-mono opacity-80">
                      {v.operation_type || 'derived'}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-rose-200">
                  {asset.workspace_id
                    ? `Delete "${asset.name}" and its entire workspace?`
                    : `Delete "${asset.name}"?`}
                </p>
                <p className="text-rose-200/80 leading-relaxed">
                  {asset.workspace_id
                    ? 'This removes the Base Mesh and all Texture, Retopology, UV, Rigging, and Animation files & DB records from your workspace.'
                    : 'This removes the uploaded mesh file from storage.'}
                </p>
              </div>
            </div>
          )}

          {asset.workspace_id && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={permanent}
                onChange={(e) => setPermanent(e.target.checked)}
                className="rounded border-[hsl(var(--border))]"
              />
              <span>Delete permanently (skip temporary Trash Bin)</span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]"
          >
            No, Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || (mode === 'workspace' && countdown > 0)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
          >
            {busy
              ? 'Deleting...'
              : mode === 'workspace' && countdown > 0
                ? `Yes, Delete (${countdown}s)`
                : permanent
                  ? 'Yes, Delete Forever'
                  : 'Yes, Move to Trash'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TrashBinModalProps {
  open: boolean;
  items: TrashItem[];
  loading: boolean;
  onClose: () => void;
  onRestore: (trashId: string) => Promise<void>;
  onPurge: (trashId: string) => Promise<void>;
  onEmpty: () => Promise<void>;
}

export function TrashBinModal({
  open,
  items,
  loading,
  onClose,
  onRestore,
  onPurge,
  onEmpty,
}: TrashBinModalProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-foreground shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Trash Bin</h2>
            <span className="text-[11px] text-muted-foreground">(Temp — auto-clears on restart)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trash bin"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Loading trash...</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Trash bin is empty.</p>
          ) : (
            items.map((item) => (
              <div
                key={item.trash_id}
                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {item.kind === 'workspace' ? 'Entire Workspace' : item.operation_type || 'Derived Version'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={async () => {
                      setBusyId(item.trash_id);
                      try {
                        await onRestore(item.trash_id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] text-foreground flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Restore
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={async () => {
                      setBusyId(item.trash_id);
                      try {
                        await onPurge(item.trash_id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15"
                    aria-label="Delete permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]">
          <button
            type="button"
            disabled={items.length === 0 || busyId !== null}
            onClick={async () => {
              setBusyId('__empty');
              try {
                await onEmpty();
              } finally {
                setBusyId(null);
              }
            }}
            className="text-xs font-medium text-rose-400 hover:text-rose-300 disabled:opacity-40"
          >
            Empty Trash
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
