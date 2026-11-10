-- sql/066_blind_counts.sql
-- Blind stock counts as a company setting (MVP decision M3, Ben 10 Nov 2026: "a company setting"). Rerun-safe. Needs sql/001-065.
--
-- When on, people who are not owners or admins do not see the quantity the books expect while they count (they count what is there,
-- not what they expect). Owners and admins still see it, and see the differences when approving. Off by default.
-- Same pattern as core_set_tour (sql/039): the flag lives in organizations.settings ('blind_counts'); one function checks the role,
-- changes it and writes the audit row in the same transaction. The API leaves the expected quantity out of the count for everyone else.
-- Limit (written down on purpose): the Stock on hand screen still shows on-hand quantities to anyone who can read stock, so a blind
-- count hides the expected quantity on the count itself, not the stock level everywhere.

begin;

create or replace function public.core_set_blind_counts(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_before boolean;
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  select coalesce((o.settings ->> 'blind_counts')::boolean, false) into v_before from public.organizations o where o.id = v_org;
  if v_before = p_on then return p_on; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('blind_counts', p_on) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'organization.blind_counts_changed', 'organization', v_org::text,
          case when p_on then 'Blind stock counts switched on' else 'Blind stock counts switched off' end);
  return p_on;
end $$;

revoke all on function public.core_set_blind_counts(boolean) from public, anon;
grant execute on function public.core_set_blind_counts(boolean) to authenticated;

commit;

-- Verification (read-only): signed-in users can call it (true), anonymous cannot (false).
select has_function_privilege('authenticated', 'public.core_set_blind_counts(boolean)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.core_set_blind_counts(boolean)', 'execute') as anon_can_set;
