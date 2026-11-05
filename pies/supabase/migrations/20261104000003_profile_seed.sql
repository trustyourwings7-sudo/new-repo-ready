-- Initial profile context, loaded only when the signed-in user asks for it.
-- Every fact is tagged source = 'initialization_context' and
-- verification_status = 'user_asserted'. Nothing beyond the supplied context is added.

create or replace function public.initialize_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted int := 0;
begin
  if v_uid is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'initialize_profile requires a signed-in user' using errcode = '42501';
  end if;

  insert into public.user_profiles (user_id, location_city, location_country, education_level,
                                    target_countries, interests)
  values (v_uid, 'Kigali', 'Rwanda', 'High school graduate', '{US,CA}',
          '{CRM,SEO,GEO,"business development","AI automation"}')
  on conflict (user_id) do nothing;

  insert into public.user_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;

  if not exists (select 1 from public.profile_entries where user_id = v_uid and source = 'initialization_context') then
    insert into public.profile_entries (user_id, kind, title, organization, description, source, verification_status)
    values
      (v_uid, 'education', 'High school graduate', null, null, 'initialization_context', 'user_asserted'),
      (v_uid, 'athletics', 'Basketball / student-athlete background', null, null, 'initialization_context', 'user_asserted'),
      (v_uid, 'experience', 'Cash services, receiving, dispatching and operational controls', 'ISCO', null, 'initialization_context', 'user_asserted'),
      (v_uid, 'experience', 'Sales and marketing', 'Ramani Travel', null, 'initialization_context', 'user_asserted'),
      (v_uid, 'venture', 'Founder, JAMOFSpot and broader JAMOF initiatives', 'JAMOF', null, 'initialization_context', 'user_asserted'),
      (v_uid, 'interest', 'US and Canadian employment, education, funding and business opportunities', null, null, 'initialization_context', 'user_asserted'),
      (v_uid, 'interest', 'Building a sustainable technology-enabled business', null, null, 'initialization_context', 'user_asserted');
    get diagnostics v_inserted = row_count;
  end if;

  insert into public.skills (user_id, name, category, source, verification_status)
  select v_uid, s, 'interest_area', 'initialization_context', 'unverified'
    from unnest(array['CRM', 'SEO', 'GEO', 'Business development', 'AI automation']) as s
  on conflict (user_id, lower(name)) do nothing;

  return jsonb_build_object('ok', true, 'profile_entries_inserted', v_inserted);
end;
$$;

revoke execute on function public.initialize_profile() from public, anon;
grant execute on function public.initialize_profile() to authenticated;
