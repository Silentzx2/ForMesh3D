# TASKS — PART 2: BACKEND, API CONTRACTS & MOTION DATA

> Owner: Backend coding agent (must be different from the UI agent)  
> Product: ForMesh 3D — personal, self-hosted 3D studio  
> Scope: FastAPI/backend implementation, server-side validation, artifact resolution, backend tests, and delivery of the API contract consumed by Part 1  
> Companion: Read all of Docs/TASKS-PART-1-UI-UX.md before coding.

---

## 0. Shared Product Vision

ForMesh 3D is a personal, self-hosted 3D studio. The frontend should be a crisp, calm, Tripo-inspired creative interface; the backend must make every visible capability truthful, reliable, secure, and compatible with the existing single-user local/VPS deployment.

The target is not an enterprise platform. Do not add microservices, distributed infrastructure, cloud accounts, or complex multi-tenant machinery without a concrete existing requirement.

The backend's job in this plan is to:
- Preserve existing model inference and scheduler stability.
- Expose reliable, typed, validated API contracts for the UI.
- Make ARDY motion clips and preset metadata safely consumable by the frontend.
- Keep user/premade motion presets separate from workspace asset storage.
- Provide truthful capability metadata and job/artifact lifecycle behaviour.
- Ensure the UI endpoint stubs from Part 1 connect without changing the visual design.

Tripo is only a visual-quality reference; no Tripo branding or SaaS functionality belongs in the backend.

---

## 1. Mandatory Read Order and Two-Agent Contract

**Both agents must read both files completely before implementation:**
1. Docs/TASKS-PART-1-UI-UX.md
2. Docs/TASKS-PART-2-BACKEND.md
3. AGENTS.md
4. Docs/PRD.md
5. Docs/DESIGN.md
6. Docs/ARCHITECTURE.md
7. Docs/MEMORY.md
8. Docs/SECURITY.md
9. Docs/api-documentation.md
10. Existing route, schema, storage resolver, job lifecycle, model registry, adapter, and test files referenced by any planned change.

**Agent ownership**
- Backend agent owns Part 2 only.
- Backend agent is separate from the UI agent.
- Backend agent may inspect frontend code, Part 1, UI API client assumptions, and frontend types read-only.
- Backend agent must not change React components, CSS, hooks, Zustand stores, frontend types, frontend API clients, or frontend tests.
- UI agent may inspect backend contracts read-only but cannot edit backend files.
- Both agents work in separate worktrees/branches. Never concurrently edit the same branch/worktree.
- Frontend contract in Part 1 is frozen at schema version 1 for initial implementation. If code inspection proves it impossible or incorrect, submit a written contract-change proposal before implementing a different route or response.
- “Wire backend to UI” means implement exact server endpoints, response schemas, route registration, and job result fields that the frontend client calls. It does not mean restyling or rewriting frontend.
- If a frontend-side change is required to consume a backend correction, hand the exact change to the UI agent. Do not directly edit frontend code under Part 2.

---

## 2. Mandatory Deep Visual Reference Audit — .brain/

Both agents are required to deeply understand all image references, including newly added files.

Before coding:
- [ ] Recursively inventory every file under .brain/, including nested folders and files added after this plan was written.
- [ ] Identify every raster, vector, screenshot, diagram, and animated visual format.
- [ ] Open and inspect each image individually at readable/full resolution. Do not infer content from filenames alone.
- [ ] Inspect SVG source and rendered appearance. Inspect relevant frames of animated references.
- [ ] Record what each image actually communicates: visual composition, component responsibilities, states, labels, interactions, and implied data requirements.
- [ ] Create a concise reference-to-requirement map and share it with the UI agent.
- [ ] Report unreadable/corrupt/ambiguous assets by exact path. Never fabricate an interpretation or silently skip the file.
- [ ] Repeat the inventory before delivery to catch newly added references.

Known named references:
- .brain/WORKSPACE_REF/RIGGING_PRESETS.png
- .brain/WORKSPACE_REF/ANIMETION.png
- .brain/WORKSPACE_REF/xyz_and_tool_rail.png

This is not a fixed list. Recursive discovery is authoritative. Backend changes must support the real UI intent, but visual reference images do not authorize adding unimplemented backend capabilities.

---

## 3. Backend Ownership Boundary

**Allowed**
- FastAPI routers and Pydantic request/response schemas.
- Small focused backend service modules for motion preset discovery, normalized clip conversion, and safe artifact resolution.
- Backend tests and fixtures.
- Backend API documentation/OpenAPI contract updates.
- Necessary backend config only where a verified capability or safe storage path requires it.

**Forbidden unless the user explicitly authorizes a separate change**
- Rework of model inference algorithms.
- Re-tuning checkpoints, model defaults, sampling, attention, BF16, FlashAttention, or CUDA behaviour.
- Broad scheduler, database, or storage architecture refactors.
- New distributed systems, workers, queues, services, or infrastructure for this personal deployment.
- Frontend component, CSS, hook, store, type, or API-client changes.
- Direct writes of preset files into backend/storage/.
- Exposing local filesystem paths to browser clients.
- Inventing API capabilities because a visual control exists in a screenshot.

### 3.1 Protected backend areas

Treat the following as read-only unless a verified blocker proves a narrowly scoped change is necessary and the user has approved it:

- backend/adapters/ardy_adapter.py — currently working ARDY inference pipeline; inspect its actual output contract but do not casually refactor it.
- backend/adapters/skintokens_adapter.py and all other working model adapters.
- backend/thirdparty/ and upstream vendored model source.
- patcher/<model>/ — preserve model-specific patch isolation and SM80+ parity.
- backend/core/scheduler/multiprocess_scheduler.py.
- backend/core/scheduler/redis_job_queue.py.
- backend/api/routers/system.py.
- backend/api/main_multiworker.py.
- Existing workspace database schema and immutable asset lifecycle.

A need to change a protected area is a blocker/escalation, not permission for broad cleanup.

---

## 4. Phase 0 — Read-only Backend and Contract Audit

- [ ] Read both task documents and all mandatory project docs.
- [ ] Inspect current OpenAPI at authoritative /openapi.json and /docs routes where available.
- [ ] Inspect backend/api/routers/motion_generation.py, auto_rigging.py, route registration, Pydantic models, and existing response/error conventions.
- [ ] Inspect how completed jobs are normalized, how output artifacts are published, how durable artifact IDs are resolved, and how current cleanup works.
- [ ] Inspect exact storage/path resolver APIs. Do not introduce direct filesystem joins for client-provided paths.
- [ ] Inspect backend/config/models.yaml for actual enabled model capabilities/defaults and parameter schemas.
- [ ] Inspect current ARDY adapter and upstream motion representation source read-only. Identify real returned NPZ keys, dtypes, dimensions, joint order, FPS source, rotation/translation conventions, units, coordinate frame, and target skeleton identity.
- [ ] Inspect SkinTokens adapter/model parameter schema read-only.
- [ ] Trace the full existing POST /api/v1/motion request → scheduler → ARDY adapter → output artifact → completed job result → current frontend normalization path.
- [ ] Trace POST /api/v1/rig with its request/response, workspace/asset identity, output formats, and scheduler job mapping.
- [ ] Write a concise baseline note documenting what is already implemented and what is genuinely missing.
- [ ] Do not begin new endpoints until existing safe artifact/preset capabilities have been ruled in or out.

---

## 5. Phase 1 — ARDY Motion Schema Discovery (Critical Gate)

The existing ARDY adapter serializes the dictionary returned by its motion representation inverse step, adds FPS and prompt metadata, and writes an NPZ archive. Do not assume array keys are named poses, trans, joints, or rotation. Do not infer rotation representation from array shape alone.

### 5.1 Required evidence

- [ ] Obtain at least one real NPZ output produced by the current supported ARDY model/checkpoint.
- [ ] Inventory all archive entry names, dtype descriptors, shapes, endianness, scalar/string fields, and metadata.
- [ ] Trace each output array to the corresponding upstream ARDY representation field.
- [ ] Verify frame count and FPS against generated request and actual model motion representation.
- [ ] Determine exact source joint ordering and names.
- [ ] Determine whether rotations are quaternions, Euler, axis-angle, 6D rotation, or another representation from upstream source and observed output—not a guessed shape heuristic.
- [ ] Determine quaternion component order, if applicable.
- [ ] Determine coordinate handedness, up axis, forward axis, translation units, rotation units, root-motion semantics, and rest-pose convention.
- [ ] Determine source skeleton profile for the loaded checkpoint.
- [ ] Verify whether output can be retargeted to the actual SkinTokens rig and which bone mapping is valid.
- [ ] Record unavailable/ambiguous values as unavailable. Do not invent defaults unless upstream contract explicitly defines one.

### 5.2 Fixture and stop condition

- [ ] Add a small sanitized real-output fixture or documented reproducible fixture-generation path. Never claim synthetic values are real ARDY output.
- [ ] Add synthetic unit fixtures separately for parser/error-path tests.
- [ ] If a real ARDY artifact cannot be generated in the available environment, state that limitation. Synthetic tests may cover parsing only; end-to-end retarget acceptance remains blocked until a real artifact is verified.
- [ ] Do not modify ardy_adapter.py merely to force a convenient NPZ shape. If the adapter must change, stop and request approval with a precise evidence-backed proposal.

**Critical rule:** Do not mark MotionClipV1 conversion complete until a real output is understood and its coordinate/joint semantics have been verified.

---

## 6. Phase 2 — Implement the Frozen Motion API Contract

Part 1 defines a normalized frontend-facing interface. The backend must implement it using verified server-side source data and the existing storage/job lifecycle.

### 6.1 Motion preset listing

GET /api/v1/motion/presets

Response shape:

    {
      "schema_version": 1,
      "presets": [
        {
          "id": "opaque-server-issued-id",
          "name": "Walk Forward",
          "duration": 4.0,
          "fps": 20.0,
          "frame_count": 80,
          "thumbnail_url": "/api/v1/motion/presets/{id}/thumbnail",
          "clip_url": "/api/v1/motion/clips/{id}"
        }
      ]
    }

Requirements:
- Enumerate only approved NPZ preset files in the dedicated preset directory.
- Return opaque stable IDs. Never expose server filesystem paths or accept raw path fragments as preset IDs.
- Do not assume filename is a safe ID without validation/normalization.
- Missing metadata must be null or explicitly unavailable; do not invent FPS/duration.
- A malformed preset must not make the entire list fail. Log a safe warning, exclude it or return an explicit unavailable status according to the documented response contract.
- Deterministic listing order.
- No filesystem path in error strings or JSON.

### 6.2 Normalized motion clip

GET /api/v1/motion/clips/{clip_id}

Return MotionClipV1:

    {
      "schema_version": 1,
      "id": "opaque-clip-id",
      "name": "Walk Forward",
      "fps": 20.0,
      "frame_count": 80,
      "duration": 4.0,
      "skeleton_profile": "verified-source-profile",
      "coordinate_system": "verified-coordinate-system",
      "translation_units": "verified-units",
      "rotation_format": "quaternion_xyzw",
      "joint_names": ["joint_0", "joint_1"],
      "frames": [
        {
          "rotations": [[0.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, 1.0]],
          "root_translation": [0.0, 0.0, 0.0]
        }
      ]
    }

Requirements:
- This is the one normalized format consumed by the frontend. Do not expose multiple undocumented variants.
- Each frame contains exactly one rotation per joint name.
- Quaternion ordering is XYZW and explicitly declared.
- Every number must be finite; validate frame counts, joint counts, dimensions, and metadata consistency.
- Coordinate system and translation units must describe the verified source conversion.
- Do not infer semantic joint mapping from array position unless upstream source explicitly defines that order and the mapping is documented.
- Preserve source root motion semantics; do not add/remove root translation silently.
- Reject unsupported representations with a controlled 422-style response instead of returning a misleading clip.
- Bound response sizes. If JSON becomes materially large, measure it and propose a versioned compact representation before changing this contract.
- Keep clip name and metadata safe for JSON/UI display.

### 6.3 Preset thumbnail

GET /api/v1/motion/presets/{id}/thumbnail

- Serve only a sibling PNG/WEBP thumbnail associated with a validated preset ID.
- Validate canonical path containment and file type.
- Return a normal not-found response when absent.
- Never serve arbitrary files from the preset folder.

### 6.4 User-uploaded NPZ preview

POST /api/v1/motion/clips/preview

- Multipart upload field: file.
- Validate extension and actual content; filename and MIME header are not trusted.
- Parse in a bounded request context and return normalized MotionClipV1.
- Preview/inspection only. Do not store upload in backend/storage/, permanent preset directory, or workspace asset store.
- Temporary bytes must be memory-bounded or use a dedicated app-owned temporary directory with guaranteed cleanup on success, error, timeout, and cancellation.
- Return explicit 400/413/415/422 errors for invalid archive, too-large upload, unsupported format, or unsupported clip semantics.

### 6.5 Completed ARDY job result

- [ ] Reuse existing completed-job/artifact identity and safe resolver if it supports motion NPZ artifacts.
- [ ] Normalized completed job result must expose a stable motion_clip_id (or pre-existing equivalent) for the UI to request MotionClipV1.
- [ ] Clip resolver must verify the requesting clip belongs to a completed, valid motion artifact. Do not accept arbitrary filesystem paths.
- [ ] Preserve workspace_id, operation_id, asset IDs, and job ID as separate identities.
- [ ] Do not create a second job registry or bypass current scheduler/job lifecycle.
- [ ] Do not make raw temporary output paths browser-visible.

### 6.6 Endpoint registration

- [ ] Register routes in existing FastAPI router structure.
- [ ] Resolve static and parameterized route order deliberately so /presets/{id}/thumbnail or /clips/preview cannot be shadowed by a greedy route.
- [ ] Reuse existing API response/error conventions and dependencies.
- [ ] Verify routes appear in OpenAPI with accurate request/response schemas.
- [ ] Keep existing POST /api/v1/motion, checkpoint, supported-format, and available-model endpoints backward-compatible unless approved contract change is required.

---

## 7. Phase 3 — Safe NPZ and Preset Handling

### 7.1 Preset directory

Dedicated directory: backend/motion_presets/

Intended local structure:

    backend/
      motion_presets/
        .gitkeep
        walk_forward.npz
        walk_forward.png
        idle_breathing.npz
        idle_breathing.webp

- [ ] Create directory and tracked .gitkeep if not already present.
- [ ] Ignore user-dropped NPZ/thumbnail files in Git while keeping .gitkeep tracked.
- [ ] Do not add sample clips as if they were real ARDY output.
- [ ] Do not store user/premade presets inside backend/storage/.
- [ ] Do not auto-copy preview uploads into permanent preset directory.
- [ ] Preset listing is read-only.

### 7.2 Archive validation and resource limits

Treat all user-supplied NPZ files and preset files as untrusted input.

- [ ] Maximum compressed upload size.
- [ ] Maximum total uncompressed bytes.
- [ ] Maximum number of ZIP entries.
- [ ] Maximum per-entry uncompressed size.
- [ ] Maximum array element count, frame count, joints, and response size.
- [ ] Decompression timeout or bounded streaming/resource budget.
- [ ] Reject encrypted ZIPs and unsupported compression methods.
- [ ] Reject duplicate entry names, absolute paths, parent traversal, and unsupported archive metadata.
- [ ] Reject object/pickle-backed NumPy arrays. Never enable pickle loading for user content.
- [ ] Validate NPY version, header length, dtype, endianness, shape, order, and payload byte count.
- [ ] Reject non-finite numeric data, invalid FPS, zero/negative frame counts, impossible durations, and mismatched joint/rotation dimensions.
- [ ] Handle ZIP64 only if explicitly supported and resource-limited; otherwise reject cleanly.
- [ ] Avoid loading every array into memory just to list metadata.
- [ ] Do not claim “header-only” or near-zero decompression cost for DEFLATE entries unless implementation truly streams only required bytes and benchmarks prove it.
- [ ] A malicious archive must fail safely without unbounded CPU, RAM, disk, or log exposure.

### 7.3 Filesystem boundary

- [ ] Resolve IDs through server-owned metadata/allowlists; do not concatenate user input into arbitrary paths.
- [ ] Canonical path containment must be checked after resolution.
- [ ] Reject symlinks or ensure resolved targets remain inside approved directory.
- [ ] Do not expose filesystem paths in API responses, errors, client-visible logs, or download names.
- [ ] Follow canonical file/path resolvers documented in Docs/SECURITY.md.
- [ ] Keep backend ports private for remote deployments unless perimeter authentication is configured.

### 7.4 Preset metadata scanning

- [ ] Deterministic scan of approved top-level preset files.
- [ ] Pair optional thumbnail by basename only after safe path checks.
- [ ] Read minimum metadata needed. Compressed ZIP members may require decompression even to reach NPY headers; enforce limits and measure this.
- [ ] One corrupt preset does not crash listing.
- [ ] Do not silently use 20 FPS or another fallback unless real source/model contract declares it. Unknown metadata remains unknown.

---

## 8. Phase 4 — Rigging API and SkinTokens Contract Alignment

- [ ] Inspect current AutoRigRequest, AutoRigResponse, actual adapter, and model registry parameter schema.
- [ ] Preserve backward compatibility for mesh reference, workspace identity, operation identity, output format, and model preference.
- [ ] Supported SkinTokens parameters currently include use_skeleton, use_transfer, use_postprocess, top_k, top_p, temperature, repetition_penalty, and num_beams; verify current schema before changing validation/defaults.
- [ ] Do not implement quadruped/generic skeleton controls if model only supports humanoid rigging.
- [ ] Do not accept or persist unsupported bind_pose, facial/finger-bone, symmetry, max-influences, or alternative skinning controls unless verified backend capability exists.
- [ ] GLB and FBX output are allowed only through current supported SkinTokens output contract. This is not a request to add arbitrary FBX conversion.
- [ ] Forward only validated model parameters and do not allow arbitrary unbounded dictionaries to bypass model schemas.
- [ ] Preserve existing scheduler submission, queue limits, operation lineage, cancellation, and durable artifact publishing.
- [ ] Do not edit SkinTokens adapter/inference logic simply to make UI values appear supported.

---

## 9. Phase 5 — Job, Artifact, and UI Contract Wiring

The backend is responsible for making the Part 1 API client calls real.

- [ ] Confirm frontend uses existing API proxy and exact endpoint URLs in Part 1.
- [ ] Implement server route/response shape that frontend client expects.
- [ ] Ensure preset list URLs resolve to correct clip and thumbnail endpoints.
- [ ] Ensure completed ARDY jobs expose a stable motion clip ID, not a raw file path.
- [ ] Ensure normalized clip metadata derives from verified NPZ and model representation.
- [ ] Preserve existing job and artifact state machine; do not publish a clip as ready before its artifact is durable/accessible.
- [ ] Handle expired/deleted artifacts and missing preset files with documented 404 response.
- [ ] Verify frontend can fetch clips through existing same-origin API proxy and does not need CORS or direct filesystem access.
- [ ] Do not change frontend code under this task. If API client assumptions need a frontend change, return a precise handoff with schema diff.

### 9.1 Motion generation request

The current API already has prompt, duration, seed, checkpoint, post_process, target_skeleton, target_bones, constraints, workspace_id, input_asset_id, and model_parameters fields. Trace how each field is actually used by the loaded model before promising a UI control.

- [ ] Forward workspace_id and input_asset_id correctly from the frontend request contract.
- [ ] Keep prompt, duration, and seed correctly recorded in job metadata.
- [ ] Verify which checkpoint is actually loaded at startup and whether a request checkpoint is honoured.
- [ ] Do not claim that passing target_skeleton, post_process, or fps changes output unless actual model/adapter applies it.
- [ ] Do not introduce selectable 24/30/60 FPS or Core/G1 options solely because they appear in an old UI draft.
- [ ] If multiple checkpoints/skeletons are not genuinely supported by current loaded model, expose the actual single supported profile in metadata and leave UI selection disabled/absent.
- [ ] Keep CPU-only ARDY inference semantics and single-worker limits intact.

### 9.2 Artifact identity and persistence

- [ ] Trace whether motion artifacts are copied/persisted by current scheduler and which durable identifier resolves them.
- [ ] Reuse existing job/artifact download and storage resolver if safe.
- [ ] Do not create separate duplicate job table or motion-only storage tree unless current lifecycle cannot safely represent the clip and user approves a design.
- [ ] Never return output_motion_path, file_path, temp directory paths, or absolute local paths to frontend.
- [ ] Do not delete generated user artifacts during preview cleanup.
- [ ] Distinguish user presets from generated job artifacts. Presets are in backend/motion_presets/; generated artifacts follow existing workspace/job retention model.

---

## 10. Backend TODO / NOT-TO-DO Checklist

### TODO
- [ ] Read both task files and all mandatory docs.
- [ ] Complete full recursive .brain image audit and share reference map.
- [ ] Audit existing routes/OpenAPI and artifact lifecycle before adding endpoints.
- [ ] Verify real ARDY NPZ schema from upstream source and a real artifact.
- [ ] Create deterministic fixtures for parser/unit/integration tests.
- [ ] Freeze MotionClipV1 schema and implement Part 1 endpoint contract.
- [ ] Implement bounded preset listing, clip retrieval, thumbnail serving, and preview upload.
- [ ] Add strict path, ZIP, NPY, dtype, shape, frame, and memory limits.
- [ ] Preserve existing job/workspace/operation/asset IDs and artifact lifecycle.
- [ ] Align rigging request validation with real SkinTokens capability metadata.
- [ ] Add backend tests for success, malformed data, missing data, traversal, limits, lifecycle, and OpenAPI.
- [ ] Update backend API documentation and changelog only after code is verified.
- [ ] Confirm all endpoint paths and JSON shapes match Part 1 exactly.
- [ ] Report any schema mismatch to UI agent rather than editing frontend files.

### NOT-TO-DO
- [ ] Do not edit frontend React components, CSS, stores, hooks, types, API clients, or frontend tests.
- [ ] Do not redesign the UI.
- [ ] Do not modify ARDY or SkinTokens inference behaviour without explicit approval.
- [ ] Do not change scheduler/database architecture to solve a small API task.
- [ ] Do not invent ARDY NPZ keys, joint names/order, rotation formats, or coordinate systems.
- [ ] Do not enable unsupported FPS, checkpoint, skeleton, cleanup, or rigging parameters.
- [ ] Do not write uploaded/premade presets into backend/storage/.
- [ ] Do not expose raw filesystem paths.
- [ ] Do not accept unbounded archive sizes, decompression, array shapes, or frame counts.
- [ ] Do not create fake assets, clips, job completion, or placeholder response data.
- [ ] Do not add microservices, Redis/queue replacements, multi-tenant auth, or enterprise abstractions for this task.
- [ ] Do not run GPU inference benchmarks or claim faster inference as part of this API/UI task.

---

## 11. Backend Tests and Acceptance Criteria

### 11.1 Unit tests

- [ ] Preset directory scanning is deterministic.
- [ ] Valid NPZ listing returns correct ID, name, FPS, frame count, duration, and thumbnail URL.
- [ ] Missing metadata is handled without fabricating values.
- [ ] Corrupt archive is isolated and does not break entire listing.
- [ ] NPY parser validates version, dtype, shape, byte count, endianness, and finite values.
- [ ] Object/pickle arrays are rejected.
- [ ] ZIP duplicate entry, path traversal, encryption, unsupported compression, ZIP64 policy, and size-limit cases are tested.
- [ ] Path resolver rejects traversal, absolute paths, symlink escapes, and unknown IDs.
- [ ] Clip normalization matches MotionClipV1 exactly.
- [ ] Quaternion order and joint/frame dimensions are verified.
- [ ] Unsupported coordinate/rotation data returns controlled error.

### 11.2 API tests

- [ ] GET /api/v1/motion/presets returns documented schema.
- [ ] GET /api/v1/motion/clips/{id} returns documented MotionClipV1 schema.
- [ ] GET thumbnail serves only verified PNG/WEBP siblings.
- [ ] POST preview accepts valid bounded files and rejects invalid/oversized files.
- [ ] Preview does not persist user uploads to backend/storage/ or permanent presets.
- [ ] Completed ARDY job exposes a stable motion_clip_id and the clip can be resolved.
- [ ] Deleted/expired artifact returns 404 without revealing filesystem path.
- [ ] Existing POST motion and rig APIs remain backward-compatible.
- [ ] OpenAPI includes accurate request/response definitions and route docs.

### 11.3 Integration and lifecycle tests

- [ ] A real ARDY-generated NPZ can be resolved to MotionClipV1.
- [ ] Real fixture FPS/frame_count/duration agree with source metadata.
- [ ] Actual joint mapping and coordinate convention are validated against a known rigged test model.
- [ ] Missing/invalid skeleton mapping never returns a plausible but incorrect animation.
- [ ] Concurrent requests remain within configured limits.
- [ ] Preview temporary data is cleaned after success, failure, timeout, and cancellation.
- [ ] Preset list/preview does not mutate workspace asset versions.
- [ ] Existing scheduler queue, cancellation, operation persistence, and model loading tests continue passing.

### 11.4 Required backend checks

Run current project CPU-safe checks and report exact results:
- [ ] Python compile check for first-party backend files.
- [ ] Focused motion preset/normalization API tests.
- [ ] Existing backend regression, API integration, and lifecycle tests relevant to changed code.
- [ ] python scripts/verify_contracts.py if current project setup supports it.
- [ ] Shell syntax checks only if shell scripts changed.
- [ ] Do not claim GPU/model inference tests passed when they were not run.

### 11.5 Acceptance gate

Backend work is complete only when:
1. Real ARDY schema and mapping are evidence-backed, or unresolved real-artifact gate is explicitly reported.
2. API response matches Part 1 exactly.
3. Security/resource limits have tests.
4. Completed-job artifact ID resolves safely.
5. Existing motion/rigging/model/scheduler behaviour remains intact.
6. Backend test results and known failures are reported.
7. No frontend file was changed by backend agent.

---

## 12. Backend Delivery and UI Handoff

The backend agent must provide:
1. Commit SHA and changed backend files.
2. Completed phases and unchecked/incomplete tasks.
3. Recursive .brain inventory and image-to-requirement map.
4. Verified real ARDY NPZ schema: archive entry names, dtypes, shapes, FPS, frame count, joint order, coordinate system, units, rotation convention, and source skeleton.
5. MotionClipV1 schema and exact OpenAPI route definitions.
6. Example successful request/response and documented error responses.
7. Security limits and test evidence.
8. Proof that preview upload does not persist to backend/storage.
9. Proof that generated job clips resolve using durable server-owned IDs.
10. Backend test/compile results and pre-existing failures.
11. Any frontend handoff request as a precise endpoint/type diff. Do not implement that frontend change.

**End of Part 2.** This file is the backend implementation specification. Part 1 remains the UI/UX and frontend source of truth.
