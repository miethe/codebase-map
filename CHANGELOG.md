# Changelog

## Unreleased
- WebGL renderer now supports all view modes via the `VITE_GRAPH_RENDERER` flag, preserving SVG as an explicit fallback.
- Added WebGL parity for hierarchical module overlays, structured layout headers, selection-flow label dimming, and ESC-to-clear selection.
- Added WebGL link styling parity with dashed edge representation via directional particles, plus tooltip parity for nodes and links.
- Aligned WebGL forces with SVG behavior (charge, link distance, collide, and architecture flow alignment).
- Updated the WebGL refactor plan to enumerate remaining gaps and define the dual-renderer cleanup strategy.
- Fixed WebGL initialization ordering bug causing `flowNodeIds` to be accessed before declaration.
- Expanded node/cluster spacing in Map and Systems views using degree-weighted charge, link distance, and collide forces.
- Increased cluster separation sizing and spacing rules to keep dense modules apart without pushing the full graph too far apart.
- Restored 3D Map balloon layout in WebGL while keeping Systems view 2D with overlays.
