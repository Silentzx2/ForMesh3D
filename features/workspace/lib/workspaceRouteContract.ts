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
 * Deep links may append a canonical workspace ID or a legacy job identifier.
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


const LEGACY_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}_[a-f0-9]{6,8}$/i;

/**
 * Mint a fresh workspace identifier <clean_stem>_<6-char-hex> adhering to WORKSPACE_ID_PATTERN.
 */
export function mintWorkspaceId(stem?: string): string {
  const raw = (stem || 'mesh')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z0-9]+/g, '');
  const clean = (raw || 'mesh').slice(0, 32);
  let hexSuffix = '';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    hexSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toLowerCase();
  } else {
    hexSuffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').slice(0, 6);
  }
  return `${clean}_${hexSuffix}`;
}

export interface WorkspaceRouteIdentity {
  tool: string | null;
  routeId: string | null;
  workspaceId: string | null;
  legacyJobId: string | null;
}

/**
 * A current deep-link segment must match the canonical <slug>_<6-8 hex> workspace ID.
 * UUID and pre-contract friendly identifiers remain readable as legacy job routes.
 * Asset IDs and operation IDs are never accepted as workspace identities.
 */
export function parseWorkspaceRouteIdentity(pathname: string): WorkspaceRouteIdentity {
  const segments = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (segments[0] !== 'workspace' || segments.length < 2) {
    return { tool: null, routeId: null, workspaceId: null, legacyJobId: null };
  }

  const tool = segments[1];
  const routeId = segments.length > 2 ? decodeURIComponent(segments[2]) : null;
  if (!routeId) {
    return { tool, routeId: null, workspaceId: null, legacyJobId: null };
  }

  // UI asset aliases and operation IDs are not valid workspace or job route identities.
  if (/^(?:ast_|op_|asset-|local_|upload_|hist_|job-)/i.test(routeId)) {
    return { tool, routeId, workspaceId: null, legacyJobId: null };
  }

  if (tool === 'jobs' || LEGACY_JOB_ID_PATTERN.test(routeId) || !WORKSPACE_ID_PATTERN.test(routeId)) {
    return { tool, routeId, workspaceId: null, legacyJobId: routeId };
  }

  return { tool, routeId, workspaceId: routeId, legacyJobId: null };
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
