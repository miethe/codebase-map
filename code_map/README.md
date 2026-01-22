# Code Map Pipeline

This folder contains the Python scraping pipeline that extracts a target codebase
into `codebase-graph.*.json` files for the visualizer.

## Where This Runs

- Run the commands from the root of this repo (the one that contains `code_map/`).
- The target codebase is only read. Nothing needs to run inside it.
- By default the scripts expect the target repo to be available at `./skillmeat`.
  If your repo lives elsewhere, pass explicit paths via CLI flags (examples below).

## Quick Start (Default Layout)

1) Clone or symlink the target repo into `./skillmeat`.
2) Run the full pipeline:
   `python -m code_map`
3) Outputs are written to `docs/architecture/codebase-graph/` by default.
4) To view in the UI, copy or symlink those files into the repo root
   (the UI fetches `./codebase-graph.*.json`).

## End-to-End Pipeline

Run everything in order:
`python -m code_map`

Skip the coverage summary:
`python -m code_map --skip-coverage`

This executes the following steps, in order:

1) `extract_frontend` -> `codebase-graph.frontend.json`
2) `extract_backend` -> `codebase-graph.backend.json`
3) `merge_graphs` -> `codebase-graph.unified.json`
4) `apply_overrides` -> updates `codebase-graph.unified.json`
5) `extract_details` -> `codebase-graph.details.json`
6) `apply_semantic_tags` -> updates `codebase-graph.unified.json`
7) `link_openapi_schemas` -> updates `codebase-graph.unified.json`
8) `extract_git_metadata` -> `codebase-graph.git-metadata.json`
9) `enrich_graph` -> updates `codebase-graph.unified.json`
10) `validate_graph` -> prints validation output
11) `build_groupings` -> `codebase-graph.groupings.json`
12) `scan_dependencies` -> `codebase-graph.dependencies.json`
13) `build_outputs` -> `codebase-graph.lod0..4.json`
14) `coverage_summary` -> prints coverage stats

## Individual Commands (with Defaults)

Use these when you want to run a single step or override paths.
Defaults point at `docs/architecture/codebase-graph/`.

### Frontend extraction
`python -m code_map.extract_frontend --web-root skillmeat/web --out docs/architecture/codebase-graph/codebase-graph.frontend.json`

### Backend extraction
`python -m code_map.extract_backend --api-root skillmeat/api --out docs/architecture/codebase-graph/codebase-graph.backend.json`

### Merge frontend + backend
`python -m code_map.merge_graphs --frontend docs/architecture/codebase-graph/codebase-graph.frontend.json --backend docs/architecture/codebase-graph/codebase-graph.backend.json --out docs/architecture/codebase-graph/codebase-graph.unified.json`

### Apply overrides (YAML)
`python -m code_map.apply_overrides --in docs/architecture/codebase-graph/codebase-graph.unified.json --overrides docs/architecture/codebase-graph/codebase-graph.overrides.yaml --out docs/architecture/codebase-graph/codebase-graph.unified.json`

### Extract details (docstrings, signatures)
`python -m code_map.extract_details --graph docs/architecture/codebase-graph/codebase-graph.unified.json --out docs/architecture/codebase-graph/codebase-graph.details.json`

### Apply semantic tags (from details)
`python -m code_map.apply_semantic_tags --graph docs/architecture/codebase-graph/codebase-graph.unified.json --details docs/architecture/codebase-graph/codebase-graph.details.json --out docs/architecture/codebase-graph/codebase-graph.unified.json`

### Link OpenAPI schemas
`python -m code_map.link_openapi_schemas --graph docs/architecture/codebase-graph/codebase-graph.unified.json --out docs/architecture/codebase-graph/codebase-graph.unified.json`

### Extract git metadata
`python -m code_map.extract_git_metadata --repo-root . --out docs/architecture/codebase-graph/codebase-graph.git-metadata.json`

### Enrich graph (merge git metadata)
`python -m code_map.enrich_graph --graph docs/architecture/codebase-graph/codebase-graph.unified.json --git-metadata docs/architecture/codebase-graph/codebase-graph.git-metadata.json --out docs/architecture/codebase-graph/codebase-graph.unified.json`

### Validate graph
`python -m code_map.validate_graph --graph docs/architecture/codebase-graph/codebase-graph.unified.json`

### Build groupings (legacy computed/group sets)
`python -m code_map.build_groupings --graph docs/architecture/codebase-graph/codebase-graph.unified.json --out docs/architecture/codebase-graph/codebase-graph.groupings.json`

### Scan dependencies (package.json)
`python -m code_map.scan_dependencies --repo-root . --out docs/architecture/codebase-graph/codebase-graph.dependencies.json`

### Build LOD outputs
`python -m code_map.build_outputs --graph docs/architecture/codebase-graph/codebase-graph.unified.json --details docs/architecture/codebase-graph/codebase-graph.details.json`

### Coverage summary
`python -m code_map.coverage_summary --graph docs/architecture/codebase-graph/codebase-graph.unified.json`

## Optional Helper Extractors

These are already called by `extract_frontend` or `extract_backend`, but can be run
independently for debugging:

- `python -m code_map.extract_frontend_components --web-root skillmeat/web`
- `python -m code_map.extract_frontend_hooks --web-root skillmeat/web`
- `python -m code_map.extract_frontend_api_clients --web-root skillmeat/web`
- `python -m code_map.extract_backend_handlers --api-root skillmeat/api`
- `python -m code_map.extract_backend_services --api-root skillmeat/api`
- `python -m code_map.extract_backend_models --api-root skillmeat/api`
- `python -m code_map.extract_backend_openapi --openapi skillmeat/api/openapi.json`

## Target Repo Notes

- The default paths assume a repo layout like `skillmeat/web` and `skillmeat/api`.
- If your target repo uses different paths, pass absolute paths with `--web-root`,
  `--api-root`, or `--repo-root` flags.
- Outputs are written in this repo, not inside the target repo.

## Semantic Groupings (JS Pipeline)

The newer semantic groupings pipeline lives in `scripts/` at the repo root and is
run via npm:

- `npm run groupings:base`
- `npm run groupings:merge`
- `npm run groupings:all`

Those commands read/write `codebase-graph.*.json` from the repo root, not from
`docs/architecture/codebase-graph/`. Copy or symlink files if needed.
