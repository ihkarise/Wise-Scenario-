# WiseCases

**Think. Diagnose. Learn.** A progressive, scenario-based reasoning engine for medical, homeopathy and clinical education.

A learner reads a case and chooses an answer. A wrong answer costs a life and reveals the next clue, with a new set of answer options. The case ends when the learner answers correctly or runs out of lives, and every ending explains the reasoning. Lives, stages and options are set per case, so the same engine serves medical diagnosis, materia medica, repertory, anatomy and other subjects.

> WiseCases is intended for medical education and learning. It is not a substitute for professional medical judgment, diagnosis or treatment.

## Current milestone: 1 (foundation and core case engine)

What works now:

- A domain-agnostic **case engine** (`src/lib/engine/`): variable lives, variable stages, different options at each stage, a life cost per stage, four configurable final-stage behaviours, and deterministic scoring.
- **Server-authoritative play.** The browser sends only IDs. The server decides correctness, lives, score, stage and completion, and returns only the current stage. A refresh resumes the attempt with the same lives, and double clicks never cost two lives.
- A mobile-first **player**: lives, clue progress, stacked clues, answer options, feedback, success and failure screens, a reasoning review and share text that hides the answer.
- **Five demo cases**, clearly labelled DEMO CONTENT, with placeholder references.
- A **Supabase migration** for the 11 core tables, with Row Level Security and its own tests.
- **Automated tests** for the engine, the play API, permissions and the database policies, all passing.

What does not exist yet: sign-in, the admin Case Builder, a real database connection, dashboards, analytics and gamification. See [Current limitations](#current-limitations).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Zod 4 · Vitest · ESLint · Supabase (PostgreSQL, Auth, Storage, RLS) · Vercel

## Local setup

Requirements: Node.js 20.9+ (22 recommended, see `.nvmrc`). PostgreSQL 15+ binaries are needed only for `npm run db:verify`.

```bash
npm install
cp .env.example .env.local     # optional in Milestone 1; defaults work
npm run dev                    # http://localhost:3000
```

Open **Cases** and play any demo case. Attempts are kept in server memory and reset when the server restarts.

## Environment variables

| Variable | Used from | Purpose |
|---|---|---|
| `WISECASES_DATA_SOURCE` | M1 | `memory` (default). `supabase` arrives in Milestone 2 |
| `NEXT_PUBLIC_SUPABASE_URL` | M2 | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | M2 | Supabase public (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | M2 | **Server only.** Never expose or prefix with `NEXT_PUBLIC_` |

Never commit `.env` files. Production values are set in Vercel and Supabase settings.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates route types, then runs `tsc --noEmit` |
| `npm test` | All unit, service and HTTP tests (Vitest) |
| `npm run build` | Production build |
| `npm run check` | Lint, typecheck, test and build in one go |
| `npm run db:verify` | Applies migrations to a throwaway PostgreSQL and runs the RLS and integrity tests |

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request.

## Architecture overview

```
Browser ──IDs only──► Next.js route handlers ──► AttemptService ──► pure engine
   ▲                                               │
   └──── PlayerView (current stage only) ◄─────────┴──► repositories (memory now, Supabase in M2)
```

- **Content** (cases, stages, options, teaching, references) is kept separate from **attempt state** (owner, stage, lives, answers, score, status).
- Attempts are pinned to the case version they started on.
- One function decides what the browser may see (`toPlayerView`), and one function calculates scores (`calculateScore`).

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATABASE.md](docs/DATABASE.md) · [SECURITY.md](SECURITY.md) · Milestone 0: [report](docs/MILESTONE-0-REPORT.md) and [interactive blueprint](docs/blueprint/index.html)

## Supabase setup (Milestone 2)

The migration is ready in `supabase/migrations/`. Once the project exists: `supabase link --project-ref <ref>` then `supabase db push`, and fill in the environment variables above. The app keeps using in-memory data until the Supabase repositories are added in Milestone 2.

## Deployment

Vercel is the intended host. Milestone 1 stores attempts in server memory, which does not persist on serverless hosting, so **do not deploy Milestone 1 for real users**. A production deployment guide comes with Milestone 12.

## Current limitations

- No sign-in yet. Every visitor is a guest identified by a random httpOnly cookie, and nobody can reach the admin area (it returns 403).
- Attempts live in memory: they are lost on restart and are not shared between server instances.
- Only single-choice questions are playable. The other interaction types are reserved in the schema.
- No Case Builder, dashboard, library filters, analytics, achievements, daily case or PWA yet.
- No rate limiting or Content-Security-Policy yet (planned for Milestone 10).
- Demo cases are fictional and unreviewed, and their references are placeholders.
- Dark mode is not built yet; components use central tokens so it can be added later.

## Next milestone

**Milestone 2: database, authentication and the Admin Case Builder foundation.** It covers Supabase repositories behind the existing interfaces, email sign-in and guest sessions through Supabase Auth, roles from `user_roles`, demo cases seeded into the database, and the first admin screens.

## Screenshots

_To be added._

## License

Proprietary and confidential. © WiseCases. All rights reserved. Not licensed for redistribution.
