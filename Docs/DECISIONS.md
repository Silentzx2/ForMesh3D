# Architecture Decisions — ForMesh 3D

> **Last Updated:** 2026-11-28 | **Retention Policy:** Keep only the last 3 active ADRs.

---

## ADR-115: UniRig Auto-Rigging Integration & Pre-Ampere Patcher (2026-11-28)

**Context:** SkinTokens requires >=14GB VRAM and long beam-search decoding on T4 (`sm_75`). Users also need VAST-AI's two-stage UniRig (SIGGRAPH '25) alongside SkinTokens without replacing SkinTokens.

**Decision:**
1. Add `backend/adapters/unirig_adapter.py` (`unirig_auto_rigging`, `enabled: true`) invoking upstream `src.data.extract` -> `run.py` -> `src.inference.merge` with per-request isolated `workdir`/`npz_dir`.
2. Isolate T4 (`sm < 80`) workarounds (`flash_attn` SDPA shim, `AutoModelForCausalLM.from_config` SDPA fallback, `bf16-mixed` -> `16-mixed`, local checkpoint short-circuit) inside `patcher/unirig/__init__.py`; keep `sm >= 80` 100% native.
3. Wire `RiggingPanel.tsx` with `useFeatureAvailability()` model dropdown (`UniRig` & `SkinTokens`) and model-specific settings, plus `download_models.sh` (`-m unirig`) and `manager.sh` (`[18] UniRig`).

---

## ADR-114: Pluggable `upstream.py` Loader & Thin Adapter Rewrite (2026-11-27)

**Context:** Adapters duplicated `sys.path` wiring, `os.chdir` handling, checkpoint resolution, and HuggingFace `snapshot_download` fallbacks across 15 files.

**Decision:**
1. Centralize upstream repo/weight loading in `backend/core/utils/upstream.py` (`resolve_thirdparty`, `resolve_pretrained`, `use_thirdparty`, `load_thirdparty_script`).
2. Rewrite all 15 adapters (12 enabled + 3 disabled) from 0 as thin wrappers that apply `patcher/<model>` first, run upstream code via `use_thirdparty` / `load_thirdparty_script`, and fail fast when `backend/pretrained/<Model>` is missing.
3. Preserve `sm >= 80` native parity and keep `pixal3d`, `trellis2`, `taoflowforge` disabled (`enabled: false`) in `models.yaml`.

---

## ADR-113: Immutable Workspace Animated-Mesh Assets (2026-11-26)

**Context:** Motion clips were playable and reusable in My Presets, but the viewport GLB export only downloaded to the device. There was no durable animated mesh asset registered in the current workspace.

**Decision:**
1. Save each export as a separate immutable folder: `backend/storage/<workspace_id>/animation/<clip-name>_v001/{animated.glb,motion.npz}`; subsequent exports use `_v002`, `_v003`, and so on.
2. Preserve the original rigged source mesh and the source preset/job clip. Reusable uploaded/generated clips remain in `backend/storage/presets/<preset_id>/`; workspace exports are separate retained assets.
3. Register every animated mesh in SQLite with `asset_id=ast_<12hex>`, `operation_id=op_<12hex>`, `workspace_id`, `asset_type=animated_mesh`, `source_asset_id`, `motion_clip_id`, `operation_type=animation`, and a workspace-relative GLB path.
4. Store the source NPZ beside the GLB. Do not create per-animation metadata JSON; project the authoritative DB state into the one workspace-root `metadata.json`.
5. The workspace Assets panel lists saved animated meshes and selection does not alter the workspace route. GLB is the implemented export format through Three.js `GLTFExporter`.
