# PRD: Drill-Down Isolation

Date: 2026-01-19
Status: Draft
Owner: TBD

## 1) Problem Statement
When drilling into a cluster, all other nodes remain visible, making it hard to understand local structure and membership.

## 2) Goals
- Provide clear isolation of the focused cluster without losing overall context.
- Let users choose how much context remains visible.

## 3) Non-Goals
- Removing cross-cluster edges entirely.
- Changing LOD expansion rules.

## 4) Requirements
- Add a context toggle: `All` / `Same layer` / `Cluster only`.
- When focused, dim or hide nodes outside the selected context.
- Keep aggregated edges to off-layer groups as optional faint links.

## 5) UX Details
- Default to `All` to avoid surprising behavior.
- Provide quick toggle in the sidebar, near LOD controls.

## 6) Success Metrics
- Users can isolate a cluster without visual overload.
- Context toggle is easy to discover and understand.

## 7) Risks & Mitigations
- Risk: Hiding nodes makes users lose orientation.
  - Mitigation: keep faint cluster boundaries and optional aggregated edges.

## 8) Open Questions
- Should isolation auto-activate on cluster expand?
- Should this affect export outputs?

