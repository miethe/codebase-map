2026-01-18

## 0) TL;DR

* The prior “deep analysis” report you’re referencing was based on **`main`** (default) per saved context.
* I attempted to open **`feat/layering`** directly, but this environment can’t fetch non-indexed GitHub URLs (and can’t `curl` GitHub either), so I **cannot** produce a literal code diff right now.
* What I *can* do today: deliver a **branch-delta validation report** (what to verify in `feat/layering`, why it matters, and the exact acceptance criteria), plus a **prioritized updated recommendation set** tuned for your 2k/5k graph case.
* Next turn PRD will be clean if you provide either a zip of `feat/layering` or paste the outputs of the small command set below.

---

## 1) Context

You asked for an updated report that validates recommendations against the **most recent work in `feat/layering`**, because the earlier report may have been based on `main`.

Saved context from the previous report indicates it **was based on `main`**, and it emphasized:

* richer scraper metadata (typed nodes/edges, layer tags, cluster IDs, weights),
* hierarchical LOD (packages→modules→files→functions),
* staged physics/layout and caching,
* WebGL-first rendering with aggressive culling/instancing,
* UX modes + progressive disclosure.

---

## 2) Assumptions

* Your target scale is at least **2k nodes / 5k edges**, with headroom for larger graphs.
* Your UX goal is “**legible at any zoom**”: architecture-first at macro scale, and actionable drill-down at micro scale.
* `feat/layering` likely contains some LOD/layering work, but I can’t confirm without branch access.

---

## 3) Approach / Rationale

Since I can’t fetch `feat/layering` source here, the best “updated report” I can provide is a **validation matrix**:

* each recommendation becomes a **checklist item**,
* with **how to verify**, **why it matters**, and **acceptance criteria**.
  That makes the next PRD deterministic: it turns into issues/epics with measurable “done”.

---

## 4) Core Content — Updated Branch-Delta Report (Main → Feat/Layering Validation)

### A) Data Model / Scraper Output (this is the biggest multiplier)

**Goal:** make the renderer dumb and fast; push semantics + hierarchy into the generated JSON.

1. **Typed nodes + typed edges**

* **Verify in `feat/layering`:** graph schema includes `node.type` (file/class/function/component/hook/route/api/etc) and `edge.type` (import/call/render/route/reads/writes/etc).
* **Why:** enables filtering, LOD aggregation, and selective rendering without expensive runtime inference.
* **Acceptance:** can hide/show by type with O(1) predicate + GPU buffer rebind, not recompute.

2. **Architectural layer tags**

* **Verify:** `node.layer` (ui/api/domain/infra/shared) and optionally `node.subsystem`.
* **Why:** layer-based layouts and presets become trivial.
* **Acceptance:** “Layer View” preset separates UI vs API vs domain with stable clusters.

3. **Hierarchical grouping fields (cluster IDs at multiple levels)**

* **Verify:** `node.lod` and `node.parent_id` (or `cluster_path`: `pkg/module/file/...`).
* **Why:** hierarchical LOD is impossible to do well “just in the viewer” without metadata.
* **Acceptance:** at LOD0 you render ~10–80 supernodes, not 2000 nodes.

4. **Edge weights + distance class**

* **Verify:** `edge.weight` and `edge.span` (intra-cluster / inter-cluster / cross-layer).
* **Why:** lets you keep only the “backbone” when zoomed out (reduce clutter + draw calls).
* **Acceptance:** at zoomed-out view, you can render ≤10–20% of edges with no “mystery loss”.

5. **Precomputed “importance”**

* **Verify:** `node.importance` (PageRank-ish / degree / churn-weighted score).
* **Why:** label budgeting and progressive disclosure need a stable priority metric.
* **Acceptance:** labels remain stable while panning/zooming; no “label pop chaos”.

---

### B) Multi-Scale / Layering UX (LOD + progressive disclosure)

**Goal:** the user never sees “everything”; they see the *right* amount.

1. **Discrete LOD tiers**

* **Verify:** viewer switches across explicit tiers (LOD0 clusters → LOD1 modules → LOD2 files → LOD3 symbols).
* **Why:** continuous zoom-based “fade in” tends to create thrash (layout + labels + GPU buffers).
* **Acceptance:** each tier has a stable node count budget (e.g., 50 / 250 / 1000 / 2000).

2. **Cluster expand/collapse**

* **Verify:** click expands cluster *in place* (animated), with breadcrumb/back.
* **Why:** this is the mental-model glue; without it, the map is just pretty noise.
* **Acceptance:** expanding does **not** rerun full layout; only local refinement.

3. **Backbone edge filtering + “show more edges” control**

* **Verify:** default edge rendering at low LOD shows only weighted backbone; user can increase density.
* **Why:** edges are your performance + readability killer.
* **Acceptance:** LOD0 renders aggregated edges (count/weight), not individual edges.

4. **Subgraph focus modes**

* **Verify:** “Neighbors k-hop”, “Upstream/Downstream”, “Path to entrypoints”, “Blast radius”.
* **Why:** usability: real tasks are subgraph tasks.
* **Acceptance:** focus mode reduces active nodes/edges by >70% on typical interactions.

---

### C) Physics / Layout (make it staged, cached, and predictable)

**Goal:** stable map + responsive interaction. Physics is a tool, not a lifestyle.

1. **Staged layout**

* **Verify:** compute layout for coarse graph first (clusters), then refine within clusters.
* **Why:** O(N²) repulsion is the death spiral at 2k nodes if you do it naïvely.
* **Acceptance:** initial “meaningful macro layout” appears fast; fine detail resolves incrementally.

2. **Layout caching**

* **Verify:** persistent cache keyed by `(repo_hash, graph_version, lod, filter_state)` in IndexedDB/localStorage.
* **Why:** users revisit maps; recomputing is wasted time and causes “map drift”.
* **Acceptance:** reopening a map yields near-instant stable positions.

3. **Approximate n-body / Barnes–Hut (or equivalent)**

* **Verify:** either Barnes–Hut style approximation or cluster-to-cluster repulsion only at low LOD.
* **Why:** keeps frame times sane.
* **Acceptance:** simulation step stays within a fixed time budget (e.g., <4–6ms per frame on desktop).

4. **Constraints as first-class**

* **Verify:** layer separation constraints (UI “north”, API “south”, etc) and intra-cluster bounding.
* **Why:** otherwise your physics fights your UX goals.
* **Acceptance:** user can predict where things are by layer; no “spaghetti bloom”.

---

### D) Rendering / Performance (where most lag actually comes from)

**Goal:** treat nodes/edges like a GPU problem, not a DOM problem.

1. **WebGL-first primitives**

* **Verify:** nodes/edges are drawn as instanced geometry (or batched buffers), not thousands of DOM elements.
* **Why:** DOM/Canvas hybrid dies as density grows.
* **Acceptance:** draw calls remain roughly constant per LOD (not proportional to node count).

2. **Aggressive culling**

* **Verify:** frustum culling + distance/size thresholding (don’t draw what can’t be seen).
* **Why:** free FPS.
* **Acceptance:** off-screen objects contribute ~0 cost.

3. **Label budgeting**

* **Verify:** labels are capped per LOD and prioritized by `node.importance`.
* **Why:** text is expensive and visually dominant.
* **Acceptance:** labels do not exceed budget; no stutter when labels update.

4. **Edge batching + optional simplification**

* **Verify:** edges as a single buffer; optional simplification at low LOD (aggregated links).
* **Why:** edges are typically more expensive than nodes.
* **Acceptance:** switching “edge density” doesn’t freeze the UI.

---

### E) UX / Product Surface (turn it into a tool, not a demo)

**Goal:** common tasks are 1–2 clicks away.

1. **Mode presets**

* **Verify:** “Architecture Layers”, “Dependency/Blast Radius”, “Runtime Flow”, “Hotspots”.
* **Acceptance:** each preset toggles filters + LOD + styling consistently.

2. **Search + jump-to**

* **Verify:** fuzzy search across node names/types; camera flies to node/cluster; highlights path.
* **Acceptance:** search-to-context is sub-second on 2k nodes.

3. **Legend + explainability**

* **Verify:** legend shows node/edge types and what colors/shapes mean.
* **Acceptance:** a new user can interpret the map without reading docs.
