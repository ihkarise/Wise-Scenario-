# WiseCases database

PostgreSQL on Supabase. Every schema change is a version-controlled migration in `supabase/migrations/`.

## Milestone 1 tables (created)

| Group | Table | Purpose |
|---|---|---|
| People & access | `profiles` | One row per login (created by trigger). Display name only; email stays in `auth.users` |
| | `user_roles` | `SUPER_ADMIN`, `ADMIN`, `EDITOR`, `REVIEWER`, `LEARNER`. New logins get `LEARNER` |
| Taxonomy | `domains` | Medical Diagnosis, Materia Medica, Repertory … (`domain_type` unlocks optional fields) |
| | `categories` | Specialty/category; `parent_id` makes a subcategory |
| Content | `cases` | Settings (lives, final-stage behaviour, difficulty, status), teaching, `domain_fields` JSON |
| | `case_stages` | Ordered stages; unique `(case_id, position)`, deferrable for reordering |
| | `stage_options` | Answer options per stage, with `is_correct` |
| | `case_references` | References with `is_placeholder` and `verified` flags |
| | `case_versions` | Frozen JSON snapshot per publication; attempts point here |
| Gameplay | `attempts` | One play-through: owner, case + version, status, stage, lives, score, revision |
| | `attempt_answers` | Every accepted answer; unique `(attempt_id, submission_id)` and `(attempt_id, sequence)` |

## Future tables (not created yet)

| Milestone | Tables |
|---|---|
| 2–3 | `tags`, `case_tags`, `media_assets`, `stage_media`, `case_reviews`, `audit_logs` |
| 6 | `user_case_progress`, `case_saves` |
| 8 | `daily_challenges`, `achievements`, `user_achievements`, `scoring_rules` |

## Security model

- **Learners never read content tables.** Anonymous visitors have no privileges on them at all. Signed-in learners get zero rows through RLS. Play goes through the server, which returns only the current stage.
- **Public catalogue** = the `public_case_summaries` view: safe columns of published cases only. It runs with the owner's rights, so it does not open up `cases`. The Supabase linter will flag it as a security-definer view; that is intended.
- **Gameplay:** learners can read their own attempts and answers only. They have no insert, update or delete rights on attempts or answers; the server writes them with the service role.
- **Staff** (`SUPER_ADMIN`, `ADMIN`, `EDITOR`, `REVIEWER`) read content via RLS; `EDITOR` and above write.
- **Publishing:** the `cases_enforce_publish` trigger allows only `SUPER_ADMIN` to set `status = 'PUBLISHED'`.
- **Roles** can only be granted by `SUPER_ADMIN` (policy on `user_roles`).
- The migration revokes default privileges, so new tables start closed. Every later migration must grant explicitly and enable RLS.

Covered by `supabase/tests/rls.test.sql`.

## Commands

| Task | How |
|---|---|
| Test all migrations and RLS locally | `npm run db:verify` (needs PostgreSQL 15+ binaries; starts and deletes a throwaway database) |
| Apply to a Supabase project | `supabase link --project-ref <ref>` then `supabase db push` |
| Seed development data | `supabase db reset` applies migrations, then `supabase/seed.sql` (local only) |
| Reset local database safely | `supabase db reset`. **Local only**: never run against production |
| Roll back locally | `psql -f supabase/rollback/20261004000100_m1_core_schema.down.sql` (destroys all cases and attempts) |
| Roll back in production | Do not. Write a new forward migration that fixes the problem |

`supabase/tests/support/` contains a small stand-in for Supabase (roles, `auth.users`, `auth.uid()`) used only by `npm run db:verify`. It must never be applied to a Supabase project.

## Naming and rules for new migrations

- File name: `YYYYMMDDHHMMSS_short_description.sql`; never edit a migration that has been applied anywhere.
- UUID primary keys, foreign keys, `created_at` / `updated_at` with the `set_updated_at` trigger.
- Check constraints for ranges, indexes for every filter used by the library.
- Cases with attempts are archived, never deleted (`case_versions` and `attempts` use `on delete restrict`).
