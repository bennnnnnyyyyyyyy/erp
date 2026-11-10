-- 077_core_owner_self_approval.sql
-- Owners may approve their own requests, as a company setting (decision D1c, Ben, 10 Nov 2026: "all of them, and the single owner can
-- do everything as is").
--
-- Every approval function (stock requests sql/063; adjustments, transfers, counts, credit and debit notes sql/065; purchase orders
-- sql/069) lets the requester decide only when core__sole_approver(org) is true, and then flags the decision self_decided /
-- approval_self and writes a "self-approved" audit row; the table rules accept a requester's decision only when so flagged.
-- This migration widens that one helper: it is also true for an OWNER (not an admin) when the company has switched on
-- `owner_self_approval` (organizations.settings). Nothing else changes: the flag, the audit row and the table rules still apply, and a
-- company with a single owner or admin keeps the D1 exception whatever the setting.
-- The setting is off by default and only an owner can change it (core_set_owner_self_approval, audited).
-- Rerun-safe. Ends with read-only checks.

begin;

create or replace function public.core__sole_approver(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (
    -- D1 (sql/063): the caller is an active owner or admin and no other active owner or admin exists.
    exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null and m.role in ('owner', 'admin'))
    and not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id <> auth.uid() and m.disabled_at is null and m.role in ('owner', 'admin'))
  ) or (
    -- D1c (sql/077): the company lets owners approve their own, and the caller is an active owner.
    coalesce((select (o.settings ->> 'owner_self_approval')::boolean from public.organizations o where o.id = p_org), false)
    and exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.disabled_at is null and m.role = 'owner')
  );
$$;
revoke all on function public.core__sole_approver(uuid) from public, anon, authenticated;

create or replace function public.core_set_owner_self_approval(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner']); v_before boolean;
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  select coalesce((o.settings ->> 'owner_self_approval')::boolean, false) into v_before from public.organizations o where o.id = v_org;
  if v_before = p_on then return p_on; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('owner_self_approval', p_on) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.owner_self_approval_changed', 'organization', v_org::text,
          case when p_on then 'Owners may now approve their own requests (each one is marked self-approved)'
               else 'Owners can no longer approve their own requests (unless they are the only owner or admin)' end,
          jsonb_build_object('owner_self_approval', v_before), jsonb_build_object('owner_self_approval', p_on));
  return p_on;
end $$;

revoke all on function public.core_set_owner_self_approval(boolean) from public, anon;
grant execute on function public.core_set_owner_self_approval(boolean) to authenticated;

commit;

-- Read-only verification.
select has_function_privilege('authenticated', 'public.core__sole_approver(uuid)', 'execute') as users_call_helper,
       has_function_privilege('anon', 'public.core_set_owner_self_approval(boolean)', 'execute') as anon_sets,
       (select count(*) from public.organizations where (settings ->> 'owner_self_approval')::boolean) as companies_with_it_on;
