'use client';

import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useWorkspace } from '../store/WorkspaceContext';
import { useViewerStore } from '@/stores/useViewerStore';
import { RealModelPreviewCanvas } from './RealModelPreviewCanvas';
import { downloadArtifact } from '../lib/artifactDownload';
import {
  Bone,
  RotateCw,
  Sparkles,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';

interface BoneJoint {
  id: string;
  name: string;
  parent: string | null;
  pos: [number, number, number];
  rot: [number, number, number];
  category: 'spine' | 'head' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';
}

const CANONICAL_BONES: BoneJoint[] = [
  { id: 'root', name: 'Root / Hips', parent: null, pos: [0, 0, 0], rot: [0, 0, 0], category: 'spine' },
  { id: 'spine', name: 'Spine Core', parent: 'root', pos: [0, 0.22, 0], rot: [0, 0, 0], category: 'spine' },
  { id: 'chest', name: 'Chest / Ribs', parent: 'spine', pos: [0, 0.44, 0], rot: [0, 0, 0], category: 'spine' },
  { id: 'neck', name: 'Neck Base', parent: 'chest', pos: [0, 0.62, 0], rot: [0, 0, 0], category: 'head' },
  { id: 'head', name: 'Head Cranium', parent: 'neck', pos: [0, 0.82, 0], rot: [0, 0, 0], category: 'head' },
  { id: 'shoulder_l', name: 'Left Shoulder', parent: 'chest', pos: [-0.28, 0.48, 0], rot: [0, 0, 0], category: 'arm_l' },
  { id: 'arm_l', name: 'Left Upper Arm', parent: 'shoulder_l', pos: [-0.55, 0.46, 0], rot: [0, 0, 0], category: 'arm_l' },
  { id: 'hand_l', name: 'Left Hand & Wrist', parent: 'arm_l', pos: [-0.85, 0.44, 0], rot: [0, 0, 0], category: 'arm_l' },
  { id: 'shoulder_r', name: 'Right Shoulder', parent: 'chest', pos: [0.28, 0.48, 0], rot: [0, 0, 0], category: 'arm_r' },
  { id: 'arm_r', name: 'Right Upper Arm', parent: 'shoulder_r', pos: [0.55, 0.46, 0], rot: [0, 0, 0], category: 'arm_r' },
  { id: 'hand_r', name: 'Right Hand & Wrist', parent: 'arm_r', pos: [0.85, 0.44, 0], rot: [0, 0, 0], category: 'arm_r' },
  { id: 'hip_l', name: 'Left Hip Joint', parent: 'root', pos: [-0.18, -0.05, 0], rot: [0, 0, 0], category: 'leg_l' },
  { id: 'knee_l', name: 'Left Knee', parent: 'hip_l', pos: [-0.22, -0.48, 0], rot: [0, 0, 0], category: 'leg_l' },
  { id: 'foot_l', name: 'Left Foot Ankle', parent: 'knee_l', pos: [-0.24, -0.88, 0.08], rot: [0, 0, 0], category: 'leg_l' },
  { id: 'hip_r', name: 'Right Hip Joint', parent: 'root', pos: [0.18, -0.05, 0], rot: [0, 0, 0], category: 'leg_r' },
  { id: 'knee_r', name: 'Right Knee', parent: 'hip_r', pos: [0.22, -0.48, 0], rot: [0, 0, 0], category: 'leg_r' },
  { id: 'foot_r', name: 'Right Foot Ankle', parent: 'knee_r', pos: [0.24, -0.88, 0.08], rot: [0, 0, 0], category: 'leg_r' },
];

function findBoneInHierarchy(root: THREE.Object3D, targetIdOrName: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  const targetLower = targetIdOrName.toLowerCase().replace(/[^a-z0-9]/g, '');
  root.traverse((node) => {
    if (found) return;
    if (node instanceof THREE.Bone) {
      const nodeLower = node.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (node.name === targetIdOrName || nodeLower === targetLower || nodeLower.includes(targetLower)) {
        found = node;
      }
    }
  });
  return found;
}

export const DynamicRiggingInspector: React.FC = () => {
  const { currentAsset, setHoveredPartId } = useWorkspace();
  const activeModelObject = useViewerStore((s) => s.activeModelObject);
  const [bones, setBones] = useState<BoneJoint[]>(CANONICAL_BONES);
  const [selectedBoneId, setSelectedBoneId] = useState<string>('arm_l');
  const [orbitYaw, setOrbitYaw] = useState<number>(0);
  const [symmetrySnap, setSymmetrySnap] = useState<boolean>(true);
  const [xrayMode, setXrayMode] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { isRealRig, realBoneCount } = useMemo(() => {
    if (!activeModelObject) return { isRealRig: false, realBoneCount: 54 };
    let count = 0;
    activeModelObject.traverse((c) => { if (c instanceof THREE.Bone) count++; });
    return { isRealRig: count > 0, realBoneCount: count > 0 ? count : 54 };
  }, [activeModelObject]);

  const selectedBone = bones.find((b) => b.id === selectedBoneId) || bones[0];

  const handleRotationChange = (axis: 0 | 1 | 2, val: number) => {
    setBones((prev) =>
      prev.map((b) => {
        if (b.id === selectedBoneId) {
          const newRot: [number, number, number] = [...b.rot];
          newRot[axis] = val;
          return { ...b, rot: newRot };
        }
        if (symmetrySnap) {
          if (selectedBoneId.endsWith('_l') && b.id === selectedBoneId.replace('_l', '_r')) {
            const mirrored: [number, number, number] = [...b.rot];
            mirrored[axis] = axis === 1 ? -val : val;
            return { ...b, rot: mirrored };
          }
          if (selectedBoneId.endsWith('_r') && b.id === selectedBoneId.replace('_r', '_l')) {
            const mirrored: [number, number, number] = [...b.rot];
            mirrored[axis] = axis === 1 ? -val : val;
            return { ...b, rot: mirrored };
          }
        }
        return b;
      })
    );

    if (activeModelObject) {
      const target = findBoneInHierarchy(activeModelObject, selectedBoneId);
      if (target) {
        if (axis === 0) target.rotation.x = THREE.MathUtils.degToRad(val);
        else if (axis === 1) target.rotation.y = THREE.MathUtils.degToRad(val);
        else if (axis === 2) target.rotation.z = THREE.MathUtils.degToRad(val);
        target.updateMatrixWorld(true);
      }
      if (symmetrySnap) {
        const oppId = selectedBoneId.endsWith('_l')
          ? selectedBoneId.replace('_l', '_r')
          : selectedBoneId.endsWith('_r')
          ? selectedBoneId.replace('_r', '_l')
          : null;
        if (oppId) {
          const opp = findBoneInHierarchy(activeModelObject, oppId);
          if (opp) {
            const oppVal = axis === 1 ? -val : val;
            if (axis === 0) opp.rotation.x = THREE.MathUtils.degToRad(oppVal);
            else if (axis === 1) opp.rotation.y = THREE.MathUtils.degToRad(oppVal);
            else if (axis === 2) opp.rotation.z = THREE.MathUtils.degToRad(oppVal);
            opp.updateMatrixWorld(true);
          }
        }
      }
    }
  };

  const applyPosePreset = (pose: 't_pose' | 'a_pose' | 'combat' | 'sitting') => {
    const presetMap: Record<string, [number, number, number]> = {};
    bones.forEach((b) => { presetMap[b.id] = [0, 0, 0]; });

    if (pose === 'a_pose') {
      presetMap['arm_l'] = [0, 0, -45];
      presetMap['arm_r'] = [0, 0, 45];
    } else if (pose === 'combat') {
      presetMap['arm_l'] = [35, 15, -20];
      presetMap['arm_r'] = [35, -15, 20];
      presetMap['knee_l'] = [25, 0, 0];
      presetMap['knee_r'] = [-15, 0, 0];
      presetMap['spine'] = [10, 0, 0];
    } else if (pose === 'sitting') {
      presetMap['hip_l'] = [85, 0, 0];
      presetMap['hip_r'] = [85, 0, 0];
      presetMap['knee_l'] = [-85, 0, 0];
      presetMap['knee_r'] = [-85, 0, 0];
      presetMap['arm_l'] = [20, 0, -15];
      presetMap['arm_r'] = [20, 0, 15];
    }

    setBones((prev) => prev.map((b) => ({ ...b, rot: presetMap[b.id] || [0, 0, 0] })));

    if (activeModelObject) {
      Object.entries(presetMap).forEach(([boneId, rot]) => {
        const bone = findBoneInHierarchy(activeModelObject, boneId);
        if (bone) {
          bone.rotation.set(
            THREE.MathUtils.degToRad(rot[0]),
            THREE.MathUtils.degToRad(rot[1]),
            THREE.MathUtils.degToRad(rot[2])
          );
          bone.updateMatrixWorld(true);
        }
      });
    }
    toast.info(`Applied pose: ${pose.replace('_', ' ').toUpperCase()}`);
  };

  const handleExportRig = async () => {
    setIsExporting(true);
    setExportError(null);
    toast.info('Packaging rigged model armature and weights...');
    try {
      const assetId = currentAsset?.id;
      if (assetId) {
        try {
          await downloadArtifact(`/api/v1/system/jobs/${assetId}/download?artifact_format=glb`, `${currentAsset?.name || 'rigged_mesh'}.glb`, 'glb');
          toast.success('Rigged model exported (.glb)');
          return;
        } catch {
          // Fall through to client exporter
        }
      }

      if (activeModelObject) {
        const exporter = new GLTFExporter();
        await new Promise<void>((resolve, reject) => {
          exporter.parse(
            activeModelObject,
            (gltf) => {
              const blob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${currentAsset?.name || 'rigged_model'}.glb`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 500);
              toast.success('Rigged model exported (.glb)');
              resolve();
            },
            reject,
            { binary: true }
          );
        });
      } else {
        throw new Error('No active 3D model available to export');
      }
    } catch (err: any) {
      setExportError(err.message || 'Export failed');
      toast.error(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-2 select-none text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Armature Inspector
          </span>
          {isRealRig && (
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-0.5">
              <Sparkles className="w-2.5 h-2.5" />
              <span>Real Bones</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/[0.06]">
          {([ { label: 'Front', yaw: 0 }, { label: '3/4', yaw: 35 }, { label: 'Side', yaw: 90 } ] as const).map((view) => (
            <button
              key={view.label}
              type="button"
              onClick={() => setOrbitYaw(view.yaw)}
              className={`h-6 px-2 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                orbitYaw === view.yaw ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <RealModelPreviewCanvas
        mode="rigging"
        selectedId={selectedBoneId}
        onSelectId={(id) => {
          setSelectedBoneId(id);
          const b = bones.find((x) => x.id === id);
          toast.info(`Selected Bone: ${b ? b.name : id}`);
        }}
        onHoverId={(id) => setHoveredPartId(id)}
        xrayBones={xrayMode}
        orbitYaw={orbitYaw}
        bones={bones}
      />

      {/* Bone Rotation Sliders */}
      <div className="space-y-1.5 p-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <Bone className="w-3.5 h-3.5 text-[hsl(var(--primary))] flex-shrink-0" />
            <span className="text-xs font-semibold text-white truncate">{selectedBone.name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              handleRotationChange(0, 0);
              handleRotationChange(1, 0);
              handleRotationChange(2, 0);
              toast.info(`Reset rotation for ${selectedBone.name}`);
            }}
            className="text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
            title="Reset bone rotation"
          >
            <RotateCw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        </div>

        {([ { label: 'Pitch (X)', axis: 0 as const }, { label: 'Yaw (Y)', axis: 1 as const }, { label: 'Roll (Z)', axis: 2 as const } ]).map(({ label, axis }) => (
          <div key={label} className="space-y-0.5">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>{label}</span>
              <span className="text-[hsl(var(--primary))] font-semibold">{selectedBone.rot[axis]}°</span>
            </div>
            <input
              type="range"
              min={-180}
              max={180}
              step={5}
              value={selectedBone.rot[axis]}
              onChange={(e) => handleRotationChange(axis, parseInt(e.target.value, 10))}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[hsl(var(--primary))]"
            />
          </div>
        ))}
      </div>

      {/* Instant Pose Presets */}
      <div className="space-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block px-0.5">
          Pose Presets
        </span>
        <div className="grid grid-cols-4 gap-1">
          {([ { id: 't_pose', label: 'T-Pose' }, { id: 'a_pose', label: 'A-Pose' }, { id: 'combat', label: 'Combat' }, { id: 'sitting', label: 'Sitting' } ] as const).map((pose) => (
            <button
              key={pose.id}
              type="button"
              onClick={() => applyPosePreset(pose.id)}
              className="h-7 rounded-lg text-xs font-semibold bg-black/30 hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.04] flex items-center justify-center transition-all cursor-pointer active:scale-95"
            >
              <span>{pose.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Switches & Metrics */}
      <div className="space-y-1.5 p-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-200 font-medium">Symmetry Mirroring</span>
          <button
            type="button"
            role="switch"
            aria-checked={symmetrySnap}
            onClick={() => setSymmetrySnap(!symmetrySnap)}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${symmetrySnap ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${symmetrySnap ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
          <span className="text-[11px] text-zinc-200 font-medium">X-Ray Bones Mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={xrayMode}
            onClick={() => setXrayMode(!xrayMode)}
            className={`w-7 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${xrayMode ? 'bg-[hsl(var(--primary))]' : 'bg-white/15'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${xrayMode ? 'translate-x-3 bg-black' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">Total Bones</span>
          <span className="font-mono text-[11px] font-semibold text-white">{realBoneCount} Bones</span>
        </div>
        <div className="p-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.08] flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">Skinning</span>
          <span className="font-mono text-[11px] font-semibold text-emerald-400">Linear Blend</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleExportRig}
        disabled={isExporting}
        className="w-full h-8 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
      >
        <Download className="w-3.5 h-3.5 text-[hsl(var(--primary))]" aria-hidden="true" />
        <span>{isExporting ? 'Packaging Rigged Model...' : 'Export Rigged Model (.GLB)'}</span>
      </button>
      {exportError && (
        <div className="text-[10px] text-rose-400">{exportError}</div>
      )}
    </div>
  );
};
