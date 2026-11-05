#!/usr/bin/env bash
# End-to-end test of the research runner against REAL local Postgres (all migrations)
# and a local mock of Exa/Firecrawl. Proves the n8n replacement works through the
# same pies_automation boundary and the database budget governor.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pies-pipe.XXXXXX")"
PGPORT_P="${PIES_PIPE_PG_PORT:-54332}"
MOCK_PORT="${PIES_PIPE_MOCK_PORT:-54399}"
MOCK_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  "${RUN_AS[@]}" pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
RUN_AS=()
trap cleanup EXIT
fail() { echo "ASSERTION FAILED: $*" >&2; [ -f "$WORK/report.md" ] && sed -n "/Failed or skipped/,\$p" "$WORK/report.md" >&2; "${PSQL[@]}" -c "select agent, status, left(coalesce(error,''),120), items_processed, max_tasks, timeout_seconds from public.agent_runs order by started_at" >&2 2>/dev/null || true; exit 1; }

if [ "$(id -u)" = "0" ]; then
  id pies_pg >/dev/null 2>&1 || useradd -r -M pies_pg
  chown -R pies_pg "$WORK"; chmod 755 "$WORK"
  RUN_AS=(runuser -u pies_pg --)
fi
"${RUN_AS[@]}" initdb -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$WORK/data" -o "-p $PGPORT_P -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/log" start -w >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PGPORT_P" -U postgres -d postgres -v ON_ERROR_STOP=1 -qtAX)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done

USER_ID="aaaaaaaa-0000-4000-8000-0000000000e2"
INT_ID="44444444-0000-4000-8000-000000000001"
"${PSQL[@]}" <<SQL
alter role pies_automation login password 'pipe-only-password';
insert into auth.users (id, email) values ('$USER_ID', 'owner@example.test');
insert into public.user_preferences (user_id) values ('$USER_ID') on conflict (user_id) do nothing;
insert into public.automation_integrations (id, user_id, name, enabled, allowed_agents)
values ('$INT_ID', '$USER_ID', 'pies-research-runner', true, '{discovery}');
-- Seed the owner's projects the way the app does on first sign-in.
select set_config('request.jwt.claims', '{"sub":"$USER_ID","role":"authenticated"}', false) is not null as _ \gset
select public.initialize_projects() is not null as _ \gset
SQL

node "$ROOT/scripts/mock-providers.mjs" "$MOCK_PORT" > "$WORK/mock.log" 2>&1 &
MOCK_PID=$!
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$MOCK_PORT/__count" && break; sleep 0.25; done
count() { curl -s "http://127.0.0.1:$MOCK_PORT/__count"; }

export PIES_PIPELINE_CONFIG_JSON='{"profile":{"name":"Test Owner","nationality":"Rwanda","age":24,"education":"secondary","experienceKeywords":["operations","sales"],"rejectApplicationFees":true,"proofPoints":["Fixture proof point"]},"queries":[{"project":"education-funding","category":"scholarship","query":"international scholarships for Rwandan students","numResults":10,"strategicFit":"primary"}],"caps":{"searches":2,"extractions":10},"officialDomains":["127.0.0.1"]}'
export PIES_AUTOMATION_DATABASE_URL="postgres://pies_automation:pipe-only-password@127.0.0.1:$PGPORT_P/postgres"
export PIES_AUTOMATION_INTEGRATION_ID="$INT_ID" PIES_OWNER_USER_ID="$USER_ID"
export PIES_PROVIDER_BASE_URL_OVERRIDE="http://127.0.0.1:$MOCK_PORT"
export EXA_API_KEY="test-exa-key" FIRECRAWL_API_KEY="test-fc-key" PIES_REPORT_PATH="$WORK/report.md"
RUN() { node --no-warnings "$ROOT/scripts/run-pipeline.ts" > "$WORK/out" 2> "$WORK/err"; echo $?; }

# 1. Safety gate: no live switch -> exit 3, nothing called.
code=$(PIES_LIVE_RESEARCH= RUN || true)
[ "$code" = "3" ] || fail "gate: expected exit 3, got $code: $(cat "$WORK/err")"
[ "$(count)" = '{"exa":0,"firecrawl":0}' ] || fail "gate: providers were called: $(count)"
echo "ok   live switch off -> exit 3, zero provider calls"

export PIES_LIVE_RESEARCH=1 PIES_PRICES_CONFIRMED_ON="$(date -u +%F)"

# 2. Database switch off (paid_operations_enabled=false) -> governor denies, providers untouched.
code=$(RUN || true)
[ "$code" = "4" ] || fail "paid disabled: expected exit 4, got $code: $(cat "$WORK/err") $(cat "$WORK/out")"
[ "$(count)" = '{"exa":0,"firecrawl":0}' ] || fail "paid disabled: providers were called: $(count)"
grep -q '"outcome":"blocked"' "$WORK/out" || fail "paid disabled: expected outcome blocked: $(cat "$WORK/out")"
echo "ok   paid_operations_enabled=false -> governor denies, zero provider calls, outcome blocked"

# 3. Paid on but providers not pricing-verified -> still denied.
"${PSQL[@]}" -c "update public.user_preferences set paid_operations_enabled = true where user_id = '$USER_ID'"
"${PSQL[@]}" -c "insert into public.provider_configs (user_id, provider, category, enabled) values ('$USER_ID','exa','search',true),('$USER_ID','firecrawl','search',true)"
code=$(PIES_AUTOMATION_INTEGRATION_ID="$INT_ID" RUN || true)
[ "$(count)" = '{"exa":0,"firecrawl":0}' ] || fail "unverified pricing: providers were called: $(count)"
echo "ok   provider pricing unverified -> denied, zero provider calls"

# 4. Fully enabled with a per-provider cap -> pipeline runs through the real boundary.
"${PSQL[@]}" -c "update public.provider_configs set pricing_verified = true, pricing_source_url = 'https://example.test/pricing', pricing_verified_at = now(), monthly_cap_usd = case provider when 'exa' then 1.00 else 0.50 end where user_id = '$USER_ID'"
"${PSQL[@]}" -c "delete from public.agent_runs where user_id = '$USER_ID'" 2>/dev/null || true
code=$(RUN || true)
[ "$code" = "0" ] || fail "full run: expected exit 0, got $code: $(cat "$WORK/err") $(cat "$WORK/out")"
grep -q '"persisted":2' "$WORK/out" || fail "full run: expected 2 persisted: $(cat "$WORK/out")"
grep -q '"outcome":"productive"' "$WORK/out" || fail "full run: expected outcome productive: $(cat "$WORK/out")"
grep -q '"sourcesOfficial":2' "$WORK/out" || fail "full run: expected 2 official sources (allowlisted host; one saved, one rejected by the degree gate): $(cat "$WORK/out")"
grep -q '"sourcesUnverified":1' "$WORK/out" || fail "full run: injected page must be unverified: $(cat "$WORK/out")"
grep -q '"rejected":1' "$WORK/out" || fail "full run: expected 1 rejected (masters-only gate): $(cat "$WORK/out")"
grep -q '"duplicates":1' "$WORK/out" || fail "full run: expected 1 duplicate: $(cat "$WORK/out")"
q() { "${PSQL[@]}" -c "$1"; }
[ "$(q "select count(*) from public.opportunities where user_id='$USER_ID'")" = "2" ] || fail "expected 2 opportunities"
[ "$(q "select count(*) from public.opportunities where user_id='$USER_ID' and qualification_score is null and eligibility_status='unknown'")" = "2" ] || fail "automation must not set score or eligibility"
[ "$(q "select string_agg(source_type, ',' order by source_type) from public.opportunity_sources where user_id='$USER_ID'")" = "official,search_result" ] || fail "source types must reflect official vs unverified"
[ "$(q "select count(*) from public.activities where user_id='$USER_ID' and title like 'Review:%' and description like 'REVIEW ONLY.%'")" = "2" ] || fail "review tasks must be marked review-only"
[ "$(q "select count(*) from public.opportunity_sources where user_id='$USER_ID' and evidence_excerpt like 'verification:%'")" = "2" ] || fail "expected 2 evidenced sources"
[ "$(q "select count(*) from public.activities where user_id='$USER_ID' and kind='task' and title like 'Review:%'")" = "2" ] || fail "expected 2 review tasks"
# Every run reports, including the denied ones in steps 2-3 (blocked runs must be visible).
[ "$(q "select count(*) from public.activities where user_id='$USER_ID' and kind='task' and title like 'PIES research report%'")" = "3" ] || fail "expected one report task per run (3)"
[ "$(q "select count(*) from public.activities where user_id='$USER_ID' and description like '%To: grab@%'")" = "0" ] || fail "injected address became a draft recipient"
[ "$(q "select count(*) from public.usage_records where user_id='$USER_ID' and status='committed'")" -ge 4 ] || fail "expected committed usage rows"
[ "$(q "select count(*) from public.usage_records where user_id='$USER_ID' and status='reserved'")" = "0" ] || fail "reservations left open"
[ "$(q "select status from public.agent_runs where user_id='$USER_ID' order by started_at desc limit 1")" = "succeeded" ] || fail "run not closed as succeeded"
spent=$(q "select coalesce(sum(actual_usd),0) from public.usage_records where user_id='$USER_ID'")
before=$(count)
echo "ok   full run -> 2 saved, 1 rejected, 1 duplicate, robots skip honored, \$$spent committed, run closed"

# 5. Same-day re-run: idempotency keys stop any repeat spend.
code=$(RUN || true)
[ "$(count)" = "$before" ] || fail "re-run called providers again: $before -> $(count)"
echo "ok   same-day re-run -> zero new provider calls (idempotent)"

# 6. Secrets never reach output.
if grep -qE 'test-exa-key|test-fc-key|pipe-only-password' "$WORK/out" "$WORK/err"; then fail "secret appeared in runner output"; fi
echo "ok   no secret in runner output"
echo "pipeline e2e passed"
