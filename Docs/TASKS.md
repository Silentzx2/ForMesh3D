# TASK — Complete the Existing Texture Generation Workflow

## Objective

Complete ForMesh3D's standalone texture-generation workflow according to the existing project plan.

The user must be able to select an existing 3D mesh, provide a reference image, choose an already-implemented texture adapter, and generate textures for that mesh.

## Requirements

1. **Reuse existing adapters**
   - Reuse the texture-generation adapters already present in the repository.
   - Check the existing adapter implementations and registrations before making changes.
   - Do not create a duplicate texture-generation pipeline or a new adapter when an existing one supports the required operation.
   - Preserve the existing adapter inference implementations.

2. **Texture generation must be standalone**
   - Texture generation operates on an already-existing mesh and a reference image.
   - It must not start image-to-3D generation or create replacement geometry.
   - If the required mesh or reference image is missing, report the problem instead of falling back to 3D generation.

3. **Preserve the input mesh**
   - Keep the original uploaded mesh unchanged.
   - The texture-generation result must retain the input mesh's geometry and topology.
   - Save the textured result separately; do not overwrite the original mesh.

4. **Use the existing project workflow**
   - Follow the user's existing project plan for workspace, database, storage, asset registration, and UI behavior.
   - The database remains authoritative for workspace and asset state.
   - Keep the existing storage structure and naming/version rules.
   - Maintain one unified `metadata.json` per workspace; do not introduce additional metadata JSON files.
   - Keep generated files and their paths associated with the correct workspace and assets.

5. **Texture outputs**
   - Save the textured mesh output using the existing project storage and asset workflow.
   - Support the texture maps and output details specified in the existing project plan.
   - Do not claim a map or output format is supported unless it is actually generated and saved.

## Existing code to inspect and reuse

- `backend/adapters/hunyuan3d_adapter_v21.py`
- `backend/adapters/hunyuan3d_v20_paint_adapter.py`
- `backend/adapters/trellis_adapter.py`
- `backend/adapters/trellis2_adapter.py`
- `backend/core/scheduler/model_factory.py`
- `backend/config/models.yaml`
- `backend/api/routers/mesh_generation.py`
- `features/workspace/Panels/TexturePanel.tsx`
- `features/workspace/store/WorkspaceContext.tsx`
- `features/workspace/utils/buildTextureGenerationParameters.ts`

The repository already contains Hunyuan3D-Paint v2.1 and v2.0 adapters, plus TRELLIS and TRELLIS.2 painting-related implementations. Reuse the appropriate registered and supported adapters rather than rebuilding their pipelines.

## Known integration issues to check

- `TexturePanel.tsx` currently has a fallback that can call `generate3DModel()` when standalone texture generation is unavailable. Texture generation must not use that fallback.
- `WorkspaceContext.tsx` can fall back to `currentAsset.fileId` for the reference-image file ID. Ensure a mesh file ID is never sent as an image file ID.
- Check that the selected texture model reaches the existing `/api/v1/texture` endpoint and the intended registered adapter.
- Check that the returned textured output is saved and registered as a separate workspace asset.

## Completion checks

- An existing mesh and reference image can be submitted to an existing texture adapter.
- No image-to-3D or shape-generation operation is triggered by the texture action.
- The original mesh remains unchanged and available.
- The textured output is saved separately and correctly linked to its workspace.
- The project plan's required texture outputs are present and correctly registered.
- The workflow reports failures clearly instead of silently returning an untextured or newly generated mesh.

Follow the existing project plan for all details not explicitly specified in this task. Do not expand the task into unrelated features or redesign existing systems.
