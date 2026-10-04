# Security

WiseCases is a private, proprietary project. Report vulnerabilities privately to the repository owner; do not open public issues for them.

## Principles

- The server and database are authoritative for correctness, lives, score, stage progression, completion and publication status. The browser is never trusted for any of them.
- Correct answers and future stages are never sent to the browser before they are earned.
- Authorization is enforced on the server (proxy, pages, services) and in the database (RLS). Hiding a button is never the control.
- No secrets in Git. `.env*` files are ignored; `.env.example` holds placeholders only. The Supabase service-role key is server-only.

## Checks (Milestones 1–2)

| Threat | Control | Evidence |
|---|---|---|
| Opening an unpublished case | Service returns `CASE_UNAVAILABLE`; page returns 404; RLS hides drafts | `attempt-service.test.ts`, `attempt-handlers.test.ts`, `rls.test.sql` |
| Learner opening admin areas | `src/proxy.ts` returns 403; admin page re-checks; permission map | `permissions.test.ts`; verified 403 on `/admin`, `/api/admin/*` |
| Answering another learner's attempt | Ownership check; reported as "not found" | `attempt-service.test.ts`, `attempt-handlers.test.ts`, `rls.test.sql` |
| Client changing lives or score | Strict request schema (400); no DB write rights for learners | `attempt-handlers.test.ts`, `rls.test.sql` |
| Client claiming a correct answer | Correctness looked up on the server from the option ID | `attempt-handlers.test.ts` |
| Skipping stages | Submitted stage must equal the current stage | `engine.test.ts`, `attempt-service.test.ts` |
| Answering after completion | `ATTEMPT_COMPLETED` | `engine.test.ts`, `attempt-service.test.ts` |
| Reading future stages / answers | `toPlayerView` picks fields explicitly; learners have no access to content tables | `view.test.ts`, `rls.test.sql`; client bundle checked for case text |
| Double submission | UI lock + idempotency key + revision check + compare-and-swap + unique constraints | `engine.test.ts`, `attempt-service.test.ts`, `rls.test.sql` |
| Self-promotion to admin | Roles only granted by `SUPER_ADMIN`; never read from requests | `rls.test.sql`, `permissions.test.ts` |
| Editor publishing | Publish trigger allows only `SUPER_ADMIN` | `rls.test.sql`, `permissions.test.ts` |
| CSRF on answer endpoints | JSON content type required; cross-origin `Origin` rejected; `SameSite=Lax` httpOnly cookie | `attempt-handlers.test.ts` |
| Leaking internals in errors | Fixed plain-language messages; details only in server logs | `attempt-handlers.test.ts` |
| Forged or chosen guest identity | Guest cookie = random UUID + HMAC-SHA256 signature with a server secret; unsigned/forged cookies rejected | `permissions.test.ts`, `attempt-handlers.test.ts`, `foundation.test.ts` |
| Roles supplied by the client | Roles loaded from `user_roles` on the server for every request; only SUPER_ADMIN can grant roles | `foundation.test.ts`, `rls.test.sql` |
| Signed-out or non-staff access to admin | Proxy redirects / returns 401; server re-checks roles; RLS in the database | browser test; `foundation.test.ts` |
| Admin actions bypassing RLS | Server runs admin queries as the signed-in user (`set local role authenticated`) | `foundation.test.ts` |
| Editor unpublishing or repointing the live version | Publish guard trigger covers status, `published_version` and `published_at` | `rls.test.sql` |
| Open redirect after sign-in | Only same-site relative `next` paths accepted | browser test |
| Secrets in the browser | Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key are public; build scanned for the connection string and session secret | release check |

## Known gaps (planned)

- Guest attempts are not transferred to an account when the guest signs up later.
- No rate limiting yet on the answer endpoint (Milestone 10).
- No Content-Security-Policy header yet (Milestone 10). Basic security headers are set in `next.config.ts`.
- The server database credential (`DATABASE_URL`) can read correct answers by design; it must stay server-only (never `NEXT_PUBLIC_`), and the database password should be rotated if it is ever shared outside a secret store.
- `npm audit` reports a high-severity advisory in `braces`, used only by the dev-time ESLint toolchain (`eslint-config-next`). No patched version exists yet, and it is not shipped to users. `npm audit --omit=dev` is clean.
