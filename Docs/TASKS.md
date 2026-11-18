# Task List – Retired Mesh-Tools Router Cleanup

## Status: Complete

The legacy `/api/v1/mesh-tools/*` router was retired. The supported mesh-processing pipelines and canonical routes (`/api/v1/retopo`, `/api/v1/unwrap`, and `/api/v1/segment`) remain in place; this cleanup does not remove those capabilities.

### Completed

- [x] Removed legacy router imports/registrations from both worker entrypoints and router exports.
- [x] Removed legacy `/api/v1/mesh-tools/*` calls and references from the workspace bridge.
- [x] Removed legacy router test/import/app registration references from the affected integration test.
- [x] Removed obsolete endpoint-table entries from API documentation.
- [x] Reconciled architecture, README, changelog, and memory documentation.
- [x] Checked the dev branch for legacy router and endpoint references.

### Verification notes

- Branch inspection confirmed the legacy router is not present in the tree and its imports, registrations, test references, bridge calls, and API-documentation references are absent.
- The documentation audit identified and corrected stale architecture/README material.
- Local execution of the full Bun/Python/shell test suites was not available during this remote-only review; CI/runtime test results should not be inferred from this audit.

## Legacy Endpoint Inventory (Retired)

| Endpoint | Status |
|---|---|
| `/api/v1/mesh-tools/auto-uv` | Retired |
| `/api/v1/mesh-tools/auto-retopo` | Retired |
| `/api/v1/mesh-tools/segment` | Retired |
| `/api/v1/mesh-tools/lods` | Retired placeholder |
| `/api/v1/mesh-tools/optimize` | Retired placeholder |
| `/api/v1/mesh-tools/repair` | Retired placeholder |
| `/api/v1/mesh-tools/convert-fbx` | Retired placeholder |
| `/api/v1/mesh-tools/inspect` | Retired placeholder |
| `/api/v1/mesh-tools/bake` | Retired placeholder |
| `/api/v1/mesh-tools/flatten` | Retired placeholder |
| `/api/v1/mesh-tools/collision` | Retired placeholder |

## Cleanup Rules

- Complete removal means checking imports, registrations, routes, config/environment keys, types, styles, tests, and startup references.
- Delete orphaned files only when they are unused and in-scope.
- Keep the canonical processing pipelines and their supported API routes intact.
