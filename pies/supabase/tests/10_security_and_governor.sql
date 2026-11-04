-- PIES database test suite. Every block raises on failure (ON_ERROR_STOP=1).
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''

insert into auth.users (id, email) values (:A, 'a@example.test'), (:B, 'b@example.test');

-- ---------------------------------------------------------------- RLS isolation
select pies_test.as_user(:A);
insert into public.opportunities (user_id, title, category, source_url, dedupe_key)
values (:A, 'Test scholarship', 'scholarship', 'https://example.org/s', 'k1');
select pies_test.assert((select count(*) from public.opportunities) = 1, 'A sees own row');
select pies_test.as_user(:B);
select pies_test.assert((select count(*) from public.opportunities) = 0, 'B cannot see A rows');
update public.opportunities set title = 'hijacked';
do $$ begin
  begin
    insert into public.opportunities (user_id, title, category, source_url, dedupe_key)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', 'other', 'https://x.org', 'k2');
    raise exception 'ASSERTION FAILED: B inserted a row owned by A';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.reset_actor();
select pies_test.assert((select title from public.opportunities where dedupe_key = 'k1') = 'Test scholarship', 'B update had no effect');
select pies_test.as_anon();
do $$ begin
  begin
    perform 1 from public.opportunities;
    raise exception 'ASSERTION FAILED: anon read opportunities';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.reset_actor();

-- ------------------------------------------------------------ duplicate prevention
select pies_test.as_user(:A);
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
  exception when check_violation or insufficient_privilege then null;
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
select pies_test.assert((public.initialize_profile() ->> 'profile_entries_inserted')::int = 7, 'profile seeded');
select pies_test.assert((public.initialize_profile() ->> 'profile_entries_inserted')::int = 0, 'profile seed idempotent');
select pies_test.assert((select count(*) from public.profile_entries where verification_status <> 'user_asserted') = 0, 'seed facts marked user_asserted');
select pies_test.assert((select paid_operations_enabled from public.user_preferences) = false, 'paid ops default OFF');

-- ------------------------------------------------------------ budget governor
-- Paid-call budget RPCs are reserved for the automation role (server-side proxy).
do $$ begin
  begin
    perform public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-browser');
    raise exception 'ASSERTION FAILED: browser session reserved budget';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Without an enabled integration, the automation role cannot act for the user.
reset role;
set session authorization pies_automation;
do $$ begin
  begin
    perform public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-noint', null, 'aaaaaaaa-0000-0000-0000-00000000000a');
    raise exception 'ASSERTION FAILED: automation acted without integration';
  exception when insufficient_privilege then null;
  end;
end $$;
reset session authorization;
select pies_test.as_user(:A);
insert into public.automation_integrations (user_id, name, enabled, allowed_agents) values (:A, 'n8n', true, '{discovery,outreach,executive_coordinator}');

reset role;
set session authorization pies_automation;
select pies_test.assert(public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-0001', null, :A) ->> 'reason' = 'paid_operations_disabled', 'blocked while kill switch off');
reset session authorization;
select pies_test.as_user(:A);
update public.user_preferences set paid_operations_enabled = true;
reset role;
set session authorization pies_automation;
select pies_test.assert(public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-0001', null, :A) ->> 'reason' = 'provider_not_enabled', 'blocked for unknown provider');
reset session authorization;
select pies_test.as_user(:A);
insert into public.provider_configs (user_id, provider, category, enabled) values (:A, 'anthropic', 'ai', true);
reset role;
set session authorization pies_automation;
select pies_test.assert(public.reserve_budget('ai', 'anthropic', 'classify', 0.01, 'idem-0001', null, :A) ->> 'reason' = 'provider_pricing_unverified', 'blocked for unverified pricing');
reset session authorization;
select pies_test.as_user(:A);
update public.provider_configs set pricing_verified = true, pricing_source_url = 'https://example.com/pricing', pricing_verified_at = now();
reset role;
set session authorization pies_automation;
select pies_test.assert(public.reserve_budget('search', 'anthropic', 'x', 0.01, 'idem-0000', null, :A) ->> 'reason' = 'provider_category_mismatch', 'category mismatch');

do $$
declare r jsonb; r2 jsonb; a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
begin
  r := public.reserve_budget('ai', 'anthropic', 'classify', 1.00, 'idem-0001', null, a);
  perform pies_test.assert((r ->> 'allowed')::boolean, 'reservation allowed: ' || r::text);
  r2 := public.reserve_budget('ai', 'anthropic', 'classify', 1.00, 'idem-0001', null, a);
  perform pies_test.assert(r2 ->> 'reason' = 'duplicate' and r2 ->> 'usage_id' = r ->> 'usage_id', 'idempotent reservation');
  perform pies_test.assert((public.commit_usage((r ->> 'usage_id')::uuid, 0.80, a) ->> 'ok')::boolean, 'commit ok');
  -- AI category limit is 5.00: 0.80 used, 4.20 left.
  perform pies_test.assert(public.reserve_budget('ai', 'anthropic', 'big', 4.50, 'idem-0002', null, a) ->> 'reason' = 'category_limit_reached', 'category cap enforced');
  r := public.reserve_budget('ai', 'anthropic', 'ok', 4.20, 'idem-0003', null, a);
  perform pies_test.assert((r ->> 'allowed')::boolean, 'exact remaining allowed');
  perform pies_test.assert(public.reserve_budget('ai', 'anthropic', 'one-more', 0.01, 'idem-0003b', null, a) ->> 'reason' = 'category_limit_reached', 'AI budget exhausted');
  perform pies_test.assert((public.release_usage((r ->> 'usage_id')::uuid, a) ->> 'ok')::boolean, 'release ok');
  r := public.reserve_budget('ai', 'anthropic', 'again', 4.20, 'idem-0004', null, a);
  perform pies_test.assert((r ->> 'allowed')::boolean, 'released budget reusable');
end $$;
reset session authorization;
select pies_test.as_user(:A);

-- Raising categories can never push the total over the hard cap.
select pies_test.assert(public.set_category_limit('search', 6.00) ->> 'reason' = 'exceeds_hard_cap', 'category limits bounded by hard cap');
select pies_test.assert((public.set_category_limit('search', 1.00) ->> 'ok')::boolean, 'lower limit accepted');

-- Total monthly cap: lower the user cap to 5.50 (5.00 AI already used/reserved).
update public.user_preferences set monthly_budget_usd = 5.50;
insert into public.provider_configs (user_id, provider, category, enabled, pricing_verified, pricing_source_url, pricing_verified_at)
values (:A, 'brave', 'search', true, true, 'https://example.com/brave', now());
reset role;
set session authorization pies_automation;
select pies_test.assert(public.reserve_budget('search', 'brave', 'q', 0.60, 'idem-0005', null, :A) ->> 'reason' = 'monthly_limit_reached', 'monthly cap enforced');
select pies_test.assert((public.reserve_budget('search', 'brave', 'q', 0.50, 'idem-0006', null, :A) ->> 'allowed')::boolean, 'within monthly cap');
reset session authorization;
select pies_test.as_user(:A);
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
select pies_test.assert((select max(limit_usd) from public.budgets) <= 5, 'direct budget update ignored');
delete from public.usage_records;
select pies_test.assert((select count(*) from public.usage_records) > 0, 'direct usage delete ignored');
select pies_test.assert((public.budget_summary() ->> 'hard_cap_usd')::numeric = 10, 'summary reports hard cap');

-- Expired reservations stop counting.
select pies_test.reset_actor();
update public.usage_records set expires_at = now() - interval '1 minute' where idempotency_key = 'idem-0004';
select pies_test.as_user(:A);
update public.user_preferences set monthly_budget_usd = 10;
reset role;
set session authorization pies_automation;
select pies_test.assert((public.reserve_budget('ai', 'anthropic', 'after-expiry', 4.00, 'idem-0007', null, :A) ->> 'allowed')::boolean, 'expired reservation released capacity');
-- Cross-user: automation cannot act for B (no integration for B).
do $$ begin
  begin
    perform public.reserve_budget('ai', 'anthropic', 'x', 0.01, 'idem-xuser', null, 'bbbbbbbb-0000-0000-0000-00000000000b');
    raise exception 'ASSERTION FAILED: cross-user reservation accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset session authorization;
select pies_test.as_user(:A);

-- ------------------------------------------------------------ approvals
select pies_test.as_service();
select set_config('pies.test_approval', public.request_approval('outreach', 'send_email', 4::smallint, 'Send intro to X',
  'outreach', 'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A)::text, false);
do $$ begin
  begin
    perform public.decide_approval(current_setting('pies.test_approval')::uuid, true);
    raise exception 'ASSERTION FAILED: service role decided an approval';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'pending approval cannot be consumed');
select pies_test.as_user(:A);
select pies_test.assert((select count(*) from public.notifications where kind = 'approval_needed') = 1, 'approval notification created');
select pies_test.assert((public.decide_approval(current_setting('pies.test_approval')::uuid, true) ->> 'ok')::boolean, 'user approves');
select pies_test.as_service();
select pies_test.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'submit_application',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'approval bound to action');
select pies_test.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'tampered', :A) ->> 'ok')::boolean, 'approval bound to content hash');
select pies_test.assert((public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'approval consumed once');
select pies_test.assert(not (public.consume_approval(current_setting('pies.test_approval')::uuid, 'send_email',
  'cccccccc-0000-0000-0000-00000000000c', 'hash1', :A) ->> 'ok')::boolean, 'approval not reusable');

-- ------------------------------------------------------------ audit log
select public.write_audit_log('agent', 'discovery', 'fetch_source', 1::smallint, 'allowed', 'success', p_user_id => :A);
select pies_test.as_user(:A);
do $$ begin
  begin
    perform public.write_audit_log('agent', 'discovery', 'forged', 1::smallint, 'allowed', 'success');
    raise exception 'ASSERTION FAILED: user forged an agent audit entry';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.reset_actor();
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
select pies_test.assert((select count(*) from public.audit_logs) = 0 and (select count(*) from public.opportunities) = 0, 'user deletion cascades');

\echo 'all database assertions passed'
