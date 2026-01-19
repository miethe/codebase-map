# Visualization Layering Roadmap

Date: 2026-01-19
Status: Draft
Owner: TBD

## Purpose
Single parent roadmap to coordinate the layering UX improvements, with links to reports, PRDs, and implementation plans.

## Source Documents
- Report: `docs/project_plans/reports/layered-lod-ux-proposal-2026-01-19.md`
- Related findings: `docs/project_plans/reports/layering-ux-findings-2026-01-18.md`
- Existing PRD (overall): `docs/project_plans/PRDs/visualization-layering-ux-prd.md`
- Existing plan: `docs/project_plans/visualization-layering-plan.md`

## Workstreams (PRD + Implementation)
1) Layered LOD Stack
- PRD: `docs/project_plans/PRDs/layered-lod-stack-prd.md`
- Plan: `docs/project_plans/implementations/layered-lod-stack-implementation-plan.md`

2) Layer Planes + Labels
- PRD: `docs/project_plans/PRDs/layer-planes-labels-prd.md`
- Plan: `docs/project_plans/implementations/layer-planes-labels-implementation-plan.md`

3) 3D Cluster Cages
- PRD: `docs/project_plans/PRDs/cluster-cages-3d-prd.md`
- Plan: `docs/project_plans/implementations/cluster-cages-3d-implementation-plan.md`

4) Drill-Down Isolation
- PRD: `docs/project_plans/PRDs/drilldown-isolation-prd.md`
- Plan: `docs/project_plans/implementations/drilldown-isolation-implementation-plan.md`

5) Multi-Membership Indicators
- PRD: `docs/project_plans/PRDs/multi-membership-indicators-prd.md`
- Plan: `docs/project_plans/implementations/multi-membership-indicators-implementation-plan.md`

6) Cross-Layer Edge Routing
- PRD: `docs/project_plans/PRDs/cross-layer-edge-routing-prd.md`
- Plan: `docs/project_plans/implementations/cross-layer-edge-routing-implementation-plan.md`

## Phased Roadmap

### Phase 1: Core Depth + Boundaries (Start Here)
- Layered LOD Stack
- 3D Cluster Cages
- Layer Planes + Labels

### Phase 2: Focused Exploration
- Drill-Down Isolation

### Phase 3: Relationship Clarity
- Cross-Layer Edge Routing
- Multi-Membership Indicators

## Dependencies & Sequencing Notes
- Layered LOD Stack should land before planes/labels and edge routing.
- 3D Cluster Cages can be built in parallel but benefit from LOD depth.
- Drill-Down Isolation depends on a stable focus/cluster selection state.

## Implementation Start Checklist
- Confirm default LOD depth mapping (`cluster_path` length vs explicit `lodDepth`).
- Decide on default `layerSpacing` range and toggle behavior.
- Confirm which features are WebGL-only vs SVG fallback.

