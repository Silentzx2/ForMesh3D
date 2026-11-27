# ForMesh3D — Task Plan & Status

> Updated: 2026-11-27 | Branch: `dev`  
> Goal: Clean, Tripo-style Animation studio (premade/generate → apply & test → game/animation-ready export).

## Phase 1 — ARDY Backend & Retargeting Quality (Completed)
- [x] **Fix `num_base_steps` & `crop_history_length`** (`ardy_adapter.py`): Clamp `num_denoising_steps` against `model.diffusion.num_base_steps` (not `num_timesteps`) and pass `crop_history_length` to prevent >10s jitter.
- [x] **Wire `checkpoint`, `cfg_weight`, `num_denoising_steps`, `post_process`** (`ardy_adapter.py`, `motion_generation.py`): Load requested `checkpoint`, sync `/motion/checkpoints` with `registry.py` (`soma60`, `soma-kimodo60`), remove unimplemented `"bvh"` from `supported_formats`, call `post_process_motion` when `post_process=true`, and surface a warning when text encoder `:9550` is offline.
- [x] **Fix `BONE_ALIASES` collisions** (`stores/useAnimationStore.ts`): Map SOMA `LeftLeg`/`RightLeg` → `upperlegl`/`upperlegr`, `LeftShin`/`RightShin` → `lowerlegl`/`lowerlegr`, and separate `shoulder`/`arm`, `foot`/`toe`, `hand`/`thumb`, `spine2`/`spine3`.
- [x] **Fix Retargeting & In-Place Mode** (`services/motionClient.ts`): Compensate target bone rest-pose quaternions (`restQuat * deltaQuat`), add `inPlace` option (zero XZ root motion for game loops), and surface `mappedJointCount`.

## Phase 2 — Game-Ready Export & Tripo-Style UX (Completed)
- [x] **Multi-Clip GLB Export** (`exportAnimatedGlb.ts`, `AnimationPanel.tsx`): Pack multiple selected clips (e.g. Idle + Walk + Run) into one `.glb` for Unity/Unreal/Godot.
- [x] **UI & Controls Cleanup** (`AnimationPanel.tsx`, `DynamicAnimationInspector.tsx`, `AnimationPlayerBar.tsx`): Added **In-Place** toggle, **Mapped Joints** badge, Premade category filter pills (`All/Idle/Walk/Run/Action`), removed redundant `Save Clip Locally` button and internal backend paths from empty-state copy.

## Completed (2026-11-27)
- [x] Studio palette, `MeshViewer` gradient + `TrackballControls`, `MeshOrientationModal`, `RightAssetsPanel` 2-col grid + `AssetDeleteModal` + `TrashBinModal`, `workspace_trash.py` temp trash/restore, `DynamicRiggingInspector` pose presets + `RealModelPreviewCanvas` `SkeletonUtils.clone`, and `.npz` download endpoint.
