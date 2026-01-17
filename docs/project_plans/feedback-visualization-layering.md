# Feedback: Visualization Layering & Cluster Hierarchy Plan

## 1. Executive Summary
The plan is comprehensive and addresses the core scalability issues of the graph visualization. The shift to a "Level of Detail" (LOD) approach with first-class Cluster Nodes is the correct architectural decision for handling 10k+ nodes.

However, the plan assumes a strong dependency on the current SVG-based renderer in some sections, while the codebase is actively moving toward WebGL (`components/GraphCanvasWebGL.tsx`). **Recommendation: Explicitly decouple the LOD logic from the renderer so it works primarily with the new WebGL implementation.**

## 2. Detailed Feedback

### 2.1 Alignment with WebGL Refactor
- **Current State**: The plan mentions `components/GraphCanvas.tsx` (SVG) as the baseline.
- **Reality**: `components/GraphCanvasWebGL.tsx` is already quite advanced (implementing force-directed layout, instances, transparency).
- **Feedback**: The "Runtime Aggregation" (Section 3) should be implemented as a hook (e.g., `useGraphLOD`) that feeds `nodes` and `links` to `GraphCanvasWebGL`. The WebGL renderer is better suited for the "Context ring" and "Ghost nodes" mentioned in 3.4 due to better alpha blending performance.

### 2.2 Data Pipeline Paths
- **Correction Needed**: The plan refers to scripts in `scripts/code_map/` (e.g., `scripts/code_map/build_groupings.py`).
- **Actual Location**: These scripts appear to reside in `code_map/` (root-level directory) based on the current workspace structure.
- **Action**: Update the plan to reflect the correct paths to avoid confusion during implementation.

### 2.3 Data Model & ID Consistency
- **Strongly Endorse**: The `cluster_id` and `cluster_path` fields are essential.
- **Concern**: Ensure that `cluster_id`s are deterministic and stable across re-runs. If `lod1` clusters change IDs between builds, the user's "saved views" or mental model will break.
- **Suggestion**: Use the file-path-based hashing (already present in `GraphCanvasWebGL.tsx` for some keys) as the canonical source for cluster IDs.

### 2.4 LOD Transitions
- The plan proposes `codebase-graph.lodX.json` files.
- **Edge Case**: What happens when a user is at LOD1 (Packages) but expands *one* specific package to see its Modules?
- **Recommendation**: The runtime state should likely be a "Hybrid Graph" where most of the graph is LOD1, but the focused region is LOD2. Loading *entire* LOD files might be too rigid. Consider a "Graph Patching" approach where expanding a cluster fetching/merges the subgraph `children` into the current visualization.

### 2.5 Visual Metaphors
- **Section 3.3 (Superedges)**: This is excellent.
- **Addition**: Consider **"Summary Glyphs"** on cluster nodes. Instead of just a circle, a Cluster Node could show a mini-barchart of its composition (e.g., "60% UI, 40% Logic") or a "heat" color if it contains high-churn files.

## 3. Risks & Missing Pieces

### 3.1 "Orphan" Nodes
- The plan focuses on a neat hierarchy. Real codebases have "utility" files or "scripts" that don't fit the `ui/api/domain` layers.
- **Risk**: These could form a "dust cloud" of unconnected nodes at high levels.
- **Mitigation**: Create a specific "Shared / Utils" cluster strategy to capture low-level orphans so they don't clutter the LOD0 view.

### 3.2 Layout Stability
- `GraphCanvasWebGL.tsx` currently has `d3ReheatSimulation`. Switching LODs will drastically change the topology.
- **Risk**: The graph "exploding" and reforming violently on every zoom.
- **Mitigation**: When expanding a cluster, spawn the children at the parent's `(x, y)` coordinates + a small random jitter, rather than resetting the simulation. This creates a "blooming" effect.

## 4. Implementation Priorities (Adjusted)

1.  **Phase 1 (Data)**: Unblock this immediately. The `code_map` scripts need to start generating `cluster_id`s.
2.  **Phase 2 (Renderer)**: Skip implementing this in SVG. Go straight to `GraphCanvasWebGL.tsx`.
3.  **Phase 3 (Interaction)**: Click-to-expand is high value.

## 5. Next Steps
- Approve the schema changes in `types.ts`.
- Start modifying `code_map/build_groupings.py` to generate the hierarchy.
