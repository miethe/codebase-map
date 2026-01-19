# PRD: Cross-Layer Edge Routing

Date: 2026-01-19
Status: Draft
Owner: TBD

## 1) Problem Statement
Edges that connect nodes across layers can clutter the view and make vertical relationships hard to follow.

## 2) Goals
- Make cross-layer connections easy to see without overwhelming the scene.
- Keep edge density manageable at overview and mid zoom.

## 3) Non-Goals
- Full edge bundling rewrite.
- Changing edge semantics or data sources.

## 4) Requirements
- Detect cross-layer edges using node depth or `cluster_path` length.
- Route cross-layer edges via a simple 2-segment path (portal point per layer) or increased curvature.
- Prefer aggregated edges when endpoints are collapsed.

## 5) UX Details
- Cross-layer edges use a different style (slightly brighter or thicker).
- Keep curvature minimal to avoid confusing arcs.

## 6) Success Metrics
- Cross-layer edges are readable without hiding nodes.
- Fewer edge overlaps across layers at overview.

## 7) Risks & Mitigations
- Risk: Routing increases computational cost.
  - Mitigation: apply only to cross-layer edges and cache computed paths.

## 8) Open Questions
- Should routing be enabled only when layered LOD is on?
- Is 2-segment routing better than curvature for this dataset?

