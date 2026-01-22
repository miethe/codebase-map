---
name: Semantic Cluster Mapper
description: "Create human-readable, hierarchical cluster groupings by analyzing compact summaries and emitting stable override mappings with labels and drill-down paths."
version: 1.0.0
---

# Semantic Cluster Mapper

## Purpose
Create semantic, domain-aligned labels and drill-down paths for computed clusters using the compact summary file. Output overrides only; never modify base groupings.

## When to use
- Computed clusters have generic or duplicate names.
- You need product/domain-aligned hierarchy for drill-down.
- You want stable overrides that survive re-runs.

## Inputs (preferred order)
1) `codebase-graph.groupings.summary.json` (required)
2) `grouping.taxonomy.json` (if available)
3) `codebase-graph.unified.json` and `codebase-graph.details.json` (only if summary is missing or insufficient)

## Output
Write `codebase-graph.groupings.overrides.json` only.

Schema:
```
{
  "version": 1,
  "overrides": [
    {
      "fingerprint": "sha1:...",
      "id": "component:...",
      "label": "Marketplace (1536)",
      "path": ["Marketplace", "Scoring"],
      "confidence": 0.92,
      "notes": "Split from large marketplace cluster"
    }
  ]
}
```

## Workflow
1) **Review summary**
   - Use `top_tokens`, `top_paths`, `sample_nodes`, and `size`.
   - Identify domain terms (marketplace, catalog, scoring, dedupe, auth).

2) **Build a minimal taxonomy**
   - Map tokens/paths to domain/subdomain paths.
   - Prefer business terms over technical ones.

3) **Assign clusters**
   - Choose the best domain path for each cluster.
   - Set confidence 0-1 based on strength of signals.

4) **Label**
   - Use `path` as the label root.
   - Keep labels ASCII, short, and unique.
   - Include size in the label when helpful.

5) **Emit overrides**
   - Key by `fingerprint` (primary) and `id` (fallback).
   - Deterministic ordering.
   - Do not edit base or merged files.

## Constraints
- Only write overrides; never mutate base files.
- Use summary-only inputs unless explicitly asked to use full graph files.
- Keep labels readable and stable; avoid "utils", "common", or "misc" if possible.

## Merge expectations
- Overrides match by `fingerprint`, then `id` as fallback.
- Override `label` and `metadata.path` when provided.
- Preserve all other base metadata.
