#!/usr/bin/env bash
# Runs the database tests without Docker: starts a throwaway Postgres in a temp folder, applies
# the migrations and seed, runs supabase/tests/*.sql (pgTAP), then deletes everything.
# Needs a local Postgres install (Postgres.app or Homebrew), git and make. Your own databases
# are not touched. With Docker, `npx supabase db start && npx supabase test db` does the same
# against the real Supabase stack (that is what CI runs).
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="$(pg_config --bindir 2>/dev/null || true)"
[ -x "$BIN/initdb" ] || BIN="/Applications/Postgres.app/Contents/Versions/latest/bin"
[ -x "$BIN/initdb" ] || { echo "Postgres not found (need initdb, pg_ctl, psql)." >&2; exit 1; }

# pgTAP, built once into supabase/.temp (git-ignored). Only the SQL file is used; nothing is installed.
PGTAP_DIR="supabase/.temp/pgtap"
if [ ! -f "$PGTAP_DIR/sql/pgtap.sql" ]; then
  echo "Fetching pgTAP..."
  rm -rf "$PGTAP_DIR"
  git clone --quiet --depth 1 --branch v1.3.3 https://github.com/theory/pgtap.git "$PGTAP_DIR"
  make -s -C "$PGTAP_DIR" PG_CONFIG="$BIN/pg_config" sql/pgtap.sql >/dev/null
fi

WORK="$(mktemp -d)"
cleanup() {
  "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
# Unix socket only, inside the temp folder: no port is opened.
"$BIN/pg_ctl" -D "$WORK/data" -l "$WORK/log" -w -o "-c listen_addresses='' -k '$WORK'" start >/dev/null
export PGHOST="$WORK" PGUSER=postgres PGDATABASE=postgres
run() { "$BIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

run -f scripts/db-test-shim.sql
PGOPTIONS="-c search_path=extensions" run -f "$PGTAP_DIR/sql/pgtap.sql" >/dev/null
run -c 'alter database postgres set search_path = "$user", public, extensions'

for f in supabase/migrations/*.sql; do echo "migrate  $f"; run -f "$f"; done
for f in supabase/seed/*.sql; do echo "seed     $f"; run -f "$f"; done
for f in supabase/seed/*.sql; do echo "re-seed  $f"; run -f "$f" 2>/dev/null; done   # must be safe to repeat

status=0
for f in supabase/tests/*.sql; do
  echo
  echo "== $f"
  if out="$(run -At -f "$f" 2>&1)"; then
    if grep -Eq '^(not ok|# Looks like you)' <<<"$out"; then
      grep -Ev '^ok ' <<<"$out"
      status=1
    else
      echo "ok: $(grep -c '^ok ' <<<"$out") tests passed"
    fi
  else
    echo "$out" | tail -20
    status=1
  fi
done
echo
[ "$status" -eq 0 ] && echo "All database tests passed." || echo "Database tests FAILED."
exit "$status"
