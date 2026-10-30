-- 016_org_people.sql
-- X7 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): names for display. The members list is admin-only, so a requester saw
-- "Someone" instead of the person's name on requests, tasks and the activity log. This returns ONLY user id and display name
-- (never email, role or sign-in data) for the active members of the caller's own organization, to any member.
-- Display name = full name or name from the profile, else the part of the email before the "@".
-- Depends on sql/001-015. Rerun-safe. Run the whole file, then sql/tests/012_org_people.sql.

begin;

create or replace function public.core_org_people() returns table (user_id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'NOT_A_MEMBER'; end if;
  return query
    select m.user_id,
           coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1))
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.org_id = v_org and m.disabled_at is null
     order by 2;
end $$;

revoke all on function public.core_org_people() from public, anon;
grant execute on function public.core_org_people() to authenticated;

commit;

-- Verification (read-only): signed-in users may run it, anonymous may not (expect true, false).
select has_function_privilege('authenticated', 'public.core_org_people()', 'execute') as authenticated_can,
       has_function_privilege('anon', 'public.core_org_people()', 'execute') as anon_can;
