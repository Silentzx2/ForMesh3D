# ForMesh3D — Task Plan Index

> Updated: 2026-11-26  
> Execution: implementation is maintained in source, tests, and focused architecture/API documentation.  
> Vision: crisp, calm, Tripo-inspired desktop 3D studio; ForMesh 3D branding; no AI slop; no mobile-first redesign.

## Task documentation

The former split implementation specifications (`TASKS-PART-1-UI-UX.md` and `TASKS-PART-2-BACKEND.md`) have been retired and removed. The root `promt.md` agent prompt file has also been retired. This index is intentionally retained.

The current animation persistence contract is documented in [ANIMATION-ASSET-STORAGE.md](ANIMATION-ASSET-STORAGE.md). API routes are documented in [api-documentation.md](api-documentation.md), and architecture decisions are recorded in [DECISIONS.md](DECISIONS.md).

## Shared non-negotiables

- Keep the personal single-user/VPS architecture simple and reliable.
- Reuse current workspace, job, asset, Zustand, Three.js Mixer, and animation-clock lifecycles.
- No fake controls, fake progress, fake data, fake holograms, fake point clouds, duplicate generation cards, or extra progress cards.
- Keep the simple horizontal generation progress line.
- Do not assume ARDY NPZ field names, shapes, joint ordering, FPS options, or coordinate conventions. Verify them from real output and upstream source.
- Bundled premade presets belong in `backend/motion_presets/`; user-uploaded/generated reusable presets belong in `backend/storage/presets/<preset_id>/`.
- Workspace animated exports belong in `backend/storage/<workspace_id>/animation/<clip-name>_vNNN/`; each folder contains `animated.glb` and `motion.npz`.
- SQLite is authoritative. One workspace-root `metadata.json` is a write-only projection; do not create per-animation metadata files.
- Preserve protected model adapters, patcher isolation, scheduler behaviour, and SM80+ inference parity.
- Update documentation only after implementation matches actual behaviour.

## Current implementation status (2026-11-26)

- MotionClipV1 preset discovery, validation, preview, and reusable user-preset persistence are implemented.
- Workspace animation export is wired to versioned workspace storage and DB asset lineage. GLB download remains available separately.
- Premade multi-select export creates one independent workspace asset per selected preset.
- No bundled premade NPZ files are fabricated or added by this change.
- Real ARDY NPZ retarget verification remains blocked until a real output from the supported checkpoint is inspected.
- Runtime/browser verification and CI status must be recorded from actual workflow results; source-level changes alone do not establish end-to-end success.
