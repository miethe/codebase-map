# WebGL/ThreeJS Refactor Implementation Plan

## Goals
- Replace SVG graph rendering with a GPU-backed renderer that scales to 10k+ nodes.
- Preserve current interaction patterns (hover, select, focus, filters) and sidebar UX.
- Keep the data model and JSON inputs stable during migration.
- Maintain an explicit SVG fallback behind a renderer flag.

## Scope
- Core renderers (`components/GraphCanvas.tsx`, `components/GraphCanvasWebGL.tsx`) and supporting graph layout code.
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

5. **Feature Parity & Dual-Renderer Cleanup (2–4 days)**
   - Parse WebGL gaps vs SVG baseline:
     - Hierarchical mode still gated to SVG; module group boxes + labels missing in WebGL.
     - Structured column headers missing in WebGL.
     - Edge dash styles (dashed relationships) not represented.
     - Node/edge tooltip parity (type/id/degree + link type) missing.
     - Selection flow label dimming (hide non-flow labels) missing.
     - ESC-to-clear selection not mirrored.
     - Collision force + architecture-flow alignment differences in Map view.
   - Port remaining behaviors into WebGL:
     - Hierarchical overlays (module boxes + labels) as ThreeJS overlay objects.
     - Structured headers as sprites aligned with column layout.
     - Dash styling via link particles or custom materials.
     - Tooltips + selection-driven label visibility.
     - Parity forces for Map/Systems/Stacked views (charge, link distance, collide).
   - Cleanup + future-proofing:
     - Keep SVG renderer intact behind `VITE_GRAPH_RENDERER=svg`.
     - Fully separate SVG-specific logic into its own module folder (no shared state leakage).
     - Consolidate shared helpers (label cleaning, flow traversal) to avoid drift.

## Milestones & Deliverables
- M1: Spike branch with FPS baseline and renderer decision.
- M2: WebGL renderer integrated behind a feature flag (`VITE_GRAPH_RENDERER=webgl|svg`).
- M3: Full parity with current UI interactions; SVG path optional fallback flag.
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
