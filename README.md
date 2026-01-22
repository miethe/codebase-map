<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Codebase Map

Interactive, multi-LOD visualization of a repository’s architecture and dependencies. The UI supports focused cluster expansion, readable label budgets, and navigation helpers for large graphs.

## Highlights
- Cluster-aware LOD expansion with sticky focus and breadcrumbs.
- Backbone edge aggregation with density control at low LODs.
- Label budgeting and importance ranking for stable, readable zooming.
- Focus modes for upstream, downstream, and k-hop exploration.
- WebGL cluster overlays for fast visual boundaries.

## Docs
- `docs/visualization-layering-ux.md` for the layering + zoom UX feature set.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Commands

**App (frontend)**
- `npm run dev` starts the Vite dev server.
- `npm run build` builds the production bundle into `dist/`.
- `npm run preview` serves the production build locally.

**Semantic groupings pipeline (this repo)**
- `npm run groupings:base` generates `codebase-graph.groupings.base.json` and `codebase-graph.groupings.summary.json`.
- `npm run groupings:merge` merges base + overrides into `codebase-graph.groupings.json`.
- `npm run groupings:all` runs base then merge.

**Supplemental data generation (this repo)**
- `node scripts/extract_git_metadata.js` regenerates `codebase-graph.git-metadata.json`.
- `node scripts/scan_dependencies.js` regenerates `codebase-graph.dependencies.json`.

**Full graph extraction (target codebase)**
- `python -m code_map` runs the full scrape pipeline (see `code_map/README.md`).
- `python -m code_map --skip-coverage` skips the coverage summary step.

## Data Flow Notes

- The end-to-end Python pipeline (`python -m code_map`) scrapes a target repo and writes graph outputs under `docs/architecture/codebase-graph/` by default.
- The UI loads graph JSON files from the repo root (e.g., `codebase-graph.unified.json`). Copy or symlink the outputs into the root, or customize the Python script `--out` paths.
- The semantic groupings scripts are separate from the Python pipeline. Run `npm run groupings:all` after `codebase-graph.unified.json` is available in the repo root to generate the merged `codebase-graph.groupings.json` used by the app.

## Notes
- LOD datasets are loaded automatically when `codebase-graph.lod*.json` files are present.
- To use the WebGL renderer, set `VITE_GRAPH_RENDERER=webgl` before running the dev server.
