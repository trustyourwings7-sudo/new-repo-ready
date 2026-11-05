-- PIES governance functions: budget governor, approvals, audit.
-- All are SECURITY DEFINER with an empty search_path and an explicit owner check,
-- so governed tables cannot be written directly by clients.

-- Hard ceiling. Mirrored in src/lib/budget/constants.ts. Changing this requires a migration.
create or replace function public.pies_hard_monthly_cap_usd()
returns numeric
language sql
immutable
set search_path = ''
as $$ select 10.00::numeric $$;

create or replace function public.pies_default_category_limit(p_category text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_category when 'ai' then 5.00 when 'search' then 2.00 when 'infra' then 3.00 end::numeric
$$;

-- Resolve and authorize the acting user.
-- Signed-in users may act only on themselves; the service role (n8n / workers)
-- must name the user explicitly.
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

create or replace function public.pies_current_period()
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('month', now() at time zone 'UTC')::date $$;

-- Ensure the month's three budget rows exist (idempotent).
create or replace function public.pies_ensure_budgets(p_user_id uuid, p_period date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.budgets (user_id, period_month, category, limit_usd)
  select p_user_id, p_period, c, public.pies_default_category_limit(c)
  from unnest(array['ai', 'search', 'infra']) as c
  on conflict (user_id, period_month, category) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_budget: the only way to obtain permission to spend money.
-- Returns jsonb { allowed, reason, usage_id, category_remaining_usd, total_remaining_usd }.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_budget(
  p_category text,
  p_provider text,
  p_operation text,
  p_estimated_usd numeric,
  p_idempotency_key text,
  p_agent_run_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_period date := public.pies_current_period();
  v_prefs record;
  v_provider record;
  v_existing record;
  v_cat_limit numeric;
  v_cat_used numeric;
  v_total_used numeric;
  v_total_limit numeric;
  v_provider_used numeric;
  v_id uuid;
begin
  if p_category not in ('ai', 'search', 'infra') then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_category');
  end if;
  if p_estimated_usd is null or p_estimated_usd <= 0 or p_estimated_usd > public.pies_hard_monthly_cap_usd() then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_estimate');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_idempotency_key');
  end if;

  -- Serialize all budget decisions for this user (prevents concurrent overspend).
  perform pg_advisory_xact_lock(hashtextextended('pies_budget:' || v_user::text, 0));

  -- Idempotency: the same key never reserves twice.
  select id, status into v_existing from public.usage_records
   where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('allowed', v_existing.status <> 'released', 'reason', 'duplicate', 'usage_id', v_existing.id);
  end if;

  select paid_operations_enabled, monthly_budget_usd into v_prefs
    from public.user_preferences where user_id = v_user;
  if not found or not v_prefs.paid_operations_enabled then
    return jsonb_build_object('allowed', false, 'reason', 'paid_operations_disabled');
  end if;

  select enabled, pricing_verified, category, monthly_cap_usd into v_provider
    from public.provider_configs where user_id = v_user and provider = p_provider;
  if not found or not v_provider.enabled then
    return jsonb_build_object('allowed', false, 'reason', 'provider_not_enabled');
  end if;
  if not v_provider.pricing_verified then
    return jsonb_build_object('allowed', false, 'reason', 'provider_pricing_unverified');
  end if;
  if v_provider.category <> p_category then
    return jsonb_build_object('allowed', false, 'reason', 'provider_category_mismatch');
  end if;

  perform public.pies_ensure_budgets(v_user, v_period);

  select limit_usd into v_cat_limit from public.budgets
   where user_id = v_user and period_month = v_period and category = p_category;

  -- Used = committed actuals + live (unexpired) reservations.
  select
    coalesce(sum(case when category = p_category then amt end), 0),
    coalesce(sum(amt), 0),
    coalesce(sum(case when provider = p_provider then amt end), 0)
  into v_cat_used, v_total_used, v_provider_used
  from (
    select category, provider,
           case when status = 'committed' then actual_usd else estimated_usd end as amt
      from public.usage_records
     where user_id = v_user and period_month = v_period
       and (status = 'committed' or (status = 'reserved' and expires_at > now()))
  ) u;

  v_total_limit := least(public.pies_hard_monthly_cap_usd(), v_prefs.monthly_budget_usd);

  if v_total_used + p_estimated_usd > v_total_limit then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_limit_reached',
      'total_remaining_usd', greatest(v_total_limit - v_total_used, 0));
  end if;
  if v_cat_used + p_estimated_usd > v_cat_limit then
    return jsonb_build_object('allowed', false, 'reason', 'category_limit_reached',
      'category_remaining_usd', greatest(v_cat_limit - v_cat_used, 0));
  end if;
  if v_provider.monthly_cap_usd is not null and v_provider_used + p_estimated_usd > v_provider.monthly_cap_usd then
    return jsonb_build_object('allowed', false, 'reason', 'provider_limit_reached');
  end if;

  insert into public.usage_records (user_id, period_month, category, provider, operation,
                                    status, estimated_usd, idempotency_key, agent_run_id)
  values (v_user, v_period, p_category, p_provider, p_operation,
          'reserved', p_estimated_usd, p_idempotency_key, p_agent_run_id)
  returning id into v_id;

  return jsonb_build_object(
    'allowed', true, 'reason', 'reserved', 'usage_id', v_id,
    'category_remaining_usd', v_cat_limit - v_cat_used - p_estimated_usd,
    'total_remaining_usd', v_total_limit - v_total_used - p_estimated_usd);
end;
$$;

-- Record the real cost. Money already spent is always recorded, even on overrun.
create or replace function public.commit_usage(p_usage_id uuid, p_actual_usd numeric, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_row record;
begin
  if p_actual_usd is null or p_actual_usd < 0 then
    raise exception 'actual_usd must be >= 0' using errcode = '22023';
  end if;
  select * into v_row from public.usage_records where id = p_usage_id and user_id = v_user for update;
  if not found then
    raise exception 'usage record not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'committed' then
    return jsonb_build_object('ok', true, 'reason', 'already_committed');
  end if;
  update public.usage_records
     set status = 'committed', actual_usd = p_actual_usd,
         overrun = p_actual_usd > v_row.estimated_usd, committed_at = now()
   where id = p_usage_id;
  return jsonb_build_object('ok', true, 'overrun', p_actual_usd > v_row.estimated_usd);
end;
$$;

create or replace function public.release_usage(p_usage_id uuid, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_n int;
begin
  update public.usage_records set status = 'released'
   where id = p_usage_id and user_id = v_user and status = 'reserved';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end;
$$;

-- Adjust a category limit; the sum of categories can never exceed the hard cap.
create or replace function public.set_category_limit(p_category text, p_limit_usd numeric, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_period date := public.pies_current_period();
  v_other numeric;
begin
  if p_category not in ('ai', 'search', 'infra') or p_limit_usd is null or p_limit_usd < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pies_budget:' || v_user::text, 0));
  perform public.pies_ensure_budgets(v_user, v_period);
  select coalesce(sum(limit_usd), 0) into v_other from public.budgets
   where user_id = v_user and period_month = v_period and category <> p_category;
  if v_other + p_limit_usd > public.pies_hard_monthly_cap_usd() then
    return jsonb_build_object('ok', false, 'reason', 'exceeds_hard_cap');
  end if;
  update public.budgets set limit_usd = p_limit_usd
   where user_id = v_user and period_month = v_period and category = p_category;
  return jsonb_build_object('ok', true);
end;
$$;

-- Read-only monthly summary for dashboards and the budget monitoring workflow.
create or replace function public.budget_summary(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_period date := public.pies_current_period();
  v_result jsonb;
begin
  perform public.pies_ensure_budgets(v_user, v_period);
  select jsonb_build_object(
    'period_month', v_period,
    'hard_cap_usd', public.pies_hard_monthly_cap_usd(),
    'paid_operations_enabled', coalesce((select paid_operations_enabled from public.user_preferences where user_id = v_user), false),
    'categories', coalesce(jsonb_agg(jsonb_build_object(
        'category', b.category,
        'limit_usd', b.limit_usd,
        'committed_usd', coalesce(u.committed, 0),
        'pending_usd', coalesce(u.pending, 0)) order by b.category), '[]'::jsonb))
  into v_result
  from public.budgets b
  left join (
    select category,
           sum(actual_usd) filter (where status = 'committed') as committed,
           sum(estimated_usd) filter (where status = 'reserved' and expires_at > now()) as pending
      from public.usage_records
     where user_id = v_user and period_month = v_period
     group by category
  ) u on u.category = b.category
  where b.user_id = v_user and b.period_month = v_period;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
-- Agents (service role) request; the user decides; agents consume exactly once.
create or replace function public.request_approval(
  p_agent text, p_action text, p_level smallint, p_summary text,
  p_target_table text default null, p_target_id uuid default null,
  p_payload_hash text default null, p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_id uuid;
begin
  insert into public.approval_requests (user_id, requested_by_agent, action, permission_level,
                                        summary, target_table, target_id, payload_hash)
  values (v_user, p_agent, p_action, p_level, p_summary, p_target_table, p_target_id, p_payload_hash)
  returning id into v_id;
  insert into public.notifications (user_id, kind, severity, title, body, related_table, related_id)
  values (v_user, 'approval_needed', 'warning', 'Approval needed: ' || p_action, p_summary, 'approval_requests', v_id);
  return v_id;
end;
$$;

-- Only a signed-in human may decide. The service role is refused.
create or replace function public.decide_approval(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'approvals require a signed-in user' using errcode = '42501';
  end if;
  update public.approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_request_id and user_id = v_uid and status = 'pending' and expires_at > now();
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, actor_type, actor_id, action, decision, result, related_table, related_id)
  values (v_uid, 'user', v_uid::text, 'decide_approval',
          case when p_approve then 'approved_by_user' else 'denied' end,
          case when v_n = 1 then 'success' else 'failure' end,
          'approval_requests', p_request_id);
  return jsonb_build_object('ok', v_n = 1);
end;
$$;

-- Single use: an approval authorizes one execution of one action on one target.
create or replace function public.consume_approval(
  p_request_id uuid, p_action text, p_target_id uuid default null,
  p_payload_hash text default null, p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_n int;
begin
  update public.approval_requests
     set status = 'consumed', consumed_at = now()
   where id = p_request_id and user_id = v_user and status = 'approved'
     and expires_at > now() and action = p_action
     and target_id is not distinct from p_target_id
     and (payload_hash is null or payload_hash = p_payload_hash);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit (agents write via service role through this function)
-- ---------------------------------------------------------------------------
create or replace function public.write_audit_log(
  p_actor_type text, p_actor_id text, p_action text, p_level smallint,
  p_decision text, p_result text, p_related_table text default null,
  p_related_id uuid default null, p_error text default null,
  p_metadata jsonb default '{}'::jsonb, p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.pies_resolve_user(p_user_id);
  v_id uuid;
begin
  if p_actor_type <> 'user' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'only the service role may log agent/system actions' using errcode = '42501';
  end if;
  insert into public.audit_logs (user_id, actor_type, actor_id, action, permission_level, decision,
                                 result, related_table, related_id, error, metadata)
  values (v_user, p_actor_type, p_actor_id, p_action, p_level, p_decision, p_result,
          p_related_table, p_related_id, left(p_error, 2000), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.reserve_budget(text, text, text, numeric, text, uuid, uuid),
  public.commit_usage(uuid, numeric, uuid),
  public.release_usage(uuid, uuid),
  public.set_category_limit(text, numeric, uuid),
  public.budget_summary(uuid),
  public.request_approval(text, text, smallint, text, text, uuid, text, uuid),
  public.decide_approval(uuid, boolean),
  public.consume_approval(uuid, text, uuid, text, uuid),
  public.write_audit_log(text, text, text, smallint, text, text, text, uuid, text, jsonb, uuid)
to authenticated, service_role;
-- Internal helpers used inside policies/constraints must stay callable.
grant execute on function public.pies_is_valid_agent(text) to authenticated, service_role;
