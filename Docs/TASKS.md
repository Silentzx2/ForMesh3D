# ForMesh3D — Task Plan & Status

> Updated: 2026-11-27 | Branch: `dev`  
> Vision: Crisp, Tripo-inspired dark desktop 3D studio for personal/self-hosted use.

## Active Architecture & Contracts
- **Storage:** `backend/storage/<workspace_id>/` (`input/`, `mesh/`, `texture/`, `animation/<clip>_vNNN/`, `metadata.json`); SQLite is authoritative.
- **Trash / Soft-Delete:** `backend/services/workspace_trash.py` stages soft-deleted workspaces or derived versions under the OS temp directory with a `manifest.json` DB snapshot. Restore checks identity conflicts and rolls filesystem moves back if the DB transaction fails. Temporary trash is best-effort and may be cleared by OS temp cleanup/restart; it is not durable backup storage.
- **Version Scoping & Auto-Selection:** Assets panel shows only base meshes, standalone uploads, and saved `animated_mesh` exports; derived operation outputs live in `workspaceVersions` (**Mesh Version** selector) and auto-select on tool switch (`findPreferredVersionForTool`); re-entering the same tool clears the active derived selection and viewer state.
- **Docs:** [api-documentation.md](api-documentation.md), [DESIGN.md](DESIGN.md), [DECISIONS.md](DECISIONS.md).

## Completed (2026-11-27)
- [x] Studio surface palette (`app/globals.css`), `LeftNavigation.tsx` contrast, `MeshViewer.tsx` radial gradient + `TrackballControls`.
- [x] `"Find the Best Angle"` upload orientation modal (`MeshOrientationModal.tsx`) with baked vertex rotation.
- [x] `RightAssetsPanel.tsx` 2-column grid, canonical URL deduplication, non-overlapping `QualityBadge`, `SimpleTooltip` upgrades, unified `AssetDeleteModal` (interactive 3D preview for specific version + 3s countdown for workspace delete), and `TrashBinModal`.
- [x] Backend trash/delete endpoints and SQLite-backed restore lifecycle (`DELETE /workspace/{id}`, `DELETE /workspace/{id}/assets/{asset_id}`, `GET /trash`, `POST /trash/{id}/restore`, `DELETE /trash/{id}`, `DELETE /trash`); regression tests cover workspace round-trip, shared operation lineage, and base-mesh protection.
- [x] `skintokens_adapter.py` `use_transfer=False` fallback with `bpy_server` restart; `trellis_adapter.py` native orientation; `motionClient.ts` index-based bone mapping fallback.

## Pending / Next
- [ ] Real ARDY NPZ retarget verification once real checkpoint output is inspected.
- [ ] `POST /api/v1/generate` `422` reproduction if it recurs on specific inputs.
