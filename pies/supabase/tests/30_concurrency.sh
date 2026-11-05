#!/usr/bin/env bash
# Parallel attack tests: many simultaneous connections as the automation role.
# Called by scripts/test-db.sh with PGHOST/PGPORT pointing at the throwaway cluster.
set -euo pipefail
SU=(psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtAX)
AU=(psql -U pies_automation -d postgres -v ON_ERROR_STOP=1 -qtAX)
E='eeeeeeee-1111-0000-0000-00000000000e'
INT='22222222-0000-0000-0000-000000000001'

fail() { echo "ASSERTION FAILED: $*" >&2; exit 1; }

# Test-only: allow the role to log in (trust auth on the throwaway cluster).
"${SU[@]}" -c "alter role pies_automation login"
"${SU[@]}" <<SQL
insert into auth.users (id, email) values ('$E', 'e@example.test');
insert into public.user_preferences (user_id, paid_operations_enabled) values ('$E', true);
insert into public.provider_configs (user_id, provider, category, enabled, pricing_verified, pricing_source_url, pricing_verified_at)
values ('$E', 'anthropic', 'ai', true, true, 'https://example.com/pricing', now());
insert into public.automation_integrations (id, user_id, name, enabled, allowed_agents, max_requests_per_minute, max_concurrent_runs)
values ('$INT', '$E', 'n8n-par', true, '{discovery}', 120, 5);
-- Pre-create this month's budget rows so the race starts immediately (no accidental serialization).
select public.pies_ensure_budgets('$E', public.pies_current_period());
SQL

# 1) 20 parallel reservations of $0.40 against the $5.00 AI limit: at most 12 may succeed.
pids=()
for i in $(seq 1 20); do
  "${AU[@]}" -c "select public.reserve_budget('ai','anthropic','par',0.40,'par-key-$(printf %04d "$i")',null,'$E') ->> 'allowed'" > "$TMPDIR_PAR/r$i" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
allowed=$(cat "$TMPDIR_PAR"/r* | grep -c '^true$' || true)
total=$("${SU[@]}" -c "select coalesce(sum(estimated_usd),0) from public.usage_records where user_id='$E' and status='reserved'")
[ "$allowed" = "12" ] || fail "expected 12 parallel reservations to succeed, got $allowed"
awk "BEGIN{exit !($total <= 5.0)}" || fail "parallel reservations exceeded AI cap: $total"
echo "parallel budget: $allowed/20 allowed, reserved \$$total (cap \$5.00)"

# 2) 10 parallel deliveries of the SAME request id: exactly one run is created.
pids=()
for i in $(seq 1 10); do
  "${AU[@]}" -c "select public.automation_execute('$INT','dup-run-request-1','discovery','run.start','{\"workflow\":\"dup\"}')" > "$TMPDIR_PAR/d$i" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
runs=$("${SU[@]}" -c "select count(*) from public.agent_runs where user_id='$E' and workflow='dup'")
replays=$(cat "$TMPDIR_PAR"/d* | grep -c '"replayed": true' || true)
[ "$runs" = "1" ] || fail "duplicate deliveries created $runs runs"
[ "$replays" = "9" ] || fail "expected 9 replays, got $replays"
echo "parallel duplicate requests: 1 run created, $replays replays"

# 3) 10 parallel upserts with different request ids but the same dedupe key: one opportunity.
run_id=$("${AU[@]}" -c "select public.automation_execute('$INT','par-run-request-2','discovery','run.start','{\"workflow\":\"par\"}') ->> 'run_id'")
pids=()
for i in $(seq 1 10); do
  "${AU[@]}" -c "select public.automation_execute('$INT','par-opp-req-$i','discovery','opportunity.upsert',
    '{\"run_id\":\"$run_id\",\"title\":\"Same\",\"category\":\"grant\",\"source_url\":\"https://g.example\",\"dedupe_key\":\"same-key-0001\"}')" > "$TMPDIR_PAR/o$i" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
opps=$("${SU[@]}" -c "select count(*) from public.opportunities where user_id='$E' and dedupe_key='same-key-0001'")
[ "$opps" = "1" ] || fail "parallel upserts created $opps opportunities"
echo "parallel upserts: 1 opportunity"

"${SU[@]}" -c "alter role pies_automation nologin"
echo "concurrency assertions passed"
