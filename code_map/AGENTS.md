# Code Map Guidelines

## Purpose
- `code_map/` holds source inputs and outputs used to build the graph datasets.
- Treat these files as data artifacts; avoid manual edits unless a task requires it.

## Usage
- Prefer regenerating artifacts via `scripts/` instead of hand-editing.
- Keep file names and paths stable; other tools may rely on them.

## Safety
- Don’t store secrets or credentials here.
- Keep artifacts reasonably small or segmented to avoid heavy token usage.
