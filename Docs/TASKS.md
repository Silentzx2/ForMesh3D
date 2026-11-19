# Direct-Save Workspace Architecture & Complete Temp Removal

## 1. AGENTS.md Governance & Priority Guardrails
- **Large GPU Parity (`sm >= 80`)**: Zero regressions on Ampere/Hopper/Blackwell (A100, RTX 3090/4090, H100). Maintain native BF16, FlashAttention 2, and upstream flows. Any pre-Ampere (`sm < 80`) workarounds must remain strictly isolated behind `_is_pre_ampere`.
- **Model Adapter Direct Patching**: Runtime fixes stay strictly inside specific adapters (`partuv_adapter.py`, `skintokens_adapter.py`) or `patcher/<model>/`; zero global monkeypatches leaking across sibling pipelines.
- **Section C Complete Removal Protocol**: When removing temp preview staging, delete all traces: routes, imports, registrations, UI bars, types, test cases, and orphaned files.
- **Ponytail Ladder**: YAGNI -> reuse existing codebase helpers -> stdlib -> platform -> installed dependencies -> minimal clean code.
- **Strict Scope Boundary**: Mesh Generate panel (`GeneratePanel.tsx`, image-to-3d pipeline) is completely untouched.
- **Context Budget Rule**: This document must strictly stay within 100–150 lines.

## 2. Implicit State Machines (Full Lifecycle & Explicit Transitions)
- **Problematic Legacy State**: Scattered booleans (`persistenceState`, `isSubmitting`, `isPreviewActive`, `isMeshGen`), race conditions between job polling and temp staging, and blocking Keep/Discard modal bars.
- **Explicit Workspace Operation Lifecycle**:
  - `IDLE`: Active mesh loaded in viewer. Workspace tool panel ready for parameter configuration.
  - `VALIDATING`: Client verifies active mesh existence, file format (.glb/.obj), and parameter bounds.
  - `SUBMITTING`: Canonical POST sent to backend (`/api/v1/{retopo,unwrap,segment,rig}`) with active `workspace_id`.
  - `PROCESSING`: Real-time backend progress (`0-100%`) and execution step message; viewer shows non-blocking progress spinner.
  - `PUBLISHING`: Backend atomic write to workspace directory, DB row created, active mesh pointer updated.
  - `COMPLETED`: New derived asset promoted to `active_mesh_asset_id`, appended to Version History, viewer re-renders new mesh immediately.
  - `FAILED`: Operation terminates cleanly, original active mesh remains active and untouched, user receives error toast.
  - `CANCELLED`: User aborts job, partial artifacts unlinked on disk, workspace returns cleanly to `IDLE`.
- **Explicit Version Switch State Machine**:
  - `VIEWING(version_k)` -> User clicks `version_j` in Version History -> `SWITCHING` -> `VIEWING(version_j)`. Viewer loads selected asset; no re-computation or file movement required.

## 3. Phase 1: Section C Complete Removal Plan
- [ ] **Backend Routes Removal**:
  - Delete endpoints in `backend/api/routers/system.py`: `/workspace/operations/{operation_id}/keep`, `/operations/{operation_id}/keep`, `/workspace/operations/{operation_id}/discard`, `/operations/{operation_id}/discard`, `/workspace/operations/{operation_id}/preview`, `/operations/{operation_id}/preview`, and `/workspace/operations/{operation_id}`.
  - Delete `execute_script_operation` temp staging logic in `backend/api/routers/script_execution.py`.
- [ ] **Backend Storage & Schema Cleanup**:
  - Remove `create_operation_temp` and all filesystem operations writing to `storage/temp/`.
  - Remove `temp_dir` column reliance in `DatabaseManager` and SQLite schema.
- [ ] **Frontend Component & State Removal**:
  - Delete `features/workspace/Viewport/OperationActionBar.tsx`.
  - Remove `persistenceState` ('not_saved' | 'saving' | 'saved' | 'save_failed' | 'discarded') from `WorkspaceContext.tsx` and `useViewerStore`.
  - Remove `restorePreviewBaseline`, `discardActivePreview`, and temporary preview rollback caches.

## 4. Phase 2: Canonical Direct-Save Pipeline (Script & AI Modes)
- [ ] **Canonical Tool Endpoints**:
  - Retopo: `POST /api/v1/retopo` (`engine: "ai" | "script"`)
  - UV Unwrap: `POST /api/v1/unwrap` (`engine: "ai" | "script"`)
  - Segmentation: `POST /api/v1/segment` (`engine: "ai" | "script"`)
  - Auto-Rig: `POST /api/v1/rig` (direct model invocation)
  - Texturing: `POST /api/v1/texture/generate` (direct model invocation)
- [ ] **Direct Workspace Disk Persistence**:
  - Script Execution: Synchronous/threadpool pipeline writes output directly to `storage/<workspace_id>/<tool_type>/` using `WorkspaceStorageManager.publish_derived_mesh`.
  - AI Execution: Scheduler worker writes completed model output directly into `storage/<workspace_id>/<tool_type>/` via `publish_derived_mesh` instead of overwriting master `mesh.glb`.
- [ ] **Database Registration & Promotion**:
  - New `AssetModel` row created with unique `asset_id`, `workspace_id`, `relative_path`, `byte_size`, `sha256`, and `settings_snapshot`.
  - `DatabaseManager.update_workspace_active_mesh(workspace_id, asset_id)` automatically promotes the asset.
  - Response returns full saved asset model, download URL, and computed face/vertex statistics.

## 5. Phase 3: Disk Management & Multi-Run Versioning Logic
- [ ] **Directory Layout Per Tool**:
  - Retopology: `storage/<workspace_id>/retopology/<workspace_id>_retopology_v{NNN}.glb`
  - UV Unwrapping: `storage/<workspace_id>/uv/<workspace_id>_uv_v{NNN}.glb`
  - Segmentation: `storage/<workspace_id>/segmentation/<workspace_id>_segmentation_v{NNN}.glb`
  - Rigging: `storage/<workspace_id>/rigging/<workspace_id>_rigging_v{NNN}.glb`
  - Texturing: `storage/<workspace_id>/texture/pbr/<workspace_id>_textured_v{NNN}.glb`
- [ ] **Atomic Versioning on Disk**:
  - Step 1: Scan target tool directory and resolve next monotonic version index (`_v002`, `_v003`, etc.) via `get_version_mesh_path`.
  - Step 2: Write output initially to `.staging_<uuid>.tmp` inside the target directory.
  - Step 3: Atomic replace: `staging_path.replace(final_version_path)`. Unlink partial files on any failure.
  - Step 4: Generate paired thumbnail: `<final_version_stem>_thumbnail.png`.
- [ ] **Iterative Parameter Tracking**:
  - Each run stores its exact input parameters in `AssetModel.settings_snapshot` (JSON string: `{ "target_faces": 5000, "engine": "script", "timestamp": "..." }`).
  - Running an operation repeatedly with varying settings never overwrites prior iterations; all historical runs remain safely on disk and in DB.

## 6. Phase 4: UI State Machine & Version Switching
- [ ] **Immediate Promotion Flow**:
  - Operation completion directly activates new asset in `WorkspaceContext`, clears execution spinner, and streams GLB to `MeshViewer`.
  - Zero blocking Keep/Discard prompts or modal overlays.
- [ ] **Version History Selector**:
  - Workspace displays chronological version list (`workspaceVersions`) with tool badges and parameter summaries.
  - Clicking any prior version immediately updates `activeMeshAssetId` and switches the viewer mesh with zero recomputation.
- [ ] **Tool Panel Fixes**:
  - `UVPanel.tsx`: Force `pack_method: "blender"` when `engine === "ai"` for PartUV to satisfy backend schema.
  - `RiggingPanel.tsx`: Bind SkinTokens model execution directly to active workspace without creating detached jobs.
  - `SegmentationPanel.tsx`: Ensure semantic part count and hierarchical settings cleanly route to direct-save pipeline.

## 7. Phase 5: Model Adapter Specifications (PartUV & SkinTokens)
- **PartUV Adapter (`partuv_adapter.py`)**:
  - Add missing `import sys` to eliminate `NameError`.
  - Guard `partuv` import to ensure `preprocess` loads cleanly even if native `_core.so` is missing.
  - Pack results and return canonical dictionary with `output_mesh_path` and `success: True`.
- **SkinTokens Adapter (`skintokens_adapter.py`)**:
  - Ensure thin adapter routes outputs directly to workspace target folder without intermediate temp copying.
  - Preserve locked inference profile: TokenRig architecture, BF16 native on `sm >= 80`, FP16 on `sm < 80`.

## 8. Phase 6: Error Handling & Failure Recovery Matrix
- **Validation Failure (HTTP 400)**: Invalid mesh format or parameter bounds; no files written; viewer retains active mesh; instant warning toast.
- **Pipeline Failure (HTTP 500)**: Script crash (e.g. missing QuadriFlow) or AI OOM; staging path unlinked; active mesh unchanged; error toast.
- **Scheduler Cancellation**: User aborts job; worker process SIGTERM, partial files unlinked, DB job marked CANCELLED, UI returns to IDLE.

## 9. Phase 7: Verification & Integrity Checklist
- [ ] **Python Compilation**: Run `python3 -m compileall backend/` to guarantee zero syntax or import errors.
- [ ] **Frontend TypeScript Validation**: Run `bun tsc` or `npx tsc --noEmit` (no `bun run build`).
- [ ] **Section D Audit**: Verify zero dead references to removed endpoints, no orphan imports, and no lingering temp directories.

## 10. Detailed Execution Sequence & Milestones
- **Milestone 1**: Clean removal of temp endpoints and action bar (Section C audit passes).
- **Milestone 2**: Backend direct publication in `publish_derived_mesh` and scheduler tool output routing.
- **Milestone 3**: Canonical endpoints updated with `settings_snapshot` persistence and active asset promotion.
- **Milestone 4**: Frontend state simplification (`WorkspaceContext`, `UVPanel`, `RiggingPanel`, `SegmentationPanel`).
- **Milestone 5**: Full validation via `compileall` and `tsc --noEmit` before git push.
