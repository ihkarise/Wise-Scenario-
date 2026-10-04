# Proposed migrations (not applied)

Files here are **awaiting approval** and are deliberately outside `supabase/migrations/`, so
`supabase db push` will not apply them. `npm run db:verify` still tests them on a throwaway local database.

- `20261004000200_m2_authoring.sql`: guest attempts, catalogue fields on published versions, a stricter publish guard,
  draft fields, an audit log and preview sessions. It will be split into a "foundation" migration and a
  "builder" migration before being moved into `supabase/migrations/`.
