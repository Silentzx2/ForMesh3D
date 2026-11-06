# ForMesh3D Changelog

## 2026-11-06 — SkinTokens Integration & Complete UniRig Decommissioning

- **Decommissioned UniRig**: Completely removed `backend/thirdparty/UniRig/` from tracking and deleted `backend/adapters/unirig_adapter.py`. Cleaned all UniRig dependencies (`blenderproc`, `pyrender`, `pytorch-lightning==1.9.5`).
- **Vendored SkinTokens**: Added `backend/thirdparty/SkinTokens/` (MIT License, VAST AI Research, arXiv:2602.04805) to submodule with catalog license table in `LICENSE` and open-source advisory in `README.md`.
- **SkinTokens Thin Adapter**: Created `backend/adapters/skintokens_adapter.py` implementing `BaseModel` for direct in-process `predict_step` execution of the TokenRig unified autoregressive pipeline (FSQ-CVAE + Qwen3-0.6B + GRPO refinement) with companion `bpy_server` daemon.
- **Hardware & Precision Preservation**: Locked native FlashAttention 2 and native BF16 inference profile on modern GPUs (`sm >= 80`). Maintained backward-compatible alias `unirig_auto_rig` resolving to `SkinTokensAdapter`.
- **System & UI Integration**: Updated `backend/config/models.yaml`, `backend/scripts/download_models.sh`, `constants/models.ts`, API routers, scheduler providers, and frontend Rigging Studio panels.
- **Verification**: `backend/tests/test_skintokens_adapter.py` passed (7/7). Full backend suite `backend/tests/` passed (43/43). Frontend `bun test` passed (60/60).

---

## 2026-11-05 — PR #80 review follow-ups

- Scoped TRELLIS.2 sparse-convolution fallback selection to the adapter worker's assigned GPU; the global hardware helper no longer forces spconv on every worker. The painting adapter follows the same per-GPU selection and preserves the upstream FlexGEMM path on modern GPUs when available.
- Unified the TRELLIS.2 painting adapter status check with the adapter's backend.core.models.base.ModelStatus enum.
- Hi3D now accepts both mesh_path and the coarse_mesh_path key emitted by /refine-mesh.
- The model downloader loads the project/backend .env before resolving MODEL_STORAGE_ROOT.
- Image-to-raw-mesh jobs now forward the top-level seed; it takes precedence over legacy model_parameters.seed.
- Verification: source-level fixes only in this commit; CI and GPU inference are pending rerun.

---

## 2026-11-05 — Mark TRELLIS.2, Pixal3D, TaoFlowForge as not_tested

- **TRELLIS.2**: Marked `status: "not_tested"`, `verified: false` in models.yaml. Root cause identified: `sparse_structure_decoder` checkpoint in `pipeline.json` references `microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16` (original TRELLIS repo, not compatible with TRELLIS.2 flow model). Produces all-negative logits (~ -75) → zero occupied voxels → hollow box output. See microsoft/TRELLIS.2#160. Works on HF Spaces demo (Microsoft-hosted infrastructure); local self-hosted broken until compatible decoder checkpoint available.
- **Pixal3D**: Marked `status: "not_tested"`, `verified: false` in models.yaml. Shares TRELLIS.2 sparse_structure_decoder checkpoint lineage; same decoder incompatibility risk applies. No top-k fallback in Pixal3D decoder path → empty mesh risk on incompatible decoder.
- **TaoFlowForge**: Marked `status: "not_tested"`, `verified: false` in models.yaml. Stage 2 topology decoding hits CUDA OOM (6.71 GiB allocation attempt, 280 MiB free) on pre-Ampere GPUs due to SDPA MATH backend fallback. Patcher `patcher/taoflowforge/` provides float16 + query-chunked SDPA fix; requires clean worker restart to activate.
- All three models marked `not_tested` because no live GPU inference has been run in this environment.

