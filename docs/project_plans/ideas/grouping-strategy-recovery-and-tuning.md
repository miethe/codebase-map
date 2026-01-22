# Grouping Strategy Recovery + Tuning Ideas

## Restore Legacy Group Sets (Structure/Layer/Ownership/Domain)
**Purpose:** Bring back the non-computed grouping strategies that disappeared after switching to the semantic groupings pipeline, so the UI has multiple grouping modes again.  
**Expected outcome:** The Grouping Strategy dropdown includes `structure`, `layer`, `ownership`, `semantic_domain`, etc., alongside `computed`. Users can switch between them like before.  
**Implementation guidance:**  
- Re-run (or re-integrate) `code_map/build_groupings.py` and merge its `group_sets` + `groups` into `codebase-graph.groupings.json`.  
- Keep `computed` groups from the new pipeline, but append legacy groups under their own `group_set` ids.  
- Ensure `App.tsx` continues to load the merged `codebase-graph.groupings.json` only.  
**Notes:** If group labels collide, prefer namespacing or keep group ids distinct by prefix.

## Add `grouping.taxonomy.json` to Split Computed Buckets
**Purpose:** Reduce overly large “computed” clusters by splitting nodes into domain buckets before connected-component clustering.  
**Expected outcome:** Smaller, more coherent computed clusters with clearer labels and fewer “mega-clusters.”  
**Implementation guidance:**  
- Add `grouping.taxonomy.json` at repo root with `rules` mapping tokens/paths to domain paths.  
- `scripts/generate_groupings.js` already supports this; it uses taxonomy buckets before building components.  
- Start with coarse domains (e.g., `Frontend`, `Backend`, `Data`, `Infra`) then refine.  
**Notes:** If a node matches no taxonomy rule, it falls into `unassigned`, which can still grow large.

## Add Generator-Level Value Filters (Computed Clusters)
**Purpose:** Limit computed clusters to “valuable” nodes (e.g., entrypoints, high-importance, non-test, non-vendor) to reduce noise.  
**Expected outcome:** Computed clusters focus on higher-signal nodes; large low-signal groups shrink or disappear.  
**Implementation guidance:**  
- Add optional filters in `scripts/generate_groupings.js` (e.g., min `importance`, `hotness`, `kind`, exclude `tests`/`vendor`).  
- Provide CLI flags (e.g., `--min-importance`, `--exclude-tests`) to keep it configurable.  
- Apply filtering before adjacency/component build to avoid ghost members.  
**Notes:** This changes cluster membership, so label stability may shift between runs.

## Add UI “Value Threshold” Filter (Viewer Only)
**Purpose:** Let viewers suppress low-value nodes without regenerating groupings.  
**Expected outcome:** The same computed clusters render with fewer nodes, improving readability; raw groupings stay intact.  
**Implementation guidance:**  
- Add a sidebar slider (e.g., min `importance` or `hotness`) and filter nodes at render time.  
- Consider separate thresholds for cluster nodes vs. leaf nodes.  
- Combine with existing filters (tests/vendor/hide intra-file edges).  
**Notes:** This does not shrink computed cluster membership in the data, only what’s displayed.
