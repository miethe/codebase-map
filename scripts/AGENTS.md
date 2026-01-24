# Scripts Guidelines

## Purpose
- Scripts generate or merge graph JSON outputs used by the app.
- Keep outputs stable and deterministic; avoid nondeterministic ordering.

## Dependencies
- Use Node built-ins and existing project deps only.
- Don’t import React app code; keep scripts standalone.

## Safety
- Avoid writing outside the repo.
- If a script changes schema, update `metadata.json` and document in `CHANGELOG.md`.
