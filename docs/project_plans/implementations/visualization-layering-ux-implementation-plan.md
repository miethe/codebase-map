# Implementation Plan: Visualization Layering & Zoom UX Overhaul

Date: 2026-01-18
Source PRD: `docs/project_plans/PRDs/visualization-layering-ux-prd.md`

## 0) Principles & Architecture Notes
- Focus + context: zoom and LOD should be cluster-local, not global.
- Discrete tiers with hysteresis: avoid continuous pop-in and layout thrash.
- Stable spatial anchoring: children appear inside parent bounds.
- Prefer precomputed metadata (cluster_path, layer, importance) over runtime inference.

Key modules:
- Renderer: `components/GraphCanvasWebGL.tsx`, `components/GraphRenderer.tsx`
- LOD logic: `utils/useGraphLOD.ts`
- Layout helpers: `utils/clusterLayout.ts`
- Types/schema: `types.ts`
- Data pipeline: `code_map/*` (JSON generation)

---

## Phase 0: Foundation & Schema Alignment (2-4 days)

### Objectives
- Ensure graph data can express hierarchy and importance.
- Prevent invalid edges from crashing the renderer.

### Deliverables
1) Schema updates (types + data)
- Add optional fields in `types.ts`:
  - Node: `kind`, `layer`, `cluster_id`, `cluster_path`, `importance`, `size`, `hotness`
  - Edge: `type`, `weight`, `distance_class`, `confidence`
- Extend JSON generation to output these fields (in `code_map/`).

2) Hierarchy invariants
- Define and enforce hierarchy levels: `repo -> package -> module -> folder -> file -> symbol`.
- Implement deterministic `cluster_id` and `cluster_path` (repo-relative, stable).

3) Data validation
- In pipeline: assert all edges reference existing nodes before writing JSON.
- In viewer: filter edges that reference missing nodes as a safety net.

### Phase 0 Implementation Steps
1) Schema extensions
- Update `types.ts` to add optional fields for `Node` and `Edge`:
  - Node: `kind`, `layer`, `cluster_id`, `cluster_path`, `importance`, `size`, `hotness`
  - Edge: `type`, `weight`, `distance_class`, `confidence`
- Add any missing enum/string union types needed by renderers (e.g., `NodeKind`, `EdgeType`).

2) Data generation updates
- In `code_map/` scripts (and/or `scripts/` helpers), populate new fields:
  - `cluster_id`: deterministic stable ID; repo-relative path or hash.
  - `cluster_path`: array or string path in hierarchy order.
  - `layer`: hierarchy index (repo=0 ... symbol=5).
  - `importance`: stable score (e.g., PageRank or in-degree proxy).
- Ensure every node includes a valid `cluster_path` and `layer` for all LOD outputs.

3) Hierarchy invariants
- Define hierarchy list in a single source of truth (constants or utility):
  - `repo -> package -> module -> folder -> file -> symbol`
- Validate that each node's `cluster_path` conforms to this order.
- Ensure `cluster_id` aligns with the last element of `cluster_path`.

4) Pipeline validation
- Add a validation step before writing JSON:
  - Build a node ID set for the LOD dataset.
  - Drop or reject edges that reference missing node IDs.
  - Fail fast with a clear error message in scripts.

5) Viewer safety net
- In `GraphRenderer.tsx` (or a shared utility), filter out invalid edges on load:
  - Any edge whose `source` or `target` node is missing.
  - Log count (dev-only) for visibility.

6) LOD data sanity checks
- Confirm `cluster_path` exists on all nodes across `codebase-graph.lod*.json`.
- Ensure layer numbers are contiguous and within the expected range.

### Phase 0 Verification Checklist
- `types.ts` compiles with new optional fields and no downstream type errors.
- `codebase-graph.lod*.json` contains `cluster_path` for all nodes.
- Running data generation scripts fails on invalid edges.
- Viewer never crashes on invalid edge references; edges are dropped safely.

### Acceptance Criteria
- LOD JSONs contain `cluster_path` for all nodes.
- Any invalid edge is rejected in build and never crashes the app.

---

## Phase 1: Core UX Fixes (Must-Have, 1-2 weeks)

### Objectives
- Implement focal LOD and sticky cluster expansion.
- Make zoom deterministic and readable.

### Architecture Changes
1) Focal LOD selection
- Extend `useGraphLOD` to support per-cluster LOD resolution:
  - Inputs: `zoomLevel`, `focusClusterId`, `expandedClusters`.
  - Output: merged graph with LOD override for focused cluster(s).
- Add a “graph patching” mechanism:
  - Base graph uses current global LOD.
  - Focused cluster is replaced with its children from the next LOD dataset.

2) Focus target state
- Add `focusClusterId` to `GraphContext` (in `App.tsx`).
- Rules:
  - Click on cluster sets focus.
  - Camera target inside a cluster hull also sets focus (optional in Phase 1).

3) Sticky expansion
- Track expanded clusters separately from LOD.
- Expansion is user-driven and persists until collapse.

4) Cluster boundaries
- Render cluster hulls/planes in WebGL.
- Hulls reflect LOD0–LOD2 clusters; hidden at deep LOD to reduce clutter.

### Implementation Details
- `GraphRenderer.tsx`: pass `focusClusterId` to `useGraphLOD`.
- `useGraphLOD.ts`:
  - Implement `applyClusterExpansions` with LOD override.
  - Use `cluster_path` to map nodes to their cluster parent.
- `GraphCanvasWebGL.tsx`:
  - Add hull rendering layer (simple convex hull or bbox outline).
  - Ensure hulls and labels are culled by frustum.

### Acceptance Criteria
- Zooming expands only the focused cluster; others remain coarse.
- Users can clearly see the focused cluster boundary and label.
- Cluster expansion persists until explicitly collapsed.

---

## Phase 2: Readability & Guidance (Should-Have, 1-2 weeks)

### Objectives
- Reduce clutter and add navigation cues.

### Deliverables
1) Backbone edge filtering
- At LOD0/LOD1, aggregate edges by `(cluster_id, type)`.
- UI control to raise or lower edge density.

2) Label budgeting by importance
- Use `node.importance` to rank labels.
- Ensure label sets are stable across small zoom changes.

3) Breadcrumb navigation
- Show path: `System -> Cluster -> Module -> File`.
- Provide a “back” action to pop to parent.

4) Focus modes
- Implement subgraph filters: k-hop neighbors, upstream/downstream.

### Acceptance Criteria
- Clutter is reduced at low LOD; labels remain stable.
- Breadcrumb always reflects focus state.
- Focus modes reduce active graph by >70% in typical cases.

---

## Phase 3: Advanced Tooling (Could-Have, 1-2 weeks)

### Objectives
- Improve performance and exploration tooling.

### Deliverables
1) Layout caching
- Cache positions keyed by `(repo hash, graph version, LOD, filters)`.
- Store in IndexedDB or localStorage.

2) Edge hover drilldown
- Hover aggregated edge to preview constituent edges.

3) Search + jump
- Fuzzy search for node/cluster IDs.
- Camera fly-to + focus set.

### Acceptance Criteria
- Reloading a graph returns near-instant stable layout.
- Hover reveals details without performance regression.

---

## Cross-Cutting Performance Work
- Maintain LOD budgets:
  - LOD0: <= 80 nodes / 200 edges
  - LOD1: <= 300 nodes / 800 edges
  - LOD2: <= 1000 nodes / 2500 edges
  - LOD3: <= 2500 nodes / 6000 edges
- Use frustum + distance culling on nodes, edges, hulls, labels.
- Avoid full layout recomputation on zoom; only recompute for focused cluster expansion.

---

## Risks & Mitigations
- Risk: Incorrect cluster_path breaks focus expansion.
  - Mitigation: add schema validation + tests in pipeline.
- Risk: Hull rendering is expensive.
  - Mitigation: use bbox outlines or simplified hulls; cull aggressively.
- Risk: User confusion about focus target.
  - Mitigation: strong focus styling + breadcrumb + hover hints.

---

## Open Questions
- Should focus be camera-target driven by default or only click-driven?
- Are cluster hulls required for all LODs, or only LOD0–LOD2?
- Should the breadcrumb be global UI or integrated into the legend panel?
