# PRD: Layer Planes and Labels

Date: 2026-01-19
Status: Draft
Owner: TBD

## 1) Problem Statement
Depth separation alone is not always enough. Users need a clear visual anchor for each layer to recognize the current LOD at a glance.

## 2) Goals
- Add minimal, non-intrusive planes that reinforce LOD levels.
- Provide visible LOD labels in 3D space.

## 3) Non-Goals
- Full grid or axis system.
- Replacing cluster boundaries.

## 4) Requirements
- Render translucent planes at each LOD depth.
- Planes scale to graph bounds and adjust when data changes.
- Label each plane (LOD0, LOD1, etc.) with a readable sprite.
- Planes should never occlude nodes (`depthWrite=false`).

## 5) UX Details
- Planes use muted colors aligned to LOD color palette.
- Labels appear at consistent front edge positions.

## 6) Success Metrics
- Users can identify layers without turning on tooltips.
- Planes do not reduce node readability.

## 7) Risks & Mitigations
- Risk: Planes clutter the scene.
  - Mitigation: toggle visibility and reduce opacity.

## 8) Open Questions
- Should planes appear only when layered LOD is enabled?
- Should users be able to toggle labels separately?

