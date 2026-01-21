# Cluster Naming & Semantic Grouping Report

Date: 2026-01-21

## Context
Current computed clusters in the app are generated from connected components and labeled with basic package/directory hints. This results in generic labels, duplicates, and large “catch‑all” clusters (e.g., `dir:skillmeat`). The UX goal is to surface meaningful, human‑readable domains (e.g., “Marketplace”) and enable drill‑down into sub‑clusters (“Scoring”, “Catalog”, “Importing”, “Dedup”), ideally aligned with LOD.

## Findings
- UI‑only heuristics (path parsing) can’t reliably assign semantic names. They produce generic labels, duplicates, and weak drill‑downs.
- The data we need to name clusters well (paths, symbols, API tags, models, docstrings) is available only during data generation or a precompute step.
- The app already supports hierarchical drill‑down via `modulePath` and grouping sets; the missing piece is **semantic grouping data** and **labels**.

## Recommended Approach (Hybrid, Precomputed)
1) **Semantic taxonomy first**
   - Create a light taxonomy config mapping tokens/paths/tags to domains and subdomains.
   - Example mapping:
     - Marketplace → scoring/importing/catalog/dedup
     - Core → validation/matching/templates
     - API → routes/auth/billing

2) **Community detection second (within taxonomy buckets)**
   - Run clustering (Louvain/Leiden or filtered connected components) within each domain to split large buckets.
   - This yields stable, coherent subclusters without losing semantic meaning.

3) **Labeling strategy**
   - Prefer labels from taxonomy path (explicit “Marketplace > Scoring”).
   - Fall back to TF‑IDF on path/symbol tokens if taxonomy is uncertain.
   - Ensure uniqueness; add suffixes only as a last resort.

4) **Hierarchical output for drill‑down**
   - Emit a `metadata.path` array per group: `['Marketplace','Scoring']`.
   - This feeds directly into `modulePath` drill‑downs.

## Hybrid Pipeline: Programmatic Base + Optional Agent Overlay
The goal is to keep a **deterministic, script‑generated baseline** that always yields usable groupings, while allowing an **optional agent pass** to refine labels and hierarchies without re‑processing the entire dataset each run.

### Core idea
- **Base script** produces `codebase-graph.groupings.base.json` and a compact, token‑efficient summary for agents.
- **Agent** reads only the summary (not the full graph), produces an overlay file with refined labels/paths.
- **Merge step** combines base + overlay into the final `codebase-graph.groupings.json` used by the app.

### Token‑efficient summary file (agent input)
Create `codebase-graph.groupings.summary.json` with only what an agent needs to label clusters:
- `group_id`, `size`, `fingerprint` (hash of sorted node IDs), `top_tokens`, `top_paths`, `sample_nodes`.
- Keep lists short (e.g., 5–10 items) to minimize tokens.

Example (sketch):
```
{
  "version": 1,
  "groups": [
    {
      "id": "component:5443d127bd",
      "fingerprint": "sha1:4b7c…",
      "size": 1536,
      "top_tokens": ["marketplace","catalog","scoring","import","dedupe"],
      "top_paths": ["web/app/marketplace", "core/marketplace", "api/routers/marketplace"],
      "sample_nodes": ["component:…", "service:…", "api_endpoint:…"]
    }
  ]
}
```

### Agent overlay file (optional enhancement)
Agent writes `codebase-graph.groupings.overrides.json`:
```
{
  "version": 1,
  "overrides": [
    {
      "fingerprint": "sha1:4b7c…",
      "label": "Marketplace (1536)",
      "path": ["Marketplace"],
      "confidence": 0.92,
      "notes": "split into Scoring/Catalog/Import/Dedupe subclusters"
    }
  ]
}
```

### Merge rules (deterministic)
- Apply overrides **by fingerprint first**, then by `id` as fallback.
- If override supplies `path`, use it; otherwise keep base `metadata.path`.
- If override supplies `label`, replace base label.
- Preserve all base metadata fields not explicitly overridden.

### Persistence across re‑runs
- **Fingerprint** anchors overrides even if group IDs shift (e.g., after refactors).
- If fingerprint not found, fall back to `id` and then warn in merge output.
- Overrides file is kept separate from generated files, so it survives re‑runs.

## Integration with LOD
- Use the same hierarchy to generate LODs:
  - LOD1: top‑level domains (Marketplace, Core, API, UI)
  - LOD2: subdomains (Scoring, Catalog, Importing, Dedupe)
  - LOD3+: directory/file clusters
- This aligns semantic grouping with LOD and makes zoom‑based transitions intuitive.

## Implementation Options
### Option A — Precompute semantic groupings (recommended)
- Add a script (e.g., `scripts/generate_groupings.js`) to:
  - Read `codebase-graph.unified.json` (and optionally `codebase-graph.details.json`).
  - Apply taxonomy + clustering to build groups.
  - Write `codebase-graph.groupings.base.json` with `metadata.path`.
  - Emit `codebase-graph.groupings.summary.json` for optional agent use.
- Add `scripts/merge_groupings.js` to combine base + overrides into `codebase-graph.groupings.json`.
- Minimal UI change: update grouping mapping to prefer `metadata.path`.

### Option B — Precompute + LOD synthesis
- In addition to Option A, generate LOD datasets from the same hierarchy.
- Ensures LODs and semantic clusters are aligned.

### Option C — UI‑only heuristics (not sufficient)
- Continue improving path heuristics for labels.
- Still yields generic names and duplicates because semantic context is missing.

## Recommendation
Proceed with **Option A** now, and keep Option B scoped for follow‑up if LOD alignment is a near‑term goal. UI heuristics alone won’t meet the desired cluster semantics.

## Proposed Next Steps
1) Draft a taxonomy config for Skillmeat:
   - Marketplace → scoring, importing, catalog, dedupe
   - Core → validators, matching, templates
   - API → routes, auth, billing
   - Web/UI → pages, components, hooks
2) Implement `scripts/generate_groupings.js` to emit base groupings + summary.
3) Implement `scripts/merge_groupings.js` to combine base + overrides.
4) Update grouping mapper to prefer `metadata.path` when present.
5) Validate in UI and iterate taxonomy.
6) (Optional) Run the agent to produce overrides and re‑merge.

## Optional Agent Enhancement (Design Guidance)
- **Agent trigger**: run only when `codebase-graph.groupings.summary.json` changes or a human requests it.
- **Agent scope**: only read the summary file, not full graph data.
- **Agent output**: write `codebase-graph.groupings.overrides.json` and do not modify base files.
- **Merge**: deterministic and idempotent; safe to re‑run.

## Success Criteria
- Top‑level clusters map to product domains with clear names.
- Drill‑down reveals sub‑clusters aligned with system responsibilities.
- Minimal duplicate labels; no large, generic “catch‑all” buckets.
