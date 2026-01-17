2026-01-16

### TL;DR

Your enemy is edge density, not node count. The win is **multi-scale aggregation + progressive disclosure**: collapse aggressively by default, reveal detail on-demand, and make “meaning” visible via **typed edges, thresholds, and funnels** instead of raw spaghetti.

---

## Context

You’ve got a 3D code graph viewer (physics clustering, focus modes, sidebar details, downstream neighbor exploration). You want **readable “layerable” captures** and general tactics to keep the viz from turning into a hairball—via **better scrape-time metadata** and **better runtime grouping**.

## Assumptions

* Input: `code-graph.json` with nodes (files/modules/classes/functions/components) and edges (imports/calls/uses/refs).
* You can change the scraper schema and the viewer behavior.
* You want: (a) interactive readability and (b) **exportable images** that can be layered in docs/slides.

## Approach / Rationale

Make the graph navigable like a map:

1. **Build a hierarchy** (repo → package → module → file → symbol) and treat it as first-class.
2. Use **edge semantics** + **weights** to decide what’s shown at each zoom/focus.
3. Provide **canonical “camera compositions”** (like UML views) so screenshots are repeatable.

---

## Core Content

## 1) Scrape-time metadata that pays off massively

Add metadata so the viewer can *choose* what to render instead of guessing.

### Node fields to add

* **kind**: `package|module|file|class|function|component|hook|test|generated`
* **loc / size**: lines, tokens, cyclomatic complexity (approx), byte size
* **hotness**: git churn (commits/30d), last_modified, author count (bus factor proxy)
* **ownership**: team/service domain tag (even heuristic: path prefix → team)
* **layer**: `ui|api|domain|infra|data|tests` (heuristic by path, frameworks, imports)
* **stability**: `stable|volatile` (use churn threshold)
* **entrypoint**: boolean (CLI main, HTTP handler, React root, etc.)
* **externality**: `internal|vendor|third_party`
* **generated**: boolean + generator tool label

### Edge fields to add

* **type**: `import|call|inherit|implement|compose|read|write|event_publish|event_subscribe|route|render|test`
* **direction**: keep directed, but mark if effectively bidirectional (e.g., cyclic import)
* **weight**: count of callsites/references, or “strength” (static count)
* **distance class**: `local` (same file/module) vs `cross-module` vs `cross-package` vs `cross-service`
* **confidence**: `static|heuristic|dynamic` (DI/reflection often heuristic)

This lets you do *policy-based rendering*:

* At high level: only `cross-package` edges, only weight ≥ N, only non-test, only non-generated.
* At mid level: show `import` + `inherit`, hide `call` unless focused.
* At low level: symbol call graph, but only within radius.

---

## 2) Multi-scale aggregation that’s actually readable

The key is to treat aggregation as a **view**, not a mutation.

### A) Hierarchical collapsing (default-on)

* Collapse nodes into **clusters** (package/module/file) based on zoom level.
* Represent a cluster as a “supernode” with:

  * size = sum(LOC) or sum(children)
  * color = dominant layer/team
  * badges = #children, churn, complexity, test ratio

When collapsed, edges become **bundled** between supernodes with aggregated weights.

### B) “Railway map” edge bundling

For screenshots, raw 3D edges look like fishing line.

* Bundle edges by (source_cluster, target_cluster, edge_type)
* Draw one thick spline per bundle; thickness = weight
* On hover: expand the bundle into individual edges (temporarily)

### C) K-core / backbone extraction (graph sparsification)

Offer a “Backbone” mode:

* Show only nodes above a centrality threshold (PageRank / betweenness / degree)
* Or show a **minimum spanning arborescence** from an entrypoint (best for directed “downstream” stories)
  This gives you a photo-worthy “skeleton” of the system.

### D) Views that answer a single question

Most “layerable” images are *not* “the whole codebase.” They’re:

* **Architecture**: packages/services + cross-boundary deps
* **Execution path**: entrypoint → domain → data (one request)
* **Hotspots**: churn/complexity heatmap
* **Risk**: cycles + forbidden edges + high fan-in utilities

So make those views one-click presets.

---

## 3) Focus mechanics that avoid spaghetti

You already have downstream neighbor focus; supercharge it:

### A) Radial budget (hard cap)

In focus mode, enforce:

* max nodes (e.g., 200)
* max edges (e.g., 400)
* selection policy: keep highest-weight edges, then highest-centrality nodes

### B) Typed edge filtering per focus

Default focus filters by meaning:

* exploring dependencies: show `import|inherit|implement`
* exploring runtime: show `call|event_publish|event_subscribe|route`
* exploring data: show `read|write`

### C) “Context ring” + “detail island”

A great screenshot pattern:

* Center: focused subgraph (high opacity)
* Surrounding ring: immediate neighbors (medium opacity)
* Everything else: dimmed to near-invisible or hidden
  This makes screenshots legible and composable in docs.

---

## 4) Layout tricks for 3D that stay interpretable in 2D screenshots

3D viewers die when flattened into a PNG unless you cheat.

### A) Use a **semi-2.5D** layout for capture

For screenshots:

* constrain Z to discrete “layers” (stacked planes): `ui`, `api`, `domain`, `data`, `infra`, `tests`
* within each plane, run a 2D layout (force-directed or hierarchical)
* edges between planes become clean vertical-ish arcs

This gives you an “architectural layer cake” that screenshots beautifully.

### B) Camera presets + orthographic option

Provide deterministic camera presets:

* top-down (dependency map)
* side-on (layer separation)
* isometric (pretty but still readable)
  And seriously consider **orthographic projection** for export—removes perspective distortion and reduces clutter in captures.

### C) Depth & occlusion controls

For stills:

* fade nodes by depth (distance to camera)
* hide edges behind nodes (or reduce alpha)
* render edges with depth-tested transparency carefully (sorted) to avoid visual noise

### D) Label strategy (labels are the #1 screenshot killer)

* Never label everything.
* Label only:

  * selected node path
  * top-N central nodes in view
  * cluster names
* Use **billboard labels** with collision avoidance + max label count.

---

## 5) Export-oriented “layerable” image pipeline

If you want images that stack well in slides/docs, support exporting multiple passes:

**Recommended export passes (same camera pose):**

1. Nodes only (clusters)
2. Edges only (bundled)
3. Labels only
4. Highlights only (focus path / critical edges)
5. Heatmap overlay (churn/complexity)

Each pass as transparent PNG, same dimensions. That’s how you get gorgeous layered visuals without cramming everything into one frame.

---

## Supporting Details

### Heuristics that work surprisingly well

* **Hide intra-file edges** by default (they’re almost always noise at macro scale).
* **Promote cross-boundary edges** (package/service) because they’re architecturally meaningful.
* Treat **tests**, **generated**, and **vendor** as separate layers you can toggle.
* Flag “god utilities”: nodes with extreme fan-in; show them as a special glyph so viewers immediately understand why everything points there.

### Metrics worth computing (cheap + useful)

* fan-in / fan-out
* SCC cycles (strongly connected components) to show “dependency knots”
* PageRank-ish importance
* churn + complexity → “risk score”

Then you can create “Risk View” screenshots that are instantly explainable.

---

## Risks / Limits

* Pure physics layouts are not stable; screenshots become non-repeatable unless you **seed** the simulation or offer deterministic layout modes.
* Any attempt to show “everything at once” will fail on real repos unless you adopt aggressive budgets + aggregation.

---

## Next Actions / Alts

* Add scrape-time fields: **edge type, weight, distance-class, confidence** + node fields: **layer/team/hotness**. That alone unlocks sane defaults.
* Implement **2.5D layered capture mode** + **export passes** for stacking images.
* Add **Backbone view** (k-core / centrality threshold) and **SCC cycle highlighting** for the most informative “single frame” shots.
