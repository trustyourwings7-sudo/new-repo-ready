-- Phase 1.5 hardening, part 1
--  * F-02: foreign keys previously accepted references to ANOTHER user's rows
--          (FK checks bypass RLS). Every user-owned reference is now a composite
--          (id, user_id) key, so a row can only point at rows of the same owner.
--  * Project-based architecture: independent projects/objectives (career, funding,
--    JAMOF ventures, Shemmaa, consulting, lead generation, ...) without core changes.
--  * F-05: outreach could be marked approved/sent while pointing at a pending or
--          rejected approval. A trigger now checks the approval itself.

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in (
    'career', 'education_funding', 'venture', 'consulting', 'lead_generation', 'personal', 'other')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (id, user_id)
);
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.pies_set_updated_at();
alter table public.projects enable row level security;
create policy projects_owner_all on public.projects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- (id, user_id) uniqueness on every referenced parent
-- ---------------------------------------------------------------------------
alter table public.documents         add constraint documents_id_user_uk         unique (id, user_id);
alter table public.organizations     add constraint organizations_id_user_uk     unique (id, user_id);
alter table public.opportunities     add constraint opportunities_id_user_uk     unique (id, user_id);
alter table public.contacts          add constraint contacts_id_user_uk          unique (id, user_id);
alter table public.client_pipeline   add constraint client_pipeline_id_user_uk   unique (id, user_id);
alter table public.approval_requests add constraint approval_requests_id_user_uk unique (id, user_id);
alter table public.agent_runs        add constraint agent_runs_id_user_uk        unique (id, user_id);
alter table public.agent_tasks       add constraint agent_tasks_id_user_uk       unique (id, user_id);

-- ---------------------------------------------------------------------------
-- Replace single-column FKs with same-owner composite FKs.
-- ON DELETE SET NULL (col) nulls only the reference, never user_id (PostgreSQL 15+).
-- ---------------------------------------------------------------------------
alter table public.profile_entries drop constraint profile_entries_document_fk,
  add constraint profile_entries_document_fk foreign key (source_document_id, user_id)
  references public.documents (id, user_id) on delete set null (source_document_id);

alter table public.skills drop constraint skills_source_document_id_fkey,
  add constraint skills_source_document_fk foreign key (source_document_id, user_id)
  references public.documents (id, user_id) on delete set null (source_document_id);

alter table public.opportunities drop constraint opportunities_organization_id_fkey,
  add constraint opportunities_organization_fk foreign key (organization_id, user_id)
  references public.organizations (id, user_id) on delete set null (organization_id);

alter table public.opportunity_sources drop constraint opportunity_sources_opportunity_id_fkey,
  add constraint opportunity_sources_opportunity_fk foreign key (opportunity_id, user_id)
  references public.opportunities (id, user_id) on delete cascade;

alter table public.contacts drop constraint contacts_organization_id_fkey,
  add constraint contacts_organization_fk foreign key (organization_id, user_id)
  references public.organizations (id, user_id) on delete set null (organization_id);

alter table public.client_pipeline drop constraint client_pipeline_organization_id_fkey,
  add constraint client_pipeline_organization_fk foreign key (organization_id, user_id)
  references public.organizations (id, user_id) on delete cascade;
alter table public.client_pipeline drop constraint client_pipeline_primary_contact_id_fkey,
  add constraint client_pipeline_contact_fk foreign key (primary_contact_id, user_id)
  references public.contacts (id, user_id) on delete set null (primary_contact_id);

alter table public.applications drop constraint applications_opportunity_id_fkey,
  add constraint applications_opportunity_fk foreign key (opportunity_id, user_id)
  references public.opportunities (id, user_id) on delete cascade;

alter table public.outreach drop constraint outreach_contact_id_fkey,
  add constraint outreach_contact_fk foreign key (contact_id, user_id)
  references public.contacts (id, user_id) on delete set null (contact_id);
alter table public.outreach drop constraint outreach_opportunity_id_fkey,
  add constraint outreach_opportunity_fk foreign key (opportunity_id, user_id)
  references public.opportunities (id, user_id) on delete set null (opportunity_id);
alter table public.outreach drop constraint outreach_client_pipeline_id_fkey,
  add constraint outreach_client_pipeline_fk foreign key (client_pipeline_id, user_id)
  references public.client_pipeline (id, user_id) on delete set null (client_pipeline_id);
alter table public.outreach drop constraint outreach_approval_request_id_fkey,
  add constraint outreach_approval_fk foreign key (approval_request_id, user_id)
  references public.approval_requests (id, user_id) on delete set null (approval_request_id);

alter table public.agent_tasks drop constraint agent_tasks_parent_task_id_fkey,
  add constraint agent_tasks_parent_fk foreign key (parent_task_id, user_id)
  references public.agent_tasks (id, user_id) on delete cascade;
alter table public.agent_tasks drop constraint agent_tasks_agent_run_id_fkey,
  add constraint agent_tasks_run_fk foreign key (agent_run_id, user_id)
  references public.agent_runs (id, user_id) on delete cascade;

alter table public.usage_records drop constraint usage_records_agent_run_id_fkey,
  add constraint usage_records_run_fk foreign key (agent_run_id, user_id)
  references public.agent_runs (id, user_id) on delete set null (agent_run_id);

-- ---------------------------------------------------------------------------
-- project_id on records that belong to an objective (nullable = unassigned)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'opportunities', 'organizations', 'contacts', 'client_pipeline', 'applications',
    'outreach', 'activities', 'agent_runs', 'documents'
  ] loop
    execute format('alter table public.%I add column project_id uuid', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (project_id, user_id)
         references public.projects (id, user_id) on delete set null (project_id)',
      t, t || '_project_fk');
    execute format('create index %I on public.%I (user_id, project_id) where project_id is not null',
      t || '_project_idx', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- F-05 outreach send integrity
-- ---------------------------------------------------------------------------
create or replace function public.pies_outreach_send_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.status in ('approved_to_send', 'sent')
     and (tg_op = 'INSERT' or old.status is distinct from new.status
          or old.approval_request_id is distinct from new.approval_request_id) then
    select status into v_status from public.approval_requests
     where id = new.approval_request_id and user_id = new.user_id
       and action = 'send_email' and target_id = new.id;
    if v_status is null
       or (new.status = 'approved_to_send' and v_status not in ('approved', 'consumed'))
       or (new.status = 'sent' and v_status <> 'consumed') then
      raise exception 'outreach % requires a matching % send_email approval',
        new.status, case when new.status = 'sent' then 'consumed' else 'approved' end
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger outreach_send_guard before insert or update on public.outreach
  for each row execute function public.pies_outreach_send_guard();

-- ---------------------------------------------------------------------------
-- initialize_profile: also create the owner's starting projects (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.initialize_projects()
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
    raise exception 'initialize_projects requires a signed-in user' using errcode = '42501';
  end if;
  insert into public.projects (user_id, slug, name, kind, description) values
    (v_uid, 'career', 'Employment & career development', 'career', null),
    (v_uid, 'education-funding', 'Education & funding', 'education_funding', null),
    (v_uid, 'jamof', 'JAMOF ventures', 'venture', 'JAMOFSpot and related JAMOF initiatives'),
    (v_uid, 'shemmaa', 'Shemmaa', 'venture', 'Separate venture; see SHEMMAA.md in the repository root'),
    (v_uid, 'ai-consulting', 'AI automation & consulting services', 'consulting', null),
    (v_uid, 'lead-generation', 'Commercial lead generation', 'lead_generation', null)
  on conflict (user_id, slug) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'projects_inserted', v_n);
end;
$$;
