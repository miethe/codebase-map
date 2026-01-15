# Repository Guidelines

## Project Structure & Module Organization
- Entry points: `index.html`, `index.tsx`, and `App.tsx`.
- UI components live in `components/` (e.g., `GraphCanvas.tsx`, `Sidebar.tsx`).
- Shared logic and utilities are in `utils/` (graph layout, analytics, color mapping).
- Shared types/constants are in `types.ts` and `constants.ts`.
- Precomputed graph data is stored in `codebase-graph.*.json` and `metadata.json`.
- Build output goes to `dist/`.
- Data generation helpers live in `scripts/` (Node scripts that write JSON files).

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

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits patterns like `feat: ...` and `fix: ...`.
- PRs should include a short summary, testing notes (e.g., `npm run dev`), and screenshots/GIFs for UI changes.
- Link related issues or tickets when applicable.

## Configuration & Secrets
- Local config: set `GEMINI_API_KEY` in `.env.local` (do not commit secrets).
