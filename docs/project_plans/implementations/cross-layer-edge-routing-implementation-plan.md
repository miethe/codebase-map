# Implementation Plan: Cross-Layer Edge Routing

Date: 2026-01-19
Status: Draft
Owner: TBD

## Overview
Adjust rendering of edges that cross LOD layers to reduce visual clutter and improve readability.

## Work Items
1) Cross-layer detection
- Compute node depth (reuse layered LOD logic).
- Mark edges as cross-layer when source/target depth differs.

2) Routing strategy
- Option A: add 2-segment routing via a per-layer portal point.
- Option B: apply mild curvature only for cross-layer edges.
- Choose one and document the tradeoffs.

3) Rendering changes
- In `GraphCanvasWebGL.tsx`, adjust `linkCurvature` or provide custom link positions if supported.
- Slightly increase opacity or width for cross-layer edges.

4) Aggregation fallback
- When nodes are collapsed, prefer aggregated edges for cross-layer connections.

5) QA checks
- Validate performance on large graphs.
- Verify edge readability at multiple zoom levels.

## Files to Touch
- `components/GraphCanvasWebGL.tsx`
- `utils/useGraphLOD.ts` (if storing depth)
- `types.ts` (optional edge flag)

## Acceptance Checklist
- Cross-layer edges are visually distinct and easier to follow.
- Edge density remains manageable at overview.
- Routing changes do not break hover or tooltip behavior.

