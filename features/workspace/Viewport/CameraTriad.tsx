'use client';

import React, { useEffect, useRef } from 'react';
import {
  VIEWPORT_EVENTS,
  dispatchCameraPreset,
  type CameraOrientationDetail,
  type CameraPresetKey,
} from './viewportEvents';

interface AxisPole {
  id: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
  label: string;
  ariaLabel: string;
  preset: CameraPresetKey;
  vec: [number, number, number];
  color: string;
  isPositive: boolean;
}

const AXIS_POLES: readonly AxisPole[] = [
  { id: 'px', label: 'X', ariaLabel: 'Snap camera to Right (+X) view', preset: 'right', vec: [1, 0, 0], color: '#ef4444', isPositive: true },
  { id: 'nx', label: '-X', ariaLabel: 'Snap camera to Left (-X) view', preset: 'left', vec: [-1, 0, 0], color: '#ef4444', isPositive: false },
  { id: 'py', label: 'Y', ariaLabel: 'Snap camera to Top (+Y) view', preset: 'top', vec: [0, 1, 0], color: '#84cc16', isPositive: true },
  { id: 'ny', label: '-Y', ariaLabel: 'Snap camera to Bottom (-Y) view', preset: 'bottom', vec: [0, -1, 0], color: '#84cc16', isPositive: false },
  { id: 'pz', label: 'Z', ariaLabel: 'Snap camera to Front (+Z) view', preset: 'front', vec: [0, 0, 1], color: '#3b82f6', isPositive: true },
  { id: 'nz', label: '-Z', ariaLabel: 'Snap camera to Back (-Z) view', preset: 'back', vec: [0, 0, -1], color: '#3b82f6', isPositive: false },
];

const SIZE = 64;
const CENTER = SIZE / 2;
const RADIUS = 20;

/** Rotate vector v by the inverse (conjugate) of unit quaternion [qx, qy, qz, qw]. */
function rotateByInverseQuaternion(
  v: [number, number, number],
  q: [number, number, number, number],
): [number, number, number] {
  const ix = -q[0];
  const iy = -q[1];
  const iz = -q[2];
  const iw = q[3];

  const vx = v[0];
  const vy = v[1];
  const vz = v[2];

  const tx = 2 * (iy * vz - iz * vy);
  const ty = 2 * (iz * vx - ix * vz);
  const tz = 2 * (ix * vy - iy * vx);

  return [
    vx + iw * tx + (iy * tz - iz * ty),
    vy + iw * ty + (iz * tx - ix * tz),
    vz + iw * tz + (ix * ty - iy * tx),
  ];
}

/**
 * Interactive SVG/CSS XYZ orientation triad.
 * Updates DOM transforms directly via refs on camera orientation events so
 * orbiting never triggers React re-renders or a second WebGL context.
 */
export const CameraTriad: React.FC = () => {
  const lineRefs = useRef<Record<string, SVGLineElement | null>>({});
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const applyQuaternion = (q: [number, number, number, number]) => {
      for (const pole of AXIS_POLES) {
        const [rx, ry, rz] = rotateByInverseQuaternion(pole.vec, q);
        const px = CENTER + rx * RADIUS;
        const py = CENTER - ry * RADIUS;

        if (pole.isPositive) {
          const line = lineRefs.current[pole.id];
          if (line) {
            line.setAttribute('x2', px.toFixed(2));
            line.setAttribute('y2', py.toFixed(2));
            line.style.opacity = rz >= -0.1 ? '0.95' : '0.45';
          }
        }

        const btn = btnRefs.current[pole.id];
        if (btn) {
          const half = pole.isPositive ? 8 : 5;
          btn.style.transform = `translate3d(${(px - half).toFixed(2)}px, ${(py - half).toFixed(2)}px, 0)`;
          // Depth-sort overlapping poles (z in [-1, 1] -> zIndex [1, 21])
          btn.style.zIndex = String(Math.round((rz + 1) * 10) + 1);
          const depthOpacity = pole.isPositive
            ? 0.65 + ((rz + 1) * 0.5) * 0.35
            : 0.3 + ((rz + 1) * 0.5) * 0.5;
          btn.style.opacity = depthOpacity.toFixed(2);
        }
      }
    };

    // Default initial orientation before first OrbitControls event
    applyQuaternion([0, 0, 0, 1]);

    const handleOrientation = (e: Event) => {
      const detail = (e as CustomEvent<CameraOrientationDetail>).detail;
      if (detail?.quaternion) {
        applyQuaternion(detail.quaternion);
      }
    };

    window.addEventListener(VIEWPORT_EVENTS.CAMERA_ORIENTATION, handleOrientation);
    return () => {
      window.removeEventListener(VIEWPORT_EVENTS.CAMERA_ORIENTATION, handleOrientation);
    };
  }, []);

  return (
    <div
      role="group"
      aria-label="Camera axis orientation triad"
      className="relative w-16 h-16 shrink-0 select-none"
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      >
        {AXIS_POLES.filter((p) => p.isPositive).map((pole) => (
          <line
            key={pole.id}
            ref={(el) => {
              lineRefs.current[pole.id] = el;
            }}
            x1={CENTER}
            y1={CENTER}
            x2={CENTER}
            y2={CENTER}
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
          ref={(el) => {
            btnRefs.current[pole.id] = el;
          }}
          type="button"
          onClick={() => dispatchCameraPreset(pole.preset)}
          aria-label={pole.ariaLabel}
          title={pole.ariaLabel}
          style={{
            backgroundColor: pole.color,
            width: pole.isPositive ? 16 : 10,
            height: pole.isPositive ? 16 : 10,
          }}
          className={`absolute top-0 left-0 rounded-full flex items-center justify-center cursor-pointer transition-shadow hover:ring-2 hover:ring-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
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
};
