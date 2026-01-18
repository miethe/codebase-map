# PRD: Visualization Layering & Zoom UX Overhaul

Date: 2026-01-18
Status: Draft (final PRD requested)
Owner: TBD

## 1) Problem Statement
The current zoom and layering experience feels chaotic. Zooming expands the entire graph rather than the area of interest, cluster boundaries are unclear, and depth is not communicated. Users cannot predict what will appear next, which makes the map difficult to explore and interpret.

## 2) Goals
- Make zoom and layering feel deterministic: users always know which cluster they are entering.
- Reveal detail locally (focus + context), not globally.
- Preserve spatial context so clusters and subclusters feel like nested regions.
- Keep performance stable at 2k nodes / 5k edges with headroom.

## 3) Non-Goals
- Replacing the renderer or changing the overall tech stack.
- Full feature parity with SVG fallback.
- AI or workflow integrations (out of scope for this PRD).

## 4) Primary Users & Use Cases
- Engineers exploring architecture (high-level boundaries and flows).
- Developers investigating a subsystem (drill down into a cluster).
- Reviewers inspecting hotspots (churn, size, risk).

## 5) Design Principles
- Overview first, zoom and filter, then details on demand.
- Focus + context: the focused cluster expands; neighbors stay coarse.
- Stable spatial anchors: children appear within their parent bounds.
- Discrete LOD tiers with hysteresis and sticky user intent.

---

## 6) Product Requirements

### 6.1 Must-Have (Phase 1)
1) Focal LOD (local expansion)
- Only the focused cluster expands when zooming in.
- Other clusters remain at their current LOD.

2) Explicit focus target
- Define and track a focused cluster based on click or camera target.
- Camera zooms into the focused cluster and uses its bounds for scaling.

3) Sticky expansion
- Cluster expansion persists until explicitly collapsed.
- Zoom changes do not reset user intent.

4) Spatial anchoring with visible boundaries
- Render cluster hulls/planes and labels at all macro levels.
- Children spawn inside parent bounds with a staged transition.

5) Discrete LOD tiers (hierarchical)
- LOD0 clusters -> LOD1 modules -> LOD2 files -> LOD3 symbols.
- Apply hysteresis and per-cluster LOD based on screen size, not global zoom.

6) Data validation / sanitization
- Ensure edges always reference existing nodes.
- Fail fast in generation; filter in viewer as a safety net.

### 6.2 Should-Have (Phase 2)
1) Backbone edge filtering
- Low LOD shows aggregated edges by weight/type.
- Add a control to increase edge density.

2) Label budgeting by importance
- Labels capped per LOD, prioritized by importance score.
- Stable label selection across small zoom changes.

3) Breadcrumb + back navigation
- Show the path: System -> Cluster -> Module -> File.
- Provide a back step (keyboard + UI).

4) Subgraph focus modes
- Neighbors k-hop, upstream/downstream, path to entrypoints.

### 6.3 Could-Have (Phase 3)
1) Layout caching
- Persist layout positions keyed by (repo hash, graph version, LOD, filters).

2) Edge hover drill
- Hover an aggregated edge to reveal its constituent edges temporarily.

3) Search + jump
- Jump to a node/cluster and snap focus there.

---

## 7) Data & Schema Requirements
Must be supported in JSON outputs and `types.ts`:
- Node fields: `kind`, `layer`, `cluster_id`, `cluster_path`, `importance`, `size`, `hotness`.
- Edge fields: `type`, `weight`, `distance_class`, `confidence`.
- LOD datasets: `codebase-graph.lod0.json` through `lod3`.

Notes:
- `cluster_path` is the canonical hierarchy source for per-cluster LOD.
- `importance` drives label budgets and focal transitions.

---

## 8) Interaction & UX Details

### 8.1 Focused Zoom
- Zooming in identifies the nearest cluster to the camera target and sets it as the focus.
- When focused, only that cluster descends to the next LOD tier.

### 8.2 Staged Transitions
- Stage 1: fade or ghost non-focused clusters.
- Stage 2: expand the focused cluster hull.
- Stage 3: animate child nodes into place inside the hull.

### 8.3 Visual Boundaries
- Cluster hulls or planes are always visible at LOD0-LOD2.
- Cluster labels are pinned to hulls.

### 8.4 Expand/Collapse Controls
- Click on cluster to expand or collapse.
- Breadcrumb provides quick pop back to parent.

---

## 9) Rendering & Performance Requirements
- WebGL primary rendering path remains.
- Use frustum and distance culling for both nodes and edges.
- Maintain node/edge budgets per LOD:
  - LOD0: <= 80 nodes, <= 200 edges
  - LOD1: <= 300 nodes, <= 800 edges
  - LOD2: <= 1000 nodes, <= 2500 edges
  - LOD3: <= 2500 nodes, <= 6000 edges
- Avoid full re-layout on zoom. Only recompute layout for focused clusters.

---

## 10) Milestones

### Phase 1: Core UX Fixes (Must-Have)
- Focal LOD with explicit focus target.
- Sticky expansion and per-cluster LOD based on screen size.
- Cluster hull rendering + staged transitions.
- Data validation of edges -> nodes.

### Phase 2: Readability + Guidance (Should-Have)
- Backbone edge filtering + density control.
- Label budgeting by importance.
- Breadcrumb navigation.
- Focus modes (k-hop, upstream/downstream).

### Phase 3: Advanced Tooling (Could-Have)
- Layout caching (localStorage/IndexedDB).
- Edge hover drilldown.
- Search + jump.

---

## 11) Acceptance Criteria
- Zooming into a cluster only reveals nodes within that cluster; other clusters remain coarse.
- The focused cluster is always visually indicated (hull + label + breadcrumb).
- Zoom transitions feel predictable and do not cause global layout resets.
- Layering depth is clear: users can tell which level they are on.
- LOD switching does not exceed node/edge budgets for each tier.

---

## 12) Risks & Mitigations
- Risk: Data lacks hierarchy fields.
  - Mitigation: add `cluster_path` and `cluster_id` in the pipeline first.
- Risk: User confusion about focus target.
  - Mitigation: add explicit visual focus treatment and breadcrumb.
- Risk: Performance regressions from hull rendering.
  - Mitigation: simplify hull geometry and cull off-screen clusters.

---

## 13) Open Questions
- Confirm the authoritative hierarchy levels and cluster rules for the repo.
- Do we need multi-repo support or ownership grouping in the first release?
- The PDF report could not be parsed in this environment (missing PDF tools). If critical, provide text export or allow a parsing dependency.
