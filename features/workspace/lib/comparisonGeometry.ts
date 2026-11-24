/**
 * Returns the normalized horizontal displacement of a diagonal wipe from
 * the viewport center, matching a CSS divider rotated by the same angle.
 */
export const COMPARISON_DIVIDER_ANGLE_DEGREES = 14;

export function getDiagonalComparisonSlope(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const angleRadians = (COMPARISON_DIVIDER_ANGLE_DEGREES * Math.PI) / 180;
  return Math.tan(angleRadians) * (height / width);
}

/** Horizontal normalized divider coordinate at a normalized vertical UV. */
export function getDiagonalComparisonBoundary(position: number, uvY: number, slope: number): number {
  const normalizedPosition = Math.max(0, Math.min(1, Number.isFinite(position) ? position : 0.5));
  const normalizedY = Math.max(0, Math.min(1, Number.isFinite(uvY) ? uvY : 0.5));
  return normalizedPosition + (0.5 - normalizedY) * slope;
}
