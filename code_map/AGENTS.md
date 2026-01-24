# Code Map Guidelines

## Purpose
- `code_map/` contains the codebase-map generation tooling (scripts/modules) used to produce graph JSON files.
- Treat it as source code, not data artifacts.

## Usage
- Changes here should focus on generation logic and data quality, not UI behavior.
- Keep interfaces stable with `scripts/` and the JSON outputs they write.

## Safety
- Don’t store secrets or credentials here.
- Avoid adding large bundled datasets; keep inputs small and reference external sources if needed.
