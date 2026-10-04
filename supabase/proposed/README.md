# Proposed migrations (not applied)

Files here are **awaiting approval** and are deliberately outside `supabase/migrations/`, so
`supabase db push` will not apply them.

- `20261004000300_m2_authoring.sql`: Case Builder support (draft fields and saving incomplete drafts, audit log,
  preview sessions). Moves to `supabase/migrations/` when the Case Builder is approved.
- `20261004000300_m2_authoring.down.sql`: its local rollback.
- `rls_authoring.test.sql`: its security tests.

Test everything, including these, with `npm run db:verify:proposed`.

Note: the Case Manager (`/admin`) does **not** need this migration; it works with the approved schema.
This proposal would still add an audit log and server-side preview sessions if approved later.
