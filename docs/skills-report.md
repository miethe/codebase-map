# Skills Relevance Report

Date: 2026-01-17

## Overview
This project centers on large-scale, interactive graph visualization (nodes/edges, clustering, LOD, WebGL/SVG rendering) with a React/TypeScript frontend and a Python-based data pipeline. The most relevant skills are those that directly support network/graph visualization, layout algorithms, and 3D/WebGL rendering.

## Most Relevant (Primary)
- **Data Visualization** (`.codex/skills/data-visualization/SKILL.md`)
  - Directly applicable to graph readability, LOD strategy, layout choices, aggregation, and perceptual best practices.
- **d3-visualization** (`.codex/skills/d3-visualization/SKILL.md`)
  - Relevant for custom force-directed layouts, edge bundling, hierarchy visualizations, and interaction patterns.
- **d3-viz** (`.codex/skills/d3js/SKILL.md`)
  - Overlaps with d3-visualization but still useful for low-level SVG/Canvas control and bespoke graph interactions.

## Relevant (Rendering / WebGL)
- **3d-graphics** (`.codex/skills/3d-graphics/SKILL.md`)
  - Applicable if/when the app uses or expands Three.js/WebGL rendering for large graphs or layered 2.5D views.
- **3d-visualizer** (`.codex/skills/3d-visualizer/SKILL.md`)
  - Useful for advanced 3D interaction, camera presets, and performance tuning in a 3D graph viewer.

## Conditionally Relevant
- **skill-creator** (`.codex/skills/.system/skill-creator/SKILL.md`)
  - Only needed if creating a new domain-specific skill (e.g., “graph-visualization” or “codebase-graph-pipeline”).
- **skill-installer** (`.codex/skills/.system/skill-installer/SKILL.md`)
  - Only needed if pulling in new skills from external repos.

## Notes on Overlap
- **d3-visualization** and **d3-viz** overlap heavily; use one consistently to avoid redundant guidance.
- **3d-graphics** vs **3d-visualizer**: both apply to Three.js, but 3d-visualizer skews toward interactive visualization patterns; 3d-graphics is broader.

## Suggested Usage by Task
- **Graph readability / LOD / aggregation / hierarchy** → Data Visualization
- **Custom force layouts / edge bundling / interaction mechanics** → d3-visualization (or d3-viz)
- **WebGL/Three.js rendering / 2.5D layered views** → 3d-visualizer (or 3d-graphics)
- **New skill definition or external skill installation** → skill-creator / skill-installer
