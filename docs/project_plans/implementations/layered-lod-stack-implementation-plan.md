# Implementation Plan: Layered LOD Stack

Date: 2026-01-19
Status: Draft
Owner: TBD

## Overview
Introduce per-LOD depth layers in the WebGL renderer, with a toggle and spacing control. Keep data and SVG fallback unchanged.

## Work Items
1) Data depth strategy
- Decide depth source: `cluster_path.length - 1`, `lodLevel`, or new `lodDepth`.
- Document depth mapping and defaults.

2) WebGL depth force
- Update `components/GraphCanvasWebGL.tsx` to apply `forceZ()` with `z(node)` target per depth.
- Ensure depth applies in `viewMode === 'hierarchical'` and `viewMode === 'force'` (if desired).

3) UI controls
- Add `Layered LOD` toggle and `Layer spacing` slider in `components/Sidebar.tsx`.
- Store state in `App.tsx` and `types.ts` context.

4) Tuning + defaults
- Set default spacing and limits (e.g., 80-400 units).
- Adjust camera presets if separation exceeds current framing.

5) QA checks
- Validate layout stability on expand/collapse.
- Confirm no Z jitter when zooming or switching LOD.

## Files to Touch
- `types.ts`
- `App.tsx`
- `components/Sidebar.tsx`
- `components/GraphCanvasWebGL.tsx`
- `utils/useGraphLOD.ts` (if adding `lodDepth`)

## Acceptance Checklist
- Toggle turns layering on/off without reloading.
- Layer spacing slider affects depth separation in real time.
- Cluster expansion remains stable with layered depth.

