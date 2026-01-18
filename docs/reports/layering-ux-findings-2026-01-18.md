# Layering & Zoom UX Findings Report

Date: 2026-01-18

## Scope
Assess current layering/LOD and zoom UX in the WebGL graph renderer, focusing on why exploration feels messy and how to fix it. No code changes are proposed here.

## Key Findings
- Global LOD causes all nodes to appear at once when zooming in, instead of only the focused cluster.
- No explicit focus target (camera target / hovered cluster / selected cluster) exists to control which cluster expands.
- Shallow hysteresis causes frequent LOD flips on small zoom changes, creating instability.
- Layering is not hierarchical, so zoom does not convey depth (system -> cluster -> module -> file).
- Children are not anchored to stable parent bounds, so spatial context is lost during expansion.

## UX Impact
- Users cannot predict what will appear when zooming in.
- Exploration feels like a global reveal rather than entering a specific cluster.
- Visual clutter spikes instantly, making inspection difficult.
- Hierarchy is not communicated through spatial structure or motion.

## Recommendations
1) Focal LOD (context + detail)
- Expand only the cluster under the camera target or cursor; keep other clusters coarse.

2) Explicit focus target
- Establish a focused cluster state (click or nearest to camera target). Only this cluster descends levels.

3) Sticky expansion
- Keep expanded clusters open until explicitly collapsed; zoom alone should not reset user intent.

4) Hierarchical depth rules
- Tie visibility to semantic depth (system -> cluster -> module -> file). Zoom sets max depth, not global expansion.

5) Spatial anchoring
- When expanding, keep children inside the parent hull to preserve the mental map.

6) Visual boundaries
- Always show cluster hulls/planes and labels to communicate entry into a region.

7) Staged transitions
- Stage reveal: isolate focus -> expand hull -> animate children. This makes zoom feel intentional.

8) Zoom-to-cluster snapping
- If the camera target is inside a cluster hull, snap to that cluster and scale by its bounds.

## Target Experience
- Far zoom: top-level clusters only, with hulls and labels.
- Mid zoom: focused cluster expands; neighbors remain coarse.
- Near zoom: sub-clusters/modules appear within the focused hull.
- Deep zoom: file/function nodes appear, still inside parent boundaries.
