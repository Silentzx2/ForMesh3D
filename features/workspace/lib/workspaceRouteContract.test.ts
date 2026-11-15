import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkspaceRouteIdentity, transitionWorkspaceToolRoute, mintWorkspaceId } from './workspaceRouteContract';

describe('workspace tool route state machine', () => {
  const base = { status: 'base' } as const;
  const workspace = { status: 'workspace', workspaceId: 'rabbit_a82f31' } as const;

  it('resets a workspace route when the active tool is selected again', () => {
    assert.deepEqual(transitionWorkspaceToolRoute(workspace, { type: 'select-same-tool' }), base);
  });

  it('keeps a base route at its initial state when the active tool is selected again', () => {
    assert.deepEqual(transitionWorkspaceToolRoute(base, { type: 'select-same-tool' }), base);
  });

  it('preserves the workspace identity when switching to another tool', () => {
    assert.deepEqual(transitionWorkspaceToolRoute(workspace, { type: 'select-different-tool' }), workspace);
  });

  it('keeps a base route when switching tools without a selected workspace', () => {
    assert.deepEqual(transitionWorkspaceToolRoute(base, { type: 'select-different-tool' }), base);
  });
});

describe('workspace route identity contract', () => {
  it('treats a non-UUID deep-link segment as a workspace ID, not an asset ID', () => {
    assert.deepEqual(
      parseWorkspaceRouteIdentity('/workspace/generate/rabbit_a82f31'),
      {
        tool: 'generate',
        routeId: 'rabbit_a82f31',
        workspaceId: 'rabbit_a82f31',
        legacyJobId: null,
      },
    );
  });

  it('keeps pre-contract friendly job IDs in the legacy job namespace', () => {
    const routeId = 'rabbit-a82f31';
    assert.deepEqual(parseWorkspaceRouteIdentity(`/workspace/generate/${routeId}`), {
      tool: 'generate',
      routeId,
      workspaceId: null,
      legacyJobId: routeId,
    });
  });

  it('recognizes UUID routes as legacy job links', () => {
    const jobId = '380fbba4-e122-4a78-818d-3418dbb0ee46';
    assert.deepEqual(parseWorkspaceRouteIdentity(`/workspace/generate/${jobId}`), {
      tool: 'generate',
      routeId: jobId,
      workspaceId: null,
      legacyJobId: jobId,
    });
  });


  it('does not treat asset or operation IDs as workspace IDs', () => {
    for (const routeId of ['ast_123456789abc', 'op_123456789abc']) {
      assert.deepEqual(parseWorkspaceRouteIdentity(`/workspace/generate/${routeId}`), {
        tool: 'generate',
        routeId,
        workspaceId: null,
        legacyJobId: null,
      });
    }
  });

  it('keeps /workspace/jobs/{id} in the job identity namespace', () => {
    assert.deepEqual(parseWorkspaceRouteIdentity('/workspace/jobs/job_123456'), {
      tool: 'jobs',
      routeId: 'job_123456',
      workspaceId: null,
      legacyJobId: 'job_123456',
    });
  });

  it('does not invent a workspace identity for a tool base route', () => {
    assert.deepEqual(parseWorkspaceRouteIdentity('/workspace/generate'), {
      tool: 'generate',
      routeId: null,
      workspaceId: null,
      legacyJobId: null,
    });
  });

  it('mints a clean workspace ID that matches the workspace route identity contract', () => {
    const wsId = mintWorkspaceId('Tactical Sniper in Olive Gear');
    assert.match(wsId, /^[a-z0-9][a-z0-9_-]{0,39}_[a-f0-9]{6,8}$/i);
    const parsed = parseWorkspaceRouteIdentity(`/workspace/generate/${wsId}`);
    assert.equal(parsed.workspaceId, wsId);
    assert.equal(parsed.legacyJobId, null);
  });
});
