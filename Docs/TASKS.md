# Task List — Script-First Workspace Processing

## Status: Implementation added; CI verification pending

Scope: make Script mode functional for Retopo, UV Unwrapping, and Segmentation. Mesh Generate / GeneratePanel is explicitly excluded. AI/model integration remains a separate path and is not replaced by automatic Script fallback.

## Architecture and API Contract

- [x] Reuse canonical routes only: `POST /api/v1/retopo`, `POST /api/v1/unwrap`, and `POST /api/v1/segment`.
- [x] Add `engine: "ai" | "script"`; omission continues to mean AI.
- [x] Acquire the AI scheduler only for AI requests; Script execution must not access it.
- [x] Reuse `backend/pipelines/retopo.py::execute_retopo`, `smart_uv.py::execute_smart_uv`, and `segment.py::execute_segment`.
- [x] Reuse SQLite operation identity, execution status, and the existing workspace preview persistence endpoints.
- [x] Preserve the AI scheduler branch and keep Mesh Generate outside this change.

## Script Execution Flow

1. Resolve the selected workspace mesh using the canonical file reference.
2. Create a new `op_<12hex>` operation with the input asset and immutable settings snapshot.
3. Stage the output at `storage/temp/<operation_id>/preview.<glb|obj>`.
4. Transition `queued -> processing -> completed`; record failure as terminal `failed`.
5. Return the operation ID, preview URL, output format, and measured geometry statistics.
6. Load the preview in the workspace. Keep publishes an immutable workspace asset version; Discard removes only the staged preview and restores the captured viewer baseline.

## Verification Checklist

- [x] Add a focused API integration contract covering all three Script routes, scheduler isolation, preview retrieval, Keep, and Discard.
- [ ] Backend Runtime Contract CI: Python compile, Batch 1 regressions, workspace lifecycle, regeneration, and Batch 4 API integration.
- [ ] Frontend CI: TypeScript check, Bun tests, and production build.
- [ ] Review GitHub Actions job results before declaring this task complete.

## Known Constraints

- Script preview output is GLB or OBJ because the existing preview and Keep persistence path supports those formats.
- Blender-dependent algorithms use the existing pipeline's fallback behavior when Blender is unavailable.
- Script requests require an existing workspace so every preview has a durable SQLite owner.
- Script execution is synchronous on the canonical request and runs the CPU pipeline in FastAPI's threadpool; AI jobs remain scheduler-backed.

## Retired Router Inventory

The legacy `/api/v1/mesh-tools/*` router remains retired. The canonical routes above are not aliases for the retired router and must not be removed with it.
