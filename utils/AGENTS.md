# Utils Guidelines

## Scope
- Keep utilities pure and deterministic where possible.
- Avoid importing React or component code into `utils/`.
- Update shared types in `types.ts` when adding or changing data shapes.

## Performance
- Prefer memoizable functions and avoid hidden global state.
- Keep graph layout and LOD logic isolated for reuse across renderers.

## Data Safety
- Preserve existing JSON schemas and field names.
- If you must change a schema, update related scripts and document the migration.
