# Workspace Animated-Mesh Storage Contract

## Purpose

A playable motion clip and a reusable My Presets entry are not the same thing as a final animated mesh. Exporting an animation creates a durable, immutable workspace asset. Downloading creates only a local file.

## Canonical workspace layout

```text
backend/storage/<workspace_id>/
├── input/
├── mesh/
├── animation/
│   ├── walking_v001/
│   │   ├── animated.glb
│   │   └── motion.npz
│   ├── running_v001/
│   │   ├── animated.glb
│   │   └── motion.npz
│   └── idle_v001/
│       ├── animated.glb
│       └── motion.npz
├── texture/
└── metadata.json
```

- `animated.glb` is the final rigged mesh with the selected animation embedded.
- `motion.npz` is the exact source clip copied from the approved premade/user/job clip resolver.
- A thumbnail is optional.
- The workspace-root `metadata.json` is the only workspace manifest. There is no metadata JSON inside an animation version folder.
- Re-exporting the same clip never overwrites an existing version. It creates the next available `_vNNN` folder.
- The original rigged mesh and reusable source preset are never modified.

## Identity and database record

Each saved export is a distinct retained asset with:
- `workspace_id`
- `asset_id=ast_<12hex>`
- `operation_id=op_<12hex>`
- `asset_type=animated_mesh`
- `operation_type=animation`
- `source_asset_id` for the original rigged mesh
- `motion_clip_id` for the premade, uploaded, generated, or completed-job source clip
- `relative_path=animation/<clip-name>_vNNN/animated.glb`

SQLite is authoritative. The manifest is regenerated from workspace, asset, operation, and verified disk state. The browser never supplies a filesystem path.

## Source preset storage remains separate

- Bundled premade presets are read-only files in `backend/motion_presets/`.
- User-imported and generated reusable clips remain in `backend/storage/presets/<upl_or_gen_id>/motion.npz` with one preset-local `metadata.json`.
- A workspace export copies the resolved NPZ into the workspace animation version; it does not move or delete the reusable preset.
- Preview-only uploads are not valid persistent source IDs.

## Export workflow

1. Select the original rigged mesh in a workspace.
2. Select and preview a premade or My Presets clip, or use a completed generated clip.
3. The frontend retargets the validated MotionClipV1 to the loaded skeleton and uses the existing Three.js `GLTFExporter` to produce a binary GLB.
4. **Save to Workspace** sends the GLB plus `source_asset_id`, `motion_clip_id`, and clip name to the motion API. The backend validates the source identities, validates the source NPZ, streams and validates the GLB 2.0 header, then atomically publishes a version folder.
5. SQLite registers the new immutable animated mesh and its lineage; the workspace manifest is refreshed as a projection.
6. The new asset appears in the Assets panel and can be selected without changing the workspace route.
7. **Download** exports the current clip as a GLB to the device without creating a workspace asset.

Batch-selecting multiple premade presets runs one export per preset, producing separate immutable assets rather than a combined GLB.

## API

- `POST /api/v1/motion/workspaces/{workspace_id}/animations` — multipart GLB upload plus source and clip IDs.
- `GET /api/v1/motion/workspaces/{workspace_id}/animations` — list verified animated mesh assets from SQLite.
- `GET /api/v1/motion/workspaces/{workspace_id}/animations/{asset_id}/download` — serve only the selected asset's contained GLB.

## Format boundary

GLB is the implemented workspace export format. The frontend exporter uses Three.js `GLTFExporter`. FBX is not supported by this client-side export path; it must not be offered until a real backend FBX conversion pipeline is implemented and verified.
