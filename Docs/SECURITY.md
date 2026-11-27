# Security Policy — ForMesh3D

ForMesh3D is designed for local, self-hosted use. The default development configuration does not enable user authentication or API-key protection, so bind the backend to localhost and place a firewall or authenticated reverse proxy in front of any remote deployment.

## Runtime boundaries

- Keep `:7842` and `:3000` private unless remote access is deliberately configured.
- Treat uploaded images, meshes, model checkpoints, third-party source, and generated assets as untrusted inputs.
- Use the canonical file/path resolvers at upload, artifact, and download boundaries; do not add direct filesystem joins for client-controlled paths.
- Do not commit credentials, model weights, tokens, private URLs, or generated secrets.
- Review third-party model code and licenses before enabling an adapter.

## Authentication and rate limiting

Personal deployments default to simple mode and disable the application rate limiter. Optional user authentication, API keys, and rate limiting are configured in `backend/config/system.yaml` and environment variables. Remote deployments should add perimeter authentication and proxy-level limits.

## Motion clip security

- All user-supplied NPZ/preset archives are treated as untrusted input and parsed with a bounded pure-Python ZIP+NPY parser in `backend/services/motion_clips.py` — no `numpy.load` and pickle/object-dtype NPY arrays are rejected.
- Enforced limits: compressed upload size, total uncompressed bytes, per-entry size, ZIP entry count, array element count, frame count, joint count, and JSON response size; encrypted ZIPs, duplicate entries, path traversal, absolute paths, symlinks, and unsupported compression are rejected.
- Preset IDs and user-upload clip IDs are opaque server-issued identifiers (`upl_<hex12> and gen_<hex12>` for uploads); client-supplied filenames are never concatenated into filesystem paths. Thumbnail serving resolves siblings only after canonical path-containment checks and rejects symlinks.
- Temporary preview uploads (POST /api/v1/motion/clips/preview) are never persisted. Permanent user imports/generated copies use backend/storage/presets/<preset_id>/ with one metadata.json per preset directory. Bundled premade assets are committed under backend/motion_presets/ and are never writable through user upload endpoints.
- No filesystem paths appear in API responses, errors, or client-visible logs.

## Reporting

Do not publish sensitive vulnerability details in a public issue. Use GitHub's private vulnerability-reporting channel when it is enabled for this repository. If that channel is unavailable, contact the repository maintainer privately rather than posting exploit details publicly.
