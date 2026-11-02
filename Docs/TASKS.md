# ForMesh3D — Official Model Integration, Thin Adapters, Shared Weight Loader & Model-Specific Patchers

**Document type:** Architecture and implementation plan  
**Target repository:** `Silentzx2/ForMesh3D`  
**Target branch:** `dev`  
**Third-party repository:** `Silentzx2/ForMesh3D-ThirdParty`

> **Implementation audit — 2026-11-01:** The structural work (17 adapter modules, registry entries, shared weights resolver, downloader root, and per-model patcher convention) is present, but this task is **not acceptance-complete**. Static review found integration defects in model identity propagation, Pixal3D, Paint3D, UniRig, FastMesh V4K, TRELLIS text painting, and model-source import setup. **Model-source import setup is now resolved**: TRELLIS, TripoSG, and Unique3D adapters add the correct ThirdParty source root to `sys.path` in `_load_model`; TRELLIS downloads full weights from HuggingFace Hub (`microsoft/TRELLIS.2-4B`) when local weights are absent and moves the pipeline to CUDA; Unique3D uses `device_map="balanced"` and `chdir`s to the weights dir for `./ckpt/` paths; TripoSG handles `diso` CUDA mesh-extraction failure on pre-Ampere GPUs. The checked-in workflow also referenced deleted tests; this update replaces those references with a focused loader contract test. No model checkpoint load, GPU inference, or generated-mesh quality validation was run. The unchecked acceptance items below are intentionally left open until fixed and verified.


---

## 1. Objective

Integrate each model by keeping its complete model implementation inside `ForMesh3D-ThirdParty` and connecting it to ForMesh3D through a thin, model-specific adapter.

The adapter must import and call the official inference API/classes/functions supplied by that model's source code. It must not copy the model implementation or duplicate the imports and internal logic already owned by the official model package. The adapter is an integration layer: it receives the input supplied by the existing ForMesh3D backend flow, obtains the model's weights directory from one shared `loader.py`, calls the official inference code, and returns the resulting mesh file/path and execution status through the existing backend contract.

The model's official code remains responsible for its own dependencies and internal imports, preprocessing, inference, sampling, geometry/mesh generation, extraction, and model-specific postprocessing. If the official inference API returns an in-memory mesh object rather than writing a file, the adapter may call the official export/conversion helper supplied by that same model source. It must not reimplement that export logic. If the official API already writes the final mesh, the adapter only validates and returns the produced file.

A shared `backend/loader.py` will be imported by each model adapter. Its only responsibility is to resolve the weights directory for the requested model under one configurable shared storage root. The environment configuration sets the root directory (by default, `backend/pretrained`); `loader.py` appends the model key to obtain that model's weights directory. The download manager must use the same configured root and destination convention so downloads land where the adapters and official loaders expect them.

A separate root-level `patcher/` directory will contain only model-specific external fixes required to resolve import, initialization, or pipeline-loading issues. A patcher must run in the target model process and at the required point in its startup sequence.

The aim is to preserve official model behavior, avoid duplicating model code or inference logic, centralize only the weights-root/model-directory resolution, and keep ForMesh3D-specific integration fixes isolated.

This refactor does **not** introduce a new application input/output storage layout. The existing ForMesh3D filesystem storage, upload and file-ID resolution, temporary-input lifecycle, canonical asset workspace, manifests, artifact downloads, and cleanup/deletion behavior remain authoritative. `MODEL_STORAGE_ROOT` is only for model weights; it is separate from the application's existing `STORAGE_LOCAL_PATH`.

## 2. Non-Negotiable Architecture Rules

1. **All model repositories stay inside `ForMesh3D-ThirdParty`.** Do not move model repositories outside that repository.
2. **Use the official model implementation as the source of truth.** Compare an existing integrated copy with its official upstream revision before refreshing or replacing it.
3. **The complete model implementation stays in ThirdParty.** This includes architecture, pipeline internals, model-owned imports/dependencies, preprocessing, inference, sampling, mesh generation/extraction, and model-specific postprocessing/export helpers.
4. **Adapters import and call the official model API.** They must not copy the complete model implementation or duplicate the model package's internal imports and inference logic.
5. **Adapters remain thin integration layers.** They receive backend input, obtain the model weights directory from the shared `loader.py`, call the official API, ensure the final mesh output is available, and return the existing result/status contract.
6. **Use the adapter supplied for each model as the starting point.** The implementation task is to inspect, improve, and minimally tweak that adapter for correct ForMesh3D integration. Do not replace it with a generic adapter or generate a new per-model adapter from assumptions unless explicitly requested.
7. **The official model code owns model-specific behavior.** Preserve its preprocessing, inference, sampling, geometry/mesh generation, extraction, and official postprocessing/export behavior.
8. **Use one shared `backend/loader.py` for model weights paths.** Each adapter imports it and asks for its own model weights directory. It must not become a general model registry, inference-parameter manager, ThirdParty source resolver, or downloader.
9. **The environment configures only the shared weights root.** For example, set the root to `backend/pretrained`; do not configure a separate full weights path for every model. `loader.py` appends the model key to that root.
10. **The download manager uses the same configured weights root and per-model directory convention.** Do not let downloading and inference resolve to different storage locations.
11. **Each model gets its own patcher area only when needed.** A patch for one model must not silently affect another model.
12. **Patcher files are only for inference/pipeline import or loading issues.** Do not use `patcher/` for model implementations, adapters, general utilities, or unrelated application logic.
13. **Do not change official defaults without a specific requirement.** When a parameter is not explicitly supplied, preserve the official API's default behavior.
14. **Do not introduce unnecessary YAML configuration.** Model inference parameters remain with the model's code/configuration or are passed through its supported API. Do not duplicate them in ForMesh3D YAML files.
15. **Do not rewrite the scheduler, planner, API, frontend, or unrelated pipeline components as part of this refactor.** Change them only if inspection proves a change is required for the adapter/loader connection.
16. **Keep ThirdParty source imports model-specific and separate from weights resolution.** Each adapter must configure only the source path/import setup its own official package needs; do not make the shared weights loader or a global import-path mutation responsible for every model.
17. **Preserve the existing ForMesh3D input/output storage contract.** Use the existing `STORAGE_LOCAL_PATH`/`get_storage_base_dir()` root, upload/file-ID resolution, temporary-input cleanup, canonical post-processing workspace, manifests, and job artifact routes. Do not introduce separate `INPUT_STORAGE_ROOT`/`OUTPUT_STORAGE_ROOT` settings or a competing storage layout as part of this model-integration refactor.

## 3. Repository and Model-Code Organisation

### 3.1 Third-party model repositories

Keep each model repository under `ForMesh3D-ThirdParty`. The integrated project must execute the model from its location inside that repository.

Before replacing or refreshing an existing model directory:

- Inspect the current model directory and its Git state.
- Identify the upstream repository and the corresponding official revision.
- Compare the current integrated copy against the official upstream implementation.
- Identify existing local modifications and determine which ones are required for ForMesh3D integration.
- Preserve required integration changes, such as supported checkpoint/weight path adjustments, where they cannot be handled externally.
- Do not discard useful changes or overwrite a working model directory without first recording what differs and why.

Where a fresh official clone is selected, keep the clone inside `ForMesh3D-ThirdParty` and make only the minimum integration changes required. Do not make broad changes to official inference behavior merely to fit the adapter.

### 3.2 Official inference API / entry point

For each model, identify the official inference interface exposed by its source repository. Prefer a reusable Python API (official pipeline class, inference function, or documented callable) and import it directly from the model source inside `ForMesh3D-ThirdParty`.

Do not assume that every model uses the same module name, class, function, CLI, or entry-point filename. Inspect its official example, documentation, and implementation to determine:

- Which public class/function should be imported and called.
- How the official code expects its model weights directory to be supplied.
- What input type it expects (for example, an image path or an image object).
- What the inference call returns: a saved mesh path, an output object, or an in-memory mesh representation.
- Whether the official pipeline writes the final mesh itself or exposes an official export/conversion helper that must be called after inference.

If the repository only exposes a supported CLI or process entry point and no suitable direct Python API, use that official interface. Do not assume that a web/demo UI is the inference API; when possible, call the underlying official pipeline interface rather than automating the UI.

The actual interface, imports, arguments, return types, and export behavior must be verified from that model's own source. The adapter must call the real supported interface, not invent a common interface that the model does not provide.

### 3.3 Model-specific ThirdParty source path and import setup

The official model source code stays under `ForMesh3D-ThirdParty`, but the import path required to reach that source must be determined separately for each model. Different repositories may have different package layouts, module names, and expected import roots. Do not assume that adding the same directory to `sys.path` will work for every model.

For each model-specific adapter:

1. Inspect that model repository's actual package layout, packaging metadata, official examples, and import statements to identify the correct import root.
2. Prefer the repository's supported installation/package mechanism (for example, an editable install) when it makes the official package importable in the intended runtime.
3. If the official package is not already importable and installation is not appropriate, configure only that model's required source path in that model's adapter or its dedicated import-setup helper.
4. Derive repository paths from a stable ForMesh3D project root or the known ThirdParty root. Do not rely on the process's incidental current working directory or hardcode machine-specific absolute paths.
5. Add a path to `sys.path` only when inspection proves it is necessary. Add the correct repository/package parent directory—not an arbitrary nested folder—and do so before importing the affected official module.
6. Keep the setup scoped to the model being launched. Do not append every model repository to `sys.path` globally or make one model's import setup alter another model's resolution.
7. Preserve the official model's own import statements and package structure. Do not rewrite upstream imports to point into ForMesh3D backend modules merely to make them resolve.
8. If an import issue requires a runtime adjustment at a specific point, use that model's patcher where appropriate and execute it in the target model process before the affected import.

This source-path setup is independent of model weights. `MODEL_STORAGE_ROOT` and `backend/loader.py` resolve weights only; they must not be used to locate or import Python source code. A correct source import path does not guarantee that dependencies, CUDA/runtime requirements, or checkpoints are available—those must be validated separately using the model's official requirements and loading mechanism.

---

## 4. Adapter Responsibilities

Each model adapter is a small integration layer around the official inference API. A model-specific adapter will be supplied/placed in the adapter directory; the task is to review, improve, and minimally tweak that adapter based on the real official source and ForMesh3D contracts. Do not rebuild an adapter from scratch when a working model-specific adapter is already present.

### 4.1 Adapter must

1. Receive the input image (or other input required by that particular model) from the existing ForMesh3D backend flow. The adapter must not import or reach into the frontend/UI to fetch the input itself.
2. Import only the official public inference class/function/API that the adapter directly uses from the model source inside `ForMesh3D-ThirdParty`.
3. Import the shared `backend/loader.py` and request the weights directory using the model's canonical key/name.
4. Pass the resolved weights directory to the official model loader in the exact way supported by that model. The adapter must not construct a second hardcoded absolute weights path.
5. Perform only minimal input adaptation required by the official API (for example, convert a supplied image path to the required image object or apply a required image mode). Do not duplicate the official preprocessing pipeline.
6. Initialize or obtain the official model pipeline using its documented interface and the existing runtime/environment required by the model.
7. Pass the received input and only explicitly requested, officially supported parameters to the official inference call. Preserve official defaults for parameters not overridden by ForMesh3D.
8. Call the official inference API and allow the model's own source code to perform its internal imports, preprocessing, inference, sampling, and mesh generation/extraction.
9. Handle the actual official return type. If the official API already writes the final mesh file, collect that path. If it returns an in-memory mesh/output object, call the official export/conversion helper from the model source to write the final file. Do not implement a separate mesh exporter or duplicate official conversion logic.
10. Pass a job-specific output path/location when the official interface supports it. Otherwise, use the official export API to write the result to the output location required by the existing ForMesh3D contract.
11. Verify that the expected mesh file exists and is usable before reporting success; return the output path, execution status, and any required metadata through the existing adapter/result contract.
12. Make execution logs and useful failures available through the existing ForMesh3D logging/result mechanism.
13. Use the shared loader's resolved path consistently; do not maintain a second independent weights-path implementation in the adapter.

### 4.2 Adapter must not

- Copy the model's main source code, architecture, pipeline implementation, or internal dependency imports into the adapter.
- Duplicate model-internal imports merely because they appear in an official example. Import only APIs and helpers the adapter directly calls; dependencies used internally by the official package remain owned by that package.
- Reimplement preprocessing already performed by the official API.
- Reimplement inference, sampling, geometry generation, mesh extraction, or model-specific postprocessing.
- Reimplement mesh-to-file conversion when an official exporter/helper already exists.
- Assume `pipeline.run(...)` or any other generic method name/return type across models. Use the real API and return type for the current adapter.
- Import the frontend/UI or bypass the existing backend input contract to obtain an image.
- Hardcode a complete model weights path or define a model-specific environment variable for it.
- Add independent model-specific inference defaults that conflict with official defaults.
- Hardcode a second set of sampling, resolution, inference-step, extraction, or similar model parameters when the official API already owns them.
- Change generated geometry as a substitute for the official model pipeline.
- Become a second model implementation, model registry, weight downloader, or generic inference-configuration layer.

### 4.3 Imports and dependency ownership

The official model package is responsible for its own internal imports and dependencies. The adapter should import only the public pipeline/class/function and any official helper that it directly calls. It should not copy all imports shown in the model's example script into the adapter.

For example, if an official inference example imports a model pipeline and then calls an official exporter, the adapter imports the pipeline API and the exporter only if the adapter itself must invoke both. If the official pipeline already performs export internally, the adapter does not need to import or call the exporter separately.

If an external runtime/import workaround is required, place it in that model's patcher and execute it before the affected official module is imported. Do not add internal model dependencies to the adapter just to work around a loading problem unless the verified fix specifically requires an adapter-side import.

The adapter's ThirdParty source import setup is model-specific. First use the official package's normal installation/import mechanism. Only when that is insufficient should the adapter add the verified source import root to `sys.path`, before the official import. Do not apply a shared/global `sys.path` change for all model repositories, and do not place this source-path logic inside `backend/loader.py`; that file is reserved for weights-directory resolution.

### 4.4 Input and output contract

**Input:** The image/input arrives from the existing backend request and is passed into the adapter. The adapter must respect the existing input contract and then adapt it only as required by the official model API. Depending on the model, the API may accept a file path, PIL/image object, or another documented input representation.

**Output:** The adapter must deliver the final mesh file/path expected by ForMesh3D. The actual official pipeline may either:

- Write a mesh file directly and return its path or output record; or
- Return an in-memory mesh/output object that must be written using the official model's own exporter/conversion helper.

Inspect the official source to establish which case applies. The adapter may connect the official exporter to ForMesh3D's existing output handoff, but must not duplicate the export algorithm. Validate the result before returning success.

### 4.5 Existing ForMesh3D storage contract — preserve it

The backend already has an application storage system. Model integration must plug into it rather than creating a second input/output storage system. The model-weights root described in Section 6 is independent and must not replace or control this application storage root.

1. **One existing application storage root:** `STORAGE_LOCAL_PATH` is the configured application file-storage root. The current `get_storage_base_dir()` helper resolves it (using the project's existing default when unset). Continue using that helper for application uploads and generated assets; do not build a parallel path resolver in adapters.
2. **Uploaded images and file IDs:** Keep the existing `POST /api/v1/file-upload/image` flow in `backend/api/routers/file_upload.py`. It stores uploaded image bytes under the configured storage root's `uploads/image/` hierarchy and writes a durable upload manifest. The API returns a `file_id`; generation requests can pass that ID and the backend resolves it to the real local file path. Adapters must consume the already-resolved input supplied by the backend, not create or search for their own upload directory.
3. **Existing generation input modes:** Preserve the current input handling for `file_id`, `file_path`, Base64 data, and direct `UploadFile` input. The generation route normalizes these through `process_file_input()` and places the resolved path in the job input contract (including `image_path`). Base64/direct-upload request inputs may use managed `mesh_gen_*` temporary directories; the scheduler owns their cleanup when the job no longer needs them. Do not move this temporary-input responsibility into `loader.py` or model adapters.
4. **Model output handoff:** The adapter returns the actual raw mesh output path and status through the existing model/result contract. It must not invent a replacement output directory convention. The scheduler's existing result handling decides whether the result enters production post-processing, manual mesh-tool persistence, or the existing bypass path.
5. **Canonical production asset workspace:** For production post-processing, continue using `backend/postprocess/pipeline.py` and its canonical workspace under `<application-storage-root>/models/meshes/<asset-name>_<job-id>/`. Preserve the existing `master/source.glb` lineage and the established `game_ready/`, `lods/`, `textures/`, `collision/`, `previews/`, `rigging/`, and `metadata/` layout. The `asset.json` and `job.json` manifests declare artifacts and support later resolution. Do not make the adapter independently create a competing canonical workspace. This production layout is conditional on the existing post-processing mode; manual-tool and post-processing-bypass jobs must retain their current handling.
6. **Metadata, downloads, and cleanup remain backend-owned:** Redis `FileStore` is used for file metadata in the multi-worker flow; uploaded file contents and generated mesh artifacts remain on the configured filesystem storage. Preserve the existing upload download and job artifact download endpoints and their manifest/path resolution. Durable uploaded files remain retained until their existing explicit deletion path is used. Temporary input directories are cleaned by the scheduler; existing scratch/temp cleanup must continue to protect canonical master assets and uploads. Job deletion must retain its current ordering: delete the durable job record successfully before removing its canonical asset workspace. Do not treat Redis metadata as the binary storage destination.

**Retention edge case to keep visible:** job-input downloads rely on the original input path still existing. Because Base64/direct-upload inputs use temporary directories that are cleaned when job ownership ends, a later request to download such an input may no longer find it. Do not silently change this retention policy in the adapter/weights-loader work; treat any longer input-retention requirement as a separate, explicit storage-policy change.

The relevant existing implementation boundaries are `backend/core/utils/file_utils.py` (`get_storage_base_dir()`), `backend/api/routers/file_upload.py` (uploads and file-ID resolution), `backend/api/routers/mesh_generation.py` (`process_file_input()`), `backend/core/scheduler/multiprocess_scheduler.py` (job handoff and temporary-input cleanup), `backend/postprocess/pipeline.py` (canonical asset workspace and manifests), and `backend/api/routers/system.py` (job artifact downloads and cleanup/deletion). Inspect the current code before changing any of these contracts.

### 4.6 Parameters and defaults

- Use the parameters actually supported by the official API or entry point.
- Preserve official defaults when ForMesh3D has not explicitly supplied an override.
- Pass an override only when required by the request and supported by the model.
- Do not invent common parameter names or assume two models expose identical arguments.
- Do not move model-specific inference parameters into a generic adapter or YAML configuration merely for consistency.

## 5. Model-Specific Patcher System

### 5.1 Purpose

Create a directory named `patcher/` for external, model-specific fixes required when an inference pipeline cannot import, initialize, or load correctly without a compatibility adjustment.

The patcher exists for cases where:

- A runtime/import issue must be fixed without editing the model's source files.
- A pipeline-loading issue needs a small external compatibility patch.
- A module or dependency must be imported or prepared at a particular point during startup.
- A narrowly scoped change is needed before a specific model pipeline component is loaded.

The `torch` example illustrates the intended behavior: if a particular model pipeline needs `torch` imported at a specific point but the model source must not be edited, that model's patcher performs the required import in the model's runtime at the required point so the pipeline can continue loading.

This is an example of the patcher's role, not a requirement to add a `torch` patch to every model.

### 5.2 Directory ownership and separation

Use one patcher area per model. A conceptual layout is:

```text
ForMesh3D/
├── adapters/
│   ├── model_a_adapter.py
│   └── model_b_adapter.py
│
├── patcher/
│   ├── model_a/
│   │   └── <only model-a runtime/import/pipeline-load patches>
│   └── model_b/
│       └── <only model-b runtime/import/pipeline-load patches>
│
└── ...

ForMesh3D-ThirdParty/
├── Model-A/
│   ├── app.py / main.py / official entry point
│   └── ... official model files ...
└── Model-B/
    ├── app.py / main.py / official entry point
    └── ... official model files ...
```

The names above are illustrative. Use the actual model names and the project's actual adapter directory/layout.

### 5.3 Patcher responsibilities

Each model-specific patcher may contain only the files needed to fix that model's inference or pipeline import/loading issue.

A patcher must:

1. Belong to one clearly identified model.
2. Apply only the required external fix for that model.
3. Run at the exact lifecycle point where the problem needs to be addressed—for example, before a particular module is imported or before the affected pipeline component is initialized.
4. Run in the same Python runtime/process whose imports or pipeline loading it needs to affect.
5. Leave the official model source files unchanged whenever the issue can be fixed externally.
6. Avoid changing unrelated model behavior or global application behavior.
7. Be narrowly scoped so that it does not affect other models.

A patcher is not a replacement for the official entry point. It only prepares or adjusts the runtime where a specific integration/loading issue requires it; the official entry point still performs inference.

### 5.4 Exact timing and process boundary

“Externally importing” a module must happen inside the Python process whose pipeline needs that module. A separate, unrelated Python process cannot import a module into the model process merely by importing it itself.

Therefore, the model's launch sequence must make that model's patcher execute in the target runtime at the required time. Depending on the specific issue, this may mean running the patcher before the official entry point starts importing the affected pipeline code, or invoking a targeted patch immediately before the affected loading step.

Do not run every model's patcher globally. Only the patcher belonging to the model being launched should run, and only the required patch should be applied.

### 5.5 Patcher must not

- Contain a copy of the model's inference implementation.
- Become a second adapter or a replacement `app.py`/`main.py`.
- Store ordinary model parameters that belong in the official model code/configuration.
- Change sampling, resolution, inference steps, or mesh extraction behavior without a specific, necessary runtime-loading fix.
- Apply broad global monkey patches when a model-scoped fix is sufficient.
- Modify other models' runtime behavior.
- Become a general-purpose folder for unrelated workarounds.

## 6. Shared Model Weights Loader and Path Resolution

Use one shared file, preferably `backend/loader.py`, to resolve the per-model weights directory. Every model adapter imports this shared loader instead of building its own weights path.

This loader has a deliberately narrow responsibility: **take a model key and return that model's weights directory under the configured shared storage root.** It does not load the model, download weights, locate ThirdParty source code, select a model, configure inference parameters, or handle output directories.

### 6.1 Environment variable owns only the shared root

Use one environment setting for the common model-weights root, for example:

```env
MODEL_STORAGE_ROOT=backend/pretrained
```

The environment value is the parent/root directory only. It must not contain a separate full path for each model. The default may be the project's `backend/pretrained` directory when the environment variable is not set.

The configured root may also be an absolute path to another mounted storage location. If a relative path is supplied (such as `backend/pretrained`), resolve it against a stable ForMesh3D project root—not the process's incidental current working directory—so the result does not change depending on how the backend or worker was launched.

### 6.2 What `loader.py` does

Each adapter calls the shared loader with its own canonical model key. The loader appends that key to the configured root and returns the resulting model-specific directory.

Conceptually:

```text
Environment:
  MODEL_STORAGE_ROOT = backend/pretrained

Shared loader:
  get_model_weights_dir(model_key)
      -> <MODEL_STORAGE_ROOT>/<model_key>

Resolved directory example:
  backend/pretrained/<model_key>
```

The example is a directory pattern, not a literal model name or a requirement to hardcode a full path in an adapter.

The shared loader should:

1. Read the single configured weights-root value and apply the documented default if it is absent.
2. Resolve relative roots against the stable project root and normalize the resulting path.
3. Accept a validated model key and safely append it as one directory component (reject path traversal or arbitrary paths).
4. Return the model-specific weights directory to the caller.
5. Optionally create the target directory when requested by the download manager; ordinary inference resolution should not silently download or fabricate missing weights.
6. Provide a clear error when the expected directory or required files are missing or inaccessible, while leaving model-specific checkpoint-layout validation to the official loader where appropriate.

The adapter then passes the resolved directory to the official model loader using that model's actual supported argument or configuration mechanism. The official model code remains responsible for understanding its own checkpoint layout and loading its weights.

### 6.3 Responsibilities that do not belong in `loader.py`

- Do not resolve or manage the ThirdParty source repository path; model source remains in `ForMesh3D-ThirdParty` and its import setup is handled by the existing project/runtime arrangement.
- Do not load model weights into memory or initialize a pipeline.
- Do not download files or implement download/retry/resume logic.
- Do not store model-specific inference defaults, VRAM rules, capabilities, or model-selection logic.
- Do not resolve mesh output/job directories.
- Do not add one environment variable per model or keep a separate hardcoded absolute weights path in every adapter.

### 6.4 Download manager must use the same root

The existing model download manager must be configured to read the same `MODEL_STORAGE_ROOT` value and save each model's downloaded files into the same per-model directory convention returned by `loader.py`:

```text
<MODEL_STORAGE_ROOT>/<model_key>/
```

The download manager must not continue saving to a hardcoded `backend/pretrained` location when the environment points somewhere else. It must also not create a different directory naming convention from the loader. Prefer reusing the shared path-resolution function (or the same single helper/contract) so both downloading and inference agree on the destination.

When the environment is set to `backend/pretrained`, the download manager saves under that root and each adapter receives its model subdirectory from `loader.py`. When the environment is changed to another valid root, both downloading and inference move together without editing individual adapters or model source code.

The download manager should report download completion/failure using the existing status/logging mechanism. `loader.py` remains a path resolver, not a downloader.

### 6.5 Path ownership summary

- **Environment configuration:** sets the shared model-weights root only.
- **`backend/loader.py`:** turns that root plus a model key into the model-specific weights directory.
- **Download manager:** saves weights into the directory resolved by the same shared convention.
- **Model adapter:** asks the loader for the directory and passes it to the official model API.
- **ThirdParty official code:** loads and interprets the model's actual checkpoint files.
- **Output path:** continues to come from the existing ForMesh3D job/output contract; it is not part of the weights loader.

## 7. YAML Configuration Direction

The purpose of this refactor is to avoid keeping duplicate model inference configuration outside the model implementation.

### 7.1 `models.yaml`

A separate `models.yaml` is not required solely to store model paths or duplicate model information if the path resolver/model registry handles those responsibilities elsewhere. It may be removed only after confirming that no existing component still depends on it for model discovery, enable/disable state, capabilities, VRAM requirements, or other runtime behavior try to use it donot delete.

Do not silently remove behavior currently supplied by `models.yaml`. First identify every reader and consumer, then move only genuinely required responsibilities to the existing code/path-resolution mechanism if they are still needed.

### 7.2 `quality.yaml`

Do not use `quality.yaml` as a second place to define model inference parameters. Parameters that control the official model's own inference must stay with that model's code/configuration or be passed through its supported entry-point flags. try to use this donot delete

If the current `quality.yaml` is not needed by any remaining quality-evaluation behavior, it can be removed after checking its consumers. Do not assume that changing model parameters and removing a quality configuration file are the same operation: inspect whether the file also controls separate validation or acceptance behavior before deleting it.

### 7.3 Other YAML files

Do not add new YAML files for the adapter, patcher, or model inference parameters. Do not delete or rewrite other existing YAML files as part of this plan unless their actual usage is inspected and a specific change is required. No YAML file should duplicate the official model's inference defaults.

## 8. Expected Execution Flow

### 8.1 Model inference flow

```text
User image / existing backend request
                |
                v
      Existing upload / input-resolution flow
      (file_id, file_path, Base64, or direct upload)
                |
                v
      Resolved input path in the existing job contract
      (for example, image_path)
                |
                v
         Existing scheduler
                |
                v
       Existing model-specific adapter
       (adapter is inspected and improved;
        do not replace it generically)
                |
                |-- Receive backend input
                |-- Import official API from ThirdParty
                |-- Import shared backend/loader.py
                |-- Ask loader for this model's weights directory
                |-- Pass weights directory to official model loader
                |-- Apply patcher only if required, before affected imports
                |
                v
       Official model API / pipeline
                |
                |-- Official internal imports/dependencies
                |-- Official preprocessing
                |-- Official inference and sampling
                |-- Official geometry/mesh generation and extraction
                |-- Official model-specific postprocessing
                |-- Official mesh export, if part of its API
                |
                v
       Final mesh file / official output object
                |
                |-- If already saved: collect its path
                |-- If in memory: call the official exporter/helper
                |-- Validate the expected output file
                |
                v
       Adapter returns mesh path/status
                |
                v
     Existing ForMesh3D result flow
                |
                v
      Existing output persistence path
      (production postprocess / manual-tool / bypass)
                |
                v
      Existing canonical workspace and manifests
      when the selected flow requires them
                |
                v
      Existing job artifact download / cleanup routes
```

The adapter must not duplicate internal model imports or pipeline work. It returns the raw mesh path through the existing result contract; the scheduler and downstream pipeline retain ownership of canonical asset persistence, manifests, and artifact URLs. The official model code performs the inference. The adapter connects the existing backend input and weights path to the real official API, handles only the output handoff that is not already performed by that API, and reports the result.

The patcher step is conditional. If a model has no import or pipeline-loading issue that needs an external fix, no patcher action is required for that model. When needed, the patcher must run in the same process and before the affected official module is imported.

### 8.2 Model weights download flow

```text
Environment setting
MODEL_STORAGE_ROOT=backend/pretrained
                |
                v
       Shared path convention
   <MODEL_STORAGE_ROOT>/<model_key>
                |
        +-------+--------+
        |                |
        v                v
 Download manager   backend/loader.py
        |                |
        v                v
 Saves model files  Returns that model's
 to resolved folder weights directory
        |                |
        +-------+--------+
                |
                v
     Official model loader reads
       weights from that folder
```

The environment variable sets only the parent root. The shared loader resolves the model-specific child directory. The download manager must save to that exact same child directory. Do not require a model-specific full path in the environment or adapter.

## 9. Implementation Plan

Implementation must be review-first and model-by-model. Do not begin by replacing every model directory or rewriting all adapters at once. Keep this plan model-agnostic: do not hardcode or prescribe any particular model name, repository-specific class, import path, or inference method here. Those details must be discovered from the actual model-specific adapter and its official ThirdParty source. The adapters are supplied separately; the implementation work is to improve and tweak each supplied adapter based on verified source behavior.

### Phase 1 — Inspect the current `dev` branch

1. Check the current working tree and branch state.
2. Inspect the model-specific adapter already supplied/placed in the adapter directory; preserve working behavior and identify only required improvements/tweaks.
3. Inspect the corresponding model repository inside `ForMesh3D-ThirdParty`.
4. Identify the official Python inference API/class/function (or supported CLI only if no suitable API exists).
5. Read the official API's supported arguments, input type, weight-loading mechanism, return type, and documented defaults.
6. Trace whether the official code writes the final mesh file itself or returns an in-memory result requiring an official exporter/helper.
7. Identify any inference parameters duplicated between adapter code, YAML files, and model code.
8. Identify all current readers and consumers of `models.yaml`, `quality.yaml`, and any other relevant configuration.
9. Record existing local changes in ThirdParty and distinguish necessary integration changes from duplicated custom model logic.

**Phase 1 output:** A per-model inventory showing the existing adapter behavior, official inference API, imports required directly by the adapter, input/return/export contracts, parameter ownership, local upstream differences, weights path, and any known loading/import problems.

### Phase 2 — Compare integrated models with official upstream

For each model:

1. Compare its current ThirdParty implementation with the official upstream repository/revision.
2. Identify custom changes that alter model behavior or inference defaults.
3. Identify custom changes needed only for local paths or ForMesh3D integration.
4. Identify custom changes that can be moved into that model's patcher without editing upstream model files.
5. Decide whether to retain the current copy with minimal changes or refresh it from official upstream.
6. Keep the model repository inside `ForMesh3D-ThirdParty` either way.

**Phase 2 output:** A safe per-model decision: retain, minimally adjust, or refresh from upstream—with the reason for each decision.

### Phase 3 — Improve the supplied thin adapters

For each model-specific adapter already supplied/placed in the project:

1. Preserve the current adapter contract unless a verified incompatibility requires a change.
2. Inspect the model's actual ThirdParty package layout and configure that model's source import path independently; prefer supported package installation and use `sys.path` only when necessary.
3. Import the model's actual official Python inference API from its ThirdParty source; use an official CLI only when there is no suitable direct API.
4. Import the shared `backend/loader.py` and request the weights directory using the model's canonical key.
5. Pass the returned weights directory to the official model loader using its supported mechanism.
6. Connect the existing backend input to the official API, applying only the minimum input conversion the API requires.
7. Preserve official defaults and pass only supported, explicitly required overrides.
8. Determine whether inference writes the final mesh or returns an in-memory mesh object. If an export step is needed, call the official exporter/helper rather than implementing a new one.
9. Collect or write the final raw mesh using the model's official exporter and the existing adapter/result handoff; validate it and return its real path. Let the existing scheduler/post-processing flow own canonical asset workspace creation and artifact registration. Do not introduce a new adapter-specific input/output directory layout.
10. Preserve logs, process/runtime handling, status, and useful errors.
11. Remove duplicate model internals only when they are confirmed to be redundant with the official source; do not remove working integration code without checking its purpose.

**Phase 3 output:** The supplied per-model adapters are improved integration wrappers that import and call official code without copying its model implementation or internal imports.

### Phase 4 — Add the model-specific `patcher/` structure

1. Create the root-level `patcher/` directory.
2. Add a separate subdirectory for each model that actually needs a patch.
3. Add only the external files required for that model's inference/import/pipeline-loading issue.
4. Arrange for the relevant patcher to execute in the target model process at the exact required lifecycle point.
5. Keep patcher execution model-specific and conditional.
6. Verify that a model without a required patch can run without invoking another model's patcher.
7. Verify that the patcher does not modify the official model source files.

**Phase 4 output:** A minimal, isolated patcher for each demonstrated issue; no placeholder or speculative patches.

### Phase 5 — Add the shared weights `loader.py` and root environment setting

1. Confirm the existing backend/project-root conventions and choose one environment variable for the shared weights root (for example, `MODEL_STORAGE_ROOT`).
2. Use `backend/pretrained` as the default root when no override is configured, unless the project already has an established default.
3. Implement one shared `backend/loader.py` function that accepts a validated model key and returns `<MODEL_STORAGE_ROOT>/<model_key>`.
4. Resolve relative environment paths against the stable ForMesh3D project root, not the current working directory.
5. Keep this loader limited to per-model weights-directory resolution; do not add model loading, downloading, ThirdParty source resolution, inference settings, or output-path management to it.
6. Update each supplied adapter to import the shared loader and pass its returned directory to the official model loading API. Do not hardcode a full model-specific path in adapters.
7. Validate missing/inaccessible directories and provide clear errors. Allow the download flow to request directory creation when appropriate.
8. Remove model-specific full-path environment variables or duplicate path definitions only after checking existing consumers.

**Phase 5 output:** One shared root setting plus one shared model-key-to-weights-directory resolver, imported by every adapter.

### Phase 6 — Configure the download manager to use the same weights root

1. Inspect the current model download manager and identify every hardcoded storage root or model-specific destination.
2. Configure it to read the same shared `MODEL_STORAGE_ROOT` setting used by `backend/loader.py`.
3. Save each model under the exact per-model directory convention `<MODEL_STORAGE_ROOT>/<model_key>`.
4. Prefer reusing the loader's path-resolution helper (or its shared underlying path helper) rather than duplicating path-joining logic.
5. Ensure relative roots resolve against the same stable project root in both download and inference flows.
6. Preserve existing download progress, retry, integrity, status, and logging behavior unless a verified issue requires a change.
7. Test both the default `backend/pretrained` root and a non-default configured root.

**Phase 6 output:** Downloads and inference resolve to the same model-specific weights directory regardless of which valid root is configured.

### Phase 7 — Review YAML usage and remove only what is no longer needed

1. Search for every read/import/reference of `models.yaml`.
2. Identify whether it supplies model discovery, VRAM requirements, capabilities, enable/disable state, path values, or other runtime behavior.
3. Confirm which of those responsibilities remain necessary and where they are handled after the refactor.
4. Search for every read/import/reference of `quality.yaml`.
5. Confirm whether it only contains model inference parameters or also controls separate validation/acceptance behavior.
6. Remove a file only when its remaining behavior is unnecessary or has a verified replacement.
7. Do not create new YAML configuration to replace duplicate model inference settings.

**Phase 7 output:** A documented keep/remove decision for the YAML files based on actual code references, not assumptions.

### Phase 8 — Verify the integrated pipeline

For each model:

1. Launch it through the ForMesh3D adapter.
2. Confirm that the intended official Python inference API (or supported CLI fallback) actually executes.
3. Confirm that the model-specific ThirdParty source import path resolves to the intended official package, and that the weights directory returned by `loader.py` is used.
4. Confirm that the correct model-specific patcher runs when required—and only then.
5. Confirm that the model runs with official defaults when no override is provided.
6. Confirm that explicitly supplied arguments/parameters reach the official API (or CLI flags reach the CLI fallback) correctly.
7. Confirm that preprocessing, inference, sampling, mesh extraction, and model-specific postprocessing are performed by the official implementation.
8. Confirm that final mesh output is handled correctly: use the file produced by the official API, or call its official exporter/helper if it returns an in-memory object.
9. Confirm that the generated mesh path is returned through the existing ForMesh3D flow.
10. Confirm that logs and process failures are visible through the existing logging/result mechanism.
11. Confirm that the input path delivered by the existing upload/file-ID/Base64 resolution flow reaches the adapter correctly, and that scheduler-owned temporary inputs are not deleted before inference/post-processing has finished.
12. For production post-processing, confirm that the returned raw mesh enters the existing canonical asset workspace, `master/source.glb` lineage and manifests remain valid, and existing job artifact download routes can resolve the resulting files. Also verify manual-tool and post-processing-bypass paths are not forced into the production workspace.
13. Compare outputs against a direct run of the same official inference API (or CLI fallback) using equivalent inputs and parameters. This checks that the adapter/patcher integration has not unintentionally changed model behavior.

### Phase 9 — Final regression review

Verify that the refactor has not unnecessarily changed:

- Main scheduler behavior.
- Existing planner/model-selection behavior.
- Existing API and frontend contracts.
- Existing logging behavior.
- Existing downstream project processing that is not part of the model's official inference pipeline.
- Existing model output paths and result handling.
- Existing `STORAGE_LOCAL_PATH`/`get_storage_base_dir()` ownership, image upload and file-ID resolution, temporary-input cleanup, canonical asset workspace, manifests, artifact download routes, and job-deletion ordering.

Only make changes to these areas where a specific, verified integration requirement makes them necessary.

## 10. Acceptance Criteria

The refactor is complete only when all applicable points below are true:

- [x] Every model repository remains inside `ForMesh3D-ThirdParty`.
- [ ] Each supplied model-specific adapter imports and calls the actual official inference API (using a supported CLI only when no suitable direct API exists).
- [x] Each adapter is improved in place where possible and does not get replaced by a generic from-scratch implementation.
- [x] Each adapter is a thin integration layer and does not copy model source code, internal imports, or inference logic.
- [ ] Each adapter passes only arguments/parameters supported by that model's official API (or flags supported by its CLI fallback).
- [ ] Official defaults are preserved when no override is requested.
- [ ] Model-specific preprocessing, inference, sampling, mesh generation/extraction, and official postprocessing remain owned by the official model implementation.
- [x] The `patcher/` directory contains only demonstrated model-specific inference/import/pipeline-loading fixes (none speculative).
- [x] Each patcher runs in the target model runtime at the required point in the loading sequence (when present).
- [x] One model's patcher does not affect another model.
- [x] Official model source files remain unchanged where the same fix can be applied externally.
- [x] Every adapter imports the shared `backend/loader.py` to obtain its model-specific weights directory.
- [ ] Each adapter resolves/imports its own official ThirdParty source using that repository's verified package layout; source-path setup is separate from weights-path resolution.
- [ ] `sys.path` is changed only when necessary, before the relevant official import, and only for the model being launched; no unnecessary global import-path mutation is introduced.
- [x] The environment variable configures only the shared weights root (defaulting to `backend/pretrained` when appropriate), not a separate full path for each model.
- [x] Relative weights-root paths resolve consistently against the ForMesh3D project root.
- [x] The download manager saves weights to the same `<MODEL_STORAGE_ROOT>/<model_key>` directory returned by the shared loader.
- [x] Model and checkpoint paths resolve correctly without requiring a duplicate `models.yaml` inference configuration.
- [x] `models.yaml` and `quality.yaml` are retained (consumers checked); not removed.
- [ ] The existing scheduler and unrelated application components continue to work.
- [ ] Model outputs, logs, exit status, and errors reach the existing ForMesh3D flow.
- [x] Application uploads and generated assets continue to use the existing `STORAGE_LOCAL_PATH`/`get_storage_base_dir()` storage root; `MODEL_STORAGE_ROOT` remains weights-only.
- [x] Existing image upload, file-ID resolution, `image_path` job input, Base64/direct-upload temporary input lifecycle, and scheduler cleanup behavior remain intact.
- [ ] Adapters return raw mesh paths through the existing result contract; the scheduler/post-processing pipeline retains ownership of canonical asset workspaces, manifests, and artifact URLs.
- [x] Production post-processing, manual mesh-tool persistence, and post-processing-bypass paths retain their distinct existing behavior.
- [x] Existing durable-upload retention, master-source protection, artifact download resolution, and job-deletion ordering are not weakened by the integration.
- [ ] If the official API returns an in-memory mesh object, the adapter uses the official exporter/helper rather than implementing its own mesh conversion.
- [ ] The adapter does not duplicate model-owned imports; it imports only official APIs/helpers it directly calls.
- [ ] An equivalent direct official-entry-point run and an adapter-launched run behave consistently for the same input and parameters, except for explicitly required integration differences (GPU-dependent; runtime inference NOT RUN in this environment — no GPU/torch/weights installed).

## 11. Explicitly Out of Scope

The following are not part of this plan unless inspection shows they are strictly required for the stated integration:

- Rewriting or copying any model's inference implementation inside ForMesh3D.
- Replacing an already supplied model-specific adapter with a generic adapter without a verified need.
- Moving model-owned internal imports/dependencies into adapters merely because they appear in an official example.
- Making `loader.py` responsible for model loading, downloading, source-code paths, inference parameters, or output paths.
- Forcing one universal ThirdParty import path or adding every model repository to the global Python import path.
- Reworking the main scheduler or rebuilding the planner.
- Rebuilding the backend API or frontend.
- Creating a new generic inference-parameter YAML system.
- Adding speculative patcher files for problems that have not been observed.
- Applying one model's runtime patch globally to all models.
- Changing official model defaults merely to make different models look uniform.
- Replacing or deleting working postprocessing features unrelated to the requested model-integration refactor.
- Introducing a second application input/output storage system or replacing the existing upload, canonical-workspace, artifact-download, or cleanup contracts.
- Replacing all ThirdParty model repositories before comparing the current copies with official upstream.

## 12. Target Design (Not a Claim of Current Completion)

**Target state:** ForMesh3D preserves its existing upload, input-resolution, scheduler, output-persistence, canonical-workspace, manifest, download, and cleanup contracts; each model adapter configures that model's verified ThirdParty source import path, calls the actual supported inference API, resolves weights through the shared `backend/loader.py`, and returns the result expected by the existing backend flow. ThirdParty owns model implementation and internal inference/export logic; `MODEL_STORAGE_ROOT` is weights-only; and a model-specific patcher is used only for a demonstrated runtime/import/loading fix. The acceptance checklist above remains authoritative for whether this target has actually been achieved.
