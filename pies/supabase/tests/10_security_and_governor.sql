-- PIES database test suite. Every block raises on failure (ON_ERROR_STOP=1).
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''

insert into auth.users (id, email) values (:A, 'a@example.test'), (:B, 'b@example.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  execute 'set role service_role';
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
end $$;
create or replace function pg_temp.reset_actor() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

-- ---------------------------------------------------------------- RLS isolation
select pg_temp.as_user(:A);
insert into public.opportunities (user_id, title, category, source_url, dedupe_key)
values (:A, 'Test scholarship', 'scholarship', 'https://example.org/s', 'k1');
select pg_temp.assert((select count(*) from public.opportunities) = 1, 'A sees own row');
select pg_temp.as_user(:B);
select pg_temp.assert((select count(*) from public.opportunities) = 0, 'B cannot see A rows');
update public.opportunities set title = 'hijacked';
do $$ begin
  begin
    insert into public.opportunities (user_id, title, category, source_url, dedupe_key)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', 'other', 'https://x.org', 'k2');
    raise exception 'ASSERTION FAILED: B inserted a row owned by A';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset_actor();
select pg_temp.assert((select title from public.opportunities where dedupe_key = 'k1') = 'Test scholarship', 'B update had no effect');
select pg_temp.as_anon();
do $$ begin
  begin
    perform 1 from public.opportunities;
    raise exception 'ASSERTION FAILED: anon read opportunities';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset_actor();

-- ------------------------------------------------------------ duplicate prevention
select pg_temp.as_user(:A);
do $$ begin
  begin
    insert into public.opportunities (user_id, title, category, source_url, dedupe_key)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'dup', 'scholarship', 'https://example.org/s', 'k1');
    raise exception 'ASSERTION FAILED: duplicate dedupe_key accepted';
  exception when unique_violation then null;
  end;
end $$;

-- ------------------------------------------------------------ integrity constraints
do $$ begin
  begin
    insert into public.contacts (user_id, full_name, source_url, public_email)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Jane', 'https://org.example/team', 'jane@org.example');
    raise exception 'ASSERTION FAILED: email without source accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.opportunities (user_id, title, category, source_url, dedupe_key, eligibility_status, status)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', 'employment', 'https://x.org', 'k3', 'ineligible', 'qualified');
    raise exception 'ASSERTION FAILED: ineligible opportunity marked qualified';
  exception when check_violation then null;
  end;
  begin
    insert into public.outreach (user_id, status) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'sent');
    raise exception 'ASSERTION FAILED: outreach marked sent without approval';
  exception when check_violation then null;
  end;
  begin
    insert into public.agent_tasks (user_id, agent, action, depth) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'discovery', 'x', 4);
    raise exception 'ASSERTION FAILED: task depth 4 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.agent_runs (user_id, agent, trigger) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'rogue_agent', 'manual');
    raise exception 'ASSERTION FAILED: unknown agent accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.client_pipeline (user_id, organization_id, segment, estimated_deal_value, currency)
    select 'aaaaaaaa-0000-0000-0000-00000000000a', null, 'clinic', 500, 'USD';
    raise exception 'ASSERTION FAILED: deal value without assumptions accepted';
  exception when check_violation or not_null_violation then null;
  end;
end $$;

-- ------------------------------------------------------------ profile initialization
select pg_temp.assert((public.initialize_profile() ->> 'profile_entries_inserted')::int = 7, 'profile seeded');
select pg_temp.assert((public.initialize_profile() ->> 'profile_entries_inserted')::int = 0, 'profile seed idempotent');
select pg_temp.assert((select count(*) from public.profile_entries where verification_status <> 'user_asserted') = 0, 'seed facts marked user_asserted');
select pg_temp.assert((select paid_operations_enabled from public.user_preferences) = false, 'paid ops default OFF');

-- ------------------------------------------------------------ budget governor
select pg_temp.assert(public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-0001') ->> 'reason' = 'paid_operations_disabled', 'blocked while kill switch off');
update public.user_preferences set paid_operations_enabled = true;
select pg_temp.assert(public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-0001') ->> 'reason' = 'provider_not_enabled', 'blocked for unknown provider');
insert into public.provider_configs (user_id, provider, category, enabled) values (:A, 'anthropic', 'ai', true);
select pg_temp.assert(public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-0001') ->> 'reason' = 'provider_pricing_unverified', 'blocked for unverified pricing');
update public.provider_configs set pricing_verified = true, pricing_source_url = 'https://example.com/pricing', pricing_verified_at = now();
select pg_temp.assert(public.reserve_budget('search', 'anthropic', 'x', 0.01, 'idem-0000') ->> 'reason' = 'provider_category_mismatch', 'category mismatch');

do $$
declare r jsonb; r2 jsonb;
begin
  r := public.reserve_budget('ai', 'anthropic', 'classify', 1.00, 'idem-0001');
  perform pg_temp.assert((r ->> 'allowed')::boolean, 'reservation allowed: ' || r::text);
  r2 := public.reserve_budget('ai', 'anthropic', 'classify', 1.00, 'idem-0001');
  perform pg_temp.assert(r2 ->> 'reason' = 'duplicate' and r2 ->> 'usage_id' = r ->> 'usage_id', 'idempotent reservation');
  perform pg_temp.assert((public.commit_usage((r ->> 'usage_id')::uuid, 0.80) ->> 'ok')::boolean, 'commit ok');
  -- AI category limit is 5.00: 0.80 used, 4.20 left.
  perform pg_temp.assert(public.reserve_budget('ai', 'anthropic', 'big', 4.50, 'idem-0002') ->> 'reason' = 'category_limit_reached', 'category cap enforced');
  r := public.reserve_budget('ai', 'anthropic', 'ok', 4.20, 'idem-0003');
  perform pg_temp.assert((r ->> 'allowed')::boolean, 'exact remaining allowed');
  perform pg_temp.assert((public.release_usage((r ->> 'usage_id')::uuid) ->> 'ok')::boolean, 'release ok');
  r := public.reserve_budget('ai', 'anthropic', 'again', 4.20, 'idem-0004');
  perform pg_temp.assert((r ->> 'allowed')::boolean, 'released budget reusable');
end $$;

-- Raising categories can never push the total over the hard cap.
select pg_temp.assert(public.set_category_limit('search', 6.00) ->> 'reason' = 'exceeds_hard_cap', 'category limits bounded by hard cap');
select pg_temp.assert((public.set_category_limit('search', 1.00) ->> 'ok')::boolean, 'lower limit accepted');

-- Total monthly cap: lower the user cap to 5.50 (5.00 AI already used/reserved).
update public.user_preferences set monthly_budget_usd = 5.50;
insert into public.provider_configs (user_id, provider, category, enabled, pricing_verified, pricing_source_url, pricing_verified_at)
values (:A, 'brave', 'search', true, true, 'https://example.com/brave', now());
select pg_temp.assert(public.reserve_budget('search', 'brave', 'q', 0.60, 'idem-0005') ->> 'reason' = 'monthly_limit_reached', 'monthly cap enforced');
select pg_temp.assert((public.reserve_budget('search', 'brave', 'q', 0.50, 'idem-0006') ->> 'allowed')::boolean, 'within monthly cap');
do $$ begin
  begin
    update public.user_preferences set monthly_budget_usd = 10.01;
    raise exception 'ASSERTION FAILED: monthly budget above $10 accepted';
  exception when check_violation then null;
  end;
end $$;

-- Users cannot write governed tables directly.
do $$ begin
  begin
    insert into public.usage_records (user_id, period_month, category, provider, operation, estimated_usd, idempotency_key)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', date_trunc('month', now())::date, 'ai', 'x', 'x', 0.01, 'direct-insert');
    raise exception 'ASSERTION FAILED: direct usage insert accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.budgets set limit_usd = 10;
select pg_temp.assert((select max(limit_usd) from public.budgets) <= 5, 'direct budget update ignored');
delete from public.usage_records;
select pg_temp.assert((select count(*) from public.usage_records) > 0, 'direct usage delete ignored');
select pg_temp.assert((public.budget_summary() ->> 'hard_cap_usd')::numeric = 10, 'summary reports hard cap');

-- Expired reservations stop counting.
select pg_temp.reset_actor();
update public.usage_records set expires_at = now() - interval '1 minute' where idempotency_key = 'idem-0004';
select pg_temp.as_user(:A);
update public.user_preferences set monthly_budget_usd = 10;
select pg_temp.assert((public.reserve_budget('ai', 'anthropic', 'after-expiry', 4.00, 'idem-0007') ->> 'allowed')::boolean, 'expired reservation released capacity');

-- Cross-user calls are refused.
do $$ begin
  begin
    perform public.reserve_budget('ai', 'anthropic', 'x', 0.01, 'idem-xuser', null, 'bbbbbbbb-0000-0000-0000-00000000000b');
    raise exception 'ASSERTION FAILED: cross-user reservation accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------------------------ approvals
select pg_temp.as_service();
select set_config('pies.test_approval', public.request_approval('outreach', 'send_email', 4::smallint, 'Send intro to X',
  'outreach', 'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A)::text, false);
do $$ begin
  begin
    perform public.decide_approval(current_setting('pies.test_approval')::uuid, true);
    raise exception 'ASSERTION FAILED: service role decided an approval';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'pending approval cannot be consumed');
select pg_temp.as_user(:A);
select pg_temp.assert((select count(*) from public.notifications where kind = 'approval_needed') = 1, 'approval notification created');
select pg_temp.assert((public.decide_approval(current_setting('pies.test_approval')::uuid, true) ->> 'ok')::boolean, 'user approves');
select pg_temp.as_service();
select pg_temp.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'submit_application',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'approval bound to action');
select pg_temp.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'tampered', :A) ->> 'ok')::boolean, 'approval bound to content hash');
select pg_temp.assert((public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'approval consumed once');
select pg_temp.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'approval not reusable');

-- ------------------------------------------------------------ audit log
select public.write_audit_log('agent', 'discovery', 'fetch_source', 1::smallint, 'allowed', 'success', p_user_id => :A);
select pg_temp.as_user(:A);
do $$ begin
  begin
    perform public.write_audit_log('agent', 'discovery', 'forged', 1::smallint, 'allowed', 'success');
    raise exception 'ASSERTION FAILED: user forged an agent audit entry';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset_actor();
do $$ begin
  begin
    update public.audit_logs set action = 'tampered';
    raise exception 'ASSERTION FAILED: audit log updated';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from public.audit_logs;
    raise exception 'ASSERTION FAILED: audit log deleted';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------------ account deletion cascades
delete from auth.users where id = :B;
delete from auth.users where id = :A;
select pg_temp.assert((select count(*) from public.audit_logs) = 0 and (select count(*) from public.opportunities) = 0, 'user deletion cascades');

\echo 'all database assertions passed'
