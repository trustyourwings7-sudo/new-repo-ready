-- Phase 1.5: automation boundary, privilege allowlist, tenant isolation, approvals.
\set C '''cccccccc-0000-0000-0000-00000000000c'''
\set D '''dddddddd-0000-0000-0000-0000000000dd'''
\set INT '''11111111-0000-0000-0000-000000000001'''
\set INT_SLOW '''11111111-0000-0000-0000-000000000002'''
\set INT_D '''11111111-0000-0000-0000-000000000003'''

insert into auth.users (id, email) values (:C, 'c@example.test'), (:D, 'd@example.test');

-- Helper: call automation_execute as the restricted role and return the result.
create or replace function pies_test.ax(p_int uuid, p_req text, p_agent text, p_op text, p_payload jsonb)
returns jsonb language sql as $$ select public.automation_execute(p_int, p_req, p_agent, p_op, p_payload) $$;
grant execute on function pies_test.ax(uuid, text, text, text, jsonb) to pies_automation;

-- ------------------------------------------------------------ owner setup
select pies_test.as_user(:C);
select pies_test.assert((public.initialize_profile() ->> 'ok')::boolean, 'C profile');
select pies_test.assert((public.initialize_projects() ->> 'projects_inserted')::int = 6, 'six starting projects');
select pies_test.assert((public.initialize_projects() ->> 'projects_inserted')::int = 0, 'projects idempotent');
insert into public.automation_integrations (id, user_id, name, enabled, allowed_agents)
values (:INT, :C, 'n8n-main', true, '{discovery,outreach}'),
       (:INT_SLOW, :C, 'n8n-slow', true, '{discovery}');
update public.automation_integrations set max_requests_per_minute = 3 where id = :INT_SLOW;
update public.automation_integrations set max_requests_per_minute = 120 where id = :INT;
select pies_test.as_user(:D);
select pies_test.assert((public.initialize_profile() ->> 'ok')::boolean, 'D profile');
insert into public.automation_integrations (id, user_id, name, enabled, allowed_agents)
values (:INT_D, :D, 'n8n-d', false, '{discovery}');
insert into public.organizations (id, user_id, name) values ('eeeeeeee-0000-0000-0000-00000000000d', :D, 'D org');
select pies_test.reset_actor();

-- ------------------------------------------------------------ who may call automation_execute
select pies_test.as_user(:C);
do $$ begin
  begin
    perform public.automation_execute('11111111-0000-0000-0000-000000000001', 'req-browser-1', 'discovery', 'run.start', '{"workflow":"x"}');
    raise exception 'ASSERTION FAILED: browser session called automation_execute';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.as_anon();
do $$ begin
  begin
    perform public.automation_execute('11111111-0000-0000-0000-000000000001', 'req-anon-001', 'discovery', 'run.start', '{"workflow":"x"}');
    raise exception 'ASSERTION FAILED: anon called automation_execute';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.reset_actor();
do $$ begin
  begin
    perform public.automation_execute('11111111-0000-0000-0000-000000000001', 'req-super-01', 'discovery', 'run.start', '{"workflow":"x"}');
    raise exception 'ASSERTION FAILED: non-automation session called automation_execute';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------------------------ the automation role has no raw access
set session authorization pies_automation;
do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'select 1 from public.opportunities limit 1',
    'insert into public.opportunities (user_id, title, category, source_url, dedupe_key) values (''cccccccc-0000-0000-0000-00000000000c'', ''x'', ''other'', ''https://x.org'', ''raw-00001'')',
    'update public.agent_runs set max_tasks = 200',
    'delete from public.audit_logs',
    'select 1 from public.automation_integrations',
    'update public.automation_integrations set enabled = true',
    'insert into public.usage_records (user_id, period_month, category, provider, operation, estimated_usd, idempotency_key) values (''cccccccc-0000-0000-0000-00000000000c'', date_trunc(''month'', now())::date, ''ai'', ''x'', ''x'', 1, ''raw-usage-1'')',
    'update public.user_preferences set paid_operations_enabled = true',
    'update public.provider_configs set pricing_verified = true',
    'select public.budget_summary(''cccccccc-0000-0000-0000-00000000000c'')',
    'select public.set_category_limit(''ai'', 10, ''cccccccc-0000-0000-0000-00000000000c'')',
    'select public.decide_approval(gen_random_uuid(), true)',
    'select public.consume_approval(gen_random_uuid(), ''send_email'', null, null, ''cccccccc-0000-0000-0000-00000000000c'')',
    'select public.request_approval(''outreach'', ''send_email'', 4::smallint, ''x'', null, null, null, ''cccccccc-0000-0000-0000-00000000000c'')',
    'select public.write_audit_log(''agent'', ''discovery'', ''x'', 1::smallint, ''allowed'', ''success'', null, null, null, ''{}''::jsonb, ''cccccccc-0000-0000-0000-00000000000c'')',
    'select public.pies_ensure_budgets(''cccccccc-0000-0000-0000-00000000000c'', date_trunc(''month'', now())::date)',
    'select public.pies_op_opportunity_upsert(''cccccccc-0000-0000-0000-00000000000c'', ''discovery'', ''{}''::jsonb)',
    'select public.initialize_profile()',
    'create table public.evil (id int)'
  ] loop
    begin
      execute stmt;
      raise exception 'ASSERTION FAILED: automation role ran: %', stmt;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- ------------------------------------------------------------ request validation
select pies_test.assert(pies_test.ax('99999999-0000-0000-0000-000000000009', 'req-unknown-int', 'discovery', 'run.start', '{"workflow":"w"}') ->> 'error' = 'integration_not_authorized', 'unknown integration rejected');
select pies_test.assert(pies_test.ax(:INT_D, 'req-disabled-1', 'discovery', 'run.start', '{"workflow":"w"}') ->> 'error' = 'integration_not_authorized', 'disabled integration rejected');
select pies_test.assert(pies_test.ax(:INT, 'bad id!', 'discovery', 'run.start', '{"workflow":"w"}') ->> 'error' = 'invalid_request_id', 'malformed request id rejected');
select pies_test.assert(pies_test.ax(:INT, 'req-array-001', 'discovery', 'run.start', '[1,2]') ->> 'error' = 'invalid_payload', 'non-object payload rejected');
select pies_test.assert(pies_test.ax(:INT, 'req-big-00001', 'discovery', 'run.start', jsonb_build_object('workflow', repeat('x', 40000))) ->> 'error' = 'invalid_payload', 'oversized payload rejected');

-- Operations that must not exist on the agent interface.
do $$
declare op text; r jsonb; i int := 0;
begin
  foreach op in array array['gmail.send', 'gmail.drafts.send', 'email.send', 'outreach.send', 'application.submit',
                             'budget.reserve', 'budget.commit', 'approval.decide', 'approval.consume', 'sql.execute',
                             'provider.enable', 'integration.update', 'payment.create'] loop
    i := i + 1;
    r := pies_test.ax('11111111-0000-0000-0000-000000000001', 'req-forbidden-' || i, 'outreach', op, '{}');
    perform pies_test.assert(r ->> 'error' = 'unknown_operation', 'forbidden op rejected: ' || op || ' -> ' || r::text);
  end loop;
end $$;

select pies_test.assert(pies_test.ax(:INT, 'req-agent-0001', 'root', 'run.start', '{"workflow":"w"}') ->> 'error' = 'unknown_agent', 'unknown agent rejected');
select pies_test.assert(pies_test.ax(:INT, 'req-agent-0002', 'qualification', 'run.start', '{"workflow":"w"}') ->> 'error' = 'agent_not_enabled_for_integration', 'agent not enabled for integration');

-- ------------------------------------------------------------ runs, execution limits, idempotency
select set_config('pies.run', pies_test.ax(:INT, 'req-run-00001', 'discovery', 'run.start', '{"workflow":"wf-a","max_tasks":3,"project":"education-funding"}') ->> 'run_id', false);
select pies_test.assert(current_setting('pies.run') is not null and current_setting('pies.run') <> '', 'run started');
select pies_test.assert(pies_test.ax(:INT, 'req-run-00002', 'discovery', 'run.start', '{"workflow":"wf-b","max_tasks":500}') ->> 'max_tasks' = '50', 'max_tasks clamped to integration ceiling');
select pies_test.assert(pies_test.ax(:INT, 'req-run-00003', 'discovery', 'run.start', '{"workflow":"wf-c"}') ->> 'error' = 'concurrent_run_limit_reached', 'concurrent run limit');

select pies_test.assert(pies_test.ax(:INT, 'req-opp-norun', 'discovery', 'opportunity.upsert',
  '{"title":"T","category":"scholarship","source_url":"https://u.example/s","dedupe_key":"opp-key-0001"}') ->> 'error' = 'missing_field:run_id', 'writes require a run');

select pies_test.assert((pies_test.ax(:INT, 'req-opp-00001', 'discovery', 'opportunity.upsert', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'project', 'education-funding', 'title', 'Scholarship X', 'category', 'scholarship',
  'source_url', 'https://u.example/s', 'dedupe_key', 'opp-key-0001')) ->> 'created')::boolean, 'opportunity created');

-- Exact replay returns the original response and changes nothing.
select pies_test.assert((pies_test.ax(:INT, 'req-opp-00001', 'discovery', 'opportunity.upsert', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'project', 'education-funding', 'title', 'Scholarship X', 'category', 'scholarship',
  'source_url', 'https://u.example/s', 'dedupe_key', 'opp-key-0001')) ->> 'replayed')::boolean, 'duplicate request replayed');
-- Same request id, different content: refused.
select pies_test.assert(pies_test.ax(:INT, 'req-opp-00001', 'discovery', 'opportunity.upsert', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'Changed', 'category', 'scholarship',
  'source_url', 'https://u.example/s', 'dedupe_key', 'opp-key-0001')) ->> 'error' = 'request_id_reused_with_different_content', 'reused request id with new content refused');
-- New request, same dedupe key: updates, no duplicate row.
select pies_test.assert(not (pies_test.ax(:INT, 'req-opp-00002', 'discovery', 'opportunity.upsert', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'Scholarship X (updated)', 'category', 'scholarship',
  'source_url', 'https://u.example/s', 'dedupe_key', 'opp-key-0001')) ->> 'created')::boolean, 'dedupe key upserts');

-- Agents cannot set analysis fields or another owner.
select pies_test.assert(pies_test.ax(:INT, 'req-opp-00003', 'discovery', 'opportunity.upsert', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'T', 'category', 'grant', 'source_url', 'https://u.example/g',
  'dedupe_key', 'opp-key-0002', 'qualification_score', 100)) ->> 'error' = 'unknown_field:qualification_score', 'agent cannot set score');
select pies_test.assert(pies_test.ax(:INT, 'req-opp-00004', 'discovery', 'opportunity.upsert', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'T', 'category', 'grant', 'source_url', 'https://u.example/g',
  'dedupe_key', 'opp-key-0002', 'user_id', 'dddddddd-0000-0000-0000-0000000000dd')) ->> 'error' = 'unknown_field:user_id', 'agent cannot choose the owner');

-- Task budget: max_tasks = 3, two units used (create + update); rejected attempts roll back.
select pies_test.assert((pies_test.ax(:INT, 'req-task-0001', 'discovery', 'task.create', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'Check deadline')) ->> 'ok')::boolean, 'third unit allowed');
select pies_test.assert(pies_test.ax(:INT, 'req-task-0002', 'discovery', 'task.create', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'One too many')) ->> 'error' = 'run_task_limit_reached', 'run task limit enforced');

-- Permission matrix.
select pies_test.assert(pies_test.ax(:INT, 'req-perm-0001', 'outreach', 'opportunity.upsert', '{"run_id":null}') ->> 'error' = 'permission_denied', 'outreach cannot write opportunities');
select pies_test.assert(pies_test.ax(:INT, 'req-perm-0002', 'discovery', 'notification.create', '{}') ->> 'error' = 'permission_denied', 'discovery cannot notify');
select pies_test.assert(pies_test.ax(:INT, 'req-perm-0003', 'discovery', 'approval.request', '{"action":"send_email"}') ->> 'error' = 'permission_denied', 'discovery cannot request send approval');
select pies_test.assert(pies_test.ax(:INT, 'req-perm-0004', 'outreach', 'approval.request', '{"action":"make_payment"}') ->> 'error' = 'permission_denied', 'payments are not approvable');

-- Timeout: an expired run accepts no more work.
reset session authorization;
update public.agent_runs set started_at = now() - interval '2 hours' where id = current_setting('pies.run')::uuid;
set session authorization pies_automation;
select pies_test.assert(pies_test.ax(:INT, 'req-time-0001', 'discovery', 'task.create', jsonb_build_object(
  'run_id', current_setting('pies.run'), 'title', 'late')) ->> 'error' = 'run_timed_out', 'timed-out run refused');

-- Rate limit (3/minute on INT_SLOW): the 4th call is refused and not stored.
select pies_test.assert(pies_test.ax(:INT_SLOW, 'req-rate-0001', 'discovery', 'run.finish', '{}') ? 'error', 'rate 1');
select pies_test.assert(pies_test.ax(:INT_SLOW, 'req-rate-0002', 'discovery', 'run.finish', '{}') ? 'error', 'rate 2');
select pies_test.assert(pies_test.ax(:INT_SLOW, 'req-rate-0003', 'discovery', 'run.finish', '{}') ? 'error', 'rate 3');
select pies_test.assert(pies_test.ax(:INT_SLOW, 'req-rate-0004', 'discovery', 'run.finish', '{}') ->> 'error' = 'rate_limited', 'rate limit enforced');
reset session authorization;
select pies_test.assert(not exists (select 1 from public.automation_requests where request_id = 'req-rate-0004'), 'rate-limited request not stored');
select pies_test.assert(exists (select 1 from public.audit_logs where metadata ->> 'request_id' = 'req-rate-0004' and error = 'rate_limited'), 'rate-limited request audited');

-- Every stored automation request has exactly one audit entry, and no extra rows were written by rejections.
select pies_test.assert((select count(*) from public.automation_requests r
  where not exists (select 1 from public.audit_logs a where a.metadata ->> 'request_id' = r.request_id
                    and a.metadata ->> 'integration_id' = r.integration_id::text)) = 0, 'every request audited');
select pies_test.assert((select count(*) from public.opportunities where user_id = :C) = 1, 'exactly one opportunity after replays and rejections');
select pies_test.assert((select title from public.opportunities where user_id = :C) = 'Scholarship X (updated)', 'replay did not overwrite');
select pies_test.assert((select project_id from public.opportunities where user_id = :C) =
  (select id from public.projects where user_id = :C and slug = 'education-funding'), 'opportunity linked to project');

-- ------------------------------------------------------------ cross-user isolation through the API
reset session authorization;
select pies_test.as_user(:D);
insert into public.opportunities (id, user_id, title, category, source_url, dedupe_key)
values ('ffffffff-0000-0000-0000-00000000000d', :D, 'D private', 'grant', 'https://d.example', 'd-key-00001');
insert into public.agent_runs (id, user_id, agent, trigger, status, started_at)
values ('ffffffff-0000-0000-0000-0000000000a1', :D, 'discovery', 'manual', 'running', now());
select pies_test.reset_actor();
set session authorization pies_automation;
select set_config('pies.run2', pies_test.ax(:INT, 'req-run-00010', 'outreach', 'run.start', '{"workflow":"wf-o"}') ->> 'error', false);
-- Two discovery runs are open (one timed out is expired on start), so outreach gets a slot only after expiry.
reset session authorization;
update public.agent_runs set status = 'succeeded' where user_id = :C and status = 'running';
set session authorization pies_automation;
select set_config('pies.run2', pies_test.ax(:INT, 'req-run-00011', 'discovery', 'run.start', '{"workflow":"wf-x"}') ->> 'run_id', false);
select pies_test.assert(pies_test.ax(:INT, 'req-xuser-001', 'discovery', 'source.add', jsonb_build_object(
  'run_id', current_setting('pies.run2'), 'opportunity_id', 'ffffffff-0000-0000-0000-00000000000d', 'url', 'https://d.example/x')) ->> 'error' = 'opportunity_not_found', 'cannot attach evidence to another user''s opportunity');
select pies_test.assert(pies_test.ax(:INT, 'req-xuser-002', 'discovery', 'task.create', jsonb_build_object(
  'run_id', 'ffffffff-0000-0000-0000-0000000000a1', 'title', 'hijack')) ->> 'error' = 'run_not_found', 'cannot use another user''s run');
reset session authorization;
select pies_test.as_user(:D);
select pies_test.assert((select count(*) from public.automation_requests) = 0, 'D cannot see C requests');
select pies_test.assert((select count(*) from public.automation_integrations) = 1, 'D sees only own integration');
select pies_test.assert((select count(*) from public.activities) = 0, 'no activity leaked into D');

-- Tenant-isolated foreign keys (F-02).
select pies_test.as_user(:C);
do $$ begin
  begin
    insert into public.contacts (user_id, organization_id, full_name, source_url)
    values ('cccccccc-0000-0000-0000-00000000000c', 'eeeeeeee-0000-0000-0000-00000000000d', 'x', 'https://x.org');
    raise exception 'ASSERTION FAILED: contact linked to another user''s organization';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.applications (user_id, opportunity_id) values ('cccccccc-0000-0000-0000-00000000000c', 'ffffffff-0000-0000-0000-00000000000d');
    raise exception 'ASSERTION FAILED: application linked to another user''s opportunity';
  exception when foreign_key_violation then null;
  end;
end $$;
select pies_test.as_user(:D);
do $$ begin
  begin
    update public.opportunities set project_id = (select id from public.projects limit 1) where false; -- D sees no C projects
    insert into public.activities (user_id, kind, title, project_id)
    select 'dddddddd-0000-0000-0000-0000000000dd', 'task', 'x', p.id from public.projects p;
    perform 1;
  end;
end $$;
select pies_test.reset_actor();
do $$ begin
  begin
    insert into public.activities (user_id, kind, title, project_id)
    select 'dddddddd-0000-0000-0000-0000000000dd', 'task', 'x', id from public.projects where user_id = 'cccccccc-0000-0000-0000-00000000000c' limit 1;
    raise exception 'ASSERTION FAILED: D activity linked to C project';
  exception when foreign_key_violation then null;
  end;
end $$;
-- Same-owner reference still works, and deleting the parent only clears the reference.
insert into public.organizations (id, user_id, name) values ('eeeeeeee-0000-0000-0000-00000000000c', :C, 'C org');
insert into public.contacts (id, user_id, organization_id, full_name, source_url)
values ('eeeeeeee-0000-0000-0000-0000000000c1', :C, 'eeeeeeee-0000-0000-0000-00000000000c', 'Jane', 'https://c.example/team');
delete from public.organizations where id = 'eeeeeeee-0000-0000-0000-00000000000c';
select pies_test.assert((select user_id from public.contacts where id = 'eeeeeeee-0000-0000-0000-0000000000c1') = :C
  and (select organization_id from public.contacts where id = 'eeeeeeee-0000-0000-0000-0000000000c1') is null, 'SET NULL keeps owner');

-- ------------------------------------------------------------ approvals end to end
insert into public.outreach (id, user_id, status, subject, body)
values ('abababab-0000-0000-0000-000000000001', :C, 'gmail_draft_created', 'Hello', 'Body v1');
set session authorization pies_automation;
select set_config('pies.run3', pies_test.ax(:INT, 'req-run-00020', 'outreach', 'run.start', '{"workflow":"wf-out"}') ->> 'run_id', false);
select set_config('pies.appr', pies_test.ax(:INT, 'req-appr-0001', 'outreach', 'approval.request', jsonb_build_object(
  'run_id', current_setting('pies.run3'), 'action', 'send_email', 'target_table', 'outreach',
  'target_id', 'abababab-0000-0000-0000-000000000001', 'summary', 'Send intro to Jane',
  'payload_sha256', encode(sha256('Body v1'::bytea), 'hex'))) ->> 'approval_request_id', false);
select pies_test.assert(current_setting('pies.appr') <> '', 'approval requested via API');
select pies_test.assert(pies_test.ax(:INT, 'req-appr-0002', 'outreach', 'approval.request', jsonb_build_object(
  'run_id', current_setting('pies.run3'), 'action', 'send_email', 'target_table', 'outreach',
  'target_id', 'abababab-0000-0000-0000-000000000001', 'summary', 'x', 'payload_sha256', 'not-a-hash')) ->> 'error' = 'invalid_field:payload_sha256', 'approval needs content hash');
reset session authorization;

select pies_test.as_user(:C);
-- Pending approval cannot authorize sending.
do $$ begin
  begin
    update public.outreach set status = 'approved_to_send', approval_request_id = current_setting('pies.appr')::uuid
     where id = 'abababab-0000-0000-0000-000000000001';
    raise exception 'ASSERTION FAILED: outreach approved with pending approval';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.assert((public.decide_approval(current_setting('pies.appr')::uuid, true) ->> 'ok')::boolean, 'owner approves');
update public.outreach set status = 'approved_to_send', approval_request_id = current_setting('pies.appr')::uuid
 where id = 'abababab-0000-0000-0000-000000000001';
-- Approved is not consumed: cannot be marked sent.
do $$ begin
  begin
    update public.outreach set status = 'sent' where id = 'abababab-0000-0000-0000-000000000001';
    raise exception 'ASSERTION FAILED: outreach marked sent before approval consumed';
  exception when insufficient_privilege then null;
  end;
end $$;
-- The approval cannot be reused for a different message.
insert into public.outreach (id, user_id, status) values ('abababab-0000-0000-0000-000000000002', :C, 'gmail_draft_created');
do $$ begin
  begin
    update public.outreach set status = 'approved_to_send', approval_request_id = current_setting('pies.appr')::uuid
     where id = 'abababab-0000-0000-0000-000000000002';
    raise exception 'ASSERTION FAILED: approval reused for another outreach';
  exception when insufficient_privilege then null;
  end;
end $$;
select pies_test.reset_actor();

-- Modified content after approval: consumption fails.
select pies_test.as_service();
select pies_test.assert(not (public.consume_approval(current_setting('pies.appr')::uuid, 'send_email',
  'abababab-0000-0000-0000-000000000001', encode(sha256('Body v2 (edited)'::bytea), 'hex'), :C) ->> 'ok')::boolean, 'edited message invalidates approval');
select pies_test.reset_actor();

-- Expired approval cannot be decided or consumed.
select pies_test.as_service();
select set_config('pies.appr2', public.request_approval('outreach', 'send_email', 4::smallint, 'old', 'outreach',
  'abababab-0000-0000-0000-000000000002', 'h', :C)::text, false);
select pies_test.reset_actor();
update public.approval_requests set expires_at = now() - interval '1 second' where id = current_setting('pies.appr2')::uuid;
select pies_test.as_user(:C);
select pies_test.assert(not (public.decide_approval(current_setting('pies.appr2')::uuid, true) ->> 'ok')::boolean, 'expired approval cannot be approved');
select pies_test.as_user(:D);
select pies_test.assert(not (public.decide_approval(current_setting('pies.appr')::uuid, false) ->> 'ok')::boolean, 'other user cannot decide');
select pies_test.reset_actor();

-- ------------------------------------------------------------ function privilege allowlist (regression guard)
select pies_test.assert((select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')) = '', 'anon executes nothing');
select pies_test.assert((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute'))
  = 'budget_summary,decide_approval,initialize_profile,initialize_projects,pies_is_valid_agent,set_category_limit',
  'authenticated function allowlist: ' || (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')));
select pies_test.assert((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('pies_automation', p.oid, 'execute'))
  = 'automation_execute,commit_usage,release_usage,reserve_budget',
  'automation function allowlist');
select pies_test.assert(not exists (
  select 1 from information_schema.role_table_grants where grantee in ('anon', 'pies_automation') and table_schema = 'public'),
  'anon and automation hold no table grants');

\echo 'automation boundary assertions passed'
