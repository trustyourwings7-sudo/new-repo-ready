#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres and runs the SQL test suite.
# Requires PostgreSQL 15+ server binaries (initdb/pg_ctl). Never touches a real Supabase project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pies-db.XXXXXX")"
PORT="${PIES_TEST_PG_PORT:-54329}"
cleanup() { pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  id pies_pg >/dev/null 2>&1 || useradd -r -M pies_pg
  chown -R pies_pg "$WORK"; chmod 755 "$WORK"
  RUN_AS=(runuser -u pies_pg --)
fi
"${RUN_AS[@]}" initdb -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start -w >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -t -A)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "apply  $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  echo "test   $(basename "$f")"
  if ! out="$("${PSQL[@]}" -f "$f" 2>&1)"; then
    printf '%s\n' "$out" | grep -v '^$' >&2
    echo "FAILED: $(basename "$f")" >&2
    exit 1
  fi
  printf '%s\n' "$out" | grep -E 'passed|NOTICE' || true
done
echo "database tests passed"
