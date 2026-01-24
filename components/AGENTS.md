# Components Guidelines

## Rendering Priority
- WebGL (`GraphCanvasWebGL.tsx`) is the primary renderer and should receive feature work first.
- SVG (`GraphCanvas.tsx`) is fallback-only; update it only for compatibility or parity fixes.
- `GraphRenderer.tsx` wires renderer choice and shared handlers.

## React Patterns
- Keep components functional and state-light; push heavy computation to `utils/`.
- Prefer `useMemo`/`useCallback` for expensive derivations and handler stability.
- Avoid introducing new global state; use existing context in `App.tsx`.

## Interaction & UX
- Route interactions through handler props in `GraphRenderer.tsx` to keep behavior centralized.
- Maintain consistent node/edge semantics defined in `types.ts`.
