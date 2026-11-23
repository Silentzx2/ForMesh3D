import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDiagonalComparisonBoundary, getDiagonalComparisonSlope } from './comparisonGeometry';

describe('diagonal comparison geometry', () => {
  it('matches a 14 degree CSS divider for a landscape viewport', () => {
    const slope = getDiagonalComparisonSlope(1600, 900);
    assert.ok(Math.abs(slope - Math.tan((14 * Math.PI) / 180) * (900 / 1600)) < 1e-8);
  });

  it('keeps the divider centered at the handle and moves opposite edges symmetrically', () => {
    const slope = getDiagonalComparisonSlope(1000, 800);
    assert.ok(Math.abs(getDiagonalComparisonBoundary(0.5, 0.5, slope) - 0.5) < 1e-8);
    assert.ok(Math.abs(getDiagonalComparisonBoundary(0.5, 0, slope) - (0.5 + slope / 2)) < 1e-8);
    assert.ok(Math.abs(getDiagonalComparisonBoundary(0.5, 1, slope) - (0.5 - slope / 2)) < 1e-8);
  });

  it('clamps positions and returns a safe zero slope for invalid dimensions', () => {
    assert.equal(getDiagonalComparisonSlope(0, 500), 0);
    assert.equal(getDiagonalComparisonSlope(Number.NaN, 500), 0);
    assert.ok(Math.abs(getDiagonalComparisonBoundary(2, -1, 0.4) - 1.2) < 1e-8);
  });
});
