# Change Log

**2026-11-28 (Persistent mesh orientation)** – Kept upload-time orientation unchanged and added a separate bottom-left viewport control, visible only for a fully loaded workspace mesh. It reuses the same editor and replaces the selected GLB and its existing SQLite asset metadata in place without creating a new asset or version.

**2026-11-28 (ARDY prompt conditioning)** – ARDY now reserves 6 GiB of CUDA memory for a local NF4 4-bit LLM2Vec prompt encoder while keeping the motion diffusion model on CPU. Quantized weights stay on their assigned GPU without unsupported `.to()` calls, and missing encoders fail instead of falling back to zero text features.

**2026-11-28 (UniRig auto-rigging + SkinTokens T4 fixes)** – Added `unirig_auto_rigging` (`UniRigAdapter`, `patcher/unirig/`, `download_models.sh -m unirig`, `manager.sh [18]`, and `RiggingPanel.tsx` model dropdown + model-specific settings) alongside `skintokens_auto_rigging`. Fixed `SkinTokens` T4 (`sm < 80`) `max_length` validation, `lm_head` 6.65 GiB logits OOM, `num_beams=1`, and `do_sample=False`; wired `install.sh` for ARDY `motion_correction`.


