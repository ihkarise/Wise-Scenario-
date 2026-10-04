#!/usr/bin/env bash
# Applies every migration to a throwaway local PostgreSQL and runs the RLS/integrity tests.
# Needs PostgreSQL 15+ server binaries (initdb, pg_ctl, psql). Nothing is left behind afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ ! -x "$PGBIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Install PostgreSQL 15+ or set PGBIN." >&2
  exit 1
fi

# initdb refuses to run as root; use the postgres system user when needed.
RUN=()
if [[ "$(id -u)" == "0" ]]; then RUN=(runuser -u postgres --); fi

WORK="$(mktemp -d)"
chmod 777 "$WORK"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/supabase/tests/support/00_supabase_shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$migration")"
  "${PSQL[@]}" -f "$migration"
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/support/99_service_role_grants.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls.test.sql"

echo "checking rollback"
"${PSQL[@]}" -f "$ROOT/supabase/rollback/20261004000100_m1_core_schema.down.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261004000100_m1_core_schema.sql"
echo "rollback and re-apply OK"
