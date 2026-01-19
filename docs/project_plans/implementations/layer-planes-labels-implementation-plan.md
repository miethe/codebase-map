# Implementation Plan: Layer Planes and Labels

Date: 2026-01-19
Status: Draft
Owner: TBD

## Overview
Add translucent planes and label sprites for each LOD depth using the existing overlay group in WebGL.

## Work Items
1) Plane geometry and materials
- Create reusable plane geometry sized to graph bounds.
- Use `THREE.MeshBasicMaterial` with low opacity and `depthWrite=false`.

2) Overlay group integration
- Add a new overlay group (e.g., `lod-plane-overlays`) in `GraphCanvasWebGL.tsx`.
- Update planes on graph bounds changes.

3) Label sprites
- Reuse text sprite helper for LOD labels.
- Position labels near the plane front edge to reduce overlap.

4) UI toggle
- Add `Show LOD planes` toggle in `Sidebar.tsx`.
- Store state in `App.tsx` context.

5) QA checks
- Verify planes update on zoom and data changes.
- Ensure planes do not occlude nodes or edges.

## Files to Touch
- `components/GraphCanvasWebGL.tsx`
- `components/Sidebar.tsx`
- `App.tsx`
- `types.ts`

## Acceptance Checklist
- Planes render consistently across LOD levels.
- Labels are readable at standard zoom levels.
- Toggling planes updates immediately.

