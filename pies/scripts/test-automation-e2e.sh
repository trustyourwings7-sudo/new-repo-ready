#!/usr/bin/env bash
# Local end-to-end test of the automation boundary:
#   signed HTTP request -> Next.js production server -> postgres login as pies_automation -> automation_execute
# Uses a throwaway local Postgres. Requires `pnpm build` first. Never touches Supabase or n8n.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pies-e2e.XXXXXX")"
PGPORT_E2E="${PIES_E2E_PG_PORT:-54331}"
APP_PORT="${PIES_E2E_APP_PORT:-3131}"
APP_PID=""
cleanup() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  id pies_pg >/dev/null 2>&1 || useradd -r -M pies_pg
  chown -R pies_pg "$WORK"; chmod 755 "$WORK"
  RUN_AS=(runuser -u pies_pg --)
fi
"${RUN_AS[@]}" initdb -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$WORK/data" -o "-p $PGPORT_E2E -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/log" start -w >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PGPORT_E2E" -U postgres -d postgres -v ON_ERROR_STOP=1 -qtAX)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done

USER_ID="aaaaaaaa-e2e0-0000-0000-00000000000a"
INT_ID="33333333-0000-4000-8000-000000000001"
SECRET="e2e-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
"${PSQL[@]}" <<SQL
alter role pies_automation login password 'e2e-only-password';
insert into auth.users (id, email) values ('$USER_ID', 'owner@example.test');
insert into public.automation_integrations (id, user_id, name, enabled, allowed_agents)
values ('$INT_ID', '$USER_ID', 'n8n-e2e', true, '{discovery}');
SQL

cd "$ROOT"
# NEXT_PUBLIC_SUPABASE_URL points at a dead port: proves /api/automation bypasses the session proxy.
NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:9" NEXT_PUBLIC_SUPABASE_ANON_KEY="e2e-anon" \
PIES_AUTOMATION_SECRET="$SECRET" PIES_AUTOMATION_INTEGRATION_ID="$INT_ID" \
PIES_AUTOMATION_DATABASE_URL="postgres://pies_automation:e2e-only-password@127.0.0.1:$PGPORT_E2E/postgres" \
  node_modules/.bin/next start -p "$APP_PORT" > "$WORK/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/api/automation/v1" && break; sleep 0.5; done

E2E_URL="http://127.0.0.1:$APP_PORT/api/automation/v1" E2E_SECRET="$SECRET" E2E_INT="$INT_ID" node "$ROOT/scripts/e2e-automation-client.mjs"

# Verify database effects directly.
runs=$("${PSQL[@]}" -c "select count(*) from public.agent_runs where user_id='$USER_ID'")
opps=$("${PSQL[@]}" -c "select count(*) from public.opportunities where user_id='$USER_ID'")
audits=$("${PSQL[@]}" -c "select count(*) from public.audit_logs where user_id='$USER_ID' and action like 'automation:%'")
[ "$runs" = "1" ] || { echo "ASSERTION FAILED: expected 1 run, got $runs" >&2; exit 1; }
[ "$opps" = "1" ] || { echo "ASSERTION FAILED: expected 1 opportunity, got $opps" >&2; exit 1; }
[ "$audits" -ge 3 ] || { echo "ASSERTION FAILED: expected >= 3 audit rows, got $audits" >&2; exit 1; }
if grep -q "$SECRET" "$WORK/app.log"; then echo "ASSERTION FAILED: secret appeared in server log" >&2; exit 1; fi
echo "database: $runs run, $opps opportunity, $audits automation audit rows; secret absent from server log"
echo "automation e2e passed"
