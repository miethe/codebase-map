# Visualization Layering & Cluster Hierarchy Plan

## Goals
- Make the graph readable at all scales by default (overview → zoom → details-on-demand).
- Introduce multi-layer clustering so zooming reveals nested structure rather than spaghetti.
- Treat clusters as first-class entities (cluster nodes + aggregated edges) that can be expanded.
- Enable FalkorDB-style “map layers” and stable, repeatable views for screenshots.
- Keep interactions fast (LOD, culling, budgets) and **optimized for WebGL**, with SVG only as a fallback.

## Non-Goals (for this plan)
- Replace the renderer (covered by `docs/project_plans/webgl-refactor-plan.md`).
- Add AI features or workflow integrations (tracked elsewhere).
- Provide full SVG feature parity (SVG is fallback-only and may be deprecated).

## Current Baseline (Relevant Files)
- Rendering: `components/GraphCanvasWebGL.tsx` (primary), `components/GraphRenderer.tsx`, `components/GraphCanvas.tsx` (SVG fallback, optional)
- Layout helpers: `utils/clusterLayout.ts`, `utils/moduleGrouping.ts`
- Metrics: `utils/graphAnalytics.ts`
- Data model: `types.ts`, `constants.ts`
- Graph data: `codebase-graph.*.json`, `metadata.json`, `codebase-graph.groupings.json`
- Scraping pipeline now in `code_map/` (Python scripts; **not** `scripts/code_map/`)

---

## 1) Data Model Extensions (Graph Schema)

### 1.1 Node Fields (additive, backwards compatible)
Add fields to `types.ts` and graph JSON:
- `kind`: `repo|package|module|folder|file|symbol|cluster` (explicit hierarchy level).
- `layer`: `ui|api|domain|data|infra|tests|shared|external` (architectural strata).
- `cluster_id`: **stable, deterministic** cluster id for the current hierarchy level.
- `cluster_path`: array of parent cluster ids (root → leaf), derived from deterministic ids.
- `size`: numeric (LOC/tokens/byte size/complexity proxy).
- `hotness`: churn score (commits/30d, last_modified age).
- `bus_factor`: unique author count.
- `entrypoint`: boolean.
- `externality`: `internal|vendor|third_party`.
- `generated`: boolean.
- `label_short`: short label for high-level views.

### 1.2 Edge Fields
- `type`: semantic category (import/call/inherit/render/read/write/event/etc).
- `weight`: strength (callsite count, ref count).
- `distance_class`: `local|cross-folder|cross-module|cross-package|cross-service`.
- `confidence`: `static|heuristic|dynamic`.
- `direction`: keep directed; include `bidirectional` flag for cycles.

### 1.3 Cluster Graphs (Multi-LOD)
Create new aggregated datasets (or embed in groupings):
- `codebase-graph.lod0.json`: repo/package clusters only.
- `codebase-graph.lod1.json`: package → module/folder clusters.
- `codebase-graph.lod2.json`: module → file clusters.
- `codebase-graph.lod3.json`: file → symbol nodes (current detail level).
Each LOD graph contains:
- cluster nodes with aggregated metrics (node count, total size, cohesion/coupling).
- aggregated edges with weight + type rollups.

### 1.4 Groupings as Primary Hierarchy Source
Extend `codebase-graph.groupings.json` to include group sets for each hierarchy level:
- `structure: repo/package/module/folder/file/symbol` (tree)
- `layer: ui/api/domain/data/infra/tests`
- `ownership: team/service/domain` (if available)

---

## 2) Scraping & Data Pipeline Updates (code_map/)

### 2.1 Hierarchy + Layer Inference
Update `code_map/build_groupings.py` and `code_map/metadata_utils.py` to:
- Build deterministic `cluster_id` and `cluster_path` using repo-relative path (hash or stable slug).
- Add `kind` and `layer` by heuristics (path prefixes, framework imports).
- Map `entrypoint` flags from framework-specific entry files (e.g. `index.tsx`, routers).

### 2.2 Metrics Enrichment
- Add size proxies (LOC, token counts) in `code_map/extract_details.py`.
- Use `code_map/extract_git_metadata.py` to compute `hotness` and `bus_factor`.
- Add centrality or SCC detection in `code_map/graph.py` or a new script:
  - SCC for cycles (architecture risk).
  - Optional PageRank/degree for backbone.

### 2.3 Edge Semantics
Extend extractors (`extract_frontend_*`, `extract_backend_*`) to assign:
- Edge `type` based on relationship (render/call/import/read/write).
- `distance_class` by comparing cluster_path ancestry.
- `weight` from callsite counts (fallback: 1).

### 2.4 Build Outputs
Update `code_map/build_outputs.py` to write the new LOD graphs and groupings.
Keep existing files intact to preserve compatibility.

---

## 3) Runtime Aggregation & LOD System

### 3.1 LOD Selection Strategy
Create a zoom-based LOD system in `GraphRenderer` with data selection in a renderer-agnostic hook (e.g., `useGraphLOD`):
- LOD0 (overview): clusters only, edges bundled, label budget low.
- LOD1 (mid): cluster nodes + major edges.
- LOD2 (close): files + key symbols, selective edges.
- LOD3 (detail): full symbol graph for focused areas only.

### 3.2 Cluster Nodes as First-Class Entities
- New `ClusterNode` model backed by the aggregated datasets.
- Cluster nodes expose:
  - `expand()` → swap in children nodes/edges.
  - `collapse()` → replace with parent cluster node.
- Use `utils/clusterLayout.ts` for cluster positions; reuse existing D3 force if needed.

### 3.3 Edge Bundling & Superedges
- Aggregate edges by `(source_cluster, target_cluster, type)`.
- Render single “superedge” per bundle with thickness by weight.
- On hover, temporarily reveal contained edges.

### 3.4 Focus & Drill-Down
- Clicking a cluster enters “drill mode” (camera zoom + graph swap).
- Back button or breadcrumb to pop back up a layer.
- “Context ring” visualization: neighbors outside drill scope in low opacity.
  
### 3.5 Hybrid Graph Expansion
- Allow partial expansion within a higher LOD (e.g., mostly LOD1 with a single LOD2 subtree).
- Use a “graph patching” approach: merge expanded children into the current graph instead of replacing the entire dataset.
- Keep positions stable by seeding children at the parent cluster’s `(x, y)` with slight jitter.

---

## 4) Visualization UX Enhancements

### 4.1 View Presets (FalkorDB-style)
Add one-click presets with deterministic camera framing:
- Architecture: layers (ui→api→domain→data) as stacked planes.
- Dependency Backbone: centrality threshold with bundled edges.
- Hotspots: node size/color based on churn/complexity.
- Risk: highlight SCC cycles + forbidden edges (if rules exist).

### 4.2 Label Strategy
- Only show cluster labels at low zoom.
- Show file/symbol labels only when zoom ≥ LOD2.
- Add label collision avoidance + max label budget.

### 4.3 Filters & Toggles
- Edge-type filters (imports vs runtime calls).
- “Hide intra-file edges” toggle.
- “Hide tests/generated/vendor” toggle.
- “Only cross-boundary edges” toggle for overview.

### 4.4 Summary Glyphs (Cluster Composition)
- Add optional mini-glyphs on cluster nodes (e.g., mini bars for layer composition or a heat tint for churn).
- Keep glyph rendering in WebGL; omit in SVG fallback if it complicates the path.

---

## 5) Rendering & Performance Plan

### 5.1 Renderer Abstraction
- Keep `GraphRenderer` responsible for choosing LOD and data sources via `useGraphLOD`.
- LOD switching should not re-run heavy layouts on every zoom tick.
- WebGL is the primary renderer; SVG is optional fallback and may be deprecated later.

### 5.2 Performance Techniques
- Cache layout positions per LOD to avoid recompute.
- Use spatial indexing for hit testing on dense views.
- Use render budgets:
  - `max_nodes`, `max_edges`, `max_labels` per LOD.
- Reduce detail during interaction (already present in `GraphCanvas.tsx`).

---

## 6) Export & Screenshot Pipeline

### 6.1 Layered Export Passes
Add export pipeline for repeatable “layered” images:
- Pass 1: clusters/nodes only
- Pass 2: edges only (bundled)
- Pass 3: labels only
- Pass 4: highlights only
- Pass 5: heatmap overlays
All passes share the same camera pose and dimensions.

### 6.2 Deterministic Layouts
- Seeded layouts for reproducible screenshots.
- Optional orthographic projection for export mode.

---

## 7) Implementation Phases

### Phase 0 — Design & Schema Alignment (1–2 days)
- Confirm the hierarchy levels and LOD thresholds.
- Finalize node/edge fields and group sets.
- Update `types.ts` to include new optional fields.

#### Phase 0 Decisions (Confirmed)
- Hierarchy levels: `repo → package → module → folder → file → symbol`. Cluster nodes represent aggregates at any level.
- Group set IDs: `structure`, `layer`, `ownership` (ownership optional if data is missing).
- Initial LOD thresholds (normalized zoom scale `k`, where `k=1` is default view):
  - LOD0: `k < 0.45` (overview clusters)
  - LOD1: `0.45 ≤ k < 0.9` (mid clusters)
  - LOD2: `0.9 ≤ k < 1.8` (files + key symbols)
  - LOD3: `k ≥ 1.8` (detail symbols)
  - Apply hysteresis of ±0.1 to reduce LOD jitter.

### Phase 1 — Data Pipeline (3–5 days)
- Implement hierarchy + layer inference in `code_map/` scripts.
- Generate LOD graphs and updated groupings.
- Validate with `code_map/validate_graph.py`.

### Phase 2 — LOD Runtime (3–5 days)
- Add LOD switching in `GraphRenderer`.
- Implement cluster expansion/collapse.
- Add superedge aggregation and edge bundling.
- Ensure WebGL-first implementation; defer SVG parity unless needed.

### Phase 3 — UX & Presets (3–4 days)
- Add view presets (Architecture/Backbone/Hotspots/Risk).
- Add toggles and filters.
- Implement label budget + collision avoidance.
 - Add summary glyphs for cluster nodes (WebGL first).

### Phase 4 — Export & Repeatability (2–3 days)
- Add export pipeline and deterministic camera presets.
- Add orthographic export option and seeded layouts.

---

## 8) Acceptance Criteria
- At default zoom, the graph shows clusters (not individual symbols) with readable labels.
- Zooming in reveals deeper levels without overwhelming edge density.
- Cluster expansion/collapse preserves positions and context.
- Edge bundling is enabled at LOD0/LOD1 and disables cleanly at LOD2+.
- Exports produce consistent multi-pass images with identical camera framing.

---

## 9) Risks & Mitigations
- **Layout instability**: use seeded layout + cached positions.
- **LOD jitter**: add hysteresis thresholds for zoom switching.
- **Performance regression**: enforce node/edge budgets; use WebGL for large graphs.
- **Schema churn**: keep old JSON files and add new ones in parallel.
- **Orphan nodes at high LOD**: create a `shared/utils` cluster strategy to avoid “dust cloud” views.

---

## 10) Open Questions
- Which hierarchy should be the primary cluster path: path-based or semantic tags?
- Do we want dynamic clustering (community detection) in addition to path-based groups?
- Should the app load all LOD files up-front or fetch on demand, or use hybrid graph patching?
