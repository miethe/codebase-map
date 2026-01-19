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

## Notes
- LOD datasets are loaded automatically when `codebase-graph.lod*.json` files are present.
- To use the WebGL renderer, set `VITE_GRAPH_RENDERER=webgl` before running the dev server.
