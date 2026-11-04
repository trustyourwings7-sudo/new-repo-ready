-- PIES core schema
-- All user-owned tables carry user_id and are protected by Row Level Security.
-- Source evidence (opportunity_sources) is stored separately from AI analysis
-- (opportunities.scoring_breakdown / recommended_action).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.pies_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Agent identifiers are fixed. Changing this list is a code + migration change.
create or replace function public.pies_is_valid_agent(p_agent text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_agent in (
    'discovery', 'qualification', 'contact_research', 'outreach',
    'career_strategist', 'revenue_intelligence', 'executive_coordinator'
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. user_profiles
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text,
  headline text,
  summary text,
  location_city text,
  location_country text,
  education_level text,
  target_countries text[] not null default '{}',
  interests text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supporting table: structured, source-tracked profile facts.
-- Prevents agents from inventing qualifications: every fact has a source and
-- a verification status, and agents may only cite facts present here.
create table public.profile_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'experience', 'education', 'achievement', 'certification',
    'athletics', 'venture', 'interest', 'other')),
  title text not null check (length(title) between 1 and 300),
  organization text,
  start_date date,
  end_date date,
  description text,
  source text not null default 'user_provided' check (source in (
    'user_provided', 'initialization_context', 'document')),
  source_document_id uuid,
  verification_status text not null default 'user_asserted' check (verification_status in (
    'user_asserted', 'document_verified', 'unverified', 'disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index profile_entries_user_idx on public.profile_entries (user_id, kind);

-- ---------------------------------------------------------------------------
-- 11. documents (declared early: referenced by skills and profile_entries)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (kind in (
    'cv', 'transcript', 'certificate', 'cover_letter', 'proposal',
    'reference_letter', 'portfolio', 'other')),
  storage_path text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  is_private boolean not null default true,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_user_idx on public.documents (user_id, kind);

alter table public.profile_entries
  add constraint profile_entries_document_fk
  foreign key (source_document_id) references public.documents(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 300),
  website text,
  domain text,
  country text,
  sector text,
  org_type text check (org_type is null or org_type in (
    'employer', 'university', 'college', 'funder', 'government', 'ngo',
    'accelerator', 'business', 'school', 'clinic', 'travel', 'hospitality', 'other')),
  description text,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_user_domain_uidx
  on public.organizations (user_id, lower(domain)) where domain is not null;
create index organizations_user_name_idx on public.organizations (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- 3. opportunities
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  title text not null check (length(title) between 1 and 500),
  category text not null check (category in (
    'employment', 'education', 'scholarship', 'grant', 'funding',
    'accelerator', 'partnership', 'consulting', 'commercial', 'other')),
  description text,
  location text,
  remote_eligible boolean,               -- null = unknown (never inferred)
  country_eligibility text[],            -- null = unknown; '{}' = none stated
  education_requirements text,
  experience_requirements text,
  financial_value numeric(14, 2) check (financial_value is null or financial_value >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  deadline timestamptz,
  published_at timestamptz,
  source_url text not null check (source_url ~ '^https?://'),
  last_verified_at timestamptz,
  -- AI / rules analysis (kept distinct from evidence in opportunity_sources)
  qualification_score smallint check (qualification_score between 0 and 100),
  scoring_breakdown jsonb,
  scoring_version text,
  eligibility_status text not null default 'unknown' check (eligibility_status in (
    'unknown', 'eligible', 'partially_eligible', 'ineligible', 'needs_review')),
  missing_information text[] not null default '{}',
  recommended_action text,
  analysis_generated_by text,
  status text not null default 'new' check (status in (
    'new', 'reviewing', 'qualified', 'pursuing', 'applied', 'won', 'lost',
    'archived', 'ineligible')),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((financial_value is null) or (currency is not null)),
  -- Mandatory eligibility failure overrides any score.
  check (eligibility_status <> 'ineligible' or status in ('ineligible', 'archived'))
);
create unique index opportunities_user_dedupe_uidx on public.opportunities (user_id, dedupe_key);
create index opportunities_user_status_idx on public.opportunities (user_id, status);
create index opportunities_user_deadline_idx on public.opportunities (user_id, deadline) where deadline is not null;
create index opportunities_user_score_idx on public.opportunities (user_id, qualification_score desc nulls last);
create index opportunities_user_category_idx on public.opportunities (user_id, category);

-- ---------------------------------------------------------------------------
-- 4. opportunity_sources (evidence)
-- ---------------------------------------------------------------------------
create table public.opportunity_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  source_type text not null default 'official' check (source_type in (
    'official', 'aggregator', 'rss', 'search_result', 'manual')),
  retrieved_at timestamptz not null default now(),
  published_at timestamptz,
  verification_status text not null default 'unverified' check (verification_status in (
    'unverified', 'verified', 'broken', 'conflicting')),
  evidence_excerpt text check (evidence_excerpt is null or length(evidence_excerpt) <= 5000),
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index opportunity_sources_uidx on public.opportunity_sources (opportunity_id, url);
create index opportunity_sources_user_idx on public.opportunity_sources (user_id);

-- ---------------------------------------------------------------------------
-- 5. contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text not null,
  role_title text,
  is_decision_maker boolean not null default false,
  public_email text check (public_email is null or public_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_source_url text,
  public_phone text,
  profile_url text,
  source_url text not null check (source_url ~ '^https?://'),
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Never store a guessed email: every email must cite where it was published.
  check (public_email is null or coalesce(email_source_url, '') ~ '^https?://')
);
create index contacts_user_org_idx on public.contacts (user_id, organization_id);
create unique index contacts_user_email_uidx on public.contacts (user_id, lower(public_email)) where public_email is not null;

-- ---------------------------------------------------------------------------
-- 16. client_pipeline
-- ---------------------------------------------------------------------------
create table public.client_pipeline (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  segment text not null check (segment in (
    'private_school', 'training_institution', 'clinic', 'healthcare',
    'travel', 'hospitality', 'other')),
  stage text not null default 'prospect' check (stage in (
    'prospect', 'researching', 'qualified', 'contacted', 'meeting',
    'proposal', 'negotiation', 'won', 'lost')),
  pain_points text[] not null default '{}',
  recommended_services text[] not null default '{}',
  fit_score smallint check (fit_score between 0 and 100),
  estimated_deal_value numeric(14, 2) check (estimated_deal_value is null or estimated_deal_value >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  deal_value_assumptions text,
  next_action text,
  next_action_due timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deal estimates must carry labelled assumptions.
  check (estimated_deal_value is null or (currency is not null and length(coalesce(deal_value_assumptions, '')) > 0))
);
create index client_pipeline_user_stage_idx on public.client_pipeline (user_id, stage);

-- ---------------------------------------------------------------------------
-- 6. applications
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  status text not null default 'preparing' check (status in (
    'preparing', 'ready_for_review', 'submitted', 'interview', 'offer',
    'accepted', 'rejected', 'withdrawn')),
  submitted_at timestamptz,
  submitted_by text check (submitted_by is null or submitted_by in ('user', 'agent_with_approval')),
  next_step text,
  next_step_due timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('submitted', 'interview', 'offer', 'accepted') or submitted_by is not null)
);
create index applications_user_status_idx on public.applications (user_id, status);
create index applications_user_due_idx on public.applications (user_id, next_step_due) where next_step_due is not null;

-- ---------------------------------------------------------------------------
-- 19. approval_requests (supporting table for the permission architecture)
-- ---------------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_by_agent text not null check (public.pies_is_valid_agent(requested_by_agent)),
  action text not null,
  permission_level smallint not null check (permission_level between 3 and 4),
  target_table text,
  target_id uuid,
  summary text not null check (length(summary) between 1 and 2000),
  payload_hash text,                    -- binds approval to exact content
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'consumed', 'expired')),
  decided_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approval_requests_user_status_idx on public.approval_requests (user_id, status);

-- ---------------------------------------------------------------------------
-- 7. outreach
-- ---------------------------------------------------------------------------
create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  client_pipeline_id uuid references public.client_pipeline(id) on delete set null,
  channel text not null default 'email' check (channel in ('email', 'linkedin', 'phone', 'whatsapp', 'other')),
  purpose text check (purpose is null or purpose in (
    'introduction', 'application', 'partnership', 'proposal', 'follow_up', 'other')),
  subject text,
  body text,
  status text not null default 'draft_internal' check (status in (
    'draft_internal', 'gmail_draft_created', 'approved_to_send', 'sent',
    'replied', 'bounced', 'cancelled')),
  gmail_draft_id text,
  gmail_thread_id text,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  sent_at timestamptz,
  follow_up_due timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A message can only be marked approved/sent if it is tied to an approval.
  check (status not in ('approved_to_send', 'sent') or approval_request_id is not null)
);
create index outreach_user_status_idx on public.outreach (user_id, status);
create index outreach_user_followup_idx on public.outreach (user_id, follow_up_due) where follow_up_due is not null;

-- ---------------------------------------------------------------------------
-- 8. activities (tasks & activity log for the user)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('task', 'note', 'meeting', 'call', 'deadline', 'event')),
  title text not null check (length(title) between 1 and 500),
  description text,
  priority smallint not null default 3 check (priority between 1 and 5),
  related_table text,
  related_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  created_by text not null default 'user' check (created_by = 'user' or public.pies_is_valid_agent(created_by)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activities_user_due_idx on public.activities (user_id, due_at) where completed_at is null;

-- ---------------------------------------------------------------------------
-- 9. agent_runs
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (public.pies_is_valid_agent(agent)),
  workflow text,
  trigger text not null check (trigger in ('schedule', 'manual', 'webhook', 'coordinator')),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'failed', 'cancelled',
    'budget_blocked', 'permission_blocked', 'timed_out')),
  max_tasks integer not null default 50 check (max_tasks between 1 and 200),
  timeout_seconds integer not null default 600 check (timeout_seconds between 10 and 3600),
  items_processed integer not null default 0 check (items_processed >= 0),
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_runs_user_agent_idx on public.agent_runs (user_id, agent, created_at desc);

-- ---------------------------------------------------------------------------
-- 10. agent_tasks
-- ---------------------------------------------------------------------------
create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete cascade,
  parent_task_id uuid references public.agent_tasks(id) on delete cascade,
  agent text not null check (public.pies_is_valid_agent(agent)),
  action text not null,
  status text not null default 'pending' check (status in (
    'pending', 'running', 'done', 'failed', 'blocked', 'awaiting_approval', 'cancelled')),
  -- Prevents uncontrolled agent-to-agent recursion.
  depth smallint not null default 0 check (depth between 0 and 3),
  attempts smallint not null default 0,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 5),
  idempotency_key text,
  input jsonb,
  output jsonb,
  error text,
  related_table text,
  related_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts between 0 and max_attempts)
);
create index agent_tasks_user_status_idx on public.agent_tasks (user_id, status);
create unique index agent_tasks_idem_uidx on public.agent_tasks (user_id, idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 12. skills
-- ---------------------------------------------------------------------------
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  category text,
  proficiency smallint check (proficiency between 1 and 5),
  evidence text,
  source text not null default 'user_provided' check (source in (
    'user_provided', 'initialization_context', 'document')),
  source_document_id uuid references public.documents(id) on delete set null,
  verification_status text not null default 'user_asserted' check (verification_status in (
    'user_asserted', 'document_verified', 'unverified', 'disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index skills_user_name_uidx on public.skills (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- 20. provider_configs (supporting table for the budget governor)
-- A paid provider is unusable until enabled AND its pricing is verified with a source.
-- ---------------------------------------------------------------------------
create table public.provider_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_.-]{2,64}$'),
  category text not null check (category in ('ai', 'search', 'infra')),
  enabled boolean not null default false,
  pricing_verified boolean not null default false,
  pricing_notes text,
  pricing_source_url text,
  pricing_verified_at timestamptz,
  monthly_cap_usd numeric(10, 4) check (monthly_cap_usd is null or (monthly_cap_usd >= 0 and monthly_cap_usd <= 10)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  check (not pricing_verified or (coalesce(pricing_source_url, '') ~ '^https?://' and pricing_verified_at is not null))
);

-- ---------------------------------------------------------------------------
-- 13. budgets
-- ---------------------------------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  category text not null check (category in ('ai', 'search', 'infra')),
  limit_usd numeric(10, 4) not null check (limit_usd >= 0 and limit_usd <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_month, category)
);

-- ---------------------------------------------------------------------------
-- 14. usage_records
-- ---------------------------------------------------------------------------
create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  category text not null check (category in ('ai', 'search', 'infra')),
  provider text not null,
  operation text not null,
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  estimated_usd numeric(10, 6) not null check (estimated_usd > 0),
  actual_usd numeric(10, 6) check (actual_usd is null or actual_usd >= 0),
  overrun boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (status <> 'committed' or actual_usd is not null)
);
create index usage_records_user_period_idx on public.usage_records (user_id, period_month, category, status);

-- ---------------------------------------------------------------------------
-- 15. audit_logs (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_type text not null check (actor_type in ('agent', 'user', 'system')),
  actor_id text not null,
  action text not null,
  permission_level smallint check (permission_level between 1 and 4),
  decision text not null check (decision in ('allowed', 'denied', 'requires_approval', 'approved_by_user', 'not_applicable')),
  result text not null check (result in ('success', 'failure', 'skipped', 'pending')),
  related_table text,
  related_id uuid,
  error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_user_created_idx on public.audit_logs (user_id, created_at desc);

create or replace function public.pies_audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger audit_logs_no_update before update on public.audit_logs
  for each row execute function public.pies_audit_immutable();
create trigger audit_logs_no_delete before delete on public.audit_logs
  -- Direct deletes are blocked; FK cascades (account deletion) run at depth > 0.
  for each row when (pg_trigger_depth() = 0)
  execute function public.pies_audit_immutable();

-- ---------------------------------------------------------------------------
-- 17. notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'approval_needed', 'deadline', 'budget', 'workflow_failure', 'briefing', 'draft_ready', 'info')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text,
  related_table text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------
-- 18. user_preferences
-- ---------------------------------------------------------------------------
create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  timezone text not null default 'Africa/Kigali',
  daily_briefing_hour smallint not null default 7 check (daily_briefing_hour between 0 and 23),
  -- Global kill switch: paid operations are OFF until the user turns them on.
  paid_operations_enabled boolean not null default false,
  monthly_budget_usd numeric(10, 4) not null default 10 check (monthly_budget_usd >= 0 and monthly_budget_usd <= 10),
  discovery_categories text[] not null default '{employment,education,scholarship,grant,funding,accelerator,partnership,consulting,commercial}',
  target_countries text[] not null default '{US,CA}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_profiles', 'profile_entries', 'documents', 'organizations', 'opportunities',
    'opportunity_sources', 'contacts', 'client_pipeline', 'applications',
    'approval_requests', 'outreach', 'activities', 'agent_runs', 'agent_tasks',
    'skills', 'provider_configs', 'budgets', 'usage_records', 'user_preferences'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.pies_set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Full CRUD on own rows for ordinary user-owned tables.
do $$
declare t text;
begin
  foreach t in array array[
    'user_profiles', 'profile_entries', 'documents', 'organizations', 'opportunities',
    'opportunity_sources', 'contacts', 'client_pipeline', 'applications',
    'outreach', 'activities', 'agent_runs', 'agent_tasks', 'skills',
    'provider_configs', 'notifications', 'user_preferences'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_owner_all', t);
  end loop;
end;
$$;

-- Governed tables: users can READ their rows; writes go through
-- SECURITY DEFINER functions that enforce the rules.
do $$
declare t text;
begin
  foreach t in array array['budgets', 'usage_records', 'approval_requests', 'audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (user_id = (select auth.uid()))',
      t || '_owner_select', t);
  end loop;
end;
$$;

-- Users may append audit entries about themselves (never update/delete).
create policy audit_logs_owner_insert on public.audit_logs for insert to authenticated
  with check (user_id = (select auth.uid()) and actor_type = 'user');

-- The anon role gets nothing.
revoke all on all tables in schema public from anon;
