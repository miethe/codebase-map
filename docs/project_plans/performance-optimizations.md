# Performance Optimizations

This document summarizes the performance work completed to date and lists future options we can implement if needed.

## Implemented

- WebGL node position persistence: cache node positions across view and focus changes to avoid starting at (0,0,0) on every update.
- WebGL label visibility throttling: throttle visibility updates and refresh calls to reduce rAF pressure on large graphs.
- WebGL idle pause/resume: pause the animation loop when the force engine stops and resume on interaction or view changes.
- WebGL cleanup on unmount: dispose renderer/controls and clear caches to avoid leaked contexts during HMR.
- Performance mode toggle: optional aggressive simplification (no label sprites, reduced link styling, no arrows/curvature).
- Motion optimization toggle retained: existing "Reduce detail while moving" option still available.
- Force reheat gating: avoid calling reheat before the force layout is initialized.
- Drag behavior: drag keeps nodes pinned where dropped and reheats the simulation so connected nodes are pulled along.

## Future Options

- Label-on-hover mode: render labels only for hovered/selected nodes, with a small halo indicator for others.
- Adaptive label density: dynamically cap label count based on zoom or node count.
- Progressive rendering: delay link rendering until nodes settle, or render links in batches.
- Force engine cap: automatically reduce force iterations for very large graphs or when CPU load is high.
- Graph data chunking: dynamically load or show subsets of nodes at lower zoom levels.
- Edge simplification: merge parallel edges and reduce arrowheads or dashes at scale.
- Node LOD (level of detail): switch to simpler glyphs at distance/zoom, full sprites when zoomed in.
- Interaction-based wake: only resume animation on pointer down/drag/zoom events, not on every minor camera change.
