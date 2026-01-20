# Implementation Plan: Pre-computed Visualization Data

## Goal Description
Move heavy lifting from the frontend runtime to the data generation pipeline to solve "node explosion" and layout instability. This involves injecting a "Folder" layer into the graph hierarchy and pre-calculating node positions and metrics.

## User Review Required
> [!IMPORTANT]
> This plan introduces a new Python dependency, `networkx`, for layout calculation. Please install it via `pip install networkx` (or add to your dependency manager) before running the new scripts.

## Proposed Changes

### Data Pipeline (`code_map/`)

#### [MODIFY] [build_outputs.py](file:///Users/miethe/dev/homelab/development/codebase-map/code_map/build_outputs.py)
- **Folder Injection**: Update `_aggregate_lod_graph` to properly handle the `folder` hierarchy level.
    -   **LOD 2 Change**: Instead of jumping from Module -> File, LOD 2 will now group files into `folder` clusters.
    -   **LOD Scheme Update**:
        -   LOD 0: Package
        -   LOD 1: Module
        -   LOD 2: Folder (New)
        -   LOD 3: File (shifted from LOD 2)
        -   LOD 4: Symbol (shifted from LOD 3)
- **Constraint**: Ensure backwards compatibility or update frontend constants (`LOD_THRESHOLDS`) to match. *Decision*: To keep it simple, we will insert Folder at LOD 2 and shift Files to LOD 3.

#### [NEW] [code_map/compute_layout.py](file:///Users/miethe/dev/homelab/development/codebase-map/code_map/compute_layout.py)
- A new script to pre-calculate node positions for each LOD.
- **Algorithm**: Use `networkx` spring_layout or a hierarchical circle-packing algorithm.
- **Output**: Decorates the graph nodes with `x`, `y`, `z` (limited to 2D for now for simplicity, or 3D if libraries allow).
- **Orchestration**: Called by `build_outputs.py` before saving JSONs.

#### [NEW] [code_map/compute_metrics.py](file:///Users/miethe/dev/homelab/development/codebase-map/code_map/compute_metrics.py)
- Calculate structural metrics to drive visualization importance:
    -   `pagerank`: For sizing and importance.
    -   `betweenness_centrality`: To identify "bridge" nodes.
    -   `community`: Louvain or similar for coloring/grouping suggestions.

### Frontend (`src/`)

#### [MODIFY] [types.ts](file:///Users/miethe/dev/homelab/development/codebase-map/types.ts)
- Add optional `fx`, `fy`, `fz` (fixed coordinates) to `Node` interface.
- Add `metrics` object to `Node` for pre-calculated values.

#### [MODIFY] [utils/useGraphLOD.ts](file:///Users/miethe/dev/homelab/development/codebase-map/utils/useGraphLOD.ts)
- Update `LOD_THRESHOLDS` to accommodate the new depth (0-4).
- Update `applyClusterExpansions` to utilize pre-computed `fx`/`fy` if available, setting them as initial positions to minimize simulation warm-up.

#### [MODIFY] [components/GraphCanvasWebGL.tsx](file:///Users/miethe/dev/homelab/development/codebase-map/components/GraphCanvasWebGL.tsx)
- Update D3 force simulation to respect pre-computed fixed positions (`fx`, `fy`) if they exist, possibly skipping the simulation entirely for static views.

## Verification Plan

### Automated Verification
- **Pipeline Tests**: Run `python3 -m code_map.build_outputs` and verify:
    -   `codebase-graph.lod2.json` contains `kind: "folder"` clusters.
    -   `codebase-graph.lod3.json` contains files.
    -   Output JSONs have `x, y` coordinates (after layout script integ).

### Manual Verification
- **Visual Inspection**:
    1.  Load the app.
    2.  Zoom in from LOD 1 (Modules).
    3.  **Expectation**: See "Folder" clusters appear *before* seeing thousands of generic files.
    4.  **Performance**: Verify that the transition is smooth and the layout doesn't "explode" or jitter.
    5.  **Drill-down**: Click a folder to expand it and see files (LOD 3).
