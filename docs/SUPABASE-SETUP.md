# Connecting WiseCases to the Supabase project

Project reference: `lathuhebwgxqteoqdjyw` · URL: `https://lathuhebwgxqteoqdjyw.supabase.co`

This guide is written so it can be followed either from your own computer or from the Claude Code cloud
environment. **Never paste passwords, connection strings or secret keys into chat, code, commits or docs.**

## 1. Credentials (what, why, where)

| Variable | Secret? | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No | `https://lathuhebwgxqteoqdjyw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | No (public by design) | Dashboard → Project Settings → API Keys → publishable key |
| `DATABASE_URL` | **Yes** | A **pooler** connection string (see below) with your database password |
| `WISECASES_SESSION_SECRET` | **Yes** | A new random string: `openssl rand -base64 48`. **Not** the database connection string |

Where to store them:
- **Your computer:** `.env.local` in the project folder (ignored by Git).
- **Claude Code cloud environment:** the environment's settings (cloud environment menu in the session title bar → Edit → environment variables). A new session picks them up.
- **Vercel (production):** Project → Settings → Environment Variables. Never with a `NEXT_PUBLIC_` prefix for the two secrets.

### Why a server-only database credential is needed
Learners and guests have no database access to correct answers, future clues or attempts. The server must read the
answers to check them and must save lives and score, so it needs its own credential. WiseCases uses the database
connection string rather than the Supabase secret API key because:
- answers, case saves and publishing are single all-or-nothing transactions;
- admin actions run **as the signed-in user** (`set local role authenticated`), so Row Level Security and the
  "only SUPER_ADMIN publishes" rule still apply. The secret API key would bypass them;
- the same migrations and tests run on a local database.

The Supabase secret key (`sb_secret_…` / `service_role`) is **not required**.

### Which connection string
The direct host `db.lathuhebwgxqteoqdjyw.supabase.co` is **IPv6-only**, which many networks (including the cloud
environment and some hosting) cannot reach. Use a **pooler** string from Dashboard → **Connect**:

- **Session pooler** (port **5432**): use for `db:migrate`, `db:check`, `db:seed-demo`, `admin:grant`, and local development.
- **Transaction pooler** (port **6543**): recommended for Vercel/serverless. The app already disables prepared statements for it.

Both look like `postgresql://postgres.lathuhebwgxqteoqdjyw:<password>@aws-…pooler.supabase.com:<port>/postgres`.
Special characters in the password must be URL-encoded (for example `@` → `%40`, `#` → `%23`), and the
`[` `]` shown around `[YOUR-PASSWORD]` in the dashboard are placeholders, not part of the password.

## 2. Network access (cloud environment only)

The cloud environment's network policy must allow these hosts (environment settings → Network access →
Custom → Allowed domains, keeping the default package-manager list):

| Host | Used for |
|---|---|
| `lathuhebwgxqteoqdjyw.supabase.co` | Sign-in (Supabase Auth) from the app server |
| `*.pooler.supabase.com` | Database connection (PostgreSQL protocol on ports 5432 / 6543) |
| `api.supabase.com`, `mcp.supabase.com` | Optional: Supabase CLI management and the Supabase MCP server |

## 3. Apply the database schema (safe order)

```bash
npm run db:migrate:dry   # lists migrations and which are pending; changes nothing
npm run db:migrate       # applies supabase/migrations only (never supabase/proposed)
psql "$DATABASE_URL" -f supabase/seed.sql   # initial domains (or paste the file into the Supabase SQL editor)
npm run db:check         # read-only: migrations, 11 tables, RLS, guards
npm run db:seed-demo     # demo cases as database records (safe to run again)
```

`db:migrate` records each file in `supabase_migrations.schema_migrations`, the same table the Supabase CLI uses.
Expected checksums: Milestone 1 `101f2771a3fc…` (unchanged since commit `6ab771d`).

## 4. Create the owner (SUPER_ADMIN)

1. Start the app (`npm run dev`) and sign up at `/sign-up` with the owner's email.
2. Confirm the email if Supabase asks you to.
3. Run `npm run admin:grant -- --email <owner email> --name "Your name"`.
4. Sign out and in again (or reload): the header shows **Admin**.

Roles live only in the `user_roles` table. No email address is written into the code.

## 5. Supabase Auth settings

Dashboard → Authentication → URL Configuration:
- **Site URL:** your production URL (or `http://localhost:3000` while developing).
- **Redirect URLs:** add `http://localhost:3000/auth/confirm` and `https://<your-domain>/auth/confirm`.

Email confirmation can stay on (recommended). Anonymous sign-ins are **not** needed: guests use a signed cookie.

## 6. After setup

Reset the database password (Dashboard → Project Settings → Database) if it was ever shared outside a secret
store, then update `DATABASE_URL` wherever it is stored.
