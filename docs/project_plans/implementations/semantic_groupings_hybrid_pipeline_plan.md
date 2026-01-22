# Implementation Plan: Semantic Groupings Hybrid Pipeline

Date: 2026-01-21

## Goal
Ship a deterministic, script‑generated baseline for cluster groupings (usable by the visualizer without AI), with an optional agent‑driven overlay that improves semantic labels and drill‑downs. The overlay must survive re‑runs via fingerprint matching and remain token‑efficient for agent workflows.

## Scope
- Data generation scripts (new/updated): base groupings, summary file, merge step.
- Visualizer ingestion updates: prefer merged groupings, prefer `metadata.path` for drill‑down.
- Optional: CLI entrypoints for base/merge/agent flow.

## Deliverables
- `codebase-graph.groupings.base.json` (generated)
- `codebase-graph.groupings.summary.json` (generated, compact)
- `codebase-graph.groupings.overrides.json` (agent‑generated, persistent)
- `codebase-graph.groupings.json` (merged; consumed by app)

---

## Phase 1 — Scripted Baseline (Deterministic)

### 1.1 Create `scripts/generate_groupings.js`
**Purpose**: Produce base groupings + summary in one deterministic pass.

**Inputs**
- `codebase-graph.unified.json`
- `codebase-graph.details.json` (optional)
- (Optional) `grouping.taxonomy.json` for explicit domain mapping

**Outputs**
- `codebase-graph.groupings.base.json`
- `codebase-graph.groupings.summary.json`

**Core steps**
1) Load unified graph nodes/edges.
2) Build deterministic clusters (connected components or taxonomy‑bucketed components).
3) Produce group entries:
   - `id`, `label`, `nodes`, `metadata.path`, `metadata.size`, optional `metadata.confidence`.
4) Emit summary per group with:
   - `id`, `fingerprint` (hash of sorted node IDs), `size`, `top_tokens`, `top_paths`, `sample_nodes`.

**Notes**
- Keep summary sizes small (5–10 entries per list max).
- Use stable ordering and hashing to ensure reproducibility.

### 1.2 (Optional) Add taxonomy support
**File**: `grouping.taxonomy.json` (manual or generated)
- Maps token/path → domain/subdomain.
- Used to set `metadata.path` in base output.

---

## Phase 2 — Optional Agent Overlay (Persistent)

### 2.1 Define override format
**File**: `codebase-graph.groupings.overrides.json`

**Schema**
```
{ "version": 1, "overrides": [
  { "fingerprint": "sha1:…", "id": "…", "label": "Marketplace (1536)", "path": ["Marketplace"], "confidence": 0.92 }
]}
```

### 2.2 Agent workflow
- Agent reads `codebase-graph.groupings.summary.json` only.
- Emits or updates overrides without touching base or merged files.
- Overrides live outside generated files and survive re‑runs.

---

## Phase 3 — Merge Step (Deterministic)

### 3.1 Create `scripts/merge_groupings.js`
**Purpose**: Combine base + overrides into final `codebase-graph.groupings.json`.

**Inputs**
- `codebase-graph.groupings.base.json`
- `codebase-graph.groupings.overrides.json` (optional)

**Output**
- `codebase-graph.groupings.json`

**Rules**
- Match overrides by `fingerprint`, then `id` as fallback.
- Override `label` and `metadata.path` when provided.
- Preserve all other base metadata.
- Emit warnings for missing fingerprints.

---

## Phase 4 — Visualizer Ingestion Updates

### 4.1 App data loading
- Ensure the app loads the merged file: `codebase-graph.groupings.json`.
- Do not load base/summary/overrides in the UI.

### 4.2 Module path resolution
- Update `buildNodePathMap` to **prefer `group.metadata.path`** when present.
- Only fall back to `group.label`‑based paths if no metadata path exists.

### 4.3 UI affordances (optional)
- Add an indicator if groupings are agent‑enhanced (e.g., metadata flag).
- Provide a menu entry for `Semantic` vs `Computed` if both are present.

---

## Phase 5 — Tooling/Automation

### 5.1 Add scripts to `package.json`
- `npm run groupings:base` → `node scripts/generate_groupings.js`
- `npm run groupings:merge` → `node scripts/merge_groupings.js`
- `npm run groupings:all` → base + merge

### 5.2 CI or local workflow
- On scan updates: run `groupings:base`, then `groupings:merge`.
- Agent runs only when summary changes or on request.

---

## Risks & Mitigations
- **Fingerprint mismatch after refactors** → fallback to group `id`, warn on merge.
- **Over‑clustering** → enforce size thresholds, ensure domain‑level grouping remains visible.
- **Generic labels** → ensure taxonomy mapping covers core product domains.

---

## Success Criteria
- Base groupings are readable without agent involvement.
- Agent overlays improve labels without breaking determinism.
- Drill‑downs reflect domain hierarchies (Marketplace → Scoring/Catalog/Import/Dedupe).
- Overrides persist across re‑runs and are merged cleanly.
