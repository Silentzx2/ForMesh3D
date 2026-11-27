import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMotionClipV1,
  validateMotionPresetsResponse,
  MotionClientError,
  MotionClientErrorCode,
  deleteUploadedMotionClip,
} from './motionClient';

const MAX_JOINTS = 512;
const MAX_FRAMES = 36000;

function buildFrame(joints = 2) {
  return {
    rotations: Array.from({ length: joints }, () => [0, 0, 0, 1]),
    root_translation: [0, 0, 0],
  };
}

function validClip(overrides: Record<string, unknown> = {}): unknown {
  const frames = Array.from({ length: 80 }, (_, i) => buildFrame());
  return {
    schema_version: 1,
    id: 'clip-1',
    name: 'Walk Forward',
    fps: 20,
    frame_count: 80,
    duration: 4.0,
    skeleton_profile: 'humanoid',
    coordinate_system: 'y-up',
    translation_units: 'meters',
    rotation_format: 'quaternion_xyzw',
    joint_names: ['Hips', 'Spine'],
    frames,
    ...overrides,
  };
}

const origFetch = globalThis.fetch;
function mockFetch(status: number, body: unknown = {}) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) as Response;
}
function mockFetchThrow() {
  globalThis.fetch = async () => {
    throw new TypeError('failed to fetch');
  };
}
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('validateMotionClipV1', () => {
  it('accepts a valid clip', () => {
    const clip = validateMotionClipV1(validClip());
    assert.equal(clip.id, 'clip-1');
    assert.equal(clip.frame_count, 80);
    assert.equal(clip.frames.length, 80);
    assert.equal(clip.rotation_format, 'quaternion_xyzw');
  });

  it('rejects non-object input', () => {
    assert.throws(
      () => validateMotionClipV1(null),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1('not an object'),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1([1, 2, 3]),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects missing schema_version', () => {
    assert.throws(
      () =>
        validateMotionClipV1(Object.assign({}, validClip() as Record<string, unknown>, { schema_version: undefined })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects bad schema_version', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ schema_version: 2 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects bad rotation_format', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ rotation_format: 'euler_xyz' })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ rotation_format: undefined })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects missing id or name', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ id: '' })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ id: undefined })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ name: '' })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ name: null })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects missing skeleton/coordinate/units metadata', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ skeleton_profile: '' })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ coordinate_system: undefined })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ translation_units: null })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects invalid fps', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ fps: 0 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ fps: -5 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ fps: NaN })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ fps: Infinity })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects invalid frame_count', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ frame_count: 0 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ frame_count: -1 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ frame_count: 2.5 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ frame_count: NaN })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ frame_count: MAX_FRAMES + 1 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects invalid duration', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ duration: 0 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ duration: -1 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ duration: NaN })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ duration: Infinity })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects duration inconsistent with frame_count/fps', () => {
    // fps=20, frame_count=80 => expectedDuration=4.0, tolerance=max(0.15, 0.1)=0.15
    assert.throws(
      () => validateMotionClipV1(validClip({ duration: 10.0 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ duration: 1.0 })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects joint_names out of bounds', () => {
    assert.throws(
      () => validateMotionClipV1(validClip({ joint_names: [] })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ joint_names: null })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ joint_names: Array.from({ length: MAX_JOINTS + 1 }, (_, i) => `j${i}`) }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ joint_names: ['Hips', ''] })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects frames length mismatch', () => {
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frame_count: 80, frames: Array.from({ length: 10 }, () => buildFrame()) }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () => validateMotionClipV1(validClip({ frame_count: 80, frames: null })),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects invalid quaternion', () => {
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[0, 0, 0]], root_translation: [0, 0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[0, 0, 0, 1, 5]], root_translation: [0, 0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[NaN, 0, 0, 1]], root_translation: [0, 0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[Infinity, 0, 0, 1]], root_translation: [0, 0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('rejects invalid root_translation', () => {
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[0, 0, 0, 1]], root_translation: [0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[0, 0, 0, 1]], root_translation: [0, 0, 0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
    assert.throws(
      () =>
        validateMotionClipV1(
          validClip({ frames: [{ rotations: [[0, 0, 0, 1]], root_translation: [NaN, 0, 0] }] }),
        ),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });
});

describe('validateMotionPresetsResponse', () => {
  it('accepts a valid presets response', () => {
    const res = validateMotionPresetsResponse({
      schema_version: 1,
      presets: [
        { id: 'p1', name: 'Walk', duration: 4, fps: 20, frame_count: 80, thumbnail_url: '/thumb', clip_url: '/clip' },
      ],
    });
    assert.equal(res.schema_version, 1);
    assert.equal(res.presets.length, 1);
    assert.equal(res.presets[0].id, 'p1');
    assert.equal(res.presets[0].name, 'Walk');
  });

  it('rejects missing presets', () => {
    assert.throws(
      () => validateMotionPresetsResponse({ schema_version: 1 }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
  });

  it('rejects wrong shape presets (non-array)', () => {
    assert.throws(
      () => validateMotionPresetsResponse({ schema_version: 1, presets: 'not an array' }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
    assert.throws(
      () => validateMotionPresetsResponse({ schema_version: 1, presets: null }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
  });

  it('rejects bad schema_version', () => {
    assert.throws(
      () => validateMotionPresetsResponse({ schema_version: 2, presets: [] }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
    assert.throws(
      () => validateMotionPresetsResponse({ presets: [] }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
  });

  it('rejects non-object response', () => {
    assert.throws(
      () => validateMotionPresetsResponse(null),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
    assert.throws(
      () => validateMotionPresetsResponse('not an object'),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
  });

  it('rejects entries missing id/name/clip_url', () => {
    assert.throws(
      () =>
        validateMotionPresetsResponse({
          schema_version: 1,
          presets: [{ name: 'Walk', clip_url: '/clip' }],
        }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
    assert.throws(
      () =>
        validateMotionPresetsResponse({
          schema_version: 1,
          presets: [{ id: 'p1', clip_url: '/clip' }],
        }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
    assert.throws(
      () =>
        validateMotionPresetsResponse({
          schema_version: 1,
          presets: [{ id: 'p1', name: 'Walk' }],
        }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
  });

  it('normalizes missing optional metadata to null', () => {
    const res = validateMotionPresetsResponse({
      schema_version: 1,
      presets: [{ id: 'p1', name: 'Walk', clip_url: '/clip' }],
    });
    assert.equal(res.presets[0].duration, null);
    assert.equal(res.presets[0].fps, null);
    assert.equal(res.presets[0].frame_count, null);
    assert.equal(res.presets[0].thumbnail_url, null);
  });
});

describe('error status mapping (via deleteUploadedMotionClip + mocked fetch)', () => {
  it('400: empty clip id -> BAD_REQUEST', async () => {
    await assert.rejects(
      deleteUploadedMotionClip(''),
      (err: Error) => err instanceof MotionClientError && err.code === 'BAD_REQUEST' && err.status === 400,
    );
  });

  it('404 -> NOT_FOUND', async () => {
    mockFetch(404, { detail: 'not found' });
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'NOT_FOUND' && err.status === 404,
    );
  });

  it('413 -> PAYLOAD_TOO_LARGE', async () => {
    mockFetch(413);
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'PAYLOAD_TOO_LARGE' && err.status === 413,
    );
  });

  it('415 -> UNSUPPORTED_MEDIA_TYPE', async () => {
    mockFetch(415);
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'UNSUPPORTED_MEDIA_TYPE' && err.status === 415,
    );
  });

  it('422 -> UNPROCESSABLE_ENTITY', async () => {
    mockFetch(422);
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'UNPROCESSABLE_ENTITY' && err.status === 422,
    );
  });

  it('429 -> RATE_LIMITED', async () => {
    mockFetch(429);
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'RATE_LIMITED' && err.status === 429,
    );
  });

  it('500 -> SERVER_ERROR', async () => {
    mockFetch(500);
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'SERVER_ERROR' && err.status === 500,
    );
  });

  it('network failure -> SERVER_ERROR (raw fetch TypeError has no NETWORK_ERROR code)', async () => {
    mockFetchThrow();
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'SERVER_ERROR',
    );
  });

  it('unexpected error -> SERVER_ERROR', async () => {
    globalThis.fetch = async () => {
      throw new Error('boom');
    };
    await assert.rejects(
      deleteUploadedMotionClip('clip-1'),
      (err: Error) => err instanceof MotionClientError && err.code === 'SERVER_ERROR',
    );
  });
});

describe('error status mapping for presets/clip responses', () => {
  it('validateMotionClipV1 throws MALFORMED_CLIP for a bad clip', () => {
    assert.throws(
      () => validateMotionClipV1({ schema_version: 1, id: '', name: '' }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_CLIP',
    );
  });

  it('validateMotionPresetsResponse throws MALFORMED_RESPONSE for a bad response', () => {
    assert.throws(
      () => validateMotionPresetsResponse({ schema_version: 1, presets: null }),
      (err: Error) => err instanceof MotionClientError && err.code === 'MALFORMED_RESPONSE',
    );
  });
});
