# ForMesh3D Changelog

## 2026-11-24 — Hunyuan3D-2.1 mesh→paint texture fix + model_factory feature_type propagation
- Fixed `ModelFactory.create_model_config` / `create_model_from_config` to pass `feature_type` into adapter `init_params` (**kwargs). Previously paint adapters defaulted to `"image_to_raw_mesh"` and generated untextured raw meshes on mesh→paint jobs.
- Fixed Hunyuan3D-2 (v2.0) Paint `snapshot_download` `allow_patterns` to recurse (`**/*`) so component subfolders (`vae/`, `scheduler/`) are downloaded and `DiffusionPipeline.from_pretrained()` finds every weight file.
- SkinTokens: bpy_server subprocess now injects the Michelangelo models stub before importing `src.server.spec`, fixing `ModuleNotFoundError: No module named 'src.model.michelangelo.models'` that prevented `/ping` from serving.

## 2026-11-24 — Workspace-Scoped Derived Operation Storage
- Prevented retopology, UV, segmentation and rigging jobs from creating duplicate `storage/<job_id>/` directories.
- Kept durable outputs and thumbnails under the existing workspace operation folders; legacy empty job directories are removed conservatively without recursive deletion.

## 2026-11-24 — PartField Multipart Persistence & AI-Only Tool Modes
- Persisted individual PartField part meshes in versioned workspace storage and registered each part as a mesh asset.
- Added a workspace-backed ZIP archive for the actual individual part files; combined colored GLB remains the active result.
- Removed obsolete Script-engine selectors and deterministic script segmentation execution while preserving the PartField island-merging utility.
