# Contributing

WiseCases is a private project. These rules keep it maintainable.

## Branches and commits
- `main` is protected. Work on `feature/*`, `fix/*`, `docs/*` (or the assigned `claude/*` branch).
- Conventional commit messages: `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.
- Never force-push shared branches or rewrite their history. Never commit `.env` files or keys.

## Before pushing
```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run db:verify        # when migrations change (needs local PostgreSQL)
```
Fix failures; do not disable lint rules or type checks to get green.

## Code rules
- Game rules live only in `src/lib/engine/`. Components render `PlayerView`; they never decide correctness, lives or score.
- No case-specific code (`if (caseId === …)`). Content comes from data.
- Validate external input with Zod (`src/lib/schemas/`).
- Database changes are new migrations; never edit an applied one. New tables must enable RLS and grant explicitly.
- Write the test with the change. Engine changes need engine tests.
