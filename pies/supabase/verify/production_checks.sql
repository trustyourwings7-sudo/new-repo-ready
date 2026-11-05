-- PIES production verification. READ-ONLY. Paste into the Supabase SQL editor after
-- applying migrations. Every row must show ok = true (rows marked "info" are guidance).
-- The local test suite runs this same file against its throwaway database.
with
pub_tables as (
  select c.oid, c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) as owner
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
fn_exec as (
  select r.rolname, string_agg(p.proname, ',' order by p.proname) as fns
  from pg_proc p cross join (values ('anon'), ('authenticated'), ('pies_automation')) r(rolname)
  where p.pronamespace = 'public'::regnamespace
    and exists (select 1 from pg_roles where rolname = r.rolname)
    and has_function_privilege(r.rolname, p.oid, 'execute')
  group by r.rolname
)
select * from (
  select 1 as n, 'postgres version >= 15 (needed for ON DELETE SET NULL (col))' as check_name,
         current_setting('server_version_num')::int >= 150000 as ok, current_setting('server_version') as detail
  union all
  select 2, 'RLS enabled on every public table',
         bool_and(relrowsecurity), coalesce(string_agg(relname, ',') filter (where not relrowsecurity), 'all enabled')
  from pub_tables
  union all
  select 3, 'all public tables owned by one role (definer functions rely on owner bypass)',
         count(distinct owner) = 1, string_agg(distinct owner, ',')
  from pub_tables
  union all
  select 4, 'anon holds no table privileges',
         not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
         (select coalesce(string_agg(distinct table_name, ','), 'none') from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public')
  union all
  select 5, 'anon executes no public functions',
         coalesce((select fns from fn_exec where rolname = 'anon'), '') = '',
         coalesce((select fns from fn_exec where rolname = 'anon'), 'none')
  union all
  select 6, 'authenticated function allowlist',
         (select fns from fn_exec where rolname = 'authenticated')
           = 'budget_summary,decide_approval,initialize_profile,initialize_projects,pies_is_valid_agent,set_category_limit',
         (select fns from fn_exec where rolname = 'authenticated')
  union all
  select 7, 'pies_automation role exists',
         exists (select 1 from pg_roles where rolname = 'pies_automation'), null
  union all
  select 8, 'pies_automation function allowlist',
         (select fns from fn_exec where rolname = 'pies_automation') = 'automation_execute,commit_usage,release_usage,reserve_budget',
         (select fns from fn_exec where rolname = 'pies_automation')
  union all
  select 9, 'pies_automation holds no table privileges',
         not exists (select 1 from information_schema.role_table_grants where grantee = 'pies_automation'),
         (select coalesce(string_agg(distinct table_schema || '.' || table_name, ','), 'none') from information_schema.role_table_grants where grantee = 'pies_automation')
  union all
  select 10, 'pies_automation is not superuser, has no BYPASSRLS, CREATEROLE or CREATEDB',
         not (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb),
         format('super=%s bypassrls=%s createrole=%s createdb=%s', rolsuper, rolbypassrls, rolcreaterole, rolcreatedb)
  from pg_roles where rolname = 'pies_automation'
  union all
  select 11, 'pies_automation is a member of no other role',
         not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'pies_automation'),
         (select coalesce(string_agg(g.rolname, ','), 'none') from pg_auth_members m join pg_roles r on r.oid = m.member
            join pg_roles g on g.oid = m.roleid where r.rolname = 'pies_automation')
  union all
  select 12, 'pies_automation cannot create objects in public',
         not has_schema_privilege('pies_automation', 'public', 'create'), null
  union all
  select 13, 'every SECURITY DEFINER function pins search_path',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
                       and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')),
         (select coalesce(string_agg(proname, ','), 'all pinned') from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
            and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%'))
  union all
  select 14, 'no RLS policy targets anon or public',
         not exists (select 1 from pg_policies where schemaname = 'public' and roles && array['anon', 'public']::name[]),
         (select coalesce(string_agg(tablename || '.' || policyname, ','), 'none') from pg_policies
            where schemaname = 'public' and roles && array['anon', 'public']::name[])
  union all
  select 15, 'auth.uid() reads the request JWT (Supabase contract)',
         exists (select 1 from pg_proc where pronamespace = 'auth'::regnamespace and proname = 'uid'
                   and prosrc like '%request.jwt.claim%'), null
  union all
  select 16, 'info: pies_automation login enabled (required before the API can connect)',
         true, (select case when rolcanlogin then 'login enabled' else 'NOT YET: run ALTER ROLE pies_automation LOGIN PASSWORD ...' end
                from pg_roles where rolname = 'pies_automation')
) checks order by n;
