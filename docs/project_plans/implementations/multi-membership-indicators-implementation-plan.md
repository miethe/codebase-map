# Implementation Plan: Multi-Membership Indicators

Date: 2026-01-19
Status: Draft
Owner: TBD

## Overview
Introduce a lightweight indicator to show when a node belongs to multiple groups using existing grouping metadata.

## Work Items
1) Membership lookup
- Build a map: nodeId -> group labels for multi-membership sets.
- Cache the map and update when grouping mode changes.

2) Glyph rendering
- Extend `nodeThreeObject` in `GraphCanvasWebGL.tsx` to add ring sprites for multi-group nodes.
- Limit to a small number of rings; vary ring radius and opacity.

3) Tooltip enhancement
- Append group labels in node tooltip when multi-membership exists.

4) UI toggle
- Add `Show multi-membership` toggle in `Sidebar.tsx`.

5) QA checks
- Confirm glyphs do not overlap labels or cluster glyphs.
- Validate performance impact on large graphs.

## Files to Touch
- `components/GraphCanvasWebGL.tsx`
- `components/Sidebar.tsx`
- `App.tsx`
- `types.ts`
- `utils/moduleGrouping.ts` or a new helper in `utils/`

## Acceptance Checklist
- Multi-group nodes show indicators in WebGL mode.
- Tooltip lists group memberships.
- Toggle enables/disables indicators immediately.

