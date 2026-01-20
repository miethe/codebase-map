# Visualization Layering Analysis & Improvements

## Executive Summary
The "node explosion" experienced when drilling down from Layer 1 (Modules) to Layer 2 (Files) is caused by a combination of high data density, a missing intermediate "Folder" aggregation layer in the current LOD strategy, and the absence of safety limits in the frontend renderer.

## Root Cause Analysis

### 1. Data Density & LOD Gaps
The current LOD strategy jumps directly from **Modules** (LOD 1) to **Files** (LOD 2).
-   **LOD 1 (Modules)**: 205 nodes. Manageable and readable.
-   **LOD 2 (Files)**: ~15,000+ nodes.
-   **The "Explosion"**: A single module (e.g., `skillmeat/web`) frequently contains hundreds of files. When a user drills down, the renderer attempts to load and display *all* constituent file nodes and their interconnections immediately.
-   **Missing Layer**: The data pipeline does not generate an intermediate "Folder" view for LOD 2, despite `folder` appearing in the hierarchy path. [build_outputs.py](file:///Users/miethe/dev/homelab/development/codebase-map/code_map/build_outputs.py) prioritizes `file:` over `folder:` for LOD 2, causing folders to be flattened.

### 2. Frontend Rendering Strategy
-   **Unbounded Expansion**: [useGraphLOD.ts](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts) logic ([applyClusterExpansions](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts#232-272)) fetches all children of a cluster from the next LOD level and merges them into the graph. It lacks a limit on the number of nodes added.
-   **Edge Aggregation Bypass**: The [aggregateClusterEdges](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts#136-201) function, which bundles edges for readability, only runs when `lodLevel <= 1`. When a cluster is expanded (simulating a localized higher LOD), the newly revealed nodes are treated as raw nodes. They lose the benefit of edge bundling, resulting in a "hairball" of connections.

## Recommendations

### Phase 1: Frontend Guardrails (Immediate Fix)
These changes can be implemented in the current branch to immediately mitigate usability issues.

1.  **Expansion Throttling (Safety Valve)**
    -   Modify [useGraphLOD.ts](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts) to check the `member_count` or actual child count before expanding.
    -   If a cluster has > 50 children, do NOT show all of them.
    -   **Strategy**: Show the top N nodes by `importance` (or `totalDegree`), and group the rest into a generic "Others" node, or refuse expansion and show a warning/tooltip.

2.  **Localized Edge Filtering**
    -   Apply the `backboneEdgeDensity` filter to the *expanded* subgraph as well.
    -   Currently, [applyBackboneEdgeDensity](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts#202-231) selectively filters cluster edges. We should extend this to filter edges between file nodes if the density is too high.

3.  **Sticky Folder/Sub-cluster Mocking (Runtime)**
    -   If possible, blindly grouping files by their parent directory path *at runtime* in [useGraphLOD](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts#283-392) could simulate a Folder layer without regenerating data.

### Phase 2: Data Pipeline Refinement (Strategic Fix)
1.  **Introduce Explicit Folder Layer**
    -   Update [code_map/build_outputs.py](file:///Users/miethe/dev/homelab/development/codebase-map/code_map/build_outputs.py) to prioritize `folder:` clusters in LOD 2.
    -   Shift `file:` nodes to LOD 3 (or a new split LOD 2.5).
    -   Hierarchy: `Package (LOD0) -> Module (LOD1) -> Folder (LOD2) -> File (LOD3)`.

2.  **Prune Low-Value Nodes**
    -   Aggressively filter "helper" or "util" files in the visualization unless explicitly requested.

## Proposed Implementation Plan (Phase 1)
We will focus on the Frontend Guardrails to solve the immediate UX problem.

1.  **Update [types.ts](file:///Users/miethe/dev/homelab/development/codebase-map/types.ts)**: Add `limit` or `filtered` flags to `GraphData` / [Node](file:///Users/miethe/dev/homelab/development/codebase-map/App.tsx#370-381) if needed to track throttled clusters.
2.  **Modify [useGraphLOD.ts](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts)**:
    -   Update [applyClusterExpansions](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts#232-272) to accept a `maxNodesPerCluster` limit (e.g., 40).
    -   Sort children by `importance` (or degree) and only merge the top N.
    -   Create a synthetic "More..." node if truncation occurs.
3.  **Refine Edge Aggregation**:
    -   Ensure [applyBackboneEdgeDensity](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts#202-231) handles expanded file-to-file edges gracefully.

