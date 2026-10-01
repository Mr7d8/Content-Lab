#!/usr/bin/env bash
# Applies the Supabase stand-ins, every migration, then the behaviour checks.
# DATABASE_URL must point to a plain, EMPTY Postgres 15+ database you can throw away.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Set DATABASE_URL to an empty throwaway Postgres database}"
psql_q() { psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 "$@"; }
psql_q -f supabase/tests/stubs.sql 2>&1 | grep -v -E 'wal_level|HINT' || true
for f in supabase/migrations/*.sql; do
  psql_q -f "$f"
  echo "applied $(basename "$f")"
done
out=$(psql_q -f supabase/tests/checks.sql 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -oE '(PASS|FAIL).*'
if echo "$out" | grep -q FAIL; then exit 1; fi
