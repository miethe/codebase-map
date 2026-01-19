# Layered LOD UX Proposal

Date: 2026-01-19

## Summary
The current 3D graph uses 2D cluster boxes at z=0, and LOD expansion keeps most nodes visible at once. This makes grouping, drill-down, and multi-membership hard to read. This proposal recommends a layered LOD stack, stronger 3D group boundaries, and clearer drill-down focus to improve UX while preserving existing data and renderer structure.

## Scope
- WebGL renderer: `components/GraphCanvasWebGL.tsx`
- LOD expansion: `utils/useGraphLOD.ts`
- Grouping metadata: `codebase-graph.groupings.json`
- Types: `types.ts`

## Current UX Issues
- Cluster boxes are flat (2D) and dim in a 3D scene, so they do not read as group boundaries.
- LOD expansion keeps unrelated clusters visible, causing visual clutter when drilling down.
- Depth cues are weak, so users cannot tell which detail level they are in.
- Cross-layer edges become noisy when detail increases.
- Nodes that belong to multiple groups are not visually explained.

## Proposed Solution (Prioritized)

### 1) Layered LOD Stack (Primary)
Make each LOD level a distinct z-layer (e.g., LOD0 top, LOD3 bottom). This provides immediate clarity about “where” the user is in the hierarchy.
- Compute a depth for nodes from `cluster_path.length - 1` or explicit `lodDepth` during LOD merge.
- Apply a `forceZ()` in WebGL to pin nodes per LOD depth with a configurable `layerSpacing`.
- Add a simple toggle + slider in the sidebar: `Layered LOD` + `Layer spacing`.

### 2) Layer Planes + Labels (Secondary)
Add translucent planes between layers to reinforce the depth separation.
- Planes sized from graph bounds (`getGraphBbox`).
- Color-coded by LOD level with a small label sprite (LOD0, LOD1, etc.).
- `depthWrite=false` so they never occlude nodes.

### 3) Replace 2D Boxes With 3D Cages (Secondary)
Draw actual 3D bounding boxes around cluster members.
- Compute min/max x,y,z per cluster and render line segments.
- Increase label size/contrast and place at top-front corner.
- This directly fixes “boxes are worthless” without a full layout rewrite.

### 4) Multi-Membership Indicators (Optional)
Represent nodes belonging to multiple groups with multi-ring glyphs or tether lines to each group plane.
- Use `group_sets[].multi_membership` to determine when to render.
- Tooltip lists all memberships to make the relationship explicit.

### 5) Drill-Down Isolation (Optional)
Make expansion more legible by controlling context.
- Add a context toggle: `All` / `Same layer` / `Cluster only`.
- Dim or hide unrelated layers when focusing a cluster.
- Keep aggregated edges for off-layer groups to avoid spaghetti.

### 6) Cross-Layer Edge Routing (Optional)
Make long vertical connections easier to follow.
- Use 2-segment routing via a shared portal point per layer.
- Increase curvature only for cross-layer edges.
- Keep aggregated edges as default when endpoints are collapsed.

## UX Impact
- Clear separation of hierarchy levels through depth + planes.
- Visible, readable cluster boundaries in 3D.
- Drill-down feels like “entering” a cluster instead of revealing everything.
- Cross-layer edges stay intelligible rather than dominating the scene.

## Implementation Notes
- LOD depth can be computed in `utils/useGraphLOD.ts` during merge (add `lodDepth` or reuse `cluster_path.length`).
- `GraphCanvasWebGL` already uses `forceZ()`; extend it to assign per-node target z.
- Overlays already exist (`cluster-overlays`, `module-overlays`); add a new `lod-plane-overlays` group.
- Keep SVG fallback unchanged for now; focus changes on WebGL renderer only.

## Phased Rollout
1) Layered LOD stack + spacing control (MVP)
2) Layer planes + labels
3) 3D cluster cages + label contrast
4) Drill-down isolation toggle
5) Multi-membership indicators
6) Cross-layer edge routing

## Acceptance Criteria
- Users can clearly identify which LOD they are viewing without reading UI text.
- Cluster boundaries are visible at typical zoom levels.
- Drilling into a cluster shows that cluster prominently without overwhelming clutter.
- Cross-layer edges remain readable at overview and mid zoom.

## Open Questions
- Which hierarchy field should define `lodDepth` (cluster_path length vs explicit level)?
- Should planes appear only when `Layered LOD` is enabled?
- Default spacing value that balances depth clarity with layout stability?
- Should drill-down isolation be a default behavior or opt-in?

