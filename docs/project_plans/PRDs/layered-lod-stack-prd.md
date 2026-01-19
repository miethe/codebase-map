# PRD: Layered LOD Stack

Date: 2026-01-19
Status: Draft
Owner: TBD

## 1) Problem Statement
LOD expansion currently happens in a single depth plane, so drilling down keeps unrelated nodes in view. Users cannot tell which level they are in, and spatial depth does not communicate hierarchy.

## 2) Goals
- Make LOD levels visually distinct via depth separation.
- Preserve layout stability while adding depth cues.
- Provide simple controls for enabling and tuning the effect.

## 3) Non-Goals
- Full re-layout or new renderer.
- Changing data pipeline outputs beyond optional node metadata.

## 4) Requirements
- Each node has a deterministic depth (e.g., derived from `cluster_path.length - 1` or explicit `lodDepth`).
- Apply a z-target per node via `forceZ()` with configurable `layerSpacing`.
- Toggle: `Layered LOD` (default off initially).
- Slider: `Layer spacing` (sensible range with a default).
- Works with existing LOD datasets and manual cluster expansion.

## 5) UX Details
- LOD0 appears on the topmost plane, deeper LODs below.
- Depth separation is strong enough to be visually obvious but not so large that nodes disperse excessively.

## 6) Success Metrics
- Users can correctly identify the current LOD without reading UI text.
- Drill-down views show clear separation between layers with no overlap confusion.
- No measurable performance regression at typical graph sizes.

## 7) Risks & Mitigations
- Risk: Over-separation causes camera framing issues.
  - Mitigation: clamp spacing and adjust camera presets if needed.
- Risk: Nodes lack reliable depth metadata.
  - Mitigation: fall back to `cluster_path` length or `lodLevel`.

## 8) Open Questions
- Should `layerSpacing` be stored in settings or session-only?
- Should layered LOD be enabled by default in WebGL mode?

