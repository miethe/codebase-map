# PRD: 3D Cluster Cages

Date: 2026-01-19
Status: Draft
Owner: TBD

## 1) Problem Statement
Current cluster boxes are 2D line loops at z=0, so they appear dim and detached in a 3D scene. Cluster boundaries are not obvious.

## 2) Goals
- Replace flat boxes with 3D bounding cages that surround cluster members.
- Improve label readability for clusters.

## 3) Non-Goals
- Full convex hull geometry.
- Redesigning group definitions or cluster layout.

## 4) Requirements
- Compute min/max x,y,z per cluster and render a 3D box outline.
- Use higher-contrast label sprites positioned at the cage front-top corner.
- Ensure cages update as nodes move.

## 5) UX Details
- Focused clusters have brighter cages and labels.
- Non-focused clusters remain visible but subdued.

## 6) Success Metrics
- Users can identify cluster regions without hovering or zooming.
- Cluster labels remain legible at common zoom levels.

## 7) Risks & Mitigations
- Risk: Extra geometry reduces performance.
  - Mitigation: limit cages to clusters in view and reuse geometry buffers.

## 8) Open Questions
- Should cages be visible in all view modes or only hierarchical?
- Should cages be optional via a toggle?

