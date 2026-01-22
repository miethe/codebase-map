# Implementation Plan: Cluster LOD View Mode

Date: 2026-01-22
Status: Draft
Owner: TBD

## Overview
Add a new "Clusters" view mode that uses the semantic computed groupings as a hierarchical LOD system. The initial view shows only top-level computed clusters as nodes. Double-click expands a cluster into its children, and eventually into the underlying graph nodes. "Systems" view should revert to its prior behavior.

## Goals
- Provide an interactive, LOD-style drill-down for computed clusters.
- Start with top-level cluster nodes only; expand on double-click.
- Use the semantic paths from overrides (`metadata.path`) as the hierarchy.
- Keep existing Systems view behavior intact.

## Non-Goals
- Replace the existing Map/Systems/Stacked views.
- Change the grouping pipeline or JSON formats.
- Implement new clustering algorithms (use existing computed groupings).

## Approach
Build an in-memory, grouping-derived LOD graph:
- Create a cluster hierarchy from `groupingData` (computed group set).
- For each depth level, generate a GraphData layer where nodes represent path prefixes.
- Aggregate edges between clusters based on underlying raw graph edges.
- At the deepest level, include actual nodes with `cluster_path` set to the cluster hierarchy so `useGraphLOD` can expand into real nodes.

## Work Items
1) Data modeling
- Add a new helper module (e.g., `utils/clusterLod.ts`).
- Build a cluster tree from `groupingData.groups` using `metadata.path`.
- Ensure stable cluster IDs (e.g., `cluster:computed/<path>` or hash of path).
- Handle nodes without a computed grouping (assign to `Other`).

2) LOD graph generation
- Build `GraphLODData` from the cluster tree and raw graph edges:
  - Level 0: top-level cluster nodes (path length 1).
  - Level N: intermediate cluster nodes (path length N).
  - Final level: raw nodes (from `rawData`), each tagged with cluster `cluster_path`.
- Aggregate edges per level: map each raw edge to the cluster IDs of its endpoints at that depth and sum weights.
- Mark cluster nodes with `kind: 'cluster'` and `canExpand: true` when they have children.

3) View mode integration
- Add `clusters` to `ViewMode` in `types.ts`.
- Add a new button to the Layout Modes UI (e.g., label "Clusters") in `components/Sidebar.tsx`.
- In `components/GraphRenderer.tsx`, branch data source:
  - If `viewMode === 'clusters'`, feed `useGraphLOD` with the cluster LOD data and allow expansion.
  - Keep Systems view unchanged (revert LOD gating that was added for Systems).

4) Interaction + Focus Cluster sync (required)
- On cluster expand (double-click), sync `activeModule` to the cluster path so Sidebar Focus Cluster mirrors the expansion.
- On collapse, update `activeModule` to the parent path (or null at root).
- Use the existing `onNodeExpand` flow and pass cluster depth so the LOD expansion state stays consistent.

5) Performance + caching
- Memoize cluster LOD data based on `rawData`, `groupingData`, and `activeGroupingMode`.
- Limit aggregation to computed-group nodes for speed.

6) UX copy/affordances
- Add tooltip or helper text to the Clusters view (“Double-click to drill down”).
- Ensure legend and node colors remain meaningful.

## Files to Touch
- `types.ts` (new view mode)
- `components/Sidebar.tsx` (layout mode toggle)
- `components/GraphRenderer.tsx` (data source switch)
- `App.tsx` (state for cluster LOD data if needed)
- `utils/clusterLod.ts` (new)
- `utils/useGraphLOD.ts` (minor wiring if needed)

## Acceptance Checklist
- New “Clusters” view mode appears in the UI.
- Initial Clusters view shows only top-level computed clusters as nodes.
- Double-click expands into child clusters; repeated expansion reaches raw nodes.
- Focus Cluster list tracks the active cluster path (required).
- Systems view behavior matches pre-change expectations.

## Risks / Open Questions
- Edge aggregation costs could spike for large graphs; mitigate with memoization and batching.
- Some nodes may not map to computed groups; define an "Other" cluster bucket.
- Need to confirm desired depth mapping when `metadata.path` is shallow or missing.
