# Task List – Mesh Tools Cleanup

## Current State (Already Done)
- `backend/api/routers/mesh_tools.py` — Reduced to empty router stub (no endpoints)
- All 11 endpoint definitions removed from the file (3 real + 8 placeholder)

## Pending Tasks

### Phase 1: Remove Router Imports & Registrations
- [ ] Remove `mesh_tools` import from `backend/api/main_multiworker.py`
- [ ] Remove `mesh_tools` import from `backend/api/main_singleworker.py`
- [ ] Remove `"mesh_tools"` from `backend/api/routers/__init__.py`

### Phase 2: Remove Frontend Usage
- [ ] Remove `auto-retopo`, `auto-uv`, `segment` calls from `features/workspace/services/meshProcessingBridge.ts`
- [ ] Remove any frontend references to `/api/v1/mesh-tools/*` endpoints

### Phase 3: Remove Tests
- [ ] Remove `test_b4_t3_mesh_tools_format_validation` from `backend/tests/test_batch4_api_integration.py`
- [ ] Remove `mesh_tools` import from `backend/tests/test_batch4_api_integration.py`
- [ ] Remove `mesh_tools.router` inclusion from test app setup in `test_batch4_api_integration.py`

### Phase 4: Update Documentation
- [ ] Update `Docs/api-documentation.md` — Remove mesh-tools endpoint table entries
- [ ] Update `Docs/ARCHITECTURE.md` — Remove mesh_tools router references
- [ ] Update `Docs/TASKS.md` — Mark tasks complete as done
- [ ] Update `Docs/CHANGELOG.md` — Add entry about mesh tools removal
- [ ] Update `Docs/MEMORY.md` — Remove mesh-tools references if present
- [ ] Update `README.md` — Remove mesh-tools endpoint references

### Phase 5: Verification
- [ ] Run `bun run test` (TypeScript type check)
- [ ] Run `python3 -m py_compile` on all modified Python files
- [ ] Run `bash -n` on shell scripts
- [ ] Commit changes to version control
- [ ] Push to `dev` branch

## Current Mesh Tools Endpoints Status
| Endpoint | Status | Action |
|----------|--------|--------|
| `/api/v1/mesh-tools/auto-uv` | Removed | Delete |
| `/api/v1/mesh-tools/auto-retopo` | Removed | Delete |
| `/api/v1/mesh-tools/segment` | Removed | Delete |
| `/api/v1/mesh-tools/lods` | Was placeholder | Delete |
| `/api/v1/mesh-tools/optimize` | Was placeholder | Delete |
| `/api/v1/mesh-tools/repair` | Was placeholder | Delete |
| `/api/v1/mesh-tools/convert-fbx` | Was placeholder | Delete |
| `/api/v1/mesh-tools/inspect` | Was placeholder | Delete |
| `/api/v1/mesh-tools/bake` | Was placeholder | Delete |
| `/api/v1/mesh-tools/flatten` | Was placeholder | Delete |
| `/api/v1/mesh-tools/collision` | Was placeholder | Delete |

## Rules to Follow (from AGENTS.md)
- Complete-Removal Rule: Clean every trace — imports, registrations, routes, config/env keys, types, styles, tests, startup references.
- Delete orphaned dead files with zero references.
- Do not skip scope: fix all callers, tests, fixtures, config, exports.
- No speculative surface patches; fix root cause once.