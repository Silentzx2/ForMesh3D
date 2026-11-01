# Model-specific patcher directory

## Purpose

This directory holds external, model-specific fixes required when an inference
pipeline cannot import, initialize, or load correctly without a compatibility
adjustment. The patcher exists for cases where:

- A runtime/import issue must be fixed without editing the model's source files.
- A pipeline-loading issue needs a small external compatibility patch.
- A module or dependency must be imported or prepared at a particular point
  during startup.
- A narrowly scoped change is needed before a specific model pipeline component
  is loaded.

This is **not** a requirement to add a patcher to every model. Most models do
not need one. Add a subdirectory **only** when a real import/pipeline-loading
problem has been observed and verified.

## What to do (step by step)

### Step 1 — Confirm the problem is real

Before creating anything here, verify the failure:

1. Try to load the model through its adapter (`backend/adapters/<model>_adapter.py`).
2. Read the error traceback. Identify the exact import, initialization, or
   pipeline-loading failure.
3. Check whether the fix can be applied inside the adapter itself (for example,
   adding a `sys.path` entry, setting an environment variable, or importing a
   dependency in `_load_model`). If it can, fix it in the adapter — do **not**
   use the patcher.
4. Only use the patcher when the fix must run **before** the official ThirdParty
   module is imported, or when editing the adapter is insufficient.

### Step 2 — Create one subdirectory per model

Create exactly one subdirectory named after the model:

```text
patcher/
├── <model-name>/
│   └── <patch-file>.py
```

- The subdirectory name must match the model's canonical key/name.
- **One model per subdirectory.** A patcher for model A must never affect model B.
- No placeholder or speculative subdirectories. If a model has no loading issue,
  it gets no subdirectory.

### Step 3 — Write only the required external fix

Each patcher file must:

1. Belong to one clearly identified model.
2. Apply only the required external fix for that model.
3. Run at the exact lifecycle point where the problem needs to be addressed —
   before the affected official module is imported or before the affected
   pipeline component is initialized.
4. Run in the same Python runtime/process whose imports or pipeline loading it
   needs to affect.
5. Leave the official ThirdParty source files unchanged whenever the issue can
   be fixed externally.
6. Avoid changing unrelated model behavior or global application behavior.

### Step 4 — Execute the patcher at the right time

The patcher must execute **inside the target model's runtime process** at the
required point in the loading sequence. How to arrange this:

- For adapters that load the ThirdParty package inside `_load_model()`, import
  and run the patcher at the top of `_load_model()`, before importing the
  official module.
- Do **not** run every model's patcher globally. Only the patcher belonging to
  the model being launched should run, and only the required patch should be
  applied.
- A separate, unrelated Python process cannot import a module into the model
  process merely by importing it itself. The patcher must run in the same
  process.

## What NOT to do

A patcher must not:

- Contain a copy of the model's inference implementation.
- Become a second adapter or a replacement `app.py`/`main.py`.
- Store ordinary model parameters that belong in the official model code or
  configuration.
- Change sampling, resolution, inference steps, or mesh extraction behavior
  without a specific, necessary runtime-loading fix.
- Apply broad global monkey patches when a model-scoped fix is sufficient.
- Modify other models' runtime behavior.
- Become a general-purpose folder for unrelated workarounds.

## Current state

This directory is intentionally empty. No model in ForMesh3D currently requires
an external patcher. All 17 adapters load their ThirdParty packages directly
from `backend/thirdparty/` using per-adapter `sys.path` setup inside
`_load_model()`.

If you later encounter a verified import/pipeline-loading problem for a
specific model:

1. Create `patcher/<model-name>/`.
2. Add the minimal external fix file.
3. Wire it to run in that model's adapter `_load_model()` before the affected
   official import.
4. Document what the fix addresses and why it cannot be in the adapter.
