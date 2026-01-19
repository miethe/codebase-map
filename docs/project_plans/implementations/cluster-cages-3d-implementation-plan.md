# Implementation Plan: 3D Cluster Cages

Date: 2026-01-19
Status: Draft
Owner: TBD

## Overview
Replace the 2D cluster overlay boxes with 3D line cages that wrap cluster members, using the existing overlay system.

## Work Items
1) Bounding box computation
- Extend cluster overlay update to compute min/max x,y,z (use node positions).
- Fall back to cluster node position if member bounds are missing.

2) Cage geometry
- Build a `THREE.LineSegments` box using a shared geometry pattern.
- Cache per-cluster line objects; update positions on tick.

3) Label upgrades
- Increase font size and contrast in `createClusterLabelSprite`.
- Position label at front-top corner of the cage.

4) Rendering + performance
- Skip cages for clusters with no members in view.
- Keep render order above links but below labels.

5) QA checks
- Verify cages track movement and do not flicker.
- Confirm performance on large graphs.

## Files to Touch
- `components/GraphCanvasWebGL.tsx`

## Acceptance Checklist
- 3D cages visible and aligned with cluster members.
- Labels readable and stable.
- No obvious frame drops on typical graphs.

