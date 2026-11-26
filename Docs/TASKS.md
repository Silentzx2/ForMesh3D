# ForMesh3D — Task Plan Index

> Updated: 2026-11-26  
> Execution: Two independent coding agents, separate scopes and separate worktrees  
> Vision: Crisp, calm, Tripo-inspired desktop 3D studio; ForMesh 3D branding; no AI slop; no mobile-first redesign.

The previous oversized single plan has been split into two complete implementation specifications. **Both agents must read both files fully before coding.**

## Task files

1. **[Part 1 — UI/UX & Frontend](TASKS-PART-1-UI-UX.md)**  
   UI agent owns frontend implementation only. It may inspect backend code and OpenAPI read-only to verify capability contracts. It must not edit anything under backend/ or patcher/.

2. **[Part 2 — Backend & API](TASKS-PART-2-BACKEND.md)**  
   A different backend agent owns FastAPI, backend services, validation, storage boundaries, and backend tests only. It may inspect Part 1/frontend code read-only. It must not edit frontend components, CSS, hooks, stores, or types.

## Agent coordination

- Read Part 1 and Part 2 completely, plus AGENTS.md and linked project docs.
- Work in separate worktrees/branches. Never edit the same worktree or shared branch simultaneously.
- Freeze the UI-owned API contract in Part 1 before Part 2 implements endpoints.
- Part 1 creates a typed frontend API client and honest loading/error states; it does not fake or implement FastAPI endpoints.
- Part 2 implements the exact endpoint/response contract and makes completed job artifacts resolvable by a stable server-issued clip ID.
- Part 2 does not restyle or change frontend code. Any needed frontend change is handed back to the UI agent.
- Do not mark the overall feature complete until both frontend and backend acceptance gates pass.

## Shared non-negotiables

- Desktop-first, primarily 1280×720 through 4K. No mobile-first redesign.
- Deeply inspect every image under .brain/ recursively, including new images added later. Record the file-to-requirement map.
- Keep existing personal operator tools and model capabilities.
- Reuse current workspace, job, asset, Zustand, Three.js Mixer, and animation-clock lifecycles.
- No fake controls, fake progress, fake data, fake holograms, fake point clouds, duplicate generation cards, or extra progress cards.
- Keep the simple horizontal generation progress line.
- Do not assume ARDY NPZ field names, shapes, joint ordering, FPS options, or coordinate conventions. Verify them from real output and upstream source.
- Never store user/premade motion presets in backend/storage/.
- Preserve protected model adapters, patcher isolation, scheduler, and SM80+ inference parity.
- Update docs only after implementation matches actual behaviour.

See both linked specifications for phases, TODO/NOT-TO-DO lists, API schema, security limits, tests, acceptance criteria, and handoff requirements.
