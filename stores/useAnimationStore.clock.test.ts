import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAnimationStore } from './useAnimationStore';

const TICK_1 = 1000;
const TICK_2 = 2000; // +1 second

function resetStore() {
  useAnimationStore.setState({
    isPlaying: false,
    currentTime: 0,
    duration: 2.0,
    playbackSpeed: 1.0,
    isLooping: false,
    clipState: 'idle',
    clipError: null,
    activeMotionClip: null,
    activeThreeClip: null,
    pendingMotionClipId: null,
    pendingMotionClipAssetId: null,
  });
  (useAnimationStore as any)._lastTick = 0;
}

beforeEach(() => resetStore());
afterEach(() => resetStore());

describe('single animation clock', () => {
  it('tickPlayback advances currentTime when playing', () => {
    useAnimationStore.setState({ isPlaying: true, duration: 2.0, currentTime: 0 });
    useAnimationStore.getState().tickPlayback(TICK_1);
    // first tick: delta is 0 (last === 0), time unchanged
    assert.equal(useAnimationStore.getState().currentTime, 0);
    useAnimationStore.getState().tickPlayback(TICK_2);
    // delta is capped at 0.1s to prevent spiral-of-death on tab backgrounding
    assert.equal(useAnimationStore.getState().currentTime, 0.1);
  });

  it('clamps currentTime to [0, duration]', () => {
    useAnimationStore.setState({ duration: 2.0 });
    useAnimationStore.getState().setCurrentTime(-5);
    assert.equal(useAnimationStore.getState().currentTime, 0);
    useAnimationStore.getState().setCurrentTime(99);
    assert.equal(useAnimationStore.getState().currentTime, 2);
  });

  it('pauses at end when not looping', () => {
    useAnimationStore.setState({ isPlaying: true, isLooping: false, duration: 1.0, currentTime: 0.9, clipState: 'playing' });
    // advance past duration
    useAnimationStore.getState().tickPlayback(TICK_1);
    useAnimationStore.getState().tickPlayback(TICK_2 + 500);
    const s = useAnimationStore.getState();
    assert.equal(s.currentTime, s.duration);
    assert.equal(s.isPlaying, false);
    assert.equal(s.clipState, 'paused');
  });

  it('loops when isLooping', () => {
    useAnimationStore.setState({ isPlaying: true, isLooping: true, duration: 1.0, currentTime: 0.9, playbackSpeed: 1.0 });
    useAnimationStore.getState().tickPlayback(TICK_1);
    useAnimationStore.getState().tickPlayback(TICK_2 + 500);
    const s = useAnimationStore.getState();
    assert.equal(s.isPlaying, true);
    assert.notEqual(s.clipState, 'paused');
    assert.ok(s.currentTime >= 0 && s.currentTime <= s.duration);
  });

  it('setIsPlaying toggles clipState playing/paused', () => {
    useAnimationStore.setState({ clipState: 'idle' });
    useAnimationStore.getState().setIsPlaying(true);
    assert.equal(useAnimationStore.getState().isPlaying, true);
    assert.equal(useAnimationStore.getState().clipState, 'playing');
    useAnimationStore.getState().setIsPlaying(false);
    assert.equal(useAnimationStore.getState().isPlaying, false);
    assert.equal(useAnimationStore.getState().clipState, 'paused');
  });

  it('clearClipOnAssetSwitch resets to idle and clears clip refs', () => {
    useAnimationStore.setState({
      activeMotionClip: { schema_version: 1, id: 'c', name: 'x', fps: 20, frame_count: 2, duration: 1, skeleton_profile: 's', coordinate_system: 'cs', translation_units: 'u', rotation_format: 'quaternion_xyzw', joint_names: ['a'], frames: [] } as any,
      activeThreeClip: { duration: 1 } as any,
      pendingMotionClipId: 'pending-1',
      pendingMotionClipAssetId: 'asset-1',
      isPlaying: true,
      currentTime: 0.5,
      duration: 1,
      clipState: 'playing',
      clipError: 'err',
    });
    useAnimationStore.getState().clearClipOnAssetSwitch();
    const s = useAnimationStore.getState();
    assert.equal(s.clipState, 'idle');
    assert.equal(s.activeMotionClip, null);
    assert.equal(s.activeThreeClip, null);
    assert.equal(s.pendingMotionClipId, null);
    assert.equal(s.pendingMotionClipAssetId, null);
    assert.equal(s.isPlaying, false);
    assert.equal(s.currentTime, 0);
    assert.equal(s.duration, 0);
    assert.equal(s.clipError, null);
  });

  it('store does not schedule its own RAF (MeshViewer is the single RAF owner)', () => {
    let rafCalls = 0;
    const orig = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: any) => {
      rafCalls += 1;
      return orig(cb);
    };
    try {
      useAnimationStore.getState().tickPlayback(TICK_1);
      useAnimationStore.getState().setIsPlaying(true);
      useAnimationStore.getState().clearClipOnAssetSwitch();
      assert.equal(rafCalls, 0, 'store must not schedule RAF; MeshViewer owns the single RAF loop');
    } finally {
      globalThis.requestAnimationFrame = orig;
    }
  });
});
