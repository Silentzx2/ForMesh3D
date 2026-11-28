# Change Log

**2026-11-28 (Independent XYZ mesh orientation control)** – Decoupled the fixed XYZ triad from camera-orientation events. Axis clicks now rotate only the active mesh group toward the current view; free viewer orbit/pan/zoom never changes the triad or gets changed by triad interaction. Added quaternion orientation coverage for all six axis directions.

**2026-11-28 (Persistent mesh orientation)** – Kept upload-time orientation unchanged and added a separate bottom-left viewport control, visible only for a fully loaded workspace mesh. It reuses the same editor and replaces the selected GLB and its existing SQLite asset metadata in place without creating a new asset or version.

**2026-11-28 (ARDY prompt conditioning)** – ARDY now reserves 6 GiB of CUDA memory for a local NF4 4-bit LLM2Vec prompt encoder while keeping the motion diffusion model on CPU. Quantized weights stay on their assigned GPU without unsupported `.to()` calls, and missing encoders fail instead of falling back to zero text features.
