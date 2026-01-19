# PRD: Multi-Membership Indicators

Date: 2026-01-19
Status: Draft
Owner: TBD

## 1) Problem Statement
Nodes can belong to multiple groups, but the current view shows only one grouping at a time. Users cannot see multi-group membership visually.

## 2) Goals
- Make multi-group membership visible without cluttering the graph.
- Provide quick identification of multi-membership via glyphs or tethers.

## 3) Non-Goals
- Full multi-layer color encoding for all groups simultaneously.
- New grouping datasets beyond the existing `groupings.json`.

## 4) Requirements
- Detect multi-membership via `group_sets[].multi_membership` and group membership lists.
- Render a multi-ring glyph or small indicator around nodes with multiple groups.
- Tooltip lists all groups for the node.

## 5) UX Details
- Indicators should be subtle at overview, more visible on hover.
- Avoid color clashes with existing color modes.

## 6) Success Metrics
- Users can identify multi-group nodes without using the sidebar.
- Multi-membership does not significantly reduce readability.

## 7) Risks & Mitigations
- Risk: Too many rings make nodes busy.
  - Mitigation: limit to top 2-3 groups and show full list on hover.

## 8) Open Questions
- Which grouping set should be used by default?
- Should this be a toggle or automatic when a multi-membership set is active?

