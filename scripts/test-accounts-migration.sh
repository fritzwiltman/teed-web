#!/usr/bin/env bash
# Checks what migration 0008 (accounts) does to data that was already there: applies the
# migrations before it, loads the old Southern Pines seed plus production-shaped rows
# (scripts/migration-test/before.sql), applies 0008, then runs scripts/migration-test/after.sql.
# Same throwaway Postgres as scripts/test-db-local.sh; nothing of yours is touched.
set -euo pipefail
cd "$(dirname "$0")/.."

OLD=a118d6c   # the last commit before 0008: its seed is in the old shape
BIN="$(pg_config --bindir 2>/dev/null || true)"
[ -x "$BIN/initdb" ] || BIN="/Applications/Postgres.app/Contents/Versions/latest/bin"
[ -x "$BIN/initdb" ] || { echo "Postgres not found (need initdb, pg_ctl, psql)." >&2; exit 1; }
PGTAP="supabase/.temp/pgtap/sql/pgtap.sql"
[ -f "$PGTAP" ] || { echo "Run scripts/test-db-local.sh once first (it fetches pgTAP)." >&2; exit 1; }

WORK="$(mktemp -d)"
cleanup() { "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$WORK/data" -l "$WORK/log" -w -o "-c listen_addresses='' -k '$WORK'" start >/dev/null
export PGHOST="$WORK" PGUSER=postgres PGDATABASE=postgres
run() { "$BIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

run -f scripts/db-test-shim.sql 2>/dev/null
PGOPTIONS="-c search_path=extensions" run -f "$PGTAP" >/dev/null
run -c 'alter database postgres set search_path = "$user", public, extensions'

for f in supabase/migrations/000[1-7]_*.sql; do run -f "$f" 2>/dev/null; done
git show "$OLD:supabase/seed/southern-pines-2026.sql" | run
run -f scripts/migration-test/before.sql
run -f supabase/migrations/0008_accounts.sql 2>/dev/null

out="$(run -At -f scripts/migration-test/after.sql 2>&1)" || { echo "$out" | tail -20; exit 1; }
if grep -Eq '^(not ok|# Looks like you)' <<<"$out"; then grep -Ev '^ok ' <<<"$out"; exit 1; fi
echo "ok: $(grep -c '^ok ' <<<"$out") migration checks passed"
