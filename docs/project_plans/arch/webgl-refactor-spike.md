# WebGL Spike Notes

## Goal
Validate a WebGL/ThreeJS-based renderer and confirm it can load the existing graph data with basic interactivity.

## Implementation Summary
- New WebGL spike component: `components/GraphCanvasWebGL.tsx` using `react-force-graph-3d`.
- Minimal interaction parity: hover, select, focus-mode filtering (upstream/downstream traversal).
- Toggle via env var: set `VITE_GRAPH_RENDERER=webgl` to enable the WebGL view.

## How to Run
1. Install dependencies: `npm install` (updates `package-lock.json`).
2. Start the app with the WebGL renderer:
   - `VITE_GRAPH_RENDERER=webgl npm run dev`

## Current Gaps
- Hierarchical/structured layouts are not mapped yet (force layout only).
- Label strategy is tooltip-only; no on-canvas labels at high zoom.
- No Web Worker for force simulation.
- No performance baseline captured yet (FPS/settling time).

## Decision
Proceed with `react-force-graph-3d` for the next phase unless the performance spike shows unexpected regressions.
