const WORKSPACE_TOOL_SEGMENTS = new Set([
  'generate', 'generate-image', 'model', '3d-gen', 'retopology', 'remesh',
  'texture', 'textures', 'texture-edit', 'texture-upscale', 'texture-pbr',
  'smart-uv', 'uv', 'segmentation', 'segment', 'fill-parts', 'edit', 'pbr',
  'animation', 'animate', 'rigging', 'rig', 'tools',
]);

const WORKSPACE_VIEW_SEGMENTS = new Set([
  'dashboard', 'assets', 'outputs', 'jobs', 'models',
]);

const JOB_ID_PATTERN = /^[a-zA-Z0-9_\-\.]{3,128}$/;

/**
 * Validate the path handled by app/workspace/[...tool].
 * Deep links may append one UUID job ID to a valid tool or use /jobs/{id}.
 */
export function isKnownWorkspaceRoute(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  const [first, ...rest] = segments;

  if (first === 'jobs') {
    return rest.length === 0 || (rest.length === 1 && JOB_ID_PATTERN.test(rest[0]));
  }

  if (rest.length === 1 && WORKSPACE_TOOL_SEGMENTS.has(first)) {
    return JOB_ID_PATTERN.test(rest[0]);
  }
  if (rest.length !== 0) return false;
  return WORKSPACE_TOOL_SEGMENTS.has(first) || WORKSPACE_VIEW_SEGMENTS.has(first);
}

export type WorkspaceToolRouteState =
  | { status: 'base' }
  | { status: 'workspace'; workspaceId: string };

export type WorkspaceToolRouteEvent =
  | { type: 'select-same-tool' }
  | { type: 'select-different-tool' };

/** Same-tool re-entry resets to the tool's base route; switching tools preserves the workspace ID. */
export function transitionWorkspaceToolRoute(
  state: WorkspaceToolRouteState,
  event: WorkspaceToolRouteEvent,
): WorkspaceToolRouteState {
  switch (event.type) {
    case 'select-same-tool':
      return { status: 'base' };
    case 'select-different-tool':
      return state;
    default:
      return { status: 'base' };
  }
}
