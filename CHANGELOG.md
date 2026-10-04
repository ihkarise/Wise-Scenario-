# Changelog

## 0.2.0-dev · Milestone 2: Supabase foundation (in progress)

### Added
- PostgreSQL repositories for published case snapshots and attempts; attempts persist across restarts.
- Supabase Auth email/password sign-in, sign-up, confirmation and sign-out; account page with attempt history.
- Roles loaded from `user_roles`; `admin:grant` script; admin gate in the proxy and on the server.
- HMAC-signed guest cookies (forged or unsigned cookies are rejected).
- Migration `m2_foundation`: guest attempts, catalogue fields on published versions, stricter publish guard.
- Proposed (not applied) Case Builder migration in `supabase/proposed/`.
- Scripts: `db:migrate[:dry]`, `db:check`, `db:seed-demo`, `admin:grant`; integration tests; CI database job.

### Changed
- The app now requires a database (`DATABASE_URL`); the in-memory store is used only by unit tests.
- Guest cookies from Milestone 1 (unsigned) are no longer accepted; those guests simply start fresh.

## 0.1.0 · Milestone 1: foundation and core case engine

### Added
- Next.js 16, TypeScript (strict), Tailwind CSS 4, ESLint, Vitest; CI for lint, typecheck, tests, build and database tests.
- Pure, domain-agnostic case engine: variable lives and stages, different options per stage, life cost per stage, four final-stage behaviours, deterministic scoring, idempotent answers.
- Server-authoritative play API (`/api/attempts`) that returns only the current stage, with in-memory repositories.
- Player UI: lives, clue progress, stacked clues, answer options, feedback, success and failure results, reasoning review, share text.
- Five demo cases (Anatomy, Dermatology, Endocrinology, Materia Medica, Repertory), clearly labelled DEMO CONTENT with placeholder references.
- Supabase migration for the 11 core tables, with RLS, a publish guard and integrity constraints, plus a local verification script.
- Admin area gate returning 403 (admin features arrive in later milestones).

## 0.0.1 · Milestone 0: architecture
- Architecture report and interactive blueprint.
