-- 039_org_tour.sql
-- A per-organization switch for the in-app guided tour (documentation/plans/IN_APP_TOUR_PLAN.md). Off by default for every company; an
-- owner or admin switches it on or off (Settings > General). It is independent of the Getting-started tutorial flag (sql/032).
-- Same pattern as core_set_tutorial: one function checks the role, changes the setting and writes the audit row in the same transaction
-- (ADR-0003); nothing else is touched. No new table: the flag lives in organizations.settings like show_tutorial.
-- Depends on sql/001-038. Rerun-safe. Run the whole file, then sql/tests/033_org_tour.sql.

begin;

create or replace function public.core_set_tour(p_show boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_before boolean;
begin
  if p_show is null then raise exception 'INVALID_INPUT'; end if;
  select coalesce((o.settings ->> 'show_tour')::boolean, false) into v_before from public.organizations o where o.id = v_org;
  if v_before = p_show then return p_show; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('show_tour', p_show) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'organization.tour_changed', 'organization', v_org::text, case when p_show then 'Guided tour switched on' else 'Guided tour switched off' end);
  return p_show;
end $$;

revoke all on function public.core_set_tour(boolean) from public, anon;
grant execute on function public.core_set_tour(boolean) to authenticated;

commit;

-- Verification (read-only): signed-in users can call it (true), anonymous cannot (false).
select has_function_privilege('authenticated', 'public.core_set_tour(boolean)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.core_set_tour(boolean)', 'execute') as anon_can_set;
