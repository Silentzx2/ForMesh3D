# Change Log

**2026-11-28 (Workspace mesh selector identity)** – Prevented operation IDs and unsaved operation previews from entering the Assets panel or viewport Mesh Version selector. Only retained workspace asset IDs are selectable as saved mesh versions.

**2026-11-28 (Independent XYZ mesh orientation control)** – Decoupled the fixed XYZ triad from camera-orientation events. Axis clicks now rotate only the active mesh group toward the current view; free viewer orbit/pan/zoom never changes the triad or gets changed by triad interaction. Added quaternion orientation coverage for all six axis directions.

**2026-11-28 (Persistent mesh orientation)** – Kept upload-time orientation unchanged and added a separate bottom-left viewport control, visible only for a fully loaded workspace mesh. It reuses the same editor and replaces the selected GLB and its existing SQLite asset metadata in place without creating a new asset or version.

