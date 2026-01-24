# Repository Guidelines

## Project Structure & Module Organization
- Entry points: `index.html`, `index.tsx`, and `App.tsx`.
- UI components live in `components/` (e.g., `GraphCanvas.tsx`, `Sidebar.tsx`).
- Shared logic and utilities are in `utils/` (graph layout, analytics, color mapping).
- Shared types/constants are in `types.ts` and `constants.ts`.
- Precomputed graph data is stored in `codebase-graph.*.json` and `metadata.json`.
- Build output goes to `dist/`.
- Data generation helpers live in `scripts/` (Node scripts that write JSON files).

## Rendering Defaults
- WebGL is the default renderer; enhancements and fixes should target `components/GraphCanvasWebGL.tsx` first.
- SVG (`components/GraphCanvas.tsx`) is a fallback for compatibility only; touch it only when a fallback-specific change is needed.
- Renderer selection lives in `components/GraphRenderer.tsx` (env-driven).

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run dev` starts the Vite dev server.
- `npm run build` produces a production build in `dist/`.
- `npm run preview` serves the production build locally.
- Data refresh (optional):
  - `node scripts/scan_dependencies.js` regenerates `codebase-graph.dependencies.json`.
  - `node scripts/extract_git_metadata.js` regenerates `codebase-graph.git-metadata.json`.

## Coding Style & Naming Conventions
- Language: TypeScript + React (functional components).
- Indentation: 2 spaces; use semicolons and single quotes, as seen in `App.tsx`.
- File naming: `PascalCase.tsx` for components, `camelCase.ts` for utilities.
- Keep UI state localized in components; share cross-cutting logic via `utils/`.

## Testing Guidelines
- No automated test runner is configured yet.
- If you add tests, place them in `tests/` or `__tests__/` and add an `npm test` script.
- Include basic smoke checks for graph rendering and data loading paths.

## Token & Context Efficiency
- Avoid loading large `codebase-graph.*.json` files unless strictly necessary; prefer `metadata.json` or narrow `rg` searches.
- When inspecting data, sample small slices (e.g., `head`, `jq` filters) instead of full dumps.
- Keep changes localized; don’t reformat unrelated code.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits patterns like `feat: ...` and `fix: ...`.
- PRs should include a short summary, testing notes (e.g., `npm run dev`), and screenshots/GIFs for UI changes.
- Link related issues or tickets when applicable.

## Configuration & Secrets
- Local config: set `GEMINI_API_KEY` in `.env.local` (do not commit secrets).

## Suggested Skills Usage by Task
- **Graph readability / LOD / aggregation / hierarchy** → Data Visualization
- **Custom force layouts / edge bundling / interaction mechanics** → d3-visualization
- **WebGL/Three.js rendering / 2.5D layered views** → 3d-visualizer
- **d3-viz** (`.codex/skills/d3js/SKILL.md`)
  - Overlaps with d3-visualization but still useful for low-level SVG/Canvas control and bespoke graph interactions.
- **New skill definition or external skill installation** → skill-creator / skill-installer
