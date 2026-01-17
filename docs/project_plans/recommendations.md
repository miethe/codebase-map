# Codebase Map Improvement Recommendations

This document outlines a comprehensive list of recommended improvements for the Codebase Map application, covering backend data processing, frontend user experience, performance, and workflow integrations.

## 1. Performance & Core Rendering
The current SVG-based rendering ([components/GraphCanvas.tsx](file:///Users/miethe/dev/homelab/development/codebase-map/components/GraphCanvas.tsx)) is excellent for visual fidelity but will likely encounter performance bottlenecks as the graph scales beyond 1,000-2,000 nodes.

### **[CRITICAL] Switch to WebGL/Canvas Rendering**
Migrate the core visualization to a Canvas or WebGL-based renderer while maintaining the React overlay for interactivity.
-   **Why**: SVG DOM operations are heavy. Canvas moves rendering to the GPU/Rasterizer, enabling smooth 60fps interaction with 10k+ nodes.
-   **Tech**: `react-force-graph` (uses ThreeJS/WebGL) or `vis.js` or standard HTML5 Canvas with existing D3 logic.
-   **Hybrid Approach**: Use Canvas for edges/nodes when zoomed out or moving; switch to SVG for labels/details when zoomed in.

### Web Worker Simulation
Offload the D3 force simulation (`d3.forceSimulation`) to a Web Worker.
-   **Why**: Complex physics calculations currently run on the main thread, blocking UI interactions (clicks, hover).
-   **Benefit**: Silky smooth UI even while the graph is "settling".

## 2. Frontend & User Experience (UX)
Enhancements to make the tool not just a "viewer" but an "explorer".

### **Command Palette Navigation (Ctrl+K)**
Implement a global command palette ("Spotlight" style).
-   **Features**:
    -   "Jump to Node..." (fuzzy search).
    -   "Show Module..."
    -   "Reset View".
    -   "Toggle Color Mode".
-   **Why**: Faster than clicking through sidebars.

### **Enhanced "Focus Mode"**
Improve the current focus mode to support "Degrees of Separation".
-   **Feature**: When focusing a node, offer a slider: `1 Hop` (direct neighbors), `2 Hops`, `Full Flow`.
-   **Context**: Show *why* nodes are connected (highlight specific edge paths).

### **Saved Views / Permalinks**
Allow users to share specific graph states.
-   **Feature**: URL parameters for `?selected=node_id&focus=true&view=hierarchical`.
-   **Feature**: "Save Snapshot" button to bookmark a specific layout/filter set.

### **Visual Grouping & Hulls**
Enhance the "Hierarchical" view.
-   **Convex Hulls**: Draw background shapes around clusters (modules) rather than just bounding boxes, to visually group related nodes more organically.
-   **Auto-Collapse**: Ability to double-click a module to "collapse" it into a single summary node to reduce noise.

## 3. Backend & Data Processing
Richness comes from the data. Expanding the extractors (`scripts/code_map/`).

### **Git "Hotspot" Analysis**
Leverage the Git metadata more aggressively.
-   **Feature**: "Heatmap Mode" where node size/color represents "Churn" (commit frequency) or "Age" (time since last edit).
-   **Use Case**: Identify "danger zones" in the codebase that change frequently.

### **Code Complexity Metrics**
Integrate static analysis tools (e.g., `radon` for Python, `complexity-report` for JS).
-   **Data**: Add `cyclomatic_complexity` or `maintainability_index` to node metadata.
-   **Visual**: Alert colors for nodes exceeding complexity thresholds.

### **Architecture Compliance Tests**
Turn the map into a verification tool.
-   **Feature**: Define "Banned Edges" in `overrides.yaml`.
    -   *Example*: `Feature A` should never import `Feature B`.
    -   *Example*: `Services` should never import `Handlers`.
-   **Visual**: Highlight "Illegal" edges in bright red.

### **Dead Code Detection**
Visualizing isolation.
-   **Feature**: Toggle to "Show Orphaned Nodes" (nodes with 0 degrees).
-   **Action**: Report generation for potential delete candidates.

## 4. Workflow Integrations
Making the tool a part of the daily developer loop.

### **"Open in IDE"**
Connect the web UI to the local editor.
-   **Feature**: Links like `vscode://file/{path}:{line}`.
-   **Action**: Clicking a node opens that specific file and line in the user's VS Code instance.

### **AI-Powered "Path Explanation"**
-   **Feature**: Select two nodes, ask AI: "How does A impact B?"
-   **Implementation**: Agent traces the path edges and summarizes the flow (e.g., "The `Login` page calls `useAuth`, which triggers `POST /login`, handled by `AuthService`...").

### **Pull Request Integration**
-   **Feature**: "Diff View". Upload a PR diff or branch comparison.
-   **Visual**: Highlight *only* the nodes touched in the PR and their direct impact radius (reverse dependencies).

## Summary of Initial Recommended Roadmap

1.  **Phase 1 (Quick Wins)**: Add "Command Palette", fix "Open in IDE" links, and implement "Permalinks" for sharing.
2.  **Phase 2 (Data Depth)**: Integrate "Git Hotspots" (Heatmap) and "Complexity Metrics".
3.  **Phase 3 (Core Tech)**: Migrate current SVG renderer to `react-force-graph` (Canvas) to future-proof performance.
