import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transitionWorkspaceToolRoute } from './workspaceRouteContract';

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
