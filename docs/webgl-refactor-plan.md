# WebGL/ThreeJS Refactor Implementation Plan

## Goals
- Replace SVG graph rendering with a GPU-backed renderer that scales to 10k+ nodes.
- Preserve current interaction patterns (hover, select, focus, filters) and sidebar UX.
- Keep the data model and JSON inputs stable during migration.

## Scope
- Core renderer (`components/GraphCanvas.tsx`) and supporting graph layout code.
- Optional performance work: force simulation in a Web Worker.
- Hybrid approach for labels/overlays if needed for readability.

## Proposed Approach
1. **Discovery & Spike (1–2 days)**
   - Evaluate `react-force-graph` (ThreeJS/WebGL) vs a custom ThreeJS canvas.
   - Build a minimal spike that loads `codebase-graph.unified.json` and renders nodes/edges.
   - Decision: choose the renderer based on FPS, API fit, and ease of integrating current interactions.

2. **Architecture & API Mapping (1 day)**
   - Define a renderer adapter interface: `renderGraph(data, viewState, handlers)`.
   - Map existing interactions (selection, hover, focus, filters, view modes) to the new API.
   - Identify what remains in React (overlays, sidebars, legends).

3. **Core Rendering Migration (3–5 days)**
   - Replace SVG node/edge rendering with WebGL/ThreeJS primitives.
   - Implement zoom/pan, node hover/selection, and focused subgraph rendering.
   - Add label strategy: canvas labels or HTML overlay (only at higher zoom levels).

4. **Performance Enhancements (2–3 days)**
   - Move force simulation to a Web Worker if using D3 forces.
   - If using `react-force-graph`, test built-in simulation vs worker offload.
   - Add a performance toggle: reduced detail while panning/zooming.

5. **Feature Parity & Cleanup (2–3 days)**
   - Port color modes, legends, module grouping, and view modes.
   - Validate data integration for groupings, git metadata, and dependencies.
   - Remove unused SVG-specific code paths and assets.

## Milestones & Deliverables
- M1: Spike branch with FPS baseline and renderer decision.
- M2: WebGL renderer integrated behind a feature flag (`GRAPH_RENDERER=webgl|svg`).
- M3: Full parity with current UI interactions; SVG path optional fallback.
- M4: Worker-based simulation (if needed) and performance report.

## Risks & Mitigations
- **Label legibility**: use HTML overlay for labels at higher zoom.
- **Interaction parity**: define a small adapter layer to keep UI state stable.
- **Regression risk**: keep SVG renderer as a fallback until parity confirmed.

## Acceptance Criteria
- Handles 10k nodes with stable pan/zoom (target 30–60 FPS on a modern laptop).
- All current interactions function: select, hover, focus, filters, legends, modes.
- Data files remain compatible; no changes required to JSON schema.

## Test Plan
- Manual: load large datasets, verify selection/hover correctness, focus mode, and color modes.
- Performance: record FPS while panning and while simulation settles.
- Regression: compare visual output (counts, filtering behavior) against SVG baseline.
