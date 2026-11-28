'use client';

import React from 'react';
import {
  dispatchMeshOrientation,
  type MeshOrientationAxis,
} from './viewportEvents';

interface AxisPole {
  id: string;
  label: string;
  ariaLabel: string;
  axis: MeshOrientationAxis;
  x: number;
  y: number;
  color: string;
  isPositive: boolean;
}

// Fixed isometric projection: viewer orbit never changes the controller itself.
const AXIS_POLES: readonly AxisPole[] = [
  { id: 'px', label: 'X', ariaLabel: 'Orient mesh with positive X facing the current view', axis: 'positive-x', x: 48, y: 38, color: '#ef4444', isPositive: true },
  { id: 'nx', label: '-X', ariaLabel: 'Orient mesh with negative X facing the current view', axis: 'negative-x', x: 16, y: 26, color: '#ef4444', isPositive: false },
  { id: 'py', label: 'Y', ariaLabel: 'Orient mesh with positive Y facing the current view', axis: 'positive-y', x: 32, y: 12, color: '#84cc16', isPositive: true },
  { id: 'ny', label: '-Y', ariaLabel: 'Orient mesh with negative Y facing the current view', axis: 'negative-y', x: 32, y: 52, color: '#84cc16', isPositive: false },
  { id: 'pz', label: 'Z', ariaLabel: 'Orient mesh with positive Z facing the current view', axis: 'positive-z', x: 16, y: 38, color: '#3b82f6', isPositive: true },
  { id: 'nz', label: '-Z', ariaLabel: 'Orient mesh with negative Z facing the current view', axis: 'negative-z', x: 48, y: 26, color: '#3b82f6', isPositive: false },
];

const SIZE = 64;
const CENTER = SIZE / 2;

/**
 * Fixed interactive XYZ mesh-orientation controller.
 * Its geometry is deliberately independent of the viewer camera.
 */
export const CameraTriad: React.FC = () => (
  <div
    role="group"
    aria-label="Mesh orientation XYZ controls"
    className="relative w-16 h-16 shrink-0 select-none"
  >
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    >
      {AXIS_POLES.filter((pole) => pole.isPositive).map((pole) => (
        <line
          key={pole.id}
          x1={CENTER}
          y1={CENTER}
          x2={pole.x}
          y2={pole.y}
          stroke={pole.color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}
      <circle cx={CENTER} cy={CENTER} r={2} fill="#e4e4e7" />
    </svg>

    {AXIS_POLES.map((pole) => (
      <button
        key={pole.id}
        type="button"
        onClick={() => dispatchMeshOrientation(pole.axis)}
        aria-label={pole.ariaLabel}
        title={pole.ariaLabel}
        style={{
          backgroundColor: pole.color,
          width: pole.isPositive ? 16 : 10,
          height: pole.isPositive ? 16 : 10,
          left: pole.x,
          top: pole.y,
          transform: 'translate(-50%, -50%)',
        }}
        className={`absolute rounded-full flex items-center justify-center cursor-pointer transition-shadow hover:ring-2 hover:ring-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          pole.isPositive
            ? 'text-[9px] font-bold leading-none text-zinc-950 shadow-sm'
            : 'border border-black/30'
        }`}
      >
        {pole.isPositive ? pole.label : null}
      </button>
    ))}
  </div>
);
