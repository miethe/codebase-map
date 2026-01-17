# WebGL Graph Engine: Layout, Physics, and Rendering

This document explains how the WebGL graph engine positions nodes, renders edges, and applies physics across all views. It is intended to be complete enough for someone to reproduce the engine from scratch, and to understand exactly how to tune spacing, clustering, and interactions.

Source of truth: `components/GraphCanvasWebGL.tsx` plus shared layout helpers in `utils/clusterLayout.ts`.

## Graph Model

### Nodes
- Each node has a unique `id`, a `type` (used for coloring and layout heuristics), and optional metadata (paths, labels, etc).
- Runtime physics fields are added: `x`, `y`, `z`, `vx`, `vy`, `vz`, `fx`, `fy`, `fz`.
- `degree` is computed per-view from *visible* edges (not total graph edges) and drives physics spacing.
- `totalDegree` is computed elsewhere and used for node radius (visual size).

### Edges
- Each edge has `from`, `to`, and `type`.
- At render time, edges are mapped to `source` and `target` (node ids) for the force simulation.

### Views
The engine supports three view modes:
- `force` (Map): 3D balloon layout.
- `hierarchical` (Systems): 2D layout with group overlays on the z=0 plane.
- `structured` (Stacked): fixed columns for types, no physics.

## Pipeline Overview

The engine follows a consistent pipeline in the WebGL renderer:
1) **Build visible data** (apply focus filters, compute degrees).
2) **Compute cluster centers** (hierarchical only).
3) **Initialize node positions** (view-specific seeding).
4) **Apply D3 forces** (charge, link distance, collide, module pull, balloon).
5) **Render nodes and links** (WebGL with labels, particles, overlays).
6) **Update overlays and caches** on ticks and idle.

Each step is described below in detail.

## 1) Visible Data and Degrees

The renderer creates a mutable copy of nodes/edges for the view:
- Nodes are cloned and optionally rehydrated from `nodePositions` (cache of last positions).
- Edges are cloned and left as plain objects with `from` and `to`.

**Visible-degree computation:**
- The engine counts all edges currently in view and records the degree per node.
- These degrees are used to scale forces and collision radii, so "busy" nodes push away more strongly than leaf nodes.

This degree weighting ensures:
- High-connection cores create more separation from unrelated nodes.
- Peripheral nodes remain closer and can be near unrelated clusters without exploding the whole graph.

## 2) Cluster Layout (Systems View)

For `hierarchical`, the engine groups nodes by `node.module` and computes cluster centers with a separate headless simulation in `utils/clusterLayout.ts`.

### Cluster Nodes
- One "cluster node" per module, with width/height derived from node count.
- Width grows with `sqrt(nodeCount)` so large clusters are harder to overlap.

### Cluster Forces
- **Charge**: repels larger clusters more strongly.
- **Link**: weighted by inter-module edge counts; stronger links pull clusters closer.
- **Collide**: prevents overlap using width/2 + padding.

The outputs are module centers used by the main graph simulation.

## 3) Initial Position Seeding

### Map (force) view
Nodes are placed onto a **3D balloon**:
- Each node gets a stable direction vector from its `id`.
- The radius is derived from `ARCHITECTURE_FLOW` (node type), so "earlier" architecture layers are closer to the center and "later" layers are farther out.
- The result is a seeded sphere with layered shells, providing an initial spatial metaphor before physics settles.

### Systems (hierarchical) view
Nodes are laid onto a local grid around each module center:
- Each module bucket is arranged in a square grid with fixed spacing.
- Nodes are seeded on the z=0 plane (2D layout).

### Structured view
Nodes are pinned into columns (see View-Specific Behavior below).

## 4) Physics Forces (Core Behavior)

The force simulation is driven by D3-force (via `react-force-graph-3d`).

### 4.1 Charge Force (Repulsion)
Charge is **degree-weighted**:
- Higher degree = stronger repulsion.
- `getChargeStrength(node, viewMode)` sets base strength and clamps max repulsion.

Tuning:
- Increase `scale` to push dense cores apart more.
- Increase `maxRepel` to limit blowout on very connected nodes.

### 4.2 Link Force (Attraction)
Link distance is **degree-weighted** and **view-aware**:
- Higher combined degree increases link distance (so dense subgraphs breathe).
- Inter-module links in Systems view have a higher base distance than intra-module links.

Tuning:
- Increase the base distance for more global spread.
- Increase `degreeBoost` multiplier for more separation around high-degree nodes.

### 4.3 Collision Force
Collision uses node radius and degree:
- Base radius from `NODE_SIZE_CONFIG`.
- Extra padding grows with `log1p(degree)`.

Tuning:
- Increase the `log1p` multiplier for more local spacing.
- Increase `iterations` for stronger overlap resolution.

### 4.4 Module Force (Systems view)
Nodes are pulled toward their module center:
- Strength is **degree-weighted**, so cluster cores stay tighter to the center.
- Implemented via `createModuleForce` and `getModulePullStrength`.

This keeps Systems clusters coherent while allowing leaf nodes to drift slightly.

### 4.5 Balloon Force (Map view)
The Map view uses a custom **balloon force**:
- Each node has a stable direction vector.
- A target radius is derived from `ARCHITECTURE_FLOW`.
- The force nudges nodes toward their shell radius in 3D.

This preserves the "ballooned" spatial metaphor while allowing the force simulation to respond to edges.

### 4.6 Z Force (2D Plane)
Systems view forces z back to 0 with a gentle `forceZ`:
- Ensures module overlays align to a 2D plane.
- Map view does not use z pinning to allow full 3D layout.

## 5) View-Specific Behavior

### Map (force)
- Forces: charge + link + collide + balloon.
- No x/y centering or architectural flow axes.
- Z axis is free.
- Expected result: a sphere-like distribution with architecture shells and softened edge grouping.

### Systems (hierarchical)
- Forces: charge + link + collide + module pull + z=0.
- Cluster centers from `computeClusterLayout`.
- Overlay boxes and labels are drawn around module bounds.

### Structured (stacked)
- Nodes are pinned in columns by type.
- Physics forces are disabled or set to zero.
- Used for deterministic, readable sorting rather than organic spacing.

## 6) Rendering and Interaction

### Node size and labels
- Node size uses logarithmic `totalDegree` (not visible degree).
- Labels are sprites; visibility is throttled to reduce cost.

### Edges
- Solid vs dashed links are represented via either lines or particle patterns to match SVG styling.
- Link curvature is used in Systems view for readability.

### Hover/Selection
- Selecting a node computes a traversal for upstream and downstream connections.
- Non-flow nodes are dimmed; link opacity is lowered.
- Focus mode restricts visible nodes to the flow set.

### Drag and camera controls
- Dragging fixes node position and reheats the simulation.
- Camera controls adjust zoom/pan/rotation; motion triggers label throttling.

## 7) Tuning Guide

### Primary spacing knobs
In `components/GraphCanvasWebGL.tsx`:
- `getChargeStrength`: base/scale/maxRepel (core separation).
- `getLinkDistance`: base distances and degree boost.
- `forceCollide` radius formula.
- `createBalloonForce` strength and `getBalloonRadius`.

In `utils/clusterLayout.ts`:
- Cluster box sizing.
- Cluster charge strength.
- Cluster link distance and strength.
- Cluster collide radius.

### Heuristics to keep graphs usable
- Increase repulsion or link distance gradually; large changes can blow out the layout.
- Prefer increasing collision padding for local spacing before globally increasing link distance.
- Use degree weighting to keep high-degree cores separated without pushing leaf nodes away.

## 8) Mental Model for Estimating Positions

Given a graph and node types, you can approximate:
- **Map view**: nodes fall on shells based on `ARCHITECTURE_FLOW`; dense areas expand outward; lightly connected leaves sit closer to unrelated nodes.
- **Systems view**: clusters form around module centers spaced by inter-module connections; large clusters push away more; cluster cores stay central, leaves can drift toward borders.
- **Structured view**: nodes stay in fixed columns, ordered vertically.

The simulation always balances:
- Repulsion (charge + collision),
- Attraction (link),
- View constraints (balloon shell, module centers, or fixed columns).

With the formulas above, the final layout is the equilibrium of those forces.

## 9) Recreating the Engine

To recreate the engine:
1) Parse graph into nodes and edges, assign `type`, `module`, and `totalDegree`.
2) Compute visible degrees per view.
3) For Systems view, compute cluster centers with a headless D3 simulation.
4) Seed node positions based on view (balloon shells, cluster grids, or columns).
5) Run force simulation with degree-weighted charge, link distance, collision.
6) Add view-specific forces (balloon, module pull, z=0).
7) Render nodes and edges, and update overlays on ticks.

All parameter values are in `components/GraphCanvasWebGL.tsx` and `utils/clusterLayout.ts`.
