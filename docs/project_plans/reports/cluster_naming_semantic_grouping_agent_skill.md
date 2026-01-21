---
name: semantic-cluster-mapper
description: Create human-readable, hierarchical cluster groupings by analyzing compact summaries (Marketplace → Scoring/Catalog/Importing/Dedupe) and emitting override mappings with stable labels and drill-down paths.
---

# Semantic Cluster Mapper (Agent Persona)

## Purpose
Produce clear, domain-aligned cluster names and multi-level drill‑downs for the graph explorer by **precomputing semantic groupings** instead of relying on UI heuristics.

## When to use
- Computed clusters have generic or duplicate names.
- You need high‑level product domains (e.g., Marketplace) with sub‑clusters (Scoring, Catalog, Importing, Dedupe).
- You want LOD-aligned clustering that matches how the system is organized.

## Inputs
Primary (token‑efficient):
- `codebase-graph.groupings.summary.json` (required)
  - Contains group id, fingerprint, size, top tokens, top paths, sample nodes.
Optional (only if summary is missing or insufficient):
- `codebase-graph.unified.json`
- `codebase-graph.details.json`
- Any taxonomy notes or domain lists from stakeholders

## Output
- Write `codebase-graph.groupings.overrides.json` (do not overwrite base groupings).
- Each override entry contains:
  - `fingerprint` (primary key), `id` (fallback)
  - `label` (human‑readable)
  - `path` (hierarchical drill‑down array, e.g., `["Marketplace","Scoring"]`)
  - `confidence` (0–1)
  - Optional `notes`

### Summary schema (expected)
```
{
  "version": 1,
  "groups": [
    {
      "id": "component:…",
      "fingerprint": "sha1:…",
      "size": 1536,
      "top_tokens": ["marketplace","catalog","scoring"],
      "top_paths": ["web/app/marketplace", "core/marketplace"],
      "sample_nodes": ["component:…", "service:…", "api_endpoint:…"]
    }
  ]
}
```

### Overrides schema (output)
```
{
  "version": 1,
  "overrides": [
    {
      "fingerprint": "sha1:…",
      "id": "component:…",
      "label": "Marketplace (1536)",
      "path": ["Marketplace"],
      "confidence": 0.92,
      "notes": "Scoring/Catalog/Import/Dedupe split"
    }
  ]
}
```

## Workflow (High Level)
1) **Discover domain signals**
   - Use summary tokens/paths/samples to infer domain terms.
   - Build a ranked list of domain candidates (e.g., marketplace, catalog, scoring, import, dedupe, deploy).

2) **Build taxonomy**
   - Create a simple mapping of tokens/paths → domain/subdomain.
   - Prefer explicit business terms; avoid generic labels ("utils", "common") unless unavoidable.

3) **Assign groups to domains**
   - Assign each group (not each node) to a taxonomy path with a confidence score.
   - Prefer stable, high‑level domains before fine‑grained splits.

4) **Cluster within domains**
   - Inside each domain, run community detection (Louvain/Leiden) or filtered connected components to split large groups.
   - Keep clusters meaningful and sized (avoid one giant bucket).

5) **Label clusters**
   - Primary label: taxonomy path ("Marketplace / Scoring").
   - Secondary label: dominant token set if taxonomy uncertain.
   - Ensure label uniqueness; use suffixes only as last resort.

6) **Emit overrides**
   - Output only overrides, keyed by fingerprint.
   - Keep deterministic ordering for stability across runs.
   - Do not modify base groupings.

7) **Validate**
   - Spot‑check top 10 clusters:
     - Labels are unique, descriptive, and stable.
     - Drill‑down paths reveal coherent sub‑areas.
     - No huge “catch‑all” without sub‑clusters.

## Heuristics (Practical)
- **API routes**: group by tag, path segment, or OpenAPI tag list.
- **Models/migrations**: map to domain using table/model names.
- **Frontend**: use route paths (`/app/marketplace/...`) and component folder names.
- **Backend services**: use module names and service class names.

## Constraints
- Do not modify raw node/edge data; only write overrides.
- Keep labels ASCII, short, and business‑meaningful.
- Prefer precompute output over UI heuristics.
 - Only read full graph files if summary is missing or clearly insufficient.

## Merge Expectations (for downstream scripts)
- Overrides are applied by `fingerprint`, then `id` as fallback.
- Overridden `label` and `path` replace base group label/path.
- All other base metadata is preserved.

## Success Criteria
- Top‑level clusters map to clear product domains.
- Sub‑clusters align with real responsibilities.
- Minimal duplicates and no generic “dir:repo” labels.
