-- Phase 1.5 hardening, part 2: restricted automation boundary.
--
-- n8n NEVER receives a Supabase key. It calls the PIES automation API with an
-- HMAC-signed request. The API connects to Postgres as the login role
-- `pies_automation`, which has NO table privileges and may execute only:
--   automation_execute  (fixed operation catalogue; validated, permission-checked,
--                        rate-limited, idempotent, audited - all in one transaction)
--   reserve_budget / commit_usage / release_usage  (for the Phase 2 server-side
--                        paid-call proxy; n8n cannot reach them directly)
--
-- F-01: previously the plan was to hand n8n the service-role key (bypasses RLS).
-- F-03: SECURITY DEFINER helper pies_ensure_budgets was executable by every
--       signed-in user and allowed writes into another user's budget rows.
-- F-04: browser sessions could call reserve/commit/release and so under-report spend.

-- ---------------------------------------------------------------------------
-- Role (login + password are set manually by the owner; never in a migration)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pies_automation') then
    create role pies_automation nologin noinherit nocreatedb nocreaterole;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Integrations (owner-managed) and request ledger (append-only to users)
-- ---------------------------------------------------------------------------
create table public.automation_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  enabled boolean not null default false,
  allowed_agents text[] not null default '{}',
  max_requests_per_minute integer not null default 30 check (max_requests_per_minute between 1 and 120),
  max_requests_per_day integer not null default 1000 check (max_requests_per_day between 1 and 5000),
  max_tasks_per_run integer not null default 50 check (max_tasks_per_run between 1 and 200),
  max_concurrent_runs integer not null default 2 check (max_concurrent_runs between 1 and 5),
  run_timeout_seconds integer not null default 600 check (run_timeout_seconds between 30 and 3600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (allowed_agents <@ array['discovery', 'qualification', 'contact_research', 'outreach',
    'career_strategist', 'revenue_intelligence', 'executive_coordinator'])
);
create trigger automation_integrations_set_updated_at before update on public.automation_integrations
  for each row execute function public.pies_set_updated_at();
alter table public.automation_integrations enable row level security;
create policy automation_integrations_owner_all on public.automation_integrations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.automation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  integration_id uuid not null,
  request_id text not null,
  agent text not null,
  operation text not null,
  payload_sha256 text not null,
  status text not null check (status in ('ok', 'rejected')),
  response jsonb not null,
  received_at timestamptz not null default now(),
  unique (integration_id, request_id),
  foreign key (integration_id, user_id) references public.automation_integrations (id, user_id) on delete cascade
);
create index automation_requests_rate_idx on public.automation_requests (integration_id, received_at desc);
alter table public.automation_requests enable row level security;
create policy automation_requests_owner_select on public.automation_requests for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- User resolution now understands the automation role
-- ---------------------------------------------------------------------------
create or replace function public.pies_resolve_user(p_user_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.role(), '');
begin
  if session_user = 'pies_automation' then
    if p_user_id is null or not exists (
      select 1 from public.automation_integrations where user_id = p_user_id and enabled) then
      raise exception 'no enabled automation integration for this user' using errcode = '42501';
    end if;
    return p_user_id;
  end if;
  if v_role = 'service_role' then
    if p_user_id is null then
      raise exception 'user_id required for service role' using errcode = '22023';
    end if;
    return p_user_id;
  end if;
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_user_id is not null and p_user_id <> v_uid then
    raise exception 'cannot act on another user' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permission mirror (must equal src/lib/permissions/catalog.ts; a unit test checks)
-- ---------------------------------------------------------------------------
create or replace function public.pies_agent_can(p_agent text, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (select 1 from (values
    -- AGENT_CAPABILITIES:BEGIN
    ('discovery', 'fetch_public_source'), ('discovery', 'extract_opportunity'), ('discovery', 'classify_record'),
    ('discovery', 'verify_source'), ('discovery', 'dedupe_records'), ('discovery', 'upsert_opportunity'),
    ('discovery', 'upsert_organization'), ('discovery', 'create_task'),
    ('qualification', 'classify_record'), ('qualification', 'verify_source'), ('qualification', 'score_opportunity'),
    ('qualification', 'upsert_opportunity'), ('qualification', 'create_task'), ('qualification', 'create_notification'),
    ('contact_research', 'fetch_public_source'), ('contact_research', 'verify_source'), ('contact_research', 'dedupe_records'),
    ('contact_research', 'upsert_organization'), ('contact_research', 'upsert_contact'), ('contact_research', 'create_task'),
    ('outreach', 'create_gmail_draft'), ('outreach', 'create_task'), ('outreach', 'create_notification'), ('outreach', 'send_email'),
    ('career_strategist', 'classify_record'), ('career_strategist', 'score_opportunity'), ('career_strategist', 'create_task'),
    ('career_strategist', 'generate_report'), ('career_strategist', 'prepare_application_materials'),
    ('career_strategist', 'submit_job_application'), ('career_strategist', 'submit_university_application'),
    ('revenue_intelligence', 'fetch_public_source'), ('revenue_intelligence', 'extract_opportunity'),
    ('revenue_intelligence', 'classify_record'), ('revenue_intelligence', 'verify_source'),
    ('revenue_intelligence', 'dedupe_records'), ('revenue_intelligence', 'upsert_organization'),
    ('revenue_intelligence', 'upsert_contact'), ('revenue_intelligence', 'update_pipeline'),
    ('revenue_intelligence', 'create_task'), ('revenue_intelligence', 'prepare_external_crm_update'),
    ('revenue_intelligence', 'push_external_crm_update'),
    ('executive_coordinator', 'create_task'), ('executive_coordinator', 'create_notification'),
    ('executive_coordinator', 'generate_report')
    -- AGENT_CAPABILITIES:END
  ) as c(agent, action) where c.agent = p_agent and c.action = p_action);
$$;

-- Level-4 actions an agent may REQUEST approval for (never execute through this API).
create or replace function public.pies_is_approvable_action(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action in ('send_email', 'submit_job_application', 'submit_university_application', 'push_external_crm_update');
$$;

-- ---------------------------------------------------------------------------
-- Operation helpers (callable only from automation_execute)
-- ---------------------------------------------------------------------------
create or replace function public.pies_reject_unknown_keys(p jsonb, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare v_bad text;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception 'payload_must_be_object';
  end if;
  select k into v_bad from jsonb_object_keys(p) as k where k <> all (p_allowed) limit 1;
  if v_bad is not null then
    raise exception 'unknown_field:%', left(v_bad, 40);
  end if;
end;
$$;

create or replace function public.pies_req_text(p jsonb, p_key text, p_max int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(p ->> p_key), '');
begin
  if v is null then raise exception 'missing_field:%', p_key; end if;
  if length(v) > p_max then raise exception 'field_too_long:%', p_key; end if;
  return v;
end;
$$;

create or replace function public.pies_opt_text(p jsonb, p_key text, p_max int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(p ->> p_key), '');
begin
  if v is not null and length(v) > p_max then raise exception 'field_too_long:%', p_key; end if;
  return v;
end;
$$;

create or replace function public.pies_project_id(p_user uuid, p_slug text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare v uuid;
begin
  if p_slug is null then return null; end if;
  select id into v from public.projects where user_id = p_user and slug = p_slug and status = 'active';
  if v is null then raise exception 'unknown_project'; end if;
  return v;
end;
$$;

-- Claims one unit of work on an active run; enforces timeout and max_tasks.
create or replace function public.pies_claim_run(p_user uuid, p_agent text, p_run_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare r record;
begin
  if p_run_id is null then raise exception 'missing_field:run_id'; end if;
  select * into r from public.agent_runs where id = p_run_id and user_id = p_user for update;
  if not found or r.agent <> p_agent then raise exception 'run_not_found'; end if;
  if r.status <> 'running' then raise exception 'run_not_active'; end if;
  if r.started_at + make_interval(secs => r.timeout_seconds) < now() then
    update public.agent_runs set status = 'timed_out', finished_at = now() where id = r.id;
    raise exception 'run_timed_out';
  end if;
  if r.items_processed >= r.max_tasks then raise exception 'run_task_limit_reached'; end if;
  update public.agent_runs set items_processed = items_processed + 1 where id = r.id;
  return r.id;
end;
$$;

create or replace function public.pies_op_run_start(p_user uuid, p_int public.automation_integrations, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_running int;
  v_max int;
  v_id uuid;
begin
  perform public.pies_reject_unknown_keys(p, array['workflow', 'trigger', 'max_tasks', 'project']);
  -- Expire stale runs first so a crashed workflow cannot hold a slot forever.
  update public.agent_runs set status = 'timed_out', finished_at = now()
   where user_id = p_user and status = 'running'
     and started_at + make_interval(secs => timeout_seconds) < now();
  select count(*) into v_running from public.agent_runs where user_id = p_user and status = 'running';
  if v_running >= p_int.max_concurrent_runs then raise exception 'concurrent_run_limit_reached'; end if;
  v_max := least(coalesce((p ->> 'max_tasks')::int, p_int.max_tasks_per_run), p_int.max_tasks_per_run);
  if v_max < 1 then raise exception 'invalid_field:max_tasks'; end if;
  insert into public.agent_runs (user_id, agent, workflow, trigger, status, max_tasks, timeout_seconds, started_at, project_id)
  values (p_user, p_agent, public.pies_req_text(p, 'workflow', 100),
          coalesce(p ->> 'trigger', 'schedule'), 'running', v_max, p_int.run_timeout_seconds, now(),
          public.pies_project_id(p_user, public.pies_opt_text(p, 'project', 48)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'run_id', v_id, 'max_tasks', v_max, 'timeout_seconds', p_int.run_timeout_seconds);
end;
$$;

create or replace function public.pies_op_run_finish(p_user uuid, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_n int;
begin
  perform public.pies_reject_unknown_keys(p, array['run_id', 'status', 'error']);
  v_status := public.pies_req_text(p, 'status', 20);
  if v_status not in ('succeeded', 'failed', 'cancelled') then raise exception 'invalid_field:status'; end if;
  update public.agent_runs
     set status = v_status, finished_at = now(), error = left(public.pies_opt_text(p, 'error', 4000), 2000)
   where id = (p ->> 'run_id')::uuid and user_id = p_user and agent = p_agent and status = 'running';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'run_not_active'; end if;
  if v_status = 'failed' then
    insert into public.notifications (user_id, kind, severity, title, related_table, related_id)
    values (p_user, 'workflow_failure', 'warning', 'Agent run failed: ' || p_agent, 'agent_runs', (p ->> 'run_id')::uuid);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pies_op_opportunity_upsert(p_user uuid, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_inserted boolean;
begin
  perform public.pies_reject_unknown_keys(p, array[
    'run_id', 'project', 'title', 'category', 'description', 'location', 'remote_eligible',
    'country_eligibility', 'education_requirements', 'experience_requirements', 'financial_value',
    'currency', 'deadline', 'published_at', 'source_url', 'dedupe_key']);
  perform public.pies_claim_run(p_user, p_agent, (p ->> 'run_id')::uuid);
  if public.pies_req_text(p, 'source_url', 2000) !~ '^https?://' then raise exception 'invalid_field:source_url'; end if;
  if public.pies_req_text(p, 'dedupe_key', 200) !~ '^[A-Za-z0-9._:/-]{8,200}$' then raise exception 'invalid_field:dedupe_key'; end if;

  insert into public.opportunities as o (
    user_id, project_id, title, category, description, location, remote_eligible, country_eligibility,
    education_requirements, experience_requirements, financial_value, currency, deadline, published_at,
    source_url, dedupe_key, analysis_generated_by)
  values (
    p_user,
    public.pies_project_id(p_user, public.pies_opt_text(p, 'project', 48)),
    public.pies_req_text(p, 'title', 500),
    public.pies_req_text(p, 'category', 32),
    public.pies_opt_text(p, 'description', 10000),
    public.pies_opt_text(p, 'location', 300),
    (p ->> 'remote_eligible')::boolean,
    case when p ? 'country_eligibility' then array(select jsonb_array_elements_text(p -> 'country_eligibility')) end,
    public.pies_opt_text(p, 'education_requirements', 2000),
    public.pies_opt_text(p, 'experience_requirements', 2000),
    (p ->> 'financial_value')::numeric,
    public.pies_opt_text(p, 'currency', 3),
    (p ->> 'deadline')::timestamptz,
    (p ->> 'published_at')::timestamptz,
    p ->> 'source_url',
    p ->> 'dedupe_key',
    'agent:' || p_agent)
  on conflict (user_id, dedupe_key) do update set
    -- Agents refresh factual fields only. Status, score and eligibility stay untouched.
    title = excluded.title,
    description = coalesce(excluded.description, o.description),
    location = coalesce(excluded.location, o.location),
    deadline = coalesce(excluded.deadline, o.deadline),
    financial_value = coalesce(excluded.financial_value, o.financial_value),
    currency = coalesce(excluded.currency, o.currency)
  returning o.id, (o.xmax = 0) into v_id, v_inserted;
  return jsonb_build_object('ok', true, 'opportunity_id', v_id, 'created', v_inserted);
end;
$$;

create or replace function public.pies_op_source_add(p_user uuid, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  perform public.pies_reject_unknown_keys(p, array[
    'run_id', 'opportunity_id', 'url', 'source_type', 'evidence_excerpt', 'content_hash', 'published_at']);
  perform public.pies_claim_run(p_user, p_agent, (p ->> 'run_id')::uuid);
  if not exists (select 1 from public.opportunities where id = (p ->> 'opportunity_id')::uuid and user_id = p_user) then
    raise exception 'opportunity_not_found';
  end if;
  insert into public.opportunity_sources as s (user_id, opportunity_id, url, source_type, evidence_excerpt, content_hash, published_at)
  values (p_user, (p ->> 'opportunity_id')::uuid, public.pies_req_text(p, 'url', 2000),
          coalesce(p ->> 'source_type', 'official'), public.pies_opt_text(p, 'evidence_excerpt', 5000),
          public.pies_opt_text(p, 'content_hash', 128), (p ->> 'published_at')::timestamptz)
  on conflict (opportunity_id, url) do update set
    retrieved_at = now(), evidence_excerpt = excluded.evidence_excerpt, content_hash = excluded.content_hash
  returning s.id into v_id;
  return jsonb_build_object('ok', true, 'source_id', v_id);
end;
$$;

create or replace function public.pies_op_task_create(p_user uuid, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  perform public.pies_reject_unknown_keys(p, array['run_id', 'project', 'title', 'description', 'due_at', 'priority']);
  perform public.pies_claim_run(p_user, p_agent, (p ->> 'run_id')::uuid);
  insert into public.activities (user_id, project_id, kind, title, description, due_at, priority, created_by)
  values (p_user, public.pies_project_id(p_user, public.pies_opt_text(p, 'project', 48)), 'task',
          public.pies_req_text(p, 'title', 500), public.pies_opt_text(p, 'description', 4000),
          (p ->> 'due_at')::timestamptz, coalesce((p ->> 'priority')::smallint, 3), p_agent)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'activity_id', v_id);
end;
$$;

create or replace function public.pies_op_notification_create(p_user uuid, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := coalesce(p ->> 'kind', 'info');
  v_id uuid;
begin
  perform public.pies_reject_unknown_keys(p, array['run_id', 'kind', 'severity', 'title', 'body']);
  perform public.pies_claim_run(p_user, p_agent, (p ->> 'run_id')::uuid);
  -- Agents cannot forge approval prompts or "draft ready" notices.
  if v_kind not in ('info', 'briefing', 'deadline', 'workflow_failure', 'budget') then
    raise exception 'invalid_field:kind';
  end if;
  insert into public.notifications (user_id, kind, severity, title, body)
  values (p_user, v_kind, coalesce(p ->> 'severity', 'info'),
          public.pies_req_text(p, 'title', 200), public.pies_opt_text(p, 'body', 4000))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'notification_id', v_id);
end;
$$;

create or replace function public.pies_op_approval_request(p_user uuid, p_agent text, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_action text;
  v_hash text;
  v_id uuid;
begin
  perform public.pies_reject_unknown_keys(p, array['run_id', 'action', 'target_table', 'target_id', 'summary', 'payload_sha256']);
  perform public.pies_claim_run(p_user, p_agent, (p ->> 'run_id')::uuid);
  v_action := public.pies_req_text(p, 'action', 64);
  v_hash := public.pies_req_text(p, 'payload_sha256', 64);
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_field:payload_sha256'; end if;
  insert into public.approval_requests (user_id, requested_by_agent, action, permission_level, target_table,
                                        target_id, summary, payload_hash)
  values (p_user, p_agent, v_action, 4, public.pies_req_text(p, 'target_table', 64),
          (p ->> 'target_id')::uuid, public.pies_req_text(p, 'summary', 2000), v_hash)
  returning id into v_id;
  insert into public.notifications (user_id, kind, severity, title, body, related_table, related_id)
  values (p_user, 'approval_needed', 'warning', 'Approval needed: ' || v_action, p ->> 'summary', 'approval_requests', v_id);
  return jsonb_build_object('ok', true, 'approval_request_id', v_id, 'status', 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- automation_execute: the ONLY entry point for workflows
-- ---------------------------------------------------------------------------
create or replace function public.automation_execute(
  p_integration_id uuid,
  p_request_id text,
  p_agent text,
  p_operation text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_int public.automation_integrations;
  v_prev record;
  v_hash text;
  v_action text;
  v_level smallint;
  v_minute int;
  v_day int;
  v_result jsonb;
  v_state text;
  v_msg text;
  v_reject text;
begin
  if session_user <> 'pies_automation' then
    raise exception 'automation_execute is reserved for the pies_automation role' using errcode = '42501';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request_id');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 32768 then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  select * into v_int from public.automation_integrations where id = p_integration_id;
  if not found or not v_int.enabled then
    return jsonb_build_object('ok', false, 'error', 'integration_not_authorized');
  end if;

  -- Serialize per integration: makes idempotency, rate limits and run limits race-free.
  perform pg_advisory_xact_lock(hashtextextended('pies_automation:' || v_int.id::text, 0));

  v_hash := encode(sha256(convert_to(coalesce(p_agent, '') || '|' || coalesce(p_operation, '') || '|' || p_payload::text, 'UTF8')), 'hex');

  -- Idempotency: a repeated request_id returns the original result and does nothing.
  select * into v_prev from public.automation_requests
   where integration_id = v_int.id and request_id = p_request_id;
  if found then
    if v_prev.payload_sha256 <> v_hash then
      v_reject := 'request_id_reused_with_different_content';
    else
      return v_prev.response || jsonb_build_object('replayed', true);
    end if;
  end if;

  if v_reject is null then
    select count(*) filter (where received_at > now() - interval '1 minute'),
           count(*) filter (where received_at > now() - interval '1 day')
      into v_minute, v_day
      from public.automation_requests
     where integration_id = v_int.id and received_at > now() - interval '1 day';
    if v_minute >= v_int.max_requests_per_minute or v_day >= v_int.max_requests_per_day then
      v_reject := 'rate_limited';
    end if;
  end if;

  if v_reject is null and (p_agent is null or not public.pies_is_valid_agent(p_agent)) then
    v_reject := 'unknown_agent';
  end if;
  if v_reject is null and not (p_agent = any (v_int.allowed_agents)) then
    v_reject := 'agent_not_enabled_for_integration';
  end if;

  -- Fixed operation catalogue. There is deliberately NO operation for sending
  -- email, submitting applications, spending budget, deciding approvals or raw SQL.
  if v_reject is null then
    v_action := case p_operation
      when 'run.start' then 'lifecycle'
      when 'run.finish' then 'lifecycle'
      when 'opportunity.upsert' then 'upsert_opportunity'
      when 'source.add' then 'upsert_opportunity'
      when 'task.create' then 'create_task'
      when 'notification.create' then 'create_notification'
      when 'approval.request' then p_payload ->> 'action'
    end;
    v_level := case when p_operation = 'approval.request' then 4 else 2 end;
    if v_action is null then
      v_reject := 'unknown_operation';
    elsif p_operation = 'approval.request'
          and not (public.pies_is_approvable_action(v_action) and public.pies_agent_can(p_agent, v_action)) then
      v_reject := 'permission_denied';
    elsif v_action <> 'lifecycle' and p_operation <> 'approval.request' and not public.pies_agent_can(p_agent, v_action) then
      v_reject := 'permission_denied';
    end if;
  end if;

  if v_reject is not null then
    v_result := jsonb_build_object('ok', false, 'error', v_reject);
  else
    begin
      v_result := case p_operation
        when 'run.start' then public.pies_op_run_start(v_int.user_id, v_int, p_agent, p_payload)
        when 'run.finish' then public.pies_op_run_finish(v_int.user_id, p_agent, p_payload)
        when 'opportunity.upsert' then public.pies_op_opportunity_upsert(v_int.user_id, p_agent, p_payload)
        when 'source.add' then public.pies_op_source_add(v_int.user_id, p_agent, p_payload)
        when 'task.create' then public.pies_op_task_create(v_int.user_id, p_agent, p_payload)
        when 'notification.create' then public.pies_op_notification_create(v_int.user_id, p_agent, p_payload)
        when 'approval.request' then public.pies_op_approval_request(v_int.user_id, p_agent, p_payload)
      end;
    exception when others then
      -- Everything the operation wrote is rolled back; only the rejection is recorded.
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_result := jsonb_build_object('ok', false, 'error',
        case
          when v_state = 'P0001' then left(v_msg, 120)          -- our own validation messages
          when v_state like '23%' then 'constraint_violation'
          when v_state like '22%' then 'invalid_value'
          else 'operation_failed'
        end);
    end;
  end if;

  -- Rate-limit rejections are not stored, so a later retry with the same id can succeed.
  if coalesce(v_reject, '') not in ('rate_limited', 'request_id_reused_with_different_content') then
    insert into public.automation_requests (user_id, integration_id, request_id, agent, operation,
                                            payload_sha256, status, response)
    values (v_int.user_id, v_int.id, p_request_id, coalesce(p_agent, ''), coalesce(p_operation, ''),
            v_hash, case when (v_result ->> 'ok')::boolean then 'ok' else 'rejected' end, v_result);
  end if;

  insert into public.audit_logs (user_id, actor_type, actor_id, action, permission_level, decision, result,
                                 error, metadata)
  values (v_int.user_id, 'agent', left(coalesce(p_agent, 'unknown'), 64), 'automation:' || left(coalesce(p_operation, ''), 64),
          v_level,
          case when v_reject in ('permission_denied', 'unknown_operation', 'agent_not_enabled_for_integration', 'unknown_agent', 'request_id_reused_with_different_content')
               then 'denied' else 'allowed' end,
          case when (v_result ->> 'ok')::boolean then 'success' else 'failure' end,
          case when (v_result ->> 'ok')::boolean then null else v_result ->> 'error' end,
          jsonb_build_object('integration_id', v_int.id, 'request_id', p_request_id));

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilege lockdown (applies to every function in public, past and future)
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on tables from anon;

revoke execute on all functions in schema public from public, anon, authenticated, pies_automation;
revoke all on all tables in schema public from anon, pies_automation;

grant usage on schema public to pies_automation;

-- Browser (signed-in owner): read-only summaries and owner decisions only.
grant execute on function
  public.budget_summary(uuid),
  public.set_category_limit(text, numeric, uuid),
  public.decide_approval(uuid, boolean),
  public.initialize_profile(),
  public.initialize_projects(),
  public.pies_is_valid_agent(text)
to authenticated;

-- Automation API connection.
grant execute on function
  public.automation_execute(uuid, text, text, text, jsonb),
  public.reserve_budget(text, text, text, numeric, text, uuid, uuid),
  public.commit_usage(uuid, numeric, uuid),
  public.release_usage(uuid, uuid)
to pies_automation;
