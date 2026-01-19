# Visualization Layering & Zoom UX

Last updated: 2026-01-19

## Overview
This release adds focused, hierarchical zoom behavior to the graph renderer. LOD is now cluster-aware, expansion is sticky and user-driven, labels are budgeted for readability, and the UI exposes controls to navigate and filter clusters without losing context.

## Data & Schema Updates
### Node fields
- `kind`: semantic classification (`repo`, `package`, `module`, `folder`, `file`, `symbol`, `cluster`).
- `layer`: domain layer tags (e.g. `ui`, `api`, `data`).
- `cluster_id`, `cluster_path`: stable hierarchy identifiers used for LOD, focus, and breadcrumbs.
- `importance`, `size`, `hotness`: signal fields used for label ranking and visual emphasis.

### Edge fields
- `type`: edge category (required for styling and aggregation).
- `weight`: aggregated edge strength for cluster-level edges.
- `distance_class`, `confidence`: structural metadata derived from cluster paths.

### Pipeline behavior
- `code_map/enrich_graph.py` populates missing hierarchy, importance, and metadata fields.
- `code_map/validate_graph.py` enforces cluster path ordering and validates that all edges reference valid nodes.
- `code_map/build_outputs.py` generates LOD datasets and cluster nodes with `member_count`, `size`, and `cluster_path`.
- The viewer drops invalid edges defensively and logs a dev warning if any are missing.

## LOD & Focused Expansion
- LOD levels (0–3) are chosen by zoom with hysteresis to avoid jitter.
- When LOD data is available and the view is unified, the renderer patches the next LOD into the focused cluster only, keeping the rest of the graph coarse.
- Cluster expansion is sticky: user-triggered expansions persist until collapsed.
- Clicking a cluster node focuses and expands it; clicking again toggles; background click clears focus.
- Focus is reset automatically when leaving unified view or when module drill-down is active.

## Cluster Boundaries (WebGL)
- Cluster overlays render as bounding boxes derived from member node extents.
- Labels are attached to cluster hulls and re-style based on focus state.
- Focused clusters are visually emphasized; non-focused clusters dim when a selection is active.

## Backbone Edge Aggregation & Density Control
- At LOD0/1, edges are aggregated by `(cluster_id, type)`.
- Aggregated edges retain `weight`, `memberCount`, and a sample of member edges for previews.
- The “Backbone Density” slider in **Edge Filters** throttles cluster-level edge count to reduce clutter.
- SVG and WebGL tooltips expose aggregated edge samples for drilldown context.

## Label Budgeting & Stability
- Labels are budgeted by zoom bucket with hysteresis to prevent pop-in thrash.
- Ranking factors include degree, `importance`, `entrypoint`, `size`, `hotness`, and selection.
- Cluster labels receive a boost at the coarsest zoom level.
- Label budgets scale with node count to keep the scene readable.

## Breadcrumbs & Navigation
- Breadcrumbs appear in the top-left overlay, reflecting focus cluster, selection, or module path.
- Each cluster segment is clickable to jump focus to that level.
- A back control steps to the parent cluster when focused.

## Focus Modes
- Focus modes reduce the visible subgraph around the selected node:
  - `flow` (upstream + downstream)
  - `upstream`
  - `downstream`
  - `k-hop` (configurable hop count)
- When focus is active, non-included nodes/edges are filtered for clarity.

## Usage Cheatsheet
- **Zoom** to change LOD; only the focused cluster expands.
- **Click a cluster** to focus + expand it; click again to collapse.
- **Use Breadcrumbs** to navigate up/down the hierarchy.
- **Adjust Backbone Density** to tame edge clutter at low LOD.
- **Switch Focus Modes** to isolate upstream/downstream or k-hop neighborhoods.

