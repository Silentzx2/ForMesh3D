# ForMesh3D — Simplified Asset & Generation Architecture Plan

> **Status:** Architecture plan only — implementation has not started.  
> **Goal:** Simplify asset upload, generation jobs, persistence, routes, and result restoration without breaking the existing application.  
> **Target environment:** A single VPS, one application instance, one active generation worker, one user or a small number of trusted users.  
> **Primary principle:** Keep the system small, persistent, predictable, and recoverable. Do not introduce enterprise infrastructure unless a demonstrated requirement needs it.
> **Personal-use scope:** This is a personal project for one primary user (with, at most, a small number of trusted users), not an enterprise or multi-tenant product. Prefer the simplest implementation that fits the existing application and one VPS. Do not add organization management, role systems, distributed infrastructure, service fleets, enterprise observability, or operational ceremony without a demonstrated need.
> **Integrated clarifications:** The relevant additions have been placed in their owning sections below. Section 24 is the final precedence/index note; existing plan content is retained, and only explicitly identified conflicting wording is superseded.

---

## 1. Product Goal

ForMesh3D should behave like a persistent 3D workspace:

1. A user uploads an image or mesh through the UI.
2. The backend saves the actual file inside the VPS storage directory.
3. The database stores the asset's identity, display name, type, file path, thumbnail path, and other essential metadata.
4. When the user presses **Generate**, the backend creates one permanent generation job.
5. The job ID is also the stable identifier in the workspace URL. Example:

   ```text
   job_id:    rabbit_a8f32c
   route:     /workspace/generate/rabbit_a8f32c
   ```

6. The job is persisted before processing starts. Its status and progress are updated as generation runs.
7. When generation succeeds, the generated mesh and thumbnail are saved to VPS storage. The same job record is updated with the output asset reference and final state.
8. The generated mesh appears in the Assets panel with its thumbnail.
9. Opening the original job route later restores that exact job and, when completed, automatically loads its generated mesh in MeshViewer.
10. Clicking that generated mesh in the Assets panel opens the same original job route and loads the same result.
11. Failed or interrupted jobs remain visible and recoverable. They must not silently disappear or be mistaken for successful generations.

### Core user experience

```text
UPLOAD IMAGE / MESH
        │
        ▼
SAVE FILE ON VPS ─────── SAVE ASSET RECORD IN SQLITE
        │                              │
        └──────────────┬───────────────┘
                       ▼
                 ASSETS PANEL
                       │
             User selects an image
                       │
                 Press GENERATE
                       │
                       ▼
             CREATE PERMANENT JOB
                       │
           job_id = rabbit_a8f32c
                       │
                       ▼
 /workspace/generate/rabbit_a8f32c
                       │
                       ▼
             SINGLE BACKGROUND WORKER
                       │
              Run the existing 3D model
                       │
             ┌─────────┴─────────┐
             │                  │
          SUCCESS             FAILURE
             │                  │
             ▼                  ▼
     SAVE OUTPUT MESH      SAVE ERROR STATE
     SAVE THUMBNAIL        KEEP INPUT IMAGE
     SAVE ASSET RECORD     ALLOW RETRY
             │
             ▼
      UPDATE SAME JOB ROW
       status = completed
             │
             ▼
       ASSETS PANEL + VIEWER
             │
             ▼
  SAME ROUTE WORKS AFTER RELOAD / VPS RESTART
```

---



### 1.1 Workspace-first implementation clarification

The user-facing product is workspace-centric, while generation and tool runs are individual operations inside that workspace. Apply these rules to the original job-centric flow above:

- `workspace_id` is the durable project identity and route token. The existing URL `/workspace/generate/<job_id>` remains supported; where the old route token is called `job_id`, it is a compatibility name for the same workspace identity, not the ID of every later tool run.
- `asset_id` identifies one immutable uploaded or retained file. `operation_id` identifies one execution of a tool. Do not reuse one identifier for all three concepts.
- A new image-to-mesh task creates one workspace; the successful initial raw mesh is automatically retained as its base mesh. A new independent standalone mesh upload also creates one workspace and is saved under `input/`.
- Subsequent Texture/PBR, Segmentation, Retopology, UV, Editing, Rigging, Animation, and other supported operations reuse the same workspace and route. They capture the exact selected input asset and settings, generate into shared temporary storage, and become permanent outputs only through **Keep in Workspace**.
- The selected saved mesh is the default input for the next operation. A preview is not an active saved mesh and is not a Mesh Versions entry until it is retained.
- A new unrelated mesh upload must not replace the source or active mesh of an already-open workspace. It creates a separate workspace unless the user explicitly chooses a supported import/reference action.

### 1.2 Product-level acceptance additions

- Refreshing or reopening a workspace restores its saved assets, active mesh selection, available mesh versions, and operation history without launching inference.
- A completed derived operation may have a valid preview but still be unsaved. The UI must distinguish execution completion from permanent retention.
- A saved output is never silently overwritten. Earlier retained versions remain selectable.
## 2. Design Principles

### 2.1 Keep the architecture intentionally small

The target system should use:

- One FastAPI backend.
- One SQLite database as the source of truth for assets and generation jobs.
- One VPS storage directory for uploaded and generated files.
- One simple persistent FIFO job queue backed by SQLite.
- One dedicated background worker process, with only one active generation at a time.
- The existing generation/model pipeline, reused rather than rewritten.
- Simple HTTP APIs and frontend polling for job status.

**Personal-project sizing rule:** Treat the list above as the complete default architecture, not a starting point for a larger platform. One application deployment, one authoritative SQLite DB, one configured storage root, and one active worker are enough. Keep maintenance to simple local/VPS logs, a basic disk-space check, and a documented backup/restore procedure. Add more only when the actual workload demonstrates a need.

### 2.2 Do not add infrastructure without a real need

Do not introduce or require:

- Redis for the single-worker setup.
- Celery, distributed task orchestration, or a separate message broker.
- Multiple worker pools or multi-machine scheduling.
- A complex event bus.
- WebSockets solely for progress updates; normal polling is sufficient initially.
- A second database just for assets.
- A new asset catalog service if a small database-backed asset service is enough.

### 2.3 Reliability is not optional

Simplifying does **not** mean removing:

- Persistent job records.
- Stable asset and job identities.
- Safe file-path handling.
- File validation and upload limits.
- Job state tracking.
- Restart/crash recovery.
- Atomic output finalization.
- Error details and manual retry.
- Database and file-storage backups.
- Backward compatibility during migration.

---



### 2.4 Reuse before adding or replacing

- Inspect and reuse the repository's existing API routers, endpoint URLs, asset/FileStore layer, database, queue, scheduler, worker entry points, model adapters, thumbnail utilities, and frontend state before adding anything. Refactor their internals to the new contracts; do not create parallel implementations that perform the same job.
- The endpoint table in Section 11 is a capability reference, not an instruction to add every listed URL. An existing endpoint that already performs the capability must be kept and adapted. Add a new endpoint only when the capability is genuinely absent and no safe extension of an existing route is suitable.
- Do not create a second SQLite database, second queue, second scheduler, second worker process, duplicate asset catalog, or parallel storage manager for the same responsibility. Keep one authoritative implementation for each responsibility.
- Prefer a small service/helper refactor over a new abstraction layer. Do not introduce generic frameworks, registries, event buses, or configurable plugin systems for this scope.

### 2.5 Minimal-change and cleanup rule

Make the smallest complete change that satisfies this plan. Preserve working inference/model code and unrelated product behavior. Remove old code only after the dependency and usage audit in Sections 14 and 23 proves it is unused and safe to remove. Do not rewrite or mass-format unrelated files.
## 3. Target Architecture

```text
                         ┌────────────────────────────┐
                         │        FRONTEND UI         │
                         │                            │
                         │ Upload · Generate · Assets │
                         │ Workspace · MeshViewer     │
                         └──────────────┬─────────────┘
                                        │ HTTP API
                                        ▼
                         ┌────────────────────────────┐
                         │       FASTAPI BACKEND      │
                         │                            │
                         │ Upload API                 │
                         │ Asset API                  │
                         │ Generation API             │
                         │ Job Status / Retry API     │
                         │ File / Thumbnail API       │
                         └────────┬───────────┬───────┘
                                  │           │
                         DB read/write       File read/write
                                  │           │
                    ┌─────────────▼──┐   ┌────▼─────────────────┐
                    │    SQLITE     │   │    VPS FILE STORAGE  │
                    │               │   │                      │
                    │ assets        │   │ uploads/             │
                    │ generation_   │   │ generated/           │
                    │ jobs          │   │ thumbnails/          │
                    └──────┬────────┘   └──────────┬───────────┘
                           │                       ▲
                           │ next queued job       │ save outputs
                           ▼                       │
                    ┌──────────────────────────────┴┐
                    │       SINGLE WORKER           │
                    │                               │
                    │ Claim queued job              │
                    │ Load input asset              │
                    │ Run existing generation code  │
                    │ Save mesh + thumbnail         │
                    │ Update job + asset records    │
                    └───────────────────────────────┘
```

### Responsibility boundaries

| Component | Single responsibility |
|---|---|
| Frontend upload UI | Select file, show upload state, refresh asset list |
| Upload API | Validate and save uploaded file, create asset row |
| Asset service/API | Return asset metadata and safe file/thumbnail URLs |
| Generation API | Validate input asset, create durable job, return job ID and route |
| SQLite | Persist asset records and job lifecycle |
| Worker | Pick one queued job, run generation, save outputs, update state |
| Job API | Return a job by its canonical job ID, retry eligible jobs, expose progress |
| MeshViewer | Load the asset referenced by the restored job/asset record |

The API process and worker may share the same codebase and storage/database configuration, but the long-running GPU inference must not block normal API requests. They should run as separate managed processes on the VPS if the current deployment structure allows it.

---



### 3.1 Workspace/operation responsibilities

Extend the existing architecture by assigning these responsibilities to existing modules where practical; these are logical boundaries, not a requirement to create new services or packages:

| Responsibility | Required behavior | Implementation constraint |
|---|---|---|
| Workspace resolution | Resolve stable `workspace_id`/legacy route token to one workspace | Reuse existing route and persistence code where possible |
| Asset ownership | Resolve each `asset_id` to its workspace owner, role, file and thumbnail | Reuse the current asset/FileStore/manifest layer where possible |
| Operation execution | Capture one input asset and immutable settings, queue one tool execution | Adapt the existing job/queue/scheduler/worker path |
| Storage/publishing | Stage, validate, publish and index files safely | Extend the existing storage utilities; no competing storage root |
| Workspace manifest | Maintain the one agreed workspace `metadata.json` | Treat it as a reconciled manifest, not a second conflicting job database |
| Frontend workspace state | Distinguish active saved mesh, temporary preview and retained versions | Extend existing UI state rather than create duplicate state stores |

The existing API process and existing managed worker remain the primary runtime. The worker consumes operation executions through the existing durable queue. Do not create a new worker simply because the internal record is now called an operation.

### 3.2 Authoritative data ownership

- SQLite remains the durable authority for workspace lookup, canonical IDs, asset records/ownership, operation execution state, queue state, active mesh ID, persistence state, and relationships needed to restore the UI. Use the repository's existing authoritative SQLite file; do not create a parallel database.
- The filesystem is authoritative for file bytes. Store only safe relative paths in records.
- Each workspace has exactly one root `metadata.json` as required by Section 21. It is the unified workspace manifest/projection of source details, retained outputs, tool paths, version/history information, and relevant presentation metadata. Do not allow it to become a competing source of truth for queue status or asset existence. If DB and manifest disagree, the DB records and verified files win; rebuild/repair the manifest.
- If an existing manifest/FileStore currently owns some metadata, map that responsibility explicitly before migration. Do not write the same field independently into multiple stores without a defined owner and reconciliation rule.
## 4. Identity and Route Rules

This is one of the most important parts of the design.

### 4.1 Canonical identities

Use two distinct canonical identifiers:

| Identifier | Identifies | Example |
|---|---|---|
| `asset_id` | One uploaded or generated file/asset | `ast_7e12...` |
| `job_id` | One generation attempt/workspace | `rabbit_a8f32c` |

A job references its input asset and, after success, its output asset. A generated asset can be traced back to its originating job.

**Do not use a filename, URL slug, temporary browser ID, backend file UUID, or a prefix such as `local_` / `upload_` as a substitute for a canonical database identity.** Those may exist as legacy or display metadata, but they must not be confused with the canonical IDs.

### 4.2 Job ID format

The user-facing route token should follow this pattern:

```text
<sanitized-image-name>_<short-unique-hash>

Example:
rabbit_a8f32c
```

Rules:

- Build the readable stem from the original input filename, without its extension.
- Normalize it to a safe lowercase URL slug; replace spaces and unsupported characters with underscores.
- Keep the readable part to a reasonable length.
- Append a short random/hash suffix generated on the backend.
- Enforce a unique constraint on `job_id`. If a collision occurs, generate another suffix before inserting the row.
- The backend is the authority that creates and returns the final ID. The frontend must not independently invent a second job ID.
- Do not derive a route ID later from a UUID or reconstruct it differently in another component.

### 4.3 Route and job ID must match

For a job:

```text
job_id:    rabbit_a8f32c
route:     /workspace/generate/rabbit_a8f32c
```

Store both `job_id` and the full `route_path` in the database. The route token must equal `job_id` exactly. The full path is stored for traceability and future route compatibility, not as a second identity.

### 4.4 Route is a lookup key, not the source of truth

When a route is opened:

1. Frontend reads the route token.
2. Frontend requests the job by that token.
3. Backend looks up `generation_jobs.job_id`.
4. Backend returns job state, input asset and output asset metadata.
5. UI renders the correct state.
6. If completed, MeshViewer loads the output asset using its asset ID / safe API URL.

Never rerun generation just because a route is opened or refreshed.

### 4.5 Generated asset click behavior

Each generated asset must be linked to its originating job. Clicking it in the Assets panel should navigate to that job's original route:

```text
Generated asset
      │
      ▼
originating job_id
      │
      ▼
/workspace/generate/<job_id>
      │
      ▼
Restore same job and load same generated mesh
```

Uploaded assets that do not originate from a generation job must continue to open through the appropriate asset-selection/viewer behavior. Do not fabricate a job route for a plain upload.

---



### 4.6 Workspace identity supersedes the old job/workspace conflation

The identity terms in this section are clarified by Sections 21–22 as follows:

| Identifier | Canonical meaning | Rules |
|---|---|---|
| `workspace_id` | One persistent workspace and its route token | One workspace directory; stable for the workspace lifetime |
| `asset_id` | One uploaded or retained asset/file | Immutable identity; a newly retained version receives a new asset ID |
| `operation_id` | One actual tool execution | New ID for each fresh run or regeneration; never a workspace directory |
| legacy `job_id` | Existing public/database compatibility field | Preserve existing meaning at each legacy API boundary; where it identifies the workspace route, map it to `workspace_id`. Never use one ambiguous internal field for both workspace and execution identity |

For new internal code, use the explicit names `workspace_id`, `asset_id`, and `operation_id`. Do not perform a blind global rename of old `job_id` fields: inventory their callers and preserve their observed contract through adapters until safely migrated. Existing records whose old `job_id` is the route token should map to the same `workspace_id`; do not mint a different route during migration.

### 4.7 Route compatibility and restoration

- Preserve `/workspace/generate/<workspace_id>` as the canonical compatible route during this implementation. Do not rename it merely because the route contains the historical word `generate`.
- Keep any other currently used route patterns working through the existing resolver/compatibility layer. Only remove an old route after the usage/dependency criteria in Section 11.4 and Section 23 are met.
- Opening a route resolves a workspace and its persisted state only. It must not enqueue an operation, create a workspace, change the active mesh, or regenerate a preview as a side effect.
- Validate route tokens and resolve them through database records; never form filesystem paths directly from an untrusted route token.

### 4.8 Canonical ID formats and collision handling

Use these readable, backend-generated formats for new records. These formats do not require a new ID service or framework:

| ID | Format | Example | Rule |
|---|---|---|---|
| `workspace_id` | `<safe-name>_<6-8 lowercase hex>` | `rabbit_a8f32c` | Same value as the workspace route token and root directory name |
| `asset_id` | `ast_<12 lowercase hex>` | `ast_7e12a4b90c31` | One immutable stored file/asset |
| `operation_id` | `op_<12 lowercase hex>` | `op_91c2e4a80b17` | One actual execution attempt |

Generate IDs on the backend. Enforce a unique DB constraint for each canonical ID. If an insert collides, generate a new suffix and retry the insert before creating or publishing the associated directory/file. Never resolve a collision by reusing another record or workspace. Existing legacy IDs remain readable through the compatibility rules in Sections 4.6–4.7; do not bulk-rename them merely to match the new format.

### 4.9 Asset navigation: gallery versus an open workspace

There are two intentionally different click contexts:

- From the global **Workspaces** gallery, clicking a workspace/card opens that workspace's stable route. It restores that workspace; it does not launch an operation.
- Inside an already-open workspace, clicking a saved mesh asset or choosing a **Mesh Versions** entry selects that exact saved `asset_id` as the Active Mesh. The workspace route stays unchanged.
- A workspace-local Assets panel is not a second global workspace browser. It lists assets belonging to the current workspace (plus any explicitly referenced external assets with their original owner shown).
- A global workspace card opens the workspace, not a nested operation URL. A legacy generated-asset click may continue to resolve through its old originating-job route during compatibility migration, but the resolved destination must be the same owning workspace.

This distinction resolves the older generated-asset click wording in Sections 4.5 and 10.4: global navigation changes workspace; selecting a saved asset/version inside a workspace changes only the active mesh.

## 5. Upload Workflow

Both images and meshes are uploaded through the UI and stored directly on the VPS.

```text
USER SELECTS FILE
       │
       ▼
FRONTEND SENDS MULTIPART REQUEST
       │
       ▼
BACKEND VALIDATES FILE
       │
       ├── Validate allowed type / extension / MIME
       ├── Enforce configured maximum file size
       ├── Generate canonical asset_id
       └── Choose safe storage destination
       │
       ▼
WRITE TO TEMPORARY FILE
       │
       ▼
VERIFY WRITE + SIZE / BASIC FILE VALIDITY
       │
       ▼
ATOMICALLY MOVE TO FINAL STORAGE PATH
       │
       ▼
INSERT ASSET ROW IN SQLITE
       │
       ▼
RETURN ASSET METADATA + SAFE FILE URL
       │
       ▼
REFRESH ASSETS PANEL
```

### 5.1 Suggested storage layout

Use a stable, predictable layout. Exact directory names can be aligned with existing storage paths during implementation; do not move old files just to match this example.

```text
backend/storage/
│
├── database/
│   └── for_mesh.db
│
├── uploads/
│   ├── images/
│   │   └── <asset_id>/source.png
│   └── meshes/
│       └── <asset_id>/source.glb
│
├── generated/
│   └── <job_id>/
│       ├── mesh.glb
│       └── metadata.json        # Optional; DB remains authoritative
│
└── thumbnails/
    ├── <asset_id>.webp
    └── <job_id>.webp
```

Storage requirements:

- Keep original uploaded files unchanged unless a separate conversion is explicitly required.
- Store generated mesh outputs separately from original uploads.
- Use generated IDs in physical directory/file names; keep original filenames as metadata only.
- Store paths relative to the configured storage root in SQLite. This makes moving the whole storage root less fragile.
- Resolve paths against the configured storage root and reject path traversal or paths that escape it.
- Do not expose arbitrary filesystem paths to the browser. Use asset/file API endpoints that look up the path server-side.
- Save output to a temporary path first; publish it at the final path only after generation and validation succeed.
- A failed or interrupted job must not be listed as a completed mesh just because a partial file exists.

### 5.2 Asset metadata

Minimum useful fields:

| Field | Required | Notes |
|---|---:|---|
| `asset_id` | Yes | Canonical unique ID |
| `name` | Yes | Display name |
| `original_filename` | Yes | Original user filename |
| `type` | Yes | `image` or `mesh` |
| `source` | Yes | `uploaded` or `generated` |
| `file_path` | Yes | Relative path inside storage root |
| `thumbnail_path` | No | Relative path; nullable if unavailable |
| `format` | Yes | `png`, `glb`, `obj`, etc. |
| `mime_type` | Recommended | Validated MIME type |
| `size_bytes` | Recommended | Actual saved file size |
| `created_at` | Yes | UTC timestamp |
| `origin_job_id` | No | Set for generated assets |

For generated assets, `origin_job_id` links the mesh to the job that produced it. The job also holds `output_asset_id`. Keep the relationship consistent and use foreign keys where feasible.

---



### 5.3 Upload ownership and upload state rules

Use the following ownership rules:

- A newly uploaded image used to start a new image-to-mesh task creates one workspace and is stored in that workspace's `input/` directory. The upload and workspace registration must be recoverable if either filesystem or DB work fails.
- A new standalone mesh upload creates a separate workspace by default and is stored unchanged in `input/`; it becomes that workspace's source and initial active mesh.
- An explicit import/reference action may select an existing asset without copying it. Its original `workspace_id` ownership must remain explicit. Never silently move or duplicate an existing asset.
- Uploading an unrelated mesh while another workspace is open must not replace that workspace's input, source mesh, or active mesh.

Treat upload as a small stateful transaction: `receiving → validating → staged → committed`; on validation/write/DB failure use `failed` and clean the staged file or mark it for bounded cleanup. Do not create a visible successful asset before its final file exists and its record is committed. A failure after file publication but before DB commit must leave a recoverable orphan for reconciliation, not a false asset entry.

### 5.4 Upload failure behavior

Return a clear validation or storage error for unsupported formats, invalid signatures, excessive size, empty/corrupt files, unavailable storage, permission failures, disk-full errors, or DB failures. Preserve the original file and existing workspace state. Do not swallow an exception and return a success-shaped response. Log technical context server-side, but do not expose absolute VPS paths, stack traces, or secrets to the client.

### 5.5 Original-file preservation and retained filename rules

- Preserve the uploaded source file byte-for-byte and keep its original extension. Do not re-encode or recompress it as part of upload. Store the original user filename separately as metadata. The safe on-disk basename may be normalized, but its real extension must remain intact. Any required conversion is a separate derived file and must not replace the original.
- Under the agreed workspace tree in Section 21, keep source inputs in `input/` using the agreed `source_image.<original-extension>` or `source_mesh.<original-extension>` pattern. The examples `source_image.png` and `source_mesh.glb` are illustrative of the extension, not permission to change an uploaded file's format.
- For retained generated outputs, use the canonical first-output naming shown in Section 21. When another output of the same role/tool is retained, preserve the earlier file and use an immutable version suffix such as `_v002`, `_v003`, and so on. Never overwrite a retained file, even if it is no longer the active selection.
- Keep original display names and original filenames in metadata; do not use raw user filenames as filesystem paths. All version naming remains backend-generated and collision-safe.
- A missing thumbnail does not make an otherwise valid source or generated mesh unusable. Thumbnail behavior is governed by Sections 7.8, 10.11, and 21.4.

## 6. Generate Workflow

The Generate button must create a persistent job before the worker starts inference.

```text
USER CLICKS GENERATE
        │
        ▼
FRONTEND SENDS input_asset_id + settings
        │
        ▼
BACKEND VALIDATES INPUT ASSET
        │
        ▼
BACKEND CREATES job_id
        │
        ├── Create safe filename stem
        ├── Add unique short suffix
        └── Build route_path from the same job_id
        │
        ▼
INSERT JOB ROW (status = queued)
        │
        ▼
RETURN { job_id, route_path, status }
        │
        ▼
FRONTEND NAVIGATES TO route_path
        │
        ▼
SINGLE WORKER CLAIMS QUEUED JOB
        │
        ▼
UPDATE status = processing
        │
        ▼
RUN EXISTING MODEL / GENERATION PIPELINE
        │
        ├──────────────────────────────┐
        │                              │
      SUCCESS                         ERROR
        │                              │
        ▼                              ▼
SAVE OUTPUT TEMPORARILY          RECORD ERROR DETAILS
VALIDATE OUTPUT                  CLEAN / QUARANTINE PARTIALS
CREATE THUMBNAIL                 status = failed
MOVE TO FINAL PATH                    │
CREATE OUTPUT ASSET ROW               ▼
UPDATE output_asset_id             KEEP JOB ROUTE
status = completed                 SHOW RETRY
        │
        ▼
FRONTEND REFRESHES JOB
        │
        ▼
MESHVIEWER LOADS OUTPUT ASSET
```

### 6.1 Important ordering rule

The job row must be committed to SQLite before the backend reports success to the frontend or the worker begins processing it. This prevents a generation from running without a durable record/route to recover later.

### 6.2 Do not couple route creation to worker completion

The route is created when the job is created, not after the mesh is generated. It remains stable through queued, processing, completed, failed, interrupted, and retry states.

---



### 6.3 Every tool execution is a workspace operation

The original Generate flow remains the initial workspace-creation flow. After the workspace exists, every additional tool run uses the same execution contract:

1. Resolve the workspace and the selected input asset by canonical IDs.
2. Validate that the input type and prerequisites match the tool.
3. Snapshot `workspace_id`, exact `input_asset_id`, input version/path, operation type, settings/parameters, and any required reference assets.
4. Create one durable operation execution record before returning accepted/queued to the frontend.
5. Submit that record to the existing persistent queue. Do not add a parallel queue or bypass durable job tracking.
6. Execute the existing tool/model pipeline with the captured snapshot, not whatever happens to be selected later in the UI.
7. Write all intermediate and result files to a unique subdirectory of shared `storage/temp/`.
8. For the initial image-to-mesh operation, automatically retain a validated base mesh in `mesh/`. For later derived operations, return a verified preview and wait for **Keep in Workspace** before permanent publication.

A page visit or route refresh is not an operation request. Repeated frontend submission caused by double-click, retrying a network request, or polling must not accidentally create duplicate execution records. Reuse existing idempotency/request-deduplication support where present; add the smallest safe deduplication guard only if the audit shows it is missing and duplicate submissions are possible.

### 6.4 Input snapshot and concurrent UI changes

Once queued, an operation is bound to its captured `input_asset_id` and settings snapshot. Changing the active mesh, switching tools, refreshing the page, or selecting another version must not mutate a running operation's input. If the selected asset is deleted, missing, or becomes invalid before the worker opens it, fail with a specific input-unavailable error; do not silently fall back to a different mesh.

### 6.5 Tool prerequisites and output contracts

Each existing tool adapter must state the required input type, prerequisites, expected output type(s), and validation method. For example, Animation must reject a mesh that lacks the required compatible rig/skeleton; Texture/PBR needs both a mesh and, when required by the current pipeline, a reference image. A tool that produces only maps or metadata must not manufacture a mesh asset or a Mesh Versions entry. Reuse the actual pipeline contract; do not invent unsupported capabilities.

### 6.6 Regenerating the initial image-to-mesh result

The initial image-to-mesh generation is special because its successful output becomes the workspace's base mesh automatically. Regenerating that initial result must follow the same immutable-operation rules as every other terminal execution:

1. Create a new `operation_id` and link it to the previous initial-generation operation as its parent/regeneration source. Keep the same `workspace_id`, route, source image asset, and settings snapshot by default.
2. Generate and validate the new raw mesh in `storage/temp/`. Do not overwrite the previous base mesh while inference is running or before the new output is valid.
3. On success, retain the new base mesh as a new immutable asset/version using the Section 5.5 naming rule (for example, the next `_v002` version). Preserve the old base mesh and keep it selectable in Mesh Versions.
4. Switch Active Mesh to the newly retained base mesh only after the new file and DB record are committed successfully. If generation or publication fails, the previous base mesh remains active and usable.
5. The original source image remains unchanged. This action regenerates the base mesh in the same workspace; it does not create a new workspace or route.

If the user chooses an image owned by another workspace as the source for a genuinely new image-to-mesh task, create a new workspace and copy the source image bytes into that new workspace's `input/` directory. Preserve the original workspace's ownership and file. This is different from an explicit cross-workspace asset reference for a later tool operation: a reference keeps the original owner and does not copy/move bytes unless the user explicitly chooses an import/copy action. Do not silently change ownership.
## 7. Job States and State Transitions

Required states:

| State | Meaning | UI behavior |
|---|---|---|
| `queued` | Job is saved and waiting for the worker | Show queued/waiting state |
| `processing` | Worker is actively generating | Show progress and current stage |
| `completed` | Output mesh and asset record are finalized | Load mesh; show thumbnail |
| `failed` | Generation ended due to a known error | Show error and retry action |
| `interrupted` | Worker/VPS stopped unexpectedly before completion | Show interrupted state and recovery/retry action |
| `cancelled` | User cancelled the job, where safe cancellation is supported | Show cancelled state |

### 7.1 State flow

```text
                       ┌────────────────┐
                       │     QUEUED     │
                       └───────┬────────┘
                               │ worker claims job
                               ▼
                       ┌────────────────┐
             ┌─────────│   PROCESSING   │─────────┐
             │         └────────────────┘         │
             │ success                            │ error
             ▼                                    ▼
      ┌────────────────┐                   ┌──────────────┐
      │   COMPLETED    │                   │    FAILED    │
      └────────────────┘                   └──────┬───────┘
                                                  │ retry same job
                                                  ▼
                                               QUEUED

PROCESSING -- unexpected process/VPS stop --> INTERRUPTED
INTERRUPTED -- user retries -----------------> QUEUED
QUEUED -- user cancels ----------------------> CANCELLED
PROCESSING -- cooperative cancellation -----> CANCELLED
```

### 7.2 State invariants

- `completed` requires a valid output asset row and an existing output file.
- `completed` requires a usable output thumbnail when thumbnail generation is supported; if thumbnail generation is optional, keep it nullable and expose that clearly.
- `failed` requires an error code/message or a useful failure description.
- `interrupted` means the process stopped unexpectedly; it is not the same as a normal model failure.
- `queued` means the job is eligible for the worker to claim.
- `processing` must identify the start time and have a way to detect an abandoned/stale worker (for example, a `heartbeat_at` timestamp or a controlled startup recovery step).
- `failed` and `interrupted` jobs retain the original input asset and stable job route.
- A partial output file must never be exposed as a completed asset.
- A retry must not create a different route for the same job unless a future product requirement explicitly asks for separate attempts as separate jobs.

### 7.3 Retry behavior

Recommended simple behavior: retry the same job record and keep the same `job_id` and `route_path`.

On retry:

1. Allow retry only for `failed` or `interrupted` jobs (and any explicitly supported recoverable state).
2. Increment `attempt_count`.
3. Clear the previous active error fields, but preserve attempt history in logs or a small attempt record if needed.
4. Remove or quarantine partial output files from the previous attempt.
5. Keep the input asset and generation settings.
6. Set status back to `queued` and let the single worker claim it.
7. Keep the exact same route.

Automatic infinite retries are not required. Prefer a visible manual retry button initially.

### 7.4 Cancellation

Cancellation can be supported simply for queued jobs: mark them `cancelled` so the worker skips them. For a processing job, only expose cancellation if the current model pipeline supports cooperative stop/cleanup. Do not pretend a GPU inference process has stopped if it cannot actually be interrupted safely.

---



### 7.5 Operation execution and persistence are separate state machines

The old job states remain useful for execution, but a derived operation can complete inference before the user decides to retain its preview. Track execution and persistence separately. The following are logical states; adapt existing columns/tables where possible rather than automatically creating a new table.

**Execution state**

| State | Meaning | Allowed next state(s) |
|---|---|---|
| `queued` | Durable operation accepted and awaiting the worker | `processing`, `cancelled` |
| `processing` | Worker owns the operation and is executing the captured request | `completed`, `failed`, `interrupted`, `cancelled` (only after confirmed cooperative stop) |
| `completed` | Tool execution succeeded and its output preview passed validation | terminal for this execution |
| `failed` | A known execution/validation error occurred | terminal; regenerate creates a new `operation_id` |
| `interrupted` | Worker/process stopped unexpectedly | terminal; recovery may offer Regenerate as a new execution |
| `cancelled` | Cancellation completed or a queued item was safely removed from eligibility | terminal |

**Persistence state**

| State | Meaning | Allowed next state(s) |
|---|---|---|
| `not_saved` | Preview exists only in temp; not a permanent workspace asset | `saving`, `discarded`, `cleanup_pending` |
| `saving` | Keep request is validating/publishing files and committing records | `saved`, `save_failed`, `cleanup_pending` |
| `saved` | Files and asset/manifest references are committed and discoverable | terminal for that retained asset; a later run creates a new operation/output version |
| `save_failed` | Retention failed; no asset may be exposed as saved | `saving`, `discarded`, `cleanup_pending` |
| `discarded` | User discarded the temporary preview | terminal |
| `cleanup_pending` | Temporary cleanup is incomplete and queued for safe cleanup | `discarded` after cleanup, or remain pending with error |
| `preview_expired` | The unretained preview has passed its TTL and is no longer available; its execution/history record remains | terminal for that preview; a new operation may be created through Regenerate |

A `not_saved` preview may transition to `preview_expired` after its TTL only when the temp files are confirmed unavailable/cleaned; `cleanup_pending` remains pending until cleanup succeeds. Expiration never changes the execution state or deletes the operation history.

For a derived operation, `execution_status = completed` means a valid preview is ready; it does **not** mean the output is saved. `persistence_status = saved` is the only condition that allows the output into permanent Assets/Mesh Versions. For initial image-to-mesh generation, successful output is automatically retained as the base mesh, so its final persistence state must be `saved` before the workspace reports the base result as available.

### 7.6 State invariants and transition enforcement

- Every state change must be validated against the allowed transition table and committed atomically. Reject stale or out-of-order updates; use a conditional update/compare-and-set or equivalent transaction guard.
- `processing` requires a worker/claim identity and heartbeat or equivalent lease evidence. Only the current owner may update progress or terminal status.
- `completed` execution requires a verified preview file and the output metadata needed to restore that preview. It does not require a permanent asset row for derived operations.
- `saved` requires validated final file(s), a canonical asset record, a valid owning workspace, and a consistent manifest. A path existing by itself is not enough.
- `failed`, `interrupted`, and `cancelled` must never expose partial output as a usable mesh version. Preserve useful error/attempt history.
- A terminal operation execution is immutable. Regenerate creates a new `operation_id` and links it to the earlier operation using a parent/regeneration reference. It does not reset the previous operation or overwrite a saved output.
- Active mesh selection is a workspace-level reference to a saved `asset_id`. Showing an unsaved preview in MeshViewer must not change this saved active reference.

### 7.7 Retry, regenerate, keep and cancel semantics

- **Regenerate**: create a new execution record/ID using the prior operation's exact input and settings snapshot by default. Deliberately changed settings create a new immutable snapshot. Preserve earlier saved outputs.
- **Keep in Workspace**: change only persistence state (`not_saved`/`save_failed → saving → saved`) for the already completed preview. It does not rerun inference.
- **Discard Preview**: mark the preview discarded and clean only its temp files. Never delete inputs, retained assets, or earlier outputs.
- Existing legacy `retry job` behavior may remain at the public API boundary for compatibility. Internally it must map clearly to either retrying a pre-execution queued job safely or creating a new operation execution after a terminal failure; do not silently reset a completed/saved execution.
- Cancellation of queued work is safe if it is atomically made ineligible for claiming. Processing cancellation is available only when the actual pipeline supports cooperative stop and confirms cleanup. Otherwise return a conflict explaining that cancellation is unsupported at that stage.

### 7.8 Final retry semantics for terminal executions (supersedes older same-row wording)

Use the following precise rule for new workspace/operation code:

- A queue record that has not yet been claimed and whose execution has not started may be returned to `queued` in the same record when this is only recovery from a submission/dispatch issue. No execution attempt has happened in this case.
- Once a worker has claimed an operation and execution has entered `processing`, its eventual `completed`, `failed`, `interrupted`, or `cancelled` state is terminal and immutable. A user-facing **Retry** or **Regenerate** after one of these terminal outcomes creates a new `operation_id`, links it to the previous operation, and keeps the same workspace route.
- The new execution reuses the exact input asset/version and settings snapshot by default. Deliberately changed settings create a new snapshot. The previous operation, its logs/error, preview (if still valid), and any retained output remain historical records.
- A legacy retry endpoint can remain for compatibility, but its adapter must apply this distinction. It may requeue a never-claimed legacy request in place; it must create a new operation for an execution that actually started and then failed/interrupted/cancelled. It must never reset a terminal operation or overwrite its output.
- Initial image-to-mesh regeneration follows Section 6.6: a new operation creates a new immutable base-mesh version in the same workspace.

**Superseded wording:** The `retry same job` arrows and statements in Sections 7.1, 7.3, 18 item 7, and older job-centric examples describe the legacy/pre-execution compatibility case only. They do not authorize resetting a started terminal execution. The stable workspace ID and route remain the same even when the operation ID changes.

### 7.9 Thumbnail and completion invariant

A thumbnail is optional presentation metadata, not a condition for a successful mesh operation. `completed`/`saved` requires a verified, non-empty, valid output mesh (and the corresponding durable asset/operation records for the relevant workflow). A thumbnail path may be null or marked failed/pending. Show a placeholder in the UI and allow thumbnail regeneration independently where supported. Thumbnail generation or upload failure must never make a valid mesh unavailable, prevent Keep in Workspace, or block workspace restoration. This resolves the conditional wording in Section 7.2 in favor of the explicit optional-thumbnail rules in Sections 13.1 and 21.4.

## 8. Database Design

Start with two primary tables: `assets` and `generation_jobs`. Keep the schema small, but include enough fields for recovery and UI restoration.

### 8.1 `assets`

```sql
CREATE TABLE assets (
    asset_id          TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    type              TEXT NOT NULL,          -- image | mesh
    source            TEXT NOT NULL,          -- uploaded | generated
    file_path         TEXT NOT NULL,          -- relative to storage root
    thumbnail_path    TEXT,                   -- relative; nullable
    format            TEXT NOT NULL,
    mime_type         TEXT,
    size_bytes        INTEGER,
    origin_job_id     TEXT,
    created_at        TEXT NOT NULL,
    FOREIGN KEY (origin_job_id)
        REFERENCES generation_jobs(job_id)
);
```

The exact foreign-key direction and creation order should be finalized during implementation to avoid circular migration problems. If necessary, add the relationship after table creation or keep the job-to-output reference as the primary relationship. Do not duplicate inconsistent IDs.

### 8.2 `generation_jobs`

```sql
CREATE TABLE generation_jobs (
    job_id           TEXT PRIMARY KEY,
    route_path       TEXT NOT NULL UNIQUE,
    input_asset_id   TEXT NOT NULL,
    output_asset_id  TEXT,
    status           TEXT NOT NULL,
    progress         INTEGER NOT NULL DEFAULT 0,
    stage            TEXT,
    settings_json    TEXT,
    error_code       TEXT,
    error_message    TEXT,
    attempt_count    INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    completed_at     TEXT,
    updated_at       TEXT NOT NULL,
    heartbeat_at     TEXT,
    FOREIGN KEY (input_asset_id) REFERENCES assets(asset_id),
    FOREIGN KEY (output_asset_id) REFERENCES assets(asset_id)
);
```

Notes:

- `settings_json` stores the generation options needed to understand/retry the job. Do not store secrets in it.
- `progress` should be constrained to a valid range (0–100) where the current pipeline can report meaningful progress.
- Use UTC timestamps in a consistent ISO-8601 format.
- Use indexes on `status`, `created_at`, `input_asset_id`, and `output_asset_id` as justified by actual queries.
- Enable SQLite foreign-key enforcement on every connection.
- Keep SQLite WAL mode and a sensible busy timeout if compatible with the existing database setup.
- Do not hold a database write transaction open during long GPU inference. Claim/update the job in a short transaction, then run inference outside the transaction.

### 8.3 Optional metadata

Only add another table when a concrete need appears. A separate job-attempt history table may be useful later, but it is not required for the first simple version. Logs can retain detailed execution output; the main job row should keep the current state and latest useful error.

---



### 8.4 Workspace and operation data model additions

The schema examples above describe the original job-centric model. Implement the following logical relationships while reusing/migrating the existing schema. Do not create duplicate tables if current tables can be extended safely.

- `workspaces`: canonical `workspace_id`, route token/path, creation/update timestamps, manifest-relative path, and `active_mesh_asset_id` (nullable until a base mesh exists).
- `assets`: retain canonical `asset_id`, owning `workspace_id` where applicable, role/type/source, relative file and thumbnail paths, format/size, origin `operation_id` (or compatible origin field), and retention/availability status. A referenced cross-workspace asset keeps its original owner.
- Operation/job execution records: canonical `operation_id`, `workspace_id`, operation/tool type, exact input asset and version, settings snapshot, execution status/progress/stage, persistence status, preview temp path, retained output asset ID/path, parent/regeneration reference, timestamps, worker ownership/heartbeat, and structured error fields. Adapt the existing job/queue record if it already carries these responsibilities.

`workspace_id`, `asset_id`, and `operation_id` must have explicit unique constraints. Add foreign keys/indexes based on actual query paths. Avoid a circular foreign-key design that makes legacy migration fragile. Keep the old `job_id`/`generation_jobs` shape as a compatibility adapter until all consumers are migrated.

### 8.5 Database and manifest authority; storage filename clarification

- Use exactly one authoritative SQLite database for this subsystem. Section 21's `storage/job_queue.db` is the agreed target layout example, while the earlier `database/for_mesh.db` example is historical. During implementation, first identify the live database. Continue using it if it is already authoritative; do not create `job_queue.db` beside it. Change the configured path/name only as an explicit, backed-up migration with every API/worker process updated together.
- SQLite is authoritative for records, queue/execution/persistence states, workspace/asset relationships, and the selected active asset. The workspace `metadata.json` is the one unified, recoverable manifest for workspace paths and saved-output/history presentation. It must be rebuildable from DB records plus verified files where possible.
- If `metadata.json` is stale or corrupt, preserve the workspace files, record a manifest-repair error, and rebuild it from the authoritative records; do not mark valid assets missing solely because the manifest write failed. If DB state is missing or ambiguous, do not infer success from the manifest alone.
- Use schema-versioned, forward-only migrations with a verified backup and a documented rollback/restore route. Migrations must be idempotent or safely detect that they already ran. Do not drop legacy columns/tables until the final cleanup gate passes.
- Do not store absolute paths, credentials, tokens, or secrets in DB settings or `metadata.json`.

### 8.6 Runtime authority and manifest projection rule

- SQLite is the runtime authority for workspace/asset/operation existence, ownership, execution and persistence state, active mesh selection, and relationships used to restore the UI. File bytes are verified on disk before an asset is shown as available.
- The single workspace `metadata.json` is a write-only/rebuildable projection for workspace organization and presentation/history compatibility. The UI and backend must not use it as an independent source of truth to decide whether an operation succeeded, an asset exists, a preview is saved, or which asset is active. Read the authoritative DB records and verify the referenced files; then render the UI.
- After a committed DB change, update `metadata.json` from the DB. If the manifest is missing, stale, corrupt, or cannot be written, preserve valid files and DB state, record a repair diagnostic, and rebuild it later. A manifest-only entry must never be treated as a valid asset.
- Keep the implementation within the existing database and schema/migration mechanism. The logical `workspaces`, `assets`, and operation relationships in Section 8.4 do not require separate new tables if the current schema can represent them safely. Add only the columns/indexes/constraints that are actually required; do not build a generic metadata platform or event-sourcing layer.
- A committed DB asset plus verified final file is sufficient for `persistence_status = saved`; a failed/stale `metadata.json` write is a manifest-repair condition, not a failed Keep. This specifically supersedes the phrase “consistent manifest” in Section 7.6 as a hard prerequisite for saved state. The manifest should be reconciled, but the UI/runtime must read the DB and verified file while repair is pending.
- Unique constraints must cover the canonical IDs in Section 4.8. Keep schema migration forward-only and backed up, but do not add distributed locking, replicas, or enterprise database infrastructure for this personal-use deployment.

## 9. Worker and Queue Design

### Minimal worker behavior

1. Start as one managed background process on the VPS.
2. On startup, run recovery for stale `processing` jobs left by a previous worker process.
3. Repeatedly look for the oldest `queued` job.
4. Claim it atomically so it cannot be processed twice.
5. Set `processing`, `started_at`, `updated_at`, and `heartbeat_at`.
6. Load the input asset by `input_asset_id`; resolve its stored path safely.
7. Invoke the existing generation pipeline.
8. Update progress/stage periodically when meaningful.
9. Save output to a temporary directory/file.
10. Validate the output; generate a thumbnail.
11. Atomically move output and thumbnail into final storage paths.
12. Insert the generated asset row and update the job to `completed` in a short DB transaction.
13. On exception, capture a useful error, clean/quarantine partial output, and set `failed`.
14. Continue to the next queued job.

### Queue behavior

- SQLite is the durable queue/source of truth.
- FIFO ordering by `created_at` (with a deterministic tie-breaker) is sufficient initially.
- Only one active worker should claim jobs in this deployment mode.
- The worker must use an atomic claim/transaction, not a separate `SELECT` followed much later by an unprotected `UPDATE`.
- A worker crash must not permanently strand a job in `processing`.
- The worker must not delete queued jobs just because the API or frontend restarts.

### Concurrency and deployment guard

The intended setup is one worker. Ensure the VPS process manager does not accidentally start duplicate worker processes. Use a process lock or an equivalent single-worker guard if needed. If the application later needs multiple workers, revisit queue claiming and database locking before enabling them; do not assume this single-worker plan automatically supports multi-worker execution.

---



### 9.1 Existing queue/worker reuse rules

The existing durable queue, scheduler, worker entry point, and process manager must be audited and reused. Treat `operation_id` as the identity of an execution item while retaining any legacy job ID fields required by existing callers. Do not add a second queue or scheduler to get operation semantics. If the current queue schema already supports the required payload and states, adapt it instead of creating a new queue table.

The existing worker must claim one queued operation atomically, capture its owner/lease, execute the current tool adapter, and write to its isolated temp directory. Progress updates must be monotonic where meaningful, bounded to the documented range, and accepted only from the current worker owner. A duplicate worker must fail its startup guard rather than process the same execution.

### 9.2 Execution isolation and ordering

- One active inference operation at a time remains the target VPS constraint unless the current code is already safely constrained another way.
- A temp directory is unique per `operation_id`/attempt and is never shared by concurrent executions.
- The queue uses the existing FIFO/order semantics; use a deterministic tie-breaker. Do not add priority scheduling unless it already exists and is required.
- A worker may process the next item only after the current execution has reached a durable terminal execution state and its cleanup/recovery information is recorded.
- If a worker dies, use startup/process ownership and heartbeat/lease evidence to mark only genuinely abandoned work as `interrupted`. Do not mark a live worker's operation interrupted because another API process restarted.

### 9.3 Worker error boundary

Catch failures at operation boundaries, classify them, save a stable error code and safe user message, retain detailed stack/context in server logs, and clean or quarantine only that execution's temp output. A failure in one operation must not terminate the worker loop or corrupt the next queued item. A DB failure while writing the terminal state must be surfaced and left recoverable; never report success to the UI before the durable state is committed.

### 9.4 Personal-use queue and single-worker safeguards

Keep the queue guard deliberately small:

- Run exactly one active generation worker in the intended VPS deployment. Reuse the current process manager and existing process lock/guard. A second worker must exit rather than compete for the same GPU/queue.
- Do not introduce distributed leases, Redis locks, a scheduler service, or a heartbeat service. For this single-worker deployment, a process lock plus worker ownership/claim record and controlled startup recovery is sufficient. Keep a heartbeat timestamp only if the existing code needs it to distinguish a live worker from abandoned work; an API restart alone must never mark a still-running worker interrupted.
- Keep a small configurable queue cap; default to at most **10 queued operations**. When the cap is reached, reject a new submission with a clear `QUEUE_FULL`/conflict response and leave all existing queue records untouched. The cap applies to waiting work, not the one currently processing.
- Deduplicate accidental repeated submissions while an identical request is queued/processing using the fingerprint `workspace_id + input_asset_id + operation_type + settings_hash`. An explicit user-triggered Regenerate is a new request and must create a new operation even when its parameters match a previous operation. Reuse an existing idempotency key if the application already has one.
- Configure a reasonable maximum runtime per operation using the existing settings/config pattern. A timeout must be recorded with a stable `TIMEOUT` error. Terminate inference only when the current pipeline runs in a separately killable process and cleanup can be confirmed. If it cannot be safely stopped, do not falsely mark it cancelled or release the worker while it is still using the GPU; wait for confirmed process exit, then record timeout/failure and recover its temp files.
- Keep FIFO ordering and one-at-a-time execution. Do not add priority queues, retry daemons, worker pools, or autoscaling for this personal-use project.

## 10. Frontend Behavior and UI Requirements

### 10.1 Upload

- User can upload images and meshes using the existing UI.
- Show upload progress and a clear error if upload fails.
- Do not treat a temporary browser `blob:` preview as the permanent asset record.
- After backend confirmation, use the returned canonical `asset_id` and persisted file/thumbnail URLs.
- Refresh the Assets panel from the backend-backed asset list.

### 10.2 Generate

- Generate is enabled only when a valid input image is selected and required settings are valid.
- Backend creates the job and returns `{ job_id, route_path, status }`.
- Frontend navigates to the returned route; it must not independently recalculate the short hash.
- Display the job state immediately, even while queued.
- Poll the job endpoint while the status is `queued` or `processing`.
- Stop polling on `completed`, `failed`, `interrupted`, or `cancelled`.

### 10.3 Reopening a route

When `/workspace/generate/<job_id>` loads or refreshes:

- Fetch the job by exactly `<job_id>`.
- Show a not-found state if the job does not exist.
- Show queued/progress UI if queued or processing.
- Show the generated mesh if completed and the output asset exists.
- Show the error and retry action if failed.
- Show interrupted/recovery UI if interrupted.
- Show cancelled state if cancelled.
- Never create a new job or re-run generation merely because the user refreshed or revisited the route.

### 10.4 Assets panel

- Load uploaded and generated assets from the backend asset list.
- Show each asset's name, type, thumbnail, and appropriate status/details.
- Generated assets must reference their `origin_job_id` or equivalent job association.
- Clicking a generated mesh navigates to `/workspace/generate/<origin_job_id>`.
- The route must exactly match the job ID stored in SQLite.
- Once the job workspace opens, its output asset is automatically loaded in MeshViewer.
- Clicking an uploaded mesh should continue to load that upload as an asset without inventing a generation job.
- Missing thumbnails should use a fallback placeholder and must not prevent mesh loading.

### 10.5 MeshViewer

- Viewer should load by canonical `asset_id` / safe backend asset URL, not infer file identity from a route slug.
- The job route resolves the job first, then supplies its output asset to the viewer.
- Protect against stale requests when users switch assets: abort or ignore old requests and prevent an old response from replacing the currently selected mesh.
- Fetch timeout must cover response-body reading as well as waiting for response headers.
- A failed download or parse must produce an error state, not an infinite `Loading mesh` state.
- Keep local blob preview only as an intentional temporary fallback before server persistence is confirmed; do not silently switch to a broken URL without visible error handling.

---



### 10.6 Active mesh, preview and retained versions

The frontend must maintain distinct state for:

- **Active Mesh**: the saved `asset_id` currently selected in the workspace and used as the default input for the next operation.
- **Preview Mesh**: the verified output from the currently completed but unretained operation. It may be displayed in MeshViewer but is not a permanent asset and does not replace the saved Active Mesh.
- **Saved Mesh Versions**: all valid retained mesh outputs registered to the workspace. Only these are offered by Mesh Versions.

During a preview, the viewer may display the preview with clear preview state and **Keep in Workspace**, **Regenerate**, and **Discard Preview** actions. On Keep success, the retained asset becomes active by default and the selector refreshes. On Discard, restore the last valid saved active mesh. On Keep failure, preserve the preview when possible, keep the prior active mesh, and show a retryable persistence error.

### 10.7 Mesh Versions and input selection

- Hide Mesh Versions when only the base/source/raw mesh exists and no additional retained mesh output exists.
- Once at least one derived mesh is retained, show the base mesh plus every valid retained mesh version, populated from backend records/manifest rather than hardcoded tool names.
- Selecting a version loads that exact `asset_id`, updates the workspace's active mesh reference, and leaves the workspace route unchanged. If loading fails, retain the last valid viewer state and show the error.
- Every tool page defaults to the selected Active Mesh and visibly identifies the input asset. Allow selection of another saved mesh in the same workspace. Do not silently choose the latest modified folder or a filename match.
- If the input comes from another workspace, show that ownership/reference clearly. Do not copy, move, or change ownership without an explicit import/copy action.

### 10.8 Preview and UI race handling

A preview response is associated with its `operation_id`; ignore late responses from superseded operations or changed workspace routes. Poll only while execution is non-terminal, and poll persistence separately while Keep is saving if needed. Stop timers/requests on route changes and unmount. Preserve the selected active asset if a background operation completes after the user navigates to another mesh.

### 10.9 Polling interval and visibility behavior

Use simple HTTP polling; do not add WebSockets for this scope:

- Poll queued/processing execution state every **1.5 seconds** initially. If an operation is still running after **2 minutes**, back off to **5 seconds**. Keep these values configurable in one frontend constant.
- Pause polling while the document/tab is hidden and resume immediately when it becomes visible again; fetch the latest state on resume.
- Stop execution polling on `completed`, `failed`, `interrupted`, or `cancelled`. If the user presses **Keep in Workspace**, run a separate persistence-status poll only while it is `saving`; stop on `saved`, `save_failed`, `discarded`, or `cleanup_pending` with a visible status.
- Abort in-flight requests and clear polling when the workspace route changes or the page component unmounts. Ignore late responses from a previous workspace/operation. Do not run multiple overlapping polls for the same operation.

### 10.10 Global Workspaces gallery

Add a lightweight **Workspaces** gallery as the global entry point. This is separate from the workspace-local Assets panel:

- Show one card per workspace with its workspace thumbnail (or a neutral placeholder), display name, latest known status, last-updated time, and count of retained mesh versions.
- Sort by most recently updated by default. Provide a simple name search and basic sort only if the existing UI patterns make them inexpensive; use pagination or a small page limit only when the actual workspace count requires it. Do not build a complex catalog/search service.
- Clicking a card opens `/workspace/generate/<workspace_id>` and restores that workspace. It must not start generation or open a nested tool route.
- Keep the existing **Assets** panel scoped to the current workspace. It lists that workspace's source and retained assets; it is not a cross-workspace file browser.
- A cross-workspace asset can be used only through an explicit reference/import choice. Show its source workspace/owner. A reference preserves original ownership; an explicit copy/import creates a new local asset record and copies bytes into the destination workspace. Never silently move or duplicate an asset.

### 10.11 UI component and interaction specification

Keep the interface compact and consistent with the existing application. Reuse the CSS variables/design tokens and existing patterns documented in `Docs/DESIGN.md` (or the repository's actual design guide); do not invent a separate theme or hardcode a second set of colors, fonts, radii, spacing, or shadows.

| UI area | Required presentation and behavior |
|---|---|
| Operation status chip/banner | Pair an icon with readable status text; use an accessible live region for meaningful state changes. Show stage/progress when available and queue position only when the backend actually knows it. Show only recovery actions valid for the current state. |
| Preview action bar | Dock near the bottom of the viewer on desktop and remain reachable on mobile. Show **Keep in Workspace**, **Regenerate**, and **Discard Preview** when applicable. Clearly label the result as an unsaved preview. While saving, disable duplicate Keep and show the saving state; on failure, keep the preview where possible and offer a retry. |
| Mesh Versions selector | Use a compact dropdown on larger screens and a bottom sheet/list on mobile. Show available retained versions with meaningful names/thumbnails, identify the active version, and disable or explain missing/invalid entries rather than silently substituting another asset. |
| Workspace-local asset cards | Use a square/1:1 thumbnail or fallback, asset name/type, saved/preview/error badge as appropriate, and a small overflow menu only for actions that exist. Show upload progress and errors without treating browser blob previews as saved assets. |
| Viewer overlays | Provide explicit loading, parse/download error, retry, missing-file/integrity error, and expired-preview states. Never leave an infinite spinner or silently replace the current valid mesh. |
| Toasts/notifications | Use brief success/error feedback for upload, Keep, Discard, and workspace actions. Persistent failures remain visible in the relevant panel/banner; a toast is not the only record of an error. |
| Tool Input card | Show the selected input mesh/image name and thumbnail, its workspace ownership when external, and a clear Change input action. Changing input affects only a newly submitted operation, never one already queued/running. |
| Workspaces gallery card | Show workspace thumbnail/fallback, name, status, updated time, and retained mesh-version count; the whole card opens the workspace route. |

Accessibility and motion: make controls keyboard reachable with visible focus; provide accessible names for icon-only buttons; do not rely on color alone to convey state; use readable contrast; respect reduced-motion preferences; and announce meaningful state changes without repeatedly announcing every polling tick.

### 10.12 Frontend state dimensions and state-to-UI mapping

Do not collapse unrelated concepts into one frontend `status` variable. Keep these dimensions distinct, using the existing state store/components where possible:

- `executionState`: `queued`, `processing`, `completed`, `failed`, `interrupted`, `cancelled`.
- `persistenceState`: `not_saved`, `saving`, `saved`, `save_failed`, `discarded`, `cleanup_pending`, `preview_expired`.
- `workspaceViewState`: `loading`, `ready`, `empty`, `not_found`, or a gallery view.
- `viewerLoadState`: `idle`, `loading`, `ready`, `error`, `expired`.

| Combined condition | UI meaning |
|---|---|
| queued / processing | Show operation status and progress; keep the last saved Active Mesh identifiable. |
| completed + not_saved | Show an unsaved Preview Mesh and the preview action bar; do not list it in permanent Assets/Mesh Versions. |
| completed + saving | Keep preview visible where possible; lock duplicate Keep and show persistence progress. |
| completed + saved | Show the retained asset as a saved mesh version; update Active Mesh only after the commit succeeds. |
| failed / interrupted / cancelled | Show a terminal execution state and the appropriate recovery/Regenerate action; do not expose partial output. |
| save_failed | Keep the prior Active Mesh; preserve the preview when possible and allow Keep to be retried. |
| discarded / preview_expired | Restore the last valid saved Active Mesh; show that the preview is unavailable and offer Regenerate where valid. |
| workspace not_found | Show a clear not-found state; never create a replacement workspace as a side effect. |
| viewer error | Retain the last valid viewer state where possible and show a retryable error. |

`completed` describes execution only. `saved` describes persistence only. `ready` describes the workspace/viewer presentation state. These words must not be treated as interchangeable.
## 11. API Shape (Proposed)

These are logical API contracts, not a mandate to break/replace all current endpoint URLs. During migration, existing routes should remain supported or be adapted internally.

| Operation | Example endpoint | Purpose |
|---|---|---|
| Upload asset | `POST /api/v1/assets/upload` | Save image/mesh and create asset record |
| List assets | `GET /api/v1/assets` | Return uploaded/generated assets and thumbnails |
| Get asset | `GET /api/v1/assets/{asset_id}` | Return asset metadata |
| Download asset | `GET /api/v1/assets/{asset_id}/file` | Safely stream the stored file |
| Asset thumbnail | `GET /api/v1/assets/{asset_id}/thumbnail` | Safely stream the thumbnail |
| Create job | `POST /api/v1/jobs` | Create durable queued job from input asset |
| Get job | `GET /api/v1/jobs/{job_id}` | Return full job state and input/output asset metadata |
| Retry job | `POST /api/v1/jobs/{job_id}/retry` | Requeue eligible existing job using the same ID/route |
| Cancel job | `POST /api/v1/jobs/{job_id}/cancel` | Cancel queued or safely cancellable job |

### Create-job response example

```json
{
  "job_id": "rabbit_a8f32c",
  "route_path": "/workspace/generate/rabbit_a8f32c",
  "status": "queued"
}
```

### Completed-job response example

```json
{
  "job_id": "rabbit_a8f32c",
  "route_path": "/workspace/generate/rabbit_a8f32c",
  "status": "completed",
  "progress": 100,
  "input_asset": {
    "asset_id": "ast_input_001",
    "name": "rabbit.png",
    "type": "image",
    "thumbnail_url": "/api/v1/assets/ast_input_001/thumbnail"
  },
  "output_asset": {
    "asset_id": "ast_output_001",
    "name": "rabbit",
    "type": "mesh",
    "format": "glb",
    "thumbnail_url": "/api/v1/assets/ast_output_001/thumbnail",
    "file_url": "/api/v1/assets/ast_output_001/file"
  }
}
```

### Failed-job response example

```json
{
  "job_id": "rabbit_a8f32c",
  "route_path": "/workspace/generate/rabbit_a8f32c",
  "status": "failed",
  "progress": 0,
  "error_code": "GENERATION_FAILED",
  "error_message": "A readable failure message for the UI"
}
```

Do not expose internal absolute VPS paths in API responses. Return safe asset URLs and metadata. The database may retain relative storage paths internally.

---



### 11.1 Endpoint reuse is mandatory; endpoint list is not a build list

Before adding or renaming any API route, inspect the actual repository and produce an endpoint inventory containing HTTP method, path, router/module, request/response schema, frontend callers, backend callers, auth/dependencies, logs/usage evidence, and behavior. **Reuse the endpoint that already performs the required capability.** Refactor its internal implementation to call the new workspace/operation services while preserving its URL, method, status codes, and response fields where clients depend on them.

The examples in the table above are logical capabilities only. They do not authorize creating duplicate `/assets`, `/jobs`, `/operations`, `/workspace`, or `/api/v1` routes when the project already has a suitable endpoint or a different established API prefix. Do not create a new route just to make names look cleaner. Do not rename existing public endpoints in this migration unless there is a proven conflict and a compatibility path is implemented.

### 11.2 Naming rules when a genuinely new endpoint is required

If the audit proves a capability has no suitable existing endpoint, follow the repository's established prefix, versioning, plural resource naming, auth, error, and response conventions. Use resource-oriented names and explicit action suffixes only for state transitions. The following are logical examples, not mandatory paths:

| Missing capability | Logical contract example |
|---|---|
| Read workspace | `GET /.../workspaces/{workspace_id}` |
| Read saved workspace assets/versions | `GET /.../workspaces/{workspace_id}/assets` |
| Set active saved mesh | `PATCH /.../workspaces/{workspace_id}/active-mesh` |
| Create/queue a tool execution | `POST /.../workspaces/{workspace_id}/operations` |
| Read operation execution | `GET /.../operations/{operation_id}` |
| Retain a completed preview | `POST /.../operations/{operation_id}/keep` |
| Regenerate an operation | `POST /.../operations/{operation_id}/regenerate` |
| Discard a preview | `POST /.../operations/{operation_id}/discard` |

Use the existing tool-specific endpoint when it already queues Texture, Segmentation, Retopology, UV, Editing, Rigging, Animation, or Generate work. It should call the shared operation execution path internally rather than create a competing generic endpoint solely for architecture symmetry. Keep **Keep in Workspace** distinct from file download.

### 11.3 API response and error contract

Preserve old response shapes where existing frontend/clients rely on them. New or extended responses should expose explicit `workspace_id`, `asset_id`, and `operation_id` fields as relevant; do not overload one ambiguous `job_id` field to mean different things on different layers. If a legacy field must remain, document its legacy meaning and map it in one adapter. Do not expose absolute storage paths, traceback text, model secrets, or internal host details.

Use the project's existing error envelope if one exists. Otherwise use one consistent structured shape with a stable machine-readable `code`, safe `message`, `retryable` boolean, and relevant `workspace_id`/`operation_id`/`request_id` fields. Validation, not-found, conflict/state-transition, unsupported-operation, storage, database, queue, timeout, and inference failures must be distinguishable. Return appropriate HTTP semantics consistently; do not return HTTP 200 with an error-shaped body.

### 11.4 Endpoint deprecation/removal gate

An endpoint may be removed only after all of the following are evidenced:

1. Repository search covers frontend calls, backend internal calls, routers mounted indirectly, generated clients, tests, scripts, CLI, cron/systemd/service configuration, deployment files, documentation, dynamic imports/dispatch, and known external integrations.
2. Usage telemetry/access logs cover at least one meaningful full usage/maintenance cycle. If logs/telemetry are unavailable or dynamic/external use cannot be ruled out, 0% observed usage is **not** proof of zero use; keep the endpoint or deprecate it first.
3. A replacement exists and is verified, or the capability is deliberately retired with an explicit decision.
4. Compatibility/deprecation behavior and release/documentation notes are in place where old clients or links may exist.
5. Regression tests pass and rollback is available.

Do not remove an endpoint merely because no current UI button calls it, because its route name is old, or because a quick grep returns no references.
## 12. VPS Restart and Recovery Behavior

The system must behave predictably after a VPS restart or process crash.

### Startup sequence

```text
VPS / PROCESS STARTS
        │
        ▼
OPEN SQLITE + VALIDATE SCHEMA
        │
        ▼
CHECK STORAGE ROOT IS AVAILABLE / WRITABLE
        │
        ▼
RECOVER JOBS LEFT IN processing
        │
        ├── Mark as interrupted (do not claim success)
        ├── Preserve original job_id and route_path
        └── Preserve input asset and settings
        │
        ▼
START SINGLE WORKER
        │
        ▼
PROCESS queued jobs
        │
        ▼
API SERVES EXISTING ASSETS / JOBS
```

### Recovery rules

- `queued`: keep queued; process when the worker is ready.
- `processing`: if the previous worker is confirmed dead at controlled startup, mark `interrupted`.
- `completed`: keep completed; verify the referenced file exists when loading the job. If missing, report an integrity error rather than pretending it is healthy.
- `failed`: retain error and allow manual retry.
- `interrupted`: retain the same route and allow manual retry.
- Partial temporary output: clean it or move it to a clearly marked quarantine directory. Never publish it as a valid asset.

For a one-worker deployment, startup recovery can be straightforward. If later running more than one worker or more than one backend instance, add a proper worker lease/heartbeat strategy before changing the deployment model.

---



### 12.1 Workspace, operation and manifest recovery

On startup, in addition to the legacy job recovery above:

- Verify the configured storage root and the one authoritative DB are readable/writable before accepting new writes. Do not silently create a second DB when the configured DB is unavailable.
- Reconcile `saving` operations against their temp/final files and DB asset records. Complete a publication only when all required evidence is valid; otherwise return the operation to `save_failed`/repairable state and keep the previous active mesh.
- Rebuild or repair a stale/missing workspace `metadata.json` from authoritative DB records and verified workspace files. Write it atomically and retain a recoverable diagnostic if repair fails.
- Verify saved asset paths before presenting them in Mesh Versions. A missing asset is an integrity error; never silently substitute a different version.
- Clean abandoned `storage/temp/` directories only after proving they are not owned by a live worker and are not referenced by an active preview/operation. Use bounded age/ownership rules and log cleanup outcomes.
- Preserve `queued` work. Mark `processing` as `interrupted` only after confirming the owning worker is no longer alive/leased. Do not automatically run expensive inference again during route load or startup unless an explicit recovery policy says so.

A successful DB commit followed by a manifest-write failure remains a saved DB asset; the manifest is repaired. A file published before a failed DB commit is an unregistered orphan and must be reconciled/quarantined, never displayed as a saved asset.
## 13. Safety, Data Integrity, and Reliability

### File safety

- Validate extension, MIME type, and basic file signature where practical.
- Enforce configurable upload size limits.
- Generate storage filenames/IDs on the backend; do not use raw user filenames as directory paths.
- Normalize display names separately from storage paths.
- Reject path traversal and any resolved path outside the storage root.
- Avoid serving arbitrary local paths requested by the browser.
- Use temporary writes and atomic finalization.
- Verify generated mesh existence and non-zero size before marking a job completed.
- Treat thumbnails as optional presentation metadata; a missing thumbnail must not corrupt the asset record or block the model viewer.

### Database safety

- Use transactions for job claiming and final completion updates.
- Keep transactions short; never wrap model inference in a database transaction.
- Enforce unique `asset_id`, `job_id`, and `route_path` values.
- Enable foreign keys and validate relationships.
- Use parameterized SQL/ORM queries.
- Store timestamps consistently in UTC.
- Handle SQLite busy/locked errors with bounded retry/backoff where appropriate; do not silently drop state changes.

### Backup and restore

The DB and files are a pair. Backing up only SQLite is not enough because the DB references files on disk.

Minimum backup set:

- SQLite database using SQLite-safe backup/checkpoint procedure.
- Upload storage directory.
- Generated output directory.
- Thumbnail directory.

A restore check should verify that database asset paths resolve to existing files. Keep at least one backup outside the VPS disk if the data matters.

### Privacy and deployment

If the VPS is publicly accessible, protect upload/generation endpoints as appropriate for the intended audience. Apply request size limits at both the reverse proxy and backend. Do not expose storage directory listings or absolute paths. Keep model/runtime secrets out of job settings and logs.

---



### 13.1 Error handling matrix and invariants

Every upload, queue, tool execution, preview, retention, viewer load, and recovery path must have an explicit failure outcome. Reuse existing error utilities; do not scatter broad silent `except` blocks. At minimum handle:

| Failure class | Required system behavior | Client behavior |
|---|---|---|
| Invalid/unsupported input or missing prerequisite | Reject before queueing; preserve existing workspace | Field/tool-specific validation message; no job/operation created |
| Missing/deleted input asset or unsafe path | Stop before inference; record a stable error if already queued | Explain which selected input is unavailable; never substitute |
| Queue/DB busy or unavailable | Bounded retry for transient lock errors; otherwise leave durable state recoverable | Retryable service error; no false accepted/success response |
| Worker crash/timeout/interruption | Mark abandoned execution `interrupted` after ownership check; retain temp evidence safely | Show interrupted state and Regenerate/recovery action |
| Model/inference/tool failure | Record error code and safe message; isolate and clean/quarantine that execution's temp output | Show failed state; retain prior saved mesh |
| Invalid/empty/corrupt output | Do not expose preview or publish; record validation failure | Explain output validation failed |
| Disk full/permission/read-only storage | Stop writes; retain previous assets; mark operation/upload failed or save_failed; do not fall back to `/root` or another unconfigured path | Actionable storage error; no false success |
| Thumbnail generation failure | Keep mesh bytes valid; store thumbnail as unavailable/failed and show fallback; retry thumbnail generation separately where supported | Mesh remains loadable; fallback thumbnail and non-blocking warning |
| Atomic publish/rename failure | Keep previous output and active mesh; preserve preview if possible; mark `save_failed` | Offer retry Keep; do not show as saved |
| DB commit/manifest update failure | DB transaction rolls back or remains in recoverable `saving`; repair manifest from DB after commit | Show pending/failed persistence, never falsely show saved |
| Viewer fetch/parse failure | Abort stale fetch; retain last valid viewer state | Visible error and retry, never infinite loading |
| Duplicate request/concurrent selection | Deduplicate or bind each operation to its immutable snapshot | No duplicate operation or unexpected input switch |

### 13.2 Error representation and logging

- Use stable error codes and a retryability classification. User-facing messages must be actionable but must not disclose filesystem paths, credentials, stack traces, or internal server details.
- Log full diagnostic context server-side with `workspace_id`, `operation_id`, attempt, tool, error code, stage, and request/worker correlation ID where available. Redact secrets, tokens, private user data, and sensitive model/runtime configuration.
- Distinguish expected validation/cancellation from unexpected exceptions. Do not log normal user cancellation as an unhandled server failure.
- A caught exception must lead to a durable state update or an explicit recoverable DB-write failure. Never swallow errors and continue as though the operation succeeded.
- Use bounded retries/backoff only for known transient operations (e.g. SQLite busy). Do not automatically retry deterministic invalid-input or model failures forever.
- Cleanup failures must be recorded as cleanup-pending and retried safely; cleanup must be scoped to the owning temp execution ID.

### 13.3 Safe Keep/Publish transaction

Because filesystem rename, SQLite commit, and JSON manifest write cannot be one atomic transaction, use a recoverable publication protocol:

1. Verify the completed preview and all required resource files.
2. Persist a `saving`/publish-intent state in SQLite before changing permanent visibility.
3. Create required tool directories lazily and choose a collision-safe immutable filename/version.
4. Atomically move files from temp to final storage on the same filesystem; use a staging/rollback or quarantine strategy if multiple files must be published together.
5. In a short SQLite transaction, register the new asset, its owner/lineage, active selection (if defaulting to the new output), and `persistence_status = saved`. Do not expose it before this commit.
6. Atomically rebuild/update the single workspace `metadata.json` from committed records. If this step fails, leave the DB asset saved and queue/record manifest repair; do not create a second metadata file.
7. Clean temp files only after successful publication and durable registration.

If publication fails before the DB commit, quarantine/remove only the newly published files and restore the operation to `save_failed`; previous retained files remain untouched. If a crash happens between steps, startup recovery must deterministically finish or roll back based on the publish-intent record and actual file validation.

### 13.4 Safe versioning and deletion

Never overwrite a retained asset filename. Use a stable latest pointer in metadata/DB plus version-safe filenames (for example `_v002`) or an equivalent immutable version scheme. Keep the old version and its asset ID. No operation may delete an asset used as an input, selected as active, referenced by an operation history record, or included in a retained version list. Any future user-facing delete action must validate dependencies, require explicit confirmation, and update DB/manifest/files in a recoverable order.

### 13.5 Personal-use disk lifecycle, trash, and storage visibility

Use one bounded cleanup routine; do not add a separate maintenance service:

- Default unretained-preview TTL is **24 hours** from successful preview creation. Keep the TTL configurable in the existing application settings. Clean expired previews at worker/API startup after ownership checks and once per day while the application is running. If the application has no scheduler, run the daily check from the existing worker's simple maintenance loop; do not add another scheduler process.
- Before deleting a temp directory, verify that no live worker owns it and no queued/running/saving operation or restorable preview references it. Never delete a retained asset, an input, the active mesh, or any file referenced by a retained operation. Record cleanup failures as `cleanup_pending` and retry safely.
- When a preview expires, keep its operation/history record, set persistence/preview state to `preview_expired`, restore the last valid saved Active Mesh, and show a clear expired-preview message with Regenerate where valid. Do not imply that the preview was saved.
- If workspace deletion is exposed, require explicit confirmation and check dependencies first. Do not delete a workspace that is still referenced as an input/owner or contains the active/source asset of another live workspace. Prefer moving the workspace directory into a single storage-level `.trash/` location on the same filesystem, recording it as trashed, and purging it after **7 days**. Restore should be possible during that period. Do not make trash a nested workspace/tool directory. If a safe trash workflow is not implemented, omit permanent delete rather than performing unsafe recursive deletion.
- Show a simple total storage-used value (and, when readily available, free disk space) in an existing settings/status area. This is visibility, not a new quota/tenant system. Give a useful low-disk warning; do not automatically delete user assets to reclaim space.
- These defaults are appropriate for a personal VPS and can be changed from one configuration location. No enterprise retention policy, legal hold, multi-tenant quota, or external monitoring stack is required.

## 14. Safe Migration Plan — Do Not Break Existing Functionality

**Do not rewrite the current scheduler, storage, upload, routes, and viewer in one step.** The current dev branch already has working code paths and existing data conventions. First introduce the target model alongside them, then migrate consumers incrementally.

### Phase 0 — Audit and baseline (no behavior changes)

- Map every current upload endpoint, upload storage path, FileStore use, manifest reader/writer, generated result path, job API, queue implementation, and viewer URL resolver.
- Identify every use of `local_`, `upload_`, `job-`, UUIDs, `routeShortId`, `fileId`, and route parsing.
- Identify all consumers of current job DB schema and current asset metadata.
- Record existing API response shapes and routes used by the UI.
- Add regression tests or fixtures for current upload, generation, result loading, and deep-link behavior.
- Do not delete or rename any existing data directory.

### Phase 1 — Introduce canonical records compatibly

- Add/migrate the `assets` and `generation_jobs` schema using versioned database migrations.
- Keep existing job tables/fields required by current code until all consumers have been migrated.
- Add compatibility adapters that map existing upload/job records into canonical asset/job responses.
- Backfill records only when identity and file paths can be verified.
- Never invent a path for a missing file. Mark unresolved legacy data clearly for review.
- Preserve existing manifests and FileStore registration while the new asset records are introduced.

### Phase 2 — Canonical upload and asset reads

- Update upload flow to create a canonical asset row after the file is safely written.
- Keep the existing upload endpoint working; it can call the new internal asset service.
- Update asset listing/details to return canonical `asset_id` and safe file/thumbnail URLs.
- Ensure old uploaded files remain loadable through compatibility resolution.
- Verify both image and mesh upload before changing generation behavior.

### Phase 3 — Stable job creation and route

- Make the backend the only creator of the final job ID.
- Create and persist `job_id` plus matching `route_path` before queuing work.
- Return `{ job_id, route_path, status }` to the frontend.
- Update the frontend to navigate using the returned route, never recomputing the suffix/hash.
- Make deep-link lookup fetch the job by canonical `job_id`.
- Keep old route patterns resolving through a compatibility layer or redirect until old links are no longer needed.

### Phase 4 — Simplify execution to one persistent worker

- First confirm the current generation pipeline can be called safely from one dedicated worker.
- Add SQLite-backed FIFO claiming with atomic state transitions.
- Keep only one active worker in the intended VPS deployment.
- Keep the current scheduler/queue API as an adapter while frontend and model integrations move over.
- Do not remove Redis code or old queue classes until tests prove there are no remaining runtime/import/configuration dependencies and the deployment no longer uses them.
- Add startup recovery for stale `processing` jobs.

### Phase 5 — Persist generated output as an asset

- Save generated mesh and thumbnail under a stable job-specific output directory.
- Validate output before publishing it.
- Create an `assets` record for the generated mesh.
- Set `output_asset_id` and `status = completed` in one short, consistent completion transaction.
- Ensure result APIs return the output asset metadata and safe URLs.
- Keep old job download URLs working until the new asset route is fully adopted.

### Phase 6 — Assets panel and MeshViewer restoration

- Load the Assets panel from canonical asset records.
- Show thumbnails and distinguish uploaded from generated assets.
- Store/use generated asset → originating job relationship.
- On generated asset click, navigate to its exact original job route.
- On job route load, fetch job and automatically load its output asset when completed.
- Fix loading timeout/body-read behavior and abort/ignore stale viewer requests.
- Verify direct URL refresh and browser back/forward navigation.

### Phase 7 — Cleanup only after verification

- Search for every remaining caller of legacy ID mapping and route generation helpers.
- Remove duplicate state only after all consumers use canonical records.
- Remove Redis/multi-worker infrastructure only if it is truly unused in deployment, tests, scripts, and configuration.
- Retain migrations and compatibility for old data/links for an agreed period.
- Do not remove old storage directories until DB records and file existence have been reconciled and a backup verified.

---



### 14.1 Required audit and refactor sequence

The migration must be implementation-led by the actual dev-branch code, not by assumed module names. First map the existing endpoints, response contracts, queue/job database, worker and scheduler entry points, recurring/background routines, storage/FileStore/manifest ownership, viewer resolution, and all callers. Build a behavior map before editing.

Refactor the current implementation in place: preserve endpoint entry points and adapt their internals to the workspace/operation services. Reuse the existing worker/queue and model adapters. Keep legacy IDs and storage records readable through compatibility adapters. Do not build a second endpoint stack, queue, scheduler, storage hierarchy, or API client just to match this plan's terminology.

### 14.2 Revised migration sequence and gates

Follow the five implementation batches in Section 23. The ordering is mandatory: audit/baseline first; data model and storage foundation second; operation state/worker/recovery third; API and UI integration fourth; regression, legacy cleanup, documentation and deployment verification last. Do not start a later batch before the previous batch's acceptance gate passes and the user explicitly continues.

Within each batch, use additive migrations and compatibility adapters first. Migrate one caller/workflow at a time. Keep old storage readable and old routes/endpoints working until there is evidence that all consumers have moved. Back up both DB and files before migrations or destructive cleanup.

### 14.3 Cleanup gate for old jobs, endpoints, routines and files

Remove a legacy item only when its exact responsibility is superseded, all callers/dependencies are migrated, runtime/config/test/deployment references are checked, meaningful usage evidence supports retirement, required data is migrated/backed up, and regression tests pass. This applies equally to endpoints, queue classes, scheduler routines, background tasks, adapters, helper functions, configuration keys, imports, and files.

Do not interpret `0%` observed request count as sufficient proof when telemetry coverage is missing, the usage window is too short, or external/dynamic use is possible. Deprecate and observe first. Never delete model weights, user assets, migrations, historical data, or files whose purpose cannot be established merely to make the tree smaller.

### 14.4 Mapping the original phases to the five-batch execution plan

The original Phase 0–7 descriptions above are retained as historical task detail. For actual sequencing and stop gates, Section 23 is authoritative. Use this mapping so the two descriptions are not treated as competing schedules:

| Original phase(s) | Current batch | Interpretation |
|---|---|---|
| Phase 0 | Batch 1 | Read-only audit and baseline |
| Phases 1–2 | Batch 2 | Canonical identity, schema, upload, ownership and storage foundation |
| Phases 4–5 | Batch 3 | Existing worker/queue, operation lifecycle, and retained output behavior |
| Phase 3 and Phase 6 | Batch 4 | Stable route/deep-link plus Assets panel and MeshViewer integration |
| Phase 7 | Batch 5 | Regression, cleanup, documentation and deployment verification |

Do not execute the original phase list as a second schedule. Batch acceptance and the explicit Continue stop rule in Section 23 govern progression.

## 15. Testing and Acceptance Criteria

Do not consider this architecture complete just because a job can generate once. The following must pass.

### Upload tests

- Upload a supported image; verify file exists in VPS storage and asset row exists in SQLite.
- Upload a supported mesh; verify file exists and asset row exists.
- Verify the original filename is metadata only and cannot escape the storage root.
- Verify invalid file types and oversized uploads are rejected cleanly.
- Verify the Assets panel refreshes and thumbnails/file URLs load.
- Verify failed upload does not leave a false successful asset record.

### Job creation tests

- Generate from a valid uploaded image.
- Verify one job row is created before inference starts.
- Verify `job_id` exactly matches the last segment of `route_path`.
- Verify opening the returned route loads the same DB job.
- Verify duplicate/short-hash collision is handled by generating a new unique ID.
- Verify invalid/missing input asset cannot create a runnable job.

### Generation tests

- Verify status transitions: queued → processing → completed.
- Verify progress/stage updates do not corrupt job state.
- Verify output mesh is saved and validated.
- Verify thumbnail is saved and the generated asset row is created.
- Verify `output_asset_id` points to the correct generated asset.
- Verify completed job and output can be loaded after page refresh.

### Failure and recovery tests

- Force a generation error; verify status becomes failed with useful error details.
- Verify failed job route remains valid and input image remains available.
- Retry the failed job; verify same `job_id` and same route are retained.
- Stop the worker during processing; restart it; verify the old job becomes interrupted, not completed.
- Verify queued jobs survive API/worker restart.
- Verify completed jobs survive VPS process restart and load the same output mesh.
- Verify partial files are not exposed as completed assets.

### Assets panel and viewer tests

- Generated mesh appears in the Assets panel with its stored thumbnail.
- Clicking it opens the exact original job route.
- MeshViewer automatically loads that generated mesh.
- Directly opening the job URL in a fresh browser tab works.
- Refreshing the same URL restores the same job/result.
- Clicking another asset updates both selection and route correctly.
- Old in-flight viewer fetches cannot replace a newly selected mesh.
- A stalled download eventually errors/times out instead of spinning forever.
- Uploaded meshes still load even though they have no generation job.

### Migration regression tests

- Existing uploaded meshes remain listed and downloadable.
- Existing generated jobs/results remain accessible.
- Existing saved routes continue to resolve or are redirected through a compatibility path.
- Existing manifests and FileStore metadata are not orphaned during rollout.
- Existing generation pipelines, model weights, and inference behavior are unchanged by the persistence/route refactor.

---



### 15.1 Additional state-machine and failure tests

Add tests for all allowed and rejected execution/persistence transitions in Section 7, including stale worker updates, double Keep, Keep after Discard, Regenerate after a terminal operation, cancel/claim races, and a worker crash during each publication boundary. Verify no invalid transition can expose an unsaved output.

Exercise at least: disk full, read-only/permission denied storage, SQLite busy/locked, DB unavailable, corrupt/missing input, invalid model output, thumbnail failure, atomic rename failure, manifest write failure, duplicate form submission, timeout, and cleanup failure. Assert that prior saved meshes, active selection, and route identity remain intact.

### 15.2 Operation, ownership and version tests

- Run two different operations against the same workspace and prove each uses its captured input asset and isolated temp path.
- Change Active Mesh after an operation starts and prove the running execution still uses its original input snapshot.
- Upload an unrelated mesh while a workspace is open and prove it creates another workspace without changing the first.
- Select an older saved version and verify the next tool uses that exact version.
- Verify Regenerate creates a new `operation_id`, reuses the exact input/settings by default, and preserves all previously retained outputs.
- Verify Keep creates a version-safe new asset and updates the active selection only after successful publication.
- Verify Discard does not create tool directories, asset rows, or Mesh Versions entries.
- Verify Mesh Versions is hidden for raw-only workspaces and lists only valid, retained outputs once a derived mesh is kept.
- Verify cross-workspace references preserve source ownership and never silently duplicate or move files.

### 15.3 API compatibility, cleanup and documentation tests

- Test existing endpoint methods, paths, status codes, auth, and response fields against captured baseline contracts. Prove a capability is not exposed through duplicate new and old routes.
- Test old workspace URLs and legacy records through compatibility adapters. Test endpoint deprecation/removal only after the audit gate is satisfied.
- Test that every removed file/routine has no remaining static or dynamic import, runtime, script, CI, deployment, test, or documentation dependency.
- Review README and all relevant Markdown instructions for accurate endpoint names, workspace/operation terminology, storage layout, state machines, errors, and batch protocol.

### 15.4 Focused regression tests for the integrated clarifications

Add these high-value cases to the existing suites rather than creating a separate testing framework:

- Force a `workspace_id`, `asset_id`, or `operation_id` collision; verify the backend retries with a new ID and never reuses another record/directory.
- Verify a started terminal operation is immutable and Retry/Regenerate creates a new `operation_id` with the same workspace route, input snapshot, settings snapshot, and parent reference. Verify a never-claimed queue item can be safely requeued without inventing an execution attempt.
- Regenerate the initial image-to-mesh result; verify a new base-mesh version is retained, the old base remains selectable, and Active Mesh changes only after commit.
- Verify thumbnail failure does not block completion, Keep, asset visibility, or viewer loading.
- Verify the DB remains authoritative when `metadata.json` is missing, corrupt, stale, or cannot be written; verify the manifest is rebuilt from DB plus checked files. A manifest-only phantom asset must not appear.
- Verify atomic single-worker claim, duplicate-worker startup refusal, queue cap behavior, accidental identical-request deduplication, and explicit Regenerate bypassing the dedupe fingerprint.
- Restart the API while the worker remains alive; verify the live operation is not marked interrupted. Restart after the worker is dead; verify only abandoned work is recovered. Exercise operation timeout without falsely releasing a still-running inference process.
- Verify 1.5-second polling, 5-second backoff after two minutes, hidden-tab pause/resume, terminal stop, and abort on route change/unmount.
- Verify a global Workspaces card opens its workspace route, while selecting an asset inside a workspace changes only Active Mesh and does not change the route.
- Verify preview TTL cleanup, preview-expired UI, trash/restore/purge safeguards (if deletion is implemented), path traversal rejection, original file-byte/extension preservation, and that cleanup cannot remove active/source/dependency files.
- Verify UI state combinations for execution, persistence, workspace view, and viewer load do not confuse `completed`, `saved`, `preview`, or `ready`.

## 16. Operational Deployment on the VPS

The deployment should have a small number of managed processes:

```text
VPS
│
├── Frontend / Next.js
│
├── FastAPI API process
│
├── One Generation Worker process
│
├── SQLite database file
│
└── Persistent storage directory
    ├── uploads/
    ├── generated/
    └── thumbnails/
```

Operational requirements:

- Storage and database must be on persistent VPS volumes, not a temporary filesystem.
- Configure one shared storage-root setting for API and worker processes.
- Ensure both processes have read/write access to required directories.
- Use a process manager (for example, the deployment's existing service manager) to restart API and worker after crashes/reboots.
- Ensure only one generation worker is active.
- Keep worker stdout/stderr and application logs accessible.
- Monitor available disk space because uploaded/generated meshes can be large.
- Provide a documented backup procedure and periodically test restoration.
- Do not put user files under a read-only system directory such as `/root` if the deployment filesystem is not writable there; use the configured persistent storage root.

---



### 16.1 Runtime, permissions and maintenance additions

- API and existing worker must use exactly the same configured storage root and authoritative DB path. Fail fast with a clear startup diagnostic if the volume is missing or not writable; do not silently switch to `/root`, `/tmp`, a local developer path, or a second database.
- Ensure `storage/temp/` and workspace directories are on the same filesystem when atomic rename is required. If they cannot be, implement a verified copy-to-staging plus atomic final rename and cleanup protocol; do not call a cross-filesystem copy atomic.
- Verify service user ownership/permissions for database, temp, workspace folders, logs, and backup targets. Surface disk-space health and protect the OS/root filesystem.
- The existing process manager starts one API process (or the current intended API topology) and exactly one generation worker. Prevent accidental duplicate workers with the repository's existing process guard/lock where available.
- Retain accessible worker/API logs and a documented cleanup/backup/restore command. Cleanup must not delete retained workspace assets or live temp previews.

### 16.2 Personal-use operations only

- Keep operational visibility in the application and the existing VPS process manager: API/worker logs, a simple storage/disk-space check, and a tested backup/restore procedure. Do not introduce a metrics database, log aggregation cluster, alerting platform, or external monitoring stack for this project.
- Run the preview cleanup/manifest-repair checks through existing startup/worker code as specified in Sections 12 and 13.5. Do not create an additional daemon or scheduled service just for housekeeping.
- Keep the storage path, DB path, queue cap, preview TTL, and operation timeout in the existing configuration pattern. Avoid a general-purpose configuration framework.
- Model weights, VRAM sizing, model downloads, model installation/loading, and inference algorithm/quality are outside this persistence/workspace change. Do not alter them as a side effect of implementing this plan.
## 17. Explicit Non-Goals

The first implementation does not aim to provide:

- Multi-tenant enterprise permissions and organization management.
- Distributed GPU workers across multiple machines.
- Redis-based distributed queueing.
- Celery or another external task broker.
- Automatic scaling or priority scheduling.
- Complex workflow orchestration with dependent task graphs.
- Separate microservices for assets, jobs, and generation.
- Mandatory WebSocket infrastructure.
- Automatic unlimited retries.
- A complete redesign of model inference or post-processing.

These can be considered later only if real usage requires them.

---



### 17.1 Additional non-goals for this implementation

- No parallel API surface that duplicates existing endpoint capabilities.
- No new SQLite database or broker solely to rename jobs as operations.
- No replacement scheduler/worker when the current one can be safely adapted.
- No broad repository rewrite, formatting-only sweep, or unrelated feature redesign.
- No speculative deletion of 0%-observed endpoints, routines, adapters, configuration, or files without the evidence required by Sections 11 and 14.
- No destructive overwriting of source inputs or retained mesh versions.

## 18. Key Decisions to Preserve During Implementation

1. **SQLite is the source of truth** for asset metadata and generation job state in the intended single-VPS deployment.
2. **Filesystem is the source of truth for the bytes** of uploaded and generated files; SQLite stores their relative paths and metadata.
3. **The backend creates the job ID.** The frontend does not independently generate a second ID.
4. **`job_id` equals the route token.** Example: `rabbit_a8f32c` maps to `/workspace/generate/rabbit_a8f32c`.
5. **A route is a persistent lookup into the database.** Reopening a route restores a job; it never starts generation by itself.
6. **A generated asset links to its originating job.** Clicking that mesh returns to the same job route.
7. **The same job row survives failure, interruption, and retry.** Retry does not silently create a new route.
8. **A completed job must reference a real, validated output asset.** Never mark completion before output finalization.
9. **One worker processes one job at a time.** SQLite-backed FIFO queue is enough for the target use case.
10. **Existing functionality and old data must remain accessible throughout migration.** Compatibility first; cleanup last.
11. **Do not change the AI model/inference pipeline as part of this architecture refactor** unless a specific integration requirement makes it necessary.
12. **Do not remove current storage metadata, manifests, FileStore code, Redis code, or legacy route handlers until a dependency audit and regression tests prove they are safe to retire.**

---



### 18.1 Clarified implementation decisions (these resolve older terminology)

1. One stable `workspace_id` equals one workspace directory and route token. Preserve the existing public route while it is in use.
2. `asset_id` identifies one immutable file; `operation_id` identifies one tool execution. These IDs are not interchangeable.
3. A legacy `job_id` is retained at existing API/database boundaries where required. Internally, map it explicitly to either the workspace identity or a legacy execution record; never make the same internal field ambiguously represent both.
4. The current authoritative SQLite database and queue are reused. `job_queue.db` in Section 21 is not permission to create a second DB beside the live DB.
5. Existing endpoints are reused and internally refactored. New endpoints are created only for genuinely missing capabilities and only according to the repository's current API naming/versioning conventions.
6. A derived operation can be execution-complete while its output remains unsaved. Only `persistence_status = saved` makes an output a permanent asset/Mesh Versions entry.
7. Derived tool outputs preview in temp and are retained only by **Keep in Workspace**. Initial raw mesh generation is automatically retained as the workspace base mesh.
8. The SQLite record is authoritative for operational state and relationships; the one workspace `metadata.json` is a repairable unified workspace manifest.
9. All retained files are immutable/versioned. New successful outputs never silently replace previous saved assets.
10. Existing endpoints, queues, schedulers, routines, storage layers and files are cleaned only after dependency/usage audit, migration and tests.

### 18.2 Resolved decisions and precedence index

The following rules resolve older examples without deleting their historical wording:

1. **Workspace identity and storage:** Sections 21–22 govern the workspace root, route identity, tool folders, temp placement, and immutable outputs. Section 5.1's `uploads/`/`generated/` layout and Section 21's `job_queue.db` filename are examples/history only; Section 8.5 governs the single live DB path. Never create a second database to match a diagram.
2. **Database versus manifest:** Sections 8.5–8.6 govern runtime authority. SQLite plus verified files drive UI restoration and asset availability; `metadata.json` is a rebuildable projection, not a competing runtime authority.
3. **Retry versus Regenerate:** Section 7.8 supersedes same-row retry wording for any execution that was actually claimed/started and then reached a terminal state. New terminal retries use a new `operation_id`, while retaining the same workspace/route.
4. **Thumbnails:** Section 7.9 and Section 21.4 make thumbnails optional presentation artifacts. Their failure never invalidates a mesh or blocks retention.
5. **Navigation:** Section 4.9 plus Sections 10.4 and 10.10 distinguish global workspace navigation from selecting a saved asset inside an open workspace.
6. **Migration order:** Section 23's five batches and explicit Continue gate supersede any interpretation of the older Phase 0–7 list as a separate execution schedule; Section 14.4 provides the mapping.
7. **IDs and names:** Section 4.8 defines new ID formats; Section 5.5 defines source-file and immutable retained-version naming. Legacy IDs/files remain supported until the migration cleanup gate passes.
8. **Personal-project scope:** Sections 2.1, 9.4, 13.5, 16.2, 17 and 24 keep this to a small one-worker VPS application. A feature is not required merely because an enterprise system might have it.

The original paragraphs remain in place for traceability. Where a sentence directly conflicts with the rules above, apply the more specific section named in this index and retain old behavior only at a compatibility boundary.
## 19. Implementation Readiness Checklist

Before changing code, confirm the following from the current `dev` branch:

- [ ] Existing DB schema and migration mechanism are understood.
- [ ] Existing upload endpoints and response contracts are mapped.
- [ ] Existing FileStore and manifest responsibilities are mapped.
- [ ] Existing generated output paths and artifact formats are mapped.
- [ ] Existing queue/scheduler/worker entry points are mapped.
- [ ] Existing job status polling and frontend job hydration are mapped.
- [ ] Every current route builder/parser is identified.
- [ ] Every current use of `local_`, `upload_`, `hist_`, `job-`, UUID, and `routeShortId` is identified.
- [ ] Existing MeshViewer URL precedence and format loaders are mapped.
- [ ] Existing generated asset listing and thumbnail generation are mapped.
- [ ] Persistent VPS storage and permissions are confirmed.
- [ ] A backup of DB and storage is available before migration.
- [ ] A rollback path is documented for each migration phase.

---



### 19.1 Expanded pre-implementation audit checklist

- [ ] All existing API endpoint methods/paths, request/response schemas, auth and frontend/backend/external callers are inventoried.
- [ ] Existing endpoint usage evidence and available access-log retention window are understood.
- [ ] Existing jobs/queue tables, DB file path, migrations, worker claims, retry/cancel behavior and scheduler routines are mapped.
- [ ] Existing recurring tasks, startup/shutdown handlers, process manager entries and background jobs are mapped to prevent duplicate routines.
- [ ] Existing FileStore, manifests, storage roots, generated paths, thumbnail writers and cleanup jobs are mapped.
- [ ] Existing mesh selection/active asset state, viewer loaders, operation tool endpoints and route hydration are mapped.
- [ ] All relevant README/docs/task Markdown files are identified and read before editing.
- [ ] A baseline test run and representative API response fixtures are saved.
- [ ] A combined DB + storage backup and tested restoration path exists.
- [ ] Each batch has one owner per task, non-overlapping file ownership, explicit acceptance criteria and a stop gate.

### 19.2 Final pre-release checklist

- [ ] No duplicate endpoint, database, queue, worker or scheduler was added for an existing capability.
- [ ] All old public paths used by the app still work or have an approved compatibility mapping.
- [ ] Execution and persistence state are independently visible and correctly restored.
- [ ] Active mesh, preview and retained versions cannot overwrite one another.
- [ ] Error and crash paths preserve the last known-good saved mesh.
- [ ] Cleanup candidates have evidence of zero remaining code/config/deployment/documentation dependency and adequate usage observation.
- [ ] Relevant Markdown documents and README no longer contradict the implementation.
## 20. Final Target

The finished experience should be predictable:

```text
UPLOAD
  └── file saved on VPS
      └── asset saved in SQLite
          └── visible in Assets panel

GENERATE
  └── backend creates job_id
      └── route = /workspace/generate/<job_id>
          └── job saved as queued
              └── one worker processes it
                  ├── success → save mesh + thumbnail + asset row
                  │              └── job = completed
                  ├── error   → job = failed
                  └── crash   → job = interrupted on recovery

REOPEN ROUTE
  └── lookup same job_id in SQLite
      ├── queued / processing → restore job status
      ├── completed           → load same saved mesh
      ├── failed              → show error + retry
      ├── interrupted         → show recovery + retry
      └── cancelled           → show cancelled state

CLICK GENERATED ASSET
  └── resolve origin_job_id
      └── navigate to original job route
          └── load the same mesh in MeshViewer
```

**Success means:** the user can upload once, generate once, leave the page or restart the VPS, return to the same route later, and see the same job state and generated mesh without rerunning inference. The implementation should achieve this with the smallest reliable architecture possible and without breaking existing uploads, jobs, model execution, or saved links.

---



### 20.1 Updated interpretation of the final target

The flow above remains the compatibility summary for initial image generation. For the complete workspace-centric product, apply this extended flow; it takes precedence over the old job-centric wording where they differ:

```text
NEW IMAGE TASK OR NEW STANDALONE MESH UPLOAD
  └── create one workspace_id (existing route-token compatibility retained)
      └── persist immutable input under workspace/input/
          └── register canonical asset_id

INITIAL IMAGE-TO-MESH GENERATION
  └── create operation_id and durable queue record
      └── existing worker executes the existing model pipeline
          └── validate + auto-retain base mesh under workspace/mesh/
              └── update asset, active mesh and unified manifest

SUBSEQUENT TOOL OPERATION
  └── select exact active/saved input asset_id + capture settings
      └── create operation_id in the existing queue
          └── existing worker writes isolated output under storage/temp/
              └── execution completed = verified preview ready
                  ├── Keep in Workspace → publish immutable version → saved asset
                  │                       └── update active mesh + Mesh Versions
                  ├── Regenerate → new operation_id using captured input/settings
                  └── Discard Preview → temp cleanup only

REOPEN WORKSPACE ROUTE
  └── resolve workspace_id and restore DB-backed state/manifest
      ├── queued/processing → show operation progress
      ├── completed + not_saved → restore verified preview if temp still exists
      ├── saved → load exact active asset and retained versions
      ├── failed/interrupted → show safe error and recovery action
      └── discarded → load last saved active mesh

ASSET/VERSION SELECTION
  └── load exact asset_id; set saved active mesh; keep route unchanged
      └── next operation captures that exact asset_id
```

The existing endpoints and worker remain the entry points unless the audit proves a capability is absent. No operation creates a new workspace route unless it is a genuinely new independent source workspace.
## Change Log

- Initial plan drafted from the agreed simplified architecture requirements.
- No source code, database schema, storage directory, API route, or worker has been modified by creating this plan.

## 21. Final Agreed Workspace Storage Structure

> **This section records the final agreed storage hierarchy.** Keep all earlier sections unchanged. Where an earlier storage-layout example conflicts with this section, use this section for the workspace directory layout and operation-output placement.
>
> **Core identity rule:** The workspace directory name, stable workspace ID, and route ID are the same value. Example: `rabbit_a8f32c`. There are no nested job directories inside a workspace.

### 21.1 Exact directory structure

```text
backend/
└── storage/
    │
    ├── job_queue.db
    ├── temp/
    │
    └── rabbit_a8f32c/                 # JOB ID = WORKSPACE ID
        │
        ├── thumbnail.png              # Main workspace thumbnail
        │
        ├── input/
        │   ├── source_image.png
        │   └── source_mesh.glb
        │
        ├── mesh/
        │   ├── rabbit_a8f32c.glb
        │   └── thumbnail.png
        │
        ├── texture/
        │   └── pbr/
        │       ├── reference.png
        │       ├── maps/
        │       │   ├── base_color.png
        │       │   ├── normal.png
        │       │   ├── roughness.png
        │       │   ├── metallic.png
        │       │   ├── ao.png
        │       │   ├── height.png
        │       │   └── opacity.png
        │       │
        │       ├── rabbit_textured_a8f32c.glb
        │       └── thumbnail.png
        │
        ├── segmentation/
        │   ├── rabbit_segmented_a8f32c.glb
        │   ├── parts/
        │   └── thumbnail.png
        │
        ├── retopology/
        │   ├── rabbit_retopology_a8f32c.glb
        │   └── thumbnail.png
        │
        ├── uv/
        │   ├── rabbit_uv_a8f32c.glb
        │   ├── uv_atlas.png
        │   └── thumbnail.png
        │
        ├── editing/
        │   ├── rabbit_edited_a8f32c.glb
        │   └── thumbnail.png
        │
        ├── rigging/
        │   ├── rabbit_rigged_a8f32c.glb
        │   ├── rabbit_rigged_a8f32c.fbx
        │   └── thumbnail.png
        │
        ├── animation/
        │   ├── rabbit_animated_a8f32c.glb
        │   ├── clips/
        │   │   ├── idle.glb
        │   │   ├── walk.glb
        │   │   └── run.glb
        │   └── thumbnail.png
        │
        └── metadata.json              # ONE UNIFIED METADATA
```

### 21.2 Workspace and operation rules

1. **One workspace directory per route identity.** `rabbit_a8f32c` is the workspace ID and the route token. The same identity is used whenever the user returns to that workspace.
2. **No nested job directories.** Do not create `jobs/`, `<job_id>/`, `output/`, or other extra job-level directory layers inside tool directories.
3. **Operations reuse the same workspace.** When the user runs Texture/PBR, Segmentation, Retopology, UV, Editing, Rigging, Animation, or another workspace operation from the same route, save its result in that operation's existing tool directory. Do not create another workspace directory or change the route.
4. **Direct tool-folder outputs.** Save each tool's final output directly in its designated directory, using the filenames shown in the hierarchy. Supporting files may use the explicitly shown subdirectories, such as `texture/pbr/maps/`, `segmentation/parts/`, and `animation/clips/`.
5. **One unified metadata file.** There must be exactly one workspace-level `metadata.json`. Do not add separate metadata JSON files under individual tools or operations.
6. **Metadata is the workspace index.** The unified file records the workspace identity, route, directory paths, source inputs, operation records, operation status, parameters, output paths, thumbnail paths, latest successful outputs, and relevant history.
7. **Thumbnails are stored with their owner.** The workspace-level `thumbnail.png` represents the overall workspace. Each tool directory has its own `thumbnail.png` representing that tool's current output. Do not create additional thumbnail directories.
8. **Inputs remain separate from outputs.** Original uploaded image/mesh files belong in `input/`. Tool operations read those inputs or prior tool outputs by their recorded paths and must not silently overwrite the originals.
9. **Texture and PBR share one hierarchy.** PBR belongs under `texture/pbr/`; there is no separate root-level `pbr/` directory.
10. **No `assets/` or `exports/` directories.** These are not part of the agreed workspace storage hierarchy. Downloads/exports are served from the existing tool output locations when applicable.
11. **Temporary processing data stays outside workspaces.** Use the shared `storage/temp/` directory for intermediate files. Do not expose incomplete temporary files as final outputs.
12. **Safe finalization.** Generate a new result in temporary storage, validate it, create its thumbnail, and only then publish it into the appropriate tool directory. A failed operation must not damage or replace the previous successful result.
13. **Stable route restoration.** Opening or refreshing the same route loads the same workspace and reads its outputs and state from the unified metadata/database records. It must not create a new workspace or rerun an operation.
14. **Operation execution records do not imply filesystem folders.** The queue/database may retain operation execution IDs, statuses, timestamps, and errors as needed, but those IDs must not create nested job directories or replace the stable workspace/route identity.
15. **Create tool directories as needed.** A tool directory may be created when that operation is first used. Do not create empty operation directories just for the sake of pre-populating the tree.

### 21.3 Example operation behavior

For route `/workspace/generate/rabbit_a8f32c`:

- Initial generation saves `rabbit_a8f32c.glb` in `rabbit_a8f32c/mesh/`.
- Texture/PBR saves its reference, maps, textured mesh, and thumbnail in `rabbit_a8f32c/texture/pbr/`.
- Segmentation saves its mesh, optional parts, and thumbnail in `rabbit_a8f32c/segmentation/`.
- Retopology, UV, Editing, Rigging, and Animation follow the same rule in their respective directories.
- Moving between workspace pages does not change the route or create another root directory.

**Final rule:** One route identity → one workspace directory → one unified `metadata.json` → direct per-tool output directories. No nested job directories, no separate metadata JSON files, no `assets/` directory, and no `exports/` directory.

---



### 21.4 Storage and manifest implementation safeguards

- The tree in this section defines the agreed workspace layout. It does not authorize creating a second DB file: follow Section 8.5 and keep the currently authoritative DB unless a controlled migration explicitly changes its location.
- Resolve every stored relative path against one configured storage root and verify the resolved path remains inside that root. Reject symlinks/path traversal that escape the root. Never derive an operation directory from a user-provided filename or raw operation ID without safe normalization.
- Workspace directory creation must be idempotent and collision-safe. A collision must resolve through a unique backend-generated ID, never reuse another workspace directory.
- `metadata.json` must include a schema version and stable workspace identity. Update it using temp-write, flush/fsync where supported, and atomic replace. Keep one file only; do not create `metadata_<timestamp>.json`, per-tool JSON files, or nested metadata files.
- If a retained file exists but DB/manifest commit failed, keep it unlisted and reconcile/quarantine it. If a DB asset points to a missing file, show an integrity error and do not substitute a different output.
- Store only relative paths. Validate every output path against the expected tool directory so an operation cannot publish into another workspace or overwrite an input.
- A thumbnail is a presentation artifact. Attempt to generate workspace/tool thumbnails as specified, but if the mesh is valid and thumbnail rendering alone fails, keep the mesh asset usable with a recorded thumbnail failure/null path and a UI fallback; retry thumbnail creation independently where possible. Do not claim a thumbnail exists when it does not.
- Retained filenames must be collision-safe and immutable. The canonical/latest filename shown in the tree is illustrative; when another result is kept, preserve the previous version using a version suffix/history record rather than overwriting it.


## 22. Workspace Ownership, Active Mesh, Operation Previews, and Mesh Versions

> **Purpose:** Define how a workspace is created, how every tool chooses its input and storage owner, and how generated results become permanent workspace assets. This section extends the agreed storage structure in Section 21. It does not replace or rewrite any earlier section. If an earlier general example conflicts with Sections 21–22, use the agreed workspace identity and storage rules in those sections.

### 22.1 Core identity model

Keep these identities separate:

| Identity | Meaning | Example | Creates a filesystem directory? |
|---|---|---|---|
| `workspace_id` | Stable project/workspace identity and route token | `rabbit_a8f32c` | Yes, one workspace root |
| `asset_id` | One source or generated mesh/image asset | `ast_001` | No, it identifies a file recorded in metadata/database |
| `operation_id` | One individual tool execution (including a regeneration attempt) | `op_002` | No, never a nested workspace directory |

Rules:

1. `workspace_id` is the stable route identity. The route remains `/workspace/generate/<workspace_id>` while the user moves between tools and selects different saved mesh phases.
2. The existing user-facing name `job_id` may remain as a compatibility/API term for the workspace route identity, but it must not be confused with an individual tool execution. In the workspace model, the stable `workspace_id` is the directory name and route token.
3. Every Generate, Texture/PBR, Segmentation, Retopology, UV, Editing, Rigging, or Animation execution receives its own `operation_id` and is associated with one `workspace_id`.
4. Operation IDs can be stored in `job_queue.db` and referenced in the workspace's unified `metadata.json`; they must not create nested job directories.
5. A regenerate/retry is a new execution attempt with a new execution identifier, linked to the earlier operation where useful. It does not create a new workspace or change the route.

### 22.2 When to create a workspace

There are two primary entry paths:

**A. Image-to-mesh generation**

1. When the user starts a new image-based generation, the backend creates the stable workspace identity and route.
2. Save the source image under that workspace's `input/` directory.
3. Run the initial mesh-generation operation through the existing durable queue/job lifecycle.
4. When the primary raw mesh generation succeeds, validate and persist the raw mesh in `mesh/` with its thumbnail and metadata record. This raw mesh becomes the initial active mesh.
5. Subsequent workspace operations reuse this same workspace and route.

**B. New standalone mesh upload**

1. When a user supplies a new external mesh as the source for a new task, create a new workspace identity from its safe display-name stem plus a backend-generated unique suffix.
2. Save the original mesh under that workspace's `input/` directory; do not rename or overwrite its bytes as an operation output.
3. Register it as the workspace's source mesh and initial active mesh in `metadata.json` / the database.
4. Run the requested tool against that mesh. The tool's result is initially a temporary preview; its permanent tool directory is created only after the user chooses **Keep in Workspace**.
5. This standalone-upload path does not require an initial AI mesh-generation operation.

A new independent external mesh upload must not silently replace the active mesh or source input of an already-open workspace. Treat it as a new workspace unless the user explicitly chooses an import/reference workflow.

### 22.3 How tool pages choose their input

Use one shared input-selection model across mesh-processing pages:

1. **Current Active Mesh** — default input. This is the most recently selected/applied saved mesh in the current workspace.
2. **Import from This Workspace** — let the user choose any previously saved mesh output recorded in the current workspace metadata, including the source/raw mesh or a result from another tool.
3. **Upload New Mesh** — an independent external mesh starts a new workspace by default; it must not silently overwrite or mutate the currently open workspace.

Page-specific rules:

- **Generate:** image-first workflow. Its primary input is an uploaded image; supported reference images/settings may be additional inputs.
- **Texture/PBR:** requires a mesh input (default: active mesh). A user-supplied reference image is an additional material/appearance input, not a replacement for the mesh.
- **Segmentation, Retopology, UV, Editing, Rigging, and other mesh-processing tools:** use the active mesh by default and allow the user to select another saved workspace mesh.
- **Animation:** use an appropriate saved rigged/compatible mesh as the default when available. If a required rig/skeleton is missing, explain the prerequisite instead of silently using an incompatible input.
- **Environment or viewer-only tools:** use the current workspace/viewer state and settings; do not manufacture a mesh input or mesh-output folder when the operation does not produce a mesh asset.

The selected input must be explicit in the operation record. A page change alone must never silently switch the input asset.

### 22.4 Active mesh and mesh lineage

Track three different concepts:

- **Source mesh:** the original uploaded mesh, or the initial raw mesh generated from the source image. It is immutable.
- **Active mesh:** the saved mesh currently selected in MeshViewer. It is the default input for the next mesh-processing operation.
- **Preview mesh:** a newly generated but not-yet-retained result. It is temporary and is not yet a permanent workspace asset.

For every operation, record at least:

- `operation_id` and `workspace_id`;
- operation/tool type;
- exact `input_asset_id` and input path/version;
- output asset ID/path when retained;
- saved/retained state;
- settings/parameters snapshot;
- execution status, timestamps, and error information as appropriate;
- thumbnail path when the output is retained;
- parent/source operation reference where applicable.

The input reference is captured when the operation starts. If the active mesh changes while an operation is running, the running operation must continue using its captured input, not the newly selected mesh.

The output is written to the owning workspace of the selected mesh. For a mesh selected from the currently open workspace, this is that workspace. For a cross-workspace reference/import, keep the source asset's ownership explicit in metadata; by default, do not duplicate the source file or silently move the output into an unrelated workspace. A future explicit “copy into this workspace” action may create a local copy when required.

### 22.5 Operation output lifecycle: temporary preview first

For derived operations such as Texture/PBR, Segmentation, Retopology, UV, Editing, Rigging, and Animation:

1. Create an operation execution record and capture the exact input asset and settings.
2. Write intermediate files, generated mesh, maps/resources, and preview thumbnail under a unique temporary work area inside the shared `storage/temp/` location. Temporary execution IDs are allowed there; they are not workspace subdirectories.
3. Validate the result and show a preview in MeshViewer when generation succeeds.
4. Until the user retains the result, do not create the final tool directory merely because the tool page was opened or generation started. Do not create empty `texture/`, `segmentation/`, `retopology/`, `uv/`, `editing/`, `rigging/`, or `animation/` directories in advance.
5. The completed temporary preview is not yet a saved workspace asset and must not appear in the permanent Mesh Versions selector.
6. The user can choose **Keep in Workspace**, **Regenerate**, or (where shown) **Discard Preview**.

The initial image-to-mesh generation is the workspace-creation flow described in Section 22.2A: its successful raw mesh is persisted as the workspace's base mesh. The explicit retain/preview flow above applies to subsequent derived tool operations.

### 22.6 User-facing actions and exact meanings

Use labels that cannot be mistaken for a download action:

| UI label | Meaning |
|---|---|
| **Keep in Workspace** | Permanently retain the successful preview in its owning workspace, publish its files, update metadata, and make it available in Mesh Versions. This is not a download. |
| **Regenerate** | Run the same operation again using the captured input and settings snapshot. It creates a new execution attempt, not a new workspace. |
| **Discard Preview** | Remove the unretained temporary result and its temporary resources. It does not delete the source mesh or any previously saved output. |

Do not label **Keep in Workspace** as `Download` or use a generic `Save` label that could be confused with downloading a file. A separate download action, if present, must remain distinct.

Regeneration rules:

- By default, reuse the exact input asset/version and settings snapshot used for the preview.
- If the user deliberately changes settings before regenerating, capture the new settings as the new attempt's immutable parameter snapshot.
- Keep previous successful retained outputs untouched.
- Never publish a failed, partial, or invalid result.
- A temporary preview can be discarded or cleaned up without affecting any retained asset.

### 22.7 Lazy creation and permanent publishing

A tool directory is created only when a valid output is being retained, not when the page is visited or a run is merely queued/started.

On **Keep in Workspace**:

1. Confirm the temporary result and all required supporting files exist and pass validation.
2. Resolve the owning workspace and the correct tool destination from the operation type.
3. Create only the required destination directories at that moment. For example, a retained texture result may create `texture/`, `texture/pbr/`, and `texture/pbr/maps/`; a retained segmentation result may create `segmentation/` and, when needed, `segmentation/parts/`.
4. Assign collision-safe/version-safe filenames. Never overwrite an earlier retained result unless an explicit, separate replacement policy is introduced and confirmed.
5. Atomically publish the generated mesh, required maps/resources, and thumbnail into the destination.
6. Update the single workspace `metadata.json` and the corresponding database asset/operation records so the new asset is discoverable only after publication succeeds.
7. Mark the retained operation as saved and make its output available in Mesh Versions.
8. Update the active mesh to the retained output by default, while preserving the ability to select any earlier saved mesh.
9. Clean up the temporary execution directory after successful publication.

If publication or metadata update fails, roll back or quarantine the incomplete final files and do not expose the result as saved. The last valid active mesh and all earlier retained outputs must remain usable.

### 22.8 MeshViewer Mesh Versions selector

Add a small dynamic **Mesh Versions** control in MeshViewer. Its purpose is to switch the viewer between saved mesh phases/outputs belonging to the workspace; it is not a download menu.

Visibility rules:

1. If the workspace contains only its initial source/raw mesh and no additional retained mesh output, hide this control.
2. Show it after at least one additional operation output has been successfully retained in the workspace.
3. Populate it dynamically from the unified `metadata.json`/asset records. Do not hardcode every possible tool phase.
4. Show only valid, successfully retained, viewer-loadable mesh outputs. Do not show failed jobs, incomplete files, or temporary previews.
5. Include the source/raw mesh as a selectable base phase once the selector is visible.
6. Show only phases that actually exist. For example, show Textured Mesh only when a textured mesh output was retained; show Rigged Mesh only when a valid rigged mesh output was retained. A tool that produced only non-mesh data must not create a fake mesh phase.
7. Selecting a phase loads its exact saved asset/path in MeshViewer and updates the active mesh reference. The workspace route and workspace ID do not change.
8. If the selected asset is missing or invalid, show a clear error and retain the last valid viewer state rather than silently loading a different phase.

Examples:

- Raw mesh only: Mesh Versions control remains hidden.
- Raw mesh + retained Texture output: show Raw Mesh and Textured Mesh.
- Raw mesh + retained Segmentation + retained Rigging outputs: show only Raw Mesh, Segmented Mesh, and Rigged Mesh.
- Raw mesh + a completed but unretained Texture preview: keep the control hidden if no other retained derived output exists; never list that preview.

### 22.9 Apply, Undo, and active-state behavior

Keep mesh-phase selection separate from material preview/application:

- Selecting a saved phase in Mesh Versions loads that saved mesh as the active mesh.
- Previewing a generated result does not overwrite the source mesh or any saved mesh.
- **Keep in Workspace** retains the output and, by default, makes it the active mesh.
- Undo/Redo operates on the active selection/application history; it changes the active reference/state, not the bytes of previously saved files.
- If the UI exposes material-specific Apply/Undo controls, those controls apply/revert the selected material state without destructively overwriting the source mesh. Store the applied material/state reference in workspace metadata.
- A later operation uses the currently active saved mesh as its default input, unless the user explicitly chooses another saved mesh.

### 22.10 Temporary cleanup and recovery

- Temporary previews and intermediate resources live only under `storage/temp/`, never inside the permanent workspace tree.
- Temporary files must be isolated by execution ID so concurrent/stale attempts cannot overwrite one another.
- Discarded previews should be cleaned promptly.
- Add a bounded cleanup policy for abandoned temporary directories after worker/API crashes or VPS restarts.
- A workspace metadata record must never advertise a temporary path as a permanent saved output.
- If a user reloads the page while a preview is still available, the UI may restore it only after verifying that its temporary files and operation state still exist. If they do not, clearly report that the preview expired and allow regeneration; never pretend it was saved.
- Cleanup must not delete a file referenced by a retained asset or the current active mesh.

### 22.11 Required scenarios and acceptance rules

| Scenario | Required behavior |
|---|---|
| User uploads a new standalone mesh and starts Segmentation | Create one workspace, persist the mesh in `input/`, preview the segmentation result in temp, and create `segmentation/` only after Keep in Workspace. |
| User uploads an image and generates the initial raw mesh | Create one workspace/route, persist the source image, save the successful base mesh in `mesh/`, and set it as the initial active mesh. |
| User takes the raw mesh to Texture and keeps the result | Reuse the same workspace/route; create `texture/pbr/` only when the result is retained. |
| User takes a textured mesh to Retopology | Use the exact active textured asset as input; save a retained result under the same workspace's `retopology/`. |
| User selects the original raw mesh after applying a derived output | Load the raw mesh and use it as the next operation's input; do not create another workspace. |
| User uploads a different independent mesh | Create a separate workspace; do not replace the currently open workspace's source or active mesh. |
| User regenerates a preview | Use the captured input/settings by default, create a new execution attempt, and preserve retained outputs. |
| User discards a preview | Remove temporary data only; do not create a tool directory or change the active mesh. |
| User keeps a preview | Publish validated files, create only the necessary tool folders, update metadata/database, and expose the new mesh phase. |
| User opens the same route later | Restore the same workspace, active mesh, retained versions, and operation history without rerunning tools. |

**Final operating principle:** One stable workspace owns a source mesh and its retained derived outputs. Every operation uses an explicitly captured input, runs in temporary storage first, and becomes a permanent tool-folder asset only when the user chooses **Keep in Workspace**. MeshViewer lists only retained, valid mesh phases; the active selection determines the default input for the next operation. No new route, nested job directory, empty tool directory, or unwanted permanent output is created.


## 23. Agent-Team Implementation Protocol — Five Batches, Stop After Each

> **Execution contract:** This plan is to be implemented in ordered batches. Run one batch only, complete its five tasks, report the result, and stop. Wait for the user's explicit **Continue** instruction before starting the next batch. Never autonomously proceed to the next batch.

### 23.1 Team structure and task limits

**Personal-use execution note:** The roles and task-owner columns below describe areas of responsibility, not a requirement to create a multi-agent team. One developer (or one coding agent working sequentially) may perform them. Do not add agent orchestration, project-management infrastructure, parallel ownership systems, or enterprise handoff tooling. Preserve the five-batch order and stop/Continue rule because they protect the existing application and data.

- Use five sub-agents/team members per batch, with one clearly owned task per agent. A sixth agent may act only as a read-only reviewer/integrator; it must not make overlapping edits unless the lead explicitly assigns a non-conflicting file scope.
- Each batch contains exactly five numbered tasks (maximum five tasks per batch). Do not split a task into extra hidden implementation tasks or start work from a later batch.
- The lead/orchestrator owns integration, shared contracts, conflict resolution, test execution, and the batch acceptance gate. It must assign file/module boundaries before parallel edits.
- Agents must report files inspected/changed, behavior changed, tests run/results, compatibility risks, unresolved items, and any assumptions. No agent may claim a test passed unless it was actually run and its result recorded.
- Avoid concurrent edits to the same file. If two tasks need the same file, assign one owner or have one agent prepare a patch proposal for the owner to integrate. Do not allow competing implementations of the same service/schema/API.

### 23.2 Mandatory instructions to every agent

1. Read the relevant plan sections and inspect the current `dev` branch before editing. The repository is the implementation source; this plan is the target behavior. Do not assume module names, endpoint paths, schemas, or routines without finding them.
2. Reuse existing endpoints, queue, scheduler, worker, storage/FileStore/manifest utilities, model adapters, and UI components wherever they already provide the capability. Change the internal logic to satisfy the workspace/operation design. Do not create duplicate endpoints or parallel systems.
3. Keep code changes minimal and scoped to the assigned task. Preserve working model/inference behavior and unrelated product functionality. Do not rewrite the repository, mass-format unrelated files, or add abstractions without a demonstrated need.
4. Treat `workspace_id`, `asset_id`, and `operation_id` as distinct. Preserve legacy `job_id` contracts through explicit adapters. Do not blindly rename public fields/routes.
5. Implement all relevant error paths and state transitions, not only the happy path. No swallowed exceptions, fake success responses, unbounded retries, partial assets presented as saved, or silent fallback to another input mesh.
6. Do not add a new DB, broker, queue, scheduler, worker, endpoint, or service when the existing one can be safely adapted. New routes are allowed only for a proven missing capability and must follow the repo's established naming/versioning conventions.
7. Do not remove code, endpoints, jobs, routines, configuration, docs, or files based only on naming or a quick grep. Prove dependencies/usages are absent across code, dynamic loading, tests, scripts, CI, deployment, docs, access logs and known external integrations. If uncertainty remains, preserve/deprecate rather than delete.
8. Preserve existing user data and saved links. Back up DB and storage before migrations or destructive cleanup. Never delete a retained asset or model weight as part of generic dead-code cleanup.
9. Add/update tests for changed behavior. Run the narrow tests and relevant regression suite; document failures honestly. Do not weaken or delete tests to get a green run.
10. Update relevant Markdown documentation only in the documentation batch, except when a code/API change requires a small in-scope comment or schema document. Do not rewrite unrelated docs.

### 23.3 Batch 1 — Read-only repository and behavior audit

**Goal:** Establish the actual baseline before any source-code changes. All five tasks are read-only; deliver inventories and findings, then stop.

| Task | Owner focus | Required output |
|---|---|---|
| B1-T1 | Existing API endpoints and routes | Inventory method/path, router, request/response contract, frontend/backend callers, auth, logs/usage evidence, duplicate/legacy candidates |
| B1-T2 | DB, assets, storage and manifests | Identify live DB path/schema/migrations, FileStore and metadata ownership, storage roots, path conventions, real data/backup requirements |
| B1-T3 | Jobs, queues, workers and routines | Map queue tables/classes, schedulers, startup/shutdown and periodic routines, retry/cancel/recovery, process manager and duplicate-worker risks |
| B1-T4 | Frontend/workspace/viewer behavior | Map upload/tool endpoints, route builders/parsers, active mesh state, MeshViewer loaders, Assets panel, polling, previews and selection |
| B1-T5 | Tests, docs and cleanup baseline | Run/record baseline tests; list all relevant Markdown/README files; identify candidate unused endpoints/routines/files with evidence and uncertainty noted |

**Batch 1 acceptance gate:** One reconciled architecture inventory, baseline test report, current endpoint map, actual DB/storage path decision, dependency map and risk list. No application code, data, endpoint, route, queue, routine or file is changed/deleted in Batch 1. Stop and wait for explicit Continue.

### 23.4 Batch 2 — Workspace identity, asset ownership and storage foundation

**Goal:** Introduce the minimum durable workspace model without breaking old records or changing inference behavior.

| Task | Owner focus | Required output | Status |
|---|---|---|---|
| B2-T1 | Identity/schema migration | Add/reuse workspace identity and explicit asset/operation relationship fields; preserve legacy job mappings; versioned, backed-up, idempotent migration | Complete |
| B2-T2 | Asset ownership and upload flow | Adapt existing image/mesh uploads to workspace ownership and immutable source inputs; independent mesh upload creates its own workspace | Complete |
| B2-T3 | Storage manager and workspace manifest | Reuse current storage helpers; implement agreed Section 21 layout, one root `metadata.json`, safe relative paths and repairable manifest writing | Complete |
| B2-T4 | Active mesh and asset lineage | Persist selected active asset, source/parent lineage, owner workspace and exact version selection; prevent last-modified-folder guessing | Complete |
| B2-T5 | Temp staging and publish foundation | Isolate temp paths by execution ID; add validation, collision-safe destination/version naming and safe publish primitives without yet wiring all UI actions | Complete |

**Batch 2 acceptance gate:** Existing uploads remain readable; new uploads produce correct workspace/asset identities; one existing DB is used; inputs remain immutable; workspace folders/manifest follow Sections 21–22; migration/rollback and storage failure tests pass. Stop and wait for explicit Continue.

### 23.5 Batch 3 — Operation lifecycle, existing queue/worker and error recovery

**Goal:** Convert existing job execution into workspace-scoped operations using the current queue and worker.

| Task | Owner focus | Required output | Status |
|---|---|---|---|
| B3-T1 | Existing queue/worker adapter | Reuse current queue, scheduler and single worker; claim operation records atomically; preserve current deployment entry points | Complete |
| B3-T2 | Execution/persistence state machines | Implement Section 7 transitions and invariants, separate execution completion from saved/persistence state, immutable operation IDs | Complete |
| B3-T3 | Input snapshots and regeneration | Capture exact asset/version/settings; prevent selection races; Regenerate creates a new execution ID and links history | Complete |
| B3-T4 | Preview, Keep and Discard lifecycle | Generate to temp, restore valid previews, implement Keep in Workspace/Discard Preview semantics; initial raw mesh remains auto-retained | Complete |
| B3-T5 | Error handling and restart recovery | Add structured error classification, bounded retry, cancellation correctness, stale-worker detection, publishing recovery and temp cleanup safeguards | Complete |

**Batch 3 acceptance gate:** State transition tests pass; one worker handles operations; errors never overwrite prior saved outputs; preview is not listed as saved; Keep/Discard/Regenerate behave correctly; restart/crash recovery is verified. Stop and wait for explicit Continue.

### 23.6 Batch 4 — Existing API integration and frontend workspace experience

**Goal:** Expose the new behavior through existing routes/endpoints and integrate the UI without duplicate API surfaces.

| Task | Owner focus | Required output | Status |
|---|---|---|---|
| B4-T1 | Existing API endpoint refactor | Reuse current routes, preserve contracts, adapt to workspace/operation services; add only proven missing capabilities with correct names | Complete |
| B4-T2 | Route/deep-link compatibility | Resolve existing route token to workspace; preserve saved links; restore state without rerunning jobs/tools | Complete |
| B4-T3 | Tool pages and active input selection | Make all relevant tools use explicit current Active Mesh or chosen saved asset; surface prerequisites and input identity | Complete |
| B4-T4 | API Deprecation Guard & Error Hardening | Sanitize internal VPS error paths, clean JSON envelopes, duplicate cancel route delegation to /system/jobs/{job_id}/cancel | Complete |
| B4-T5 | MeshViewer & Assets panel integration | Preview display, saved-version selector visibility, active selection, stale fetch protection | Complete |

> **Post-Processing Retention Clarification**: Automated downstream post-processing is permanently disabled by default (`postprocessing.enabled: false`) in favor of direct high-fidelity model-native output. However, all modules and pipelines in `backend/postprocess/` remain permanent core foundations powering discrete, on-demand specialist tools (such as PartUV, AutoRetopo, Baking, Collision, and QA inspection) and are strictly preserved.

**Batch 4 acceptance gate:** Existing endpoint URLs and response contracts continue to work; no duplicate endpoints exist; deep links restore correctly; raw-only Mesh Versions is hidden; only retained meshes appear; tool selection and viewer races are tested. Passed.

### 23.7 Batch 5 — Regression, migration cleanup, docs and deployment verification

**Goal:** Prove compatibility, safely retire only proven-unused legacy components, and leave maintainable documentation.

| Task | Owner focus | Required output | Status |
|---|---|---|---|
| B5-T1 | Frontend State Store Alignment | Model `executionState` and `persistenceState` with transition guards; replace client route hashing with backend `workspace_id`; decouple asset selection from route mutation | Complete |
| B5-T2 | MeshViewer Preview & Versions Control | Dynamic Mesh Versions selector (hidden on base mesh only, shown when derived assets exist); Stale viewer fetch race protection via AbortController | Complete |
| B5-T3 | Operation Action Bar (Keep, Regenerate, Discard) | Dockable action bar with explicit Keep in Workspace (`saved`), Regenerate (`parent_operation_id`), and Discard Preview (`discarded`) actions | Complete |
| B5-T4 | Assets Panel & Adaptive Polling | Workspace-scoped Assets panel with thumbnail placeholder fallback; consolidated adaptive poller (1.5s -> 5s after 2m, tab visibility pause, terminal stop) | Complete |
| B5-T5 | Global Workspaces Gallery | Studio dashboard gallery card listing navigating to `/workspace/generate/<workspace_id>` | Complete |

**Markdown documentation requirement for B5-T4:** Enumerate every repository Markdown file, including root `README.md`, nested READMEs, docs, architecture/API/deployment guides, contributor instructions and task/planning files. Read each relevant file fully before editing. Update every document that describes changed behavior; remove or label contradictory obsolete instructions; preserve unrelated historical material. Do not claim every Markdown file was updated if some were irrelevant or inaccessible—record exactly which files were reviewed and changed.

**Batch 5 acceptance gate:** All relevant tests and regression checks pass or have explicitly documented pre-existing failures; all legacy cleanup has evidence and rollback; no unresolved duplicate DB/queue/endpoint/routine remains; README/docs match the final implementation; deployment and restore checks are recorded. Passed.

### 23.8 Final Operational & Startup Verification (Batch 6)

**Goal:** Complete end-to-end operational readiness, startup validation, and service verification.

| Check | Target | Observed Outcome | Status |
|---|---|---|---|
| Single-command startup (`scripts/start.sh`) | Redis + Backend Multi-Worker + Next.js Frontend | Clean boot without error, logs unified in `logs/master.log` | Complete |
| Backend Health Check | `http://127.0.0.1:7842/health` | HTTP 200 OK (`{"status":"healthy","version":"1.0.0"}`) | Complete |
| Frontend Health Check | `http://127.0.0.1:3000` | HTTP 307 Redirect to `/workspace`, Next.js ready | Complete |
| Test Regression Suite | All batches (Tiers 1–4, Batch 2, Batch 3, Batch 4) | 46 backend pytest passed, 18 bun tests passed, 0 tsc errors | Complete |
| Invariant & GPU Rule 1 | `sm >= 80` native parity, `AGENTS.md` untouched | 100% native FlashAttention/BF16 preserved, zero regressions | Complete |
| Post-Processing Core Retention | `backend/postprocess/` files preserved | Disabled by default for generation; preserved for specialist tools | Complete |

**Batch 6 acceptance gate:** Passed. Single-command startup and complete regression suite verified cleanly.

### 23.8 Required batch handoff report and stop rule

At the end of each batch, the lead must report:

1. Batch number and exact five task outcomes (completed/blocked/partial).
2. Files created, modified and deleted, with a one-line reason for each.
3. Existing endpoints/DB/queue/worker/routines reused or changed; any genuinely new route or schema item and why it was necessary.
4. Tests/commands actually run and their results, including failures not fixed.
5. Data migration/backup/rollback status and any cleanup candidates deliberately retained because usage was uncertain.
6. Risks, open decisions and the next batch's prerequisites.

After this report, stop all agents and make no changes from the next batch until the user explicitly says **Continue**. A Continue instruction authorizes only the next numbered batch, not multiple batches. If a task is blocked, report the blocker and stop; do not silently skip it or start future work.

### 23.9 Final implementation constraints

- Do not change model weights, inference algorithms, generated quality, or unrelated tool behavior as part of this storage/route/workspace refactor.
- Do not delete old data, manifests, FileStore metadata, Redis/queue code, endpoint handlers, scheduler routines, or files until the exact cleanup gate passes. If Redis or another legacy service is demonstrably unused, remove its runtime/config/dependency references consistently; do not leave a half-removed service.
- Keep the implementation small: reuse current code paths, eliminate duplicate code only when the replacement is verified, and avoid speculative abstraction.
- The user's batch stop instruction is mandatory even if agents finish early. Never run Batch N+1 in the same execution without a fresh Continue.




## 24. Addendum: Integrated Resolutions and Personal-Use Scope

> **Purpose:** This addendum records final precedence and scope decisions after integrating the clarifications into their relevant sections. It does not replace Sections 1–23 and does not authorize a rewrite of existing working code. The detailed requirements live in the section numbers referenced below.

### 24.1 What is authoritative

- Workspace identity, directory layout, ownership, tool output placement, preview behavior and Mesh Versions: **Sections 4, 5, 6, 21 and 22**, with the final navigation distinction in **4.9**.
- New canonical ID formats: **Section 4.8**. Existing IDs are not bulk-renamed.
- Source byte/extension preservation and immutable version filenames: **Section 5.5**.
- Initial image-to-mesh Regenerate behavior: **Section 6.6**.
- Terminal Retry/Regenerate semantics and optional thumbnail behavior: **Sections 7.8–7.9**. These override older same-row retry and thumbnail-required interpretations.
- Single DB authority, DB-backed runtime state, and `metadata.json` projection/repair: **Sections 8.5–8.6**.
- Single-worker queue cap, deduplication, process ownership and timeout handling: **Section 9.4**.
- Polling, global Workspaces gallery, component behavior, accessibility and frontend state dimensions: **Sections 10.9–10.12**.
- Preview TTL, safe cleanup/trash and storage visibility: **Section 13.5**.
- Original phase-to-batch mapping: **Section 14.4**. Actual execution order is **Section 23**.
- Required regression coverage: **Section 15.4**.
- Personal-use runtime/maintenance limits: **Sections 2.1, 16.2 and 17**.

### 24.2 Personal-use boundary

This project is intended for personal use on one VPS, normally with one primary user and a small number of trusted users at most. The implementation should favor a small number of understandable components and low maintenance overhead. The existing FastAPI app, its current authoritative SQLite DB, its storage/FileStore code, its existing queue/scheduler/worker, its model adapters, and its current UI conventions are to be reused wherever they already provide the required behavior.

Do not add enterprise or speculative infrastructure: no multi-tenant organizations/roles, distributed worker fleet, external broker, microservices, event bus, generic plugin framework, metrics platform, external log aggregation, complex retention engine, or separate asset catalog. Do not add a second DB, queue, scheduler, worker, storage root, manifest, or duplicate endpoint surface.

Authentication/authorization redesign is not part of this workspace/persistence task; preserve whatever access controls the current application already needs, and do not introduce a new enterprise identity system. Model weights, VRAM management, model installation/download/loading, inference algorithms and generated quality are also out of scope.

### 24.3 Explicit conflict resolutions

| Earlier wording or overlap | Final rule | Detailed location |
|---|---|---|
| Same-row retry after a failed job versus immutable terminal operations | Requeue in place only if execution was never claimed/started. After a started execution reaches a terminal state, Retry/Regenerate creates a new `operation_id`; workspace route remains unchanged. | 7.8 |
| Generated-asset click always changes route versus Mesh Versions selection keeps route | Global workspace navigation opens the workspace route; choosing an asset/version inside the workspace changes Active Mesh only. | 4.9, 10.10, 22.8 |
| Old `uploads/`/`generated/` and `job_queue.db` examples versus the final workspace tree/live DB | Section 21 controls workspace file layout; use only the currently authoritative DB identified in the audit. | 5.1, 8.5, 21 |
| Phase 0–7 migration plan versus five implementation batches | Use the five batches and stop gate; original phases are mapped only for traceability. | 14.4, 23 |
| Thumbnail mentioned as required in an earlier state invariant | A valid mesh can complete and be retained without a thumbnail; use placeholder/repair. | 7.9, 13.1, 21.4 |
| Manifest described as an index versus SQLite authority | Runtime/UI state comes from DB plus verified files; manifest is a rebuildable projection. | 8.5–8.6 |
| Execution completion versus saved output | `completed` means preview/execution succeeded; only `persistence_state = saved` means permanent asset. | 7.5–7.9, 10.12, 22.5–22.7 |

### 24.4 Default personal-use settings

| Setting | Default | Notes |
|---|---:|---|
| Active generation workers | 1 | Enforced by existing process manager/lock |
| Maximum queued operations | 10 | Configurable; reject new work with a clear queue-full error |
| Initial status polling | 1.5 seconds | Back off to 5 seconds after 2 minutes |
| Unretained preview TTL | 24 hours | Configurable; cleanup at startup and daily |
| Trash retention | 7 days | Only if safe workspace trash/restore is implemented |
| Operation maximum runtime | Configurable | Use existing config; do not claim a running process was stopped until confirmed |

These are modest defaults for one user's VPS, not service-level guarantees. Change them only when actual usage or hardware requires it.

### 24.5 Preserve existing code and data

This is an architecture/persistence integration, not a broad rewrite. Inspect the actual repository during Batch 1, reuse its existing implementation, and add only the missing behavior. Keep source files, saved meshes, manifests, endpoints, queues, schedulers, routines, model adapters and old IDs until the relevant compatibility and cleanup gates pass. Do not change model loading, VRAM behavior, inference algorithms or unrelated tools. Never claim a route, migration, test or runtime behavior has been verified until it has actually been checked.

**Final rule:** implement the smallest complete personal-use solution that satisfies the specific workspace, persistence, recovery and UI behavior in this plan. Preserve everything that still works; replace only what is proven necessary; and stop after each of the five batches until the user explicitly says **Continue**.
