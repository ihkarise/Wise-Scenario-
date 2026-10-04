#!/usr/bin/env bash
# Applies migrations to a throwaway local PostgreSQL and runs the RLS/integrity tests, then rolls back,
# re-applies and re-tests. Needs PostgreSQL 15+ server binaries (initdb, pg_ctl, psql).
#   bash scripts/verify-db.sh             approved migrations only (supabase/migrations)
#   bash scripts/verify-db.sh --proposed  also the proposed Case Builder migration (supabase/proposed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WITH_PROPOSED=0
[[ "${1:-}" == "--proposed" ]] && WITH_PROPOSED=1
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ ! -x "$PGBIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Install PostgreSQL 15+ or set PGBIN." >&2
  exit 1
fi

RUN=()
if [[ "$(id -u)" == "0" ]]; then RUN=(runuser -u postgres --); fi
WORK="$(mktemp -d)"
chmod 777 "$WORK"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

migrations() {
  ls "$ROOT"/supabase/migrations/*.sql
  if [[ $WITH_PROPOSED == 1 ]]; then ls "$ROOT"/supabase/proposed/2*.sql 2>/dev/null | grep -v '\.down\.sql$' || true; fi
}
apply_and_test() {
  for m in $(migrations); do echo "applying $(basename "$m")"; "${PSQL[@]}" -f "$m"; done
  "${PSQL[@]}" -f "$ROOT/supabase/tests/support/99_service_role_grants.sql"
  "${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
  "${PSQL[@]}" -f "$ROOT/supabase/tests/rls.test.sql"
  if [[ $WITH_PROPOSED == 1 ]]; then "${PSQL[@]}" -f "$ROOT/supabase/proposed/rls_authoring.test.sql"; fi
}

"${PSQL[@]}" -f "$ROOT/supabase/tests/support/00_supabase_shim.sql"
apply_and_test

echo "checking rollback (newest first), then re-apply and re-test"
downs=$(ls "$ROOT"/supabase/rollback/*.down.sql)
if [[ $WITH_PROPOSED == 1 ]]; then downs="$downs $(ls "$ROOT"/supabase/proposed/*.down.sql 2>/dev/null || true)"; fi
for d in $(printf '%s\n' $downs | awk -F/ '{print $NF" "$0}' | sort -r | cut -d' ' -f2); do
  echo "rolling back $(basename "$d")"
  "${PSQL[@]}" -f "$d"
done
apply_and_test
echo "rollback, re-apply and re-test OK"
