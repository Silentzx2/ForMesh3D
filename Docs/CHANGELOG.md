# Change Log

**2026-11-25** – Removed the decorative generation hologram/point cloud and the extra thinking/progress card. Kept the existing lightweight viewport progress bar; removed the unused card component.

**2026‑11‑25** – Completed comprehensive adapter audit. Added detailed Task Report, risk scores, line‑count statistics, and a refactoring vision. Updated documentation to explain why adapters should delegate to upstream model code and how shared helpers will be centralised.

* 2026-11-25 – Implemented the selected adapter fixes: full PartUV UV pipeline, tracked temporary-output cleanup, SkinTokens process reaping, live Hunyuan generation metadata, SF3D worker-scoped pre-Ampere patching, and disabled the unsupported TRELLIS text-paint alias. Removed the obsolete `backend/adapters_backup/` directory. Runtime GPU validation remains required.
