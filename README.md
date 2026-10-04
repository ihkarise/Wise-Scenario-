# WiseCases

**Think. Diagnose. Learn.** A progressive, scenario-based reasoning engine for medical, homeopathy and clinical education.

A learner reads a case and chooses an answer. A wrong answer costs a life and reveals the next clue, with a new set of answer options. The case ends when the learner answers correctly or runs out of lives, and every ending explains the reasoning. Lives, stages and options are set per case, so the same engine serves medical diagnosis, materia medica, repertory, anatomy and other subjects.

> WiseCases is intended for medical education and learning. It is not a substitute for professional medical judgment, diagnosis or treatment.

## Current milestone: 2 (Supabase foundation in progress)

What works now:

- A domain-agnostic **case engine** (`src/lib/engine/`): variable lives and stages, different options at each stage, a life cost per stage, four final-stage behaviours, and deterministic scoring.
- **Server-authoritative play backed by PostgreSQL/Supabase.** The browser sends only IDs. The server decides correctness, lives, score, stage and completion, returns only the current stage, and stores every attempt and answer in the database. Attempts survive refreshes and server restarts.
- **Published versions.** Learners play frozen snapshots in `case_versions`, so later edits never change a game in progress.
- **Sign-in** with email and password (Supabase Auth). **Guests** can play with a signed, httpOnly cookie, with no registration needed.
- **Roles from the database** (`user_roles`). The owner is made SUPER_ADMIN with `npm run admin:grant`. Admin pages and APIs refuse signed-out visitors and non-staff.
- **Demo cases as database records** (`npm run db:seed-demo`), clearly labelled DEMO CONTENT.
- Database checks, migrations with rollback, and Row Level Security tests.

Not built yet: the Admin **Case Builder** (on hold until the Supabase foundation is verified on the hosted project), dashboards, analytics and gamification.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Zod 4 · Supabase (PostgreSQL, Auth, RLS) via `postgres` and `@supabase/ssr` · Vitest · ESLint · Vercel

## Local setup

Requirements: Node.js 20.9+ (22 recommended, see `.nvmrc`), and a Supabase project. PostgreSQL 15+ binaries are needed only for the database test scripts.

```bash
npm install
cp .env.example .env.local      # fill in the four values (see docs/SUPABASE-SETUP.md)
npm run db:migrate:dry          # see what will be applied (changes nothing)
npm run db:migrate              # apply approved migrations
npm run db:seed-demo            # load demo cases
npm run dev                     # http://localhost:3000
```

Then sign up at `/sign-up` and run `npm run admin:grant -- --email <you>` to become SUPER_ADMIN. Full guide: [docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md).

## Environment variables

| Variable | Browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (public) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (public) | Email/password sign-in |
| `DATABASE_URL` | **No, server only** | PostgreSQL pooler connection string. Used to check answers and save attempts; admin actions run as the signed-in user under RLS |
| `WISECASES_SESSION_SECRET` | **No, server only** | Random 32+ character string that signs guest cookies |

Never commit `.env` files. The Supabase secret API key is not needed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` | Quality gates (`npm run check` runs all four) |
| `npm run test:integration` | Repository tests against a throwaway PostgreSQL |
| `npm run db:verify` / `db:verify:proposed` | Migrations, rollback and RLS tests on a throwaway database (approved / plus proposed) |
| `npm run db:migrate:dry` · `db:migrate` | Show / apply pending migrations on `DATABASE_URL` (never `supabase/proposed`) |
| `npm run db:check` | Read-only checks of the connected database |
| `npm run db:seed-demo` | Load demo cases (idempotent) |
| `npm run admin:grant -- --email <e> [--role R] [--revoke]` | Grant or revoke a role |

CI (`.github/workflows/ci.yml`) runs the quality gates, the database tests and the integration tests.

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

## Deployment

Vercel is the intended host. Set the four environment variables in Vercel (the two secrets without `NEXT_PUBLIC_`) and use the Supabase **transaction pooler** connection string. A full deployment guide comes with Milestone 12.

## Current limitations

- The hosted Supabase project has not been migrated yet: this cloud environment's network policy blocks Supabase hosts (see docs/SUPABASE-SETUP.md §2). Everything was verified against Supabase Auth and PostgreSQL 16 running locally.
- The Admin Case Builder is not built yet; `/admin` shows a placeholder for staff.
- Guest attempts are not moved to an account when a guest signs up later.
- Only single-choice questions are playable.
- No rate limiting or Content-Security-Policy yet (planned for Milestone 10).
- Demo cases are fictional and unreviewed, and their references are placeholders.

## Next step

Connect and verify the hosted Supabase project, then build the **Admin Case Builder** (the proposed migration in `supabase/proposed/` adds draft fields, the audit log and preview sessions).

## Screenshots

_To be added._

## License

Proprietary and confidential. © WiseCases. All rights reserved. Not licensed for redistribution.
