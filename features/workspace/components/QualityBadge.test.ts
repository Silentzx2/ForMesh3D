import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQualityMetrics } from './QualityBadge';

test('missing QA evidence is not presented as clean or 100 percent retention', () => {
  const metrics = computeQualityMetrics(null, null);
  assert.equal(metrics.triangles, null);
  assert.equal(metrics.nonManifoldEdges, null);
  assert.equal(metrics.holes, null);
  assert.equal(metrics.featureEdgeRetention, null);
  assert.equal(metrics.passedGate, null);
  assert.equal(metrics.status, 'Not Assessed');
});

test('explicit zero topology defects and a passed gate can report clean', () => {
  const metrics = computeQualityMetrics({ nonManifoldEdges: 0, qaStatus: 'pass' } as any, { metrics: { hole_count: 0 } });
  assert.equal(metrics.nonManifoldEdges, 0);
  assert.equal(metrics.holes, 0);
  assert.equal(metrics.passedGate, true);
  assert.equal(metrics.status, 'Clean');
});

test('feature edge retention accepts ratio and percentage values', () => {
  assert.equal(computeQualityMetrics(null, { feature_edge_retention: 0.9 }).status, 'Sharp');
  assert.equal(computeQualityMetrics(null, { feature_edge_retention: 90 }).status, 'Sharp');
});
