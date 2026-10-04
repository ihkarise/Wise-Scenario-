#!/usr/bin/env bash
# Runs tests/integration against a throwaway local PostgreSQL with the Supabase stand-in, the approved
# migrations (via the same migration runner used for real projects) and the seed. Leaves nothing behind.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[[ -x "$PGBIN/initdb" ]] || { echo "PostgreSQL server binaries not found. Install PostgreSQL 15+ or set PGBIN." >&2; exit 1; }
RUN=(); [[ "$(id -u)" == "0" ]] && RUN=(runuser -u postgres --)
PORT="${TEST_PG_PORT:-55433}"
WORK="$(mktemp -d)"; chmod 777 "$WORK"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k $WORK" -l "$WORK/log" -w start >/dev/null
export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
psql "$TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/support/00_supabase_shim.sql"
DATABASE_URL="$TEST_DATABASE_URL" npx tsx "$ROOT/scripts/db.ts" migrate >/dev/null
psql "$TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/support/99_service_role_grants.sql" -f "$ROOT/supabase/seed.sql"
npx vitest run --config "$ROOT/vitest.integration.config.ts"
