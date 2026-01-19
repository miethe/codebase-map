# Implementation Plan: Drill-Down Isolation

Date: 2026-01-19
Status: Draft
Owner: TBD

## Overview
Add a focus-context control that limits visible nodes and edges to a cluster or layer when drilling down.

## Work Items
1) Context state
- Add `drilldownContext` enum in `types.ts` and `App.tsx` context.
- Options: `all`, `same-layer`, `cluster-only`.

2) Visibility filtering
- Extend node and link visibility logic in `GraphCanvasWebGL.tsx` (and optionally `GraphCanvas.tsx`) to apply context rules.
- For `same-layer`, keep nodes with matching `lodDepth` or `cluster_path` level.
- For `cluster-only`, keep nodes inside focused cluster (via `cluster_path`).

3) Edge handling
- Keep aggregated edges from focused cluster to other clusters with reduced opacity (optional).
- Hide non-relevant edges if they connect to hidden nodes.

4) UI control
- Add a segmented control in `Sidebar.tsx`.

5) QA checks
- Validate context changes do not break selection or hover.
- Confirm expansion and collapse behave predictably.

## Files to Touch
- `types.ts`
- `App.tsx`
- `components/Sidebar.tsx`
- `components/GraphCanvasWebGL.tsx`
- `components/GraphCanvas.tsx` (optional parity)

## Acceptance Checklist
- Context toggle filters nodes as expected.
- Focused cluster remains prominent.
- Edges do not dominate when context is restricted.

