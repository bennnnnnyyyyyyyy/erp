-- 021_enable_all_modules.sql
-- "Apps on by default": core_enable_all_modules(org) switches on every app the product ships (the keys in
-- packages/shared/src/modules.ts) for one organization, audited, safe to repeat. It is NOT a trigger on organization
-- creation (the SQL tests add their own module rows after bootstrap_organization and would collide), so whatever creates
-- an organization (onboarding, a seed script) calls it. Service role only; signed-in users cannot call it.
-- Depends on sql/001-020. Rerun-safe. Run the whole file, then sql/tests/017_enable_all_modules.sql.

begin;

create or replace function public.core_enable_all_modules(p_org_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text;
  n int := 0;
begin
  if not exists (select 1 from public.organizations where id = p_org_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  foreach k in array array['inventory', 'tasks', 'messaging', 'purchasing', 'sales'] loop
    if not exists (select 1 from public.org_modules where org_id = p_org_id and module_key = k and disabled_at is null) then
      insert into public.org_modules (org_id, module_key, enabled_at, disabled_at) values (p_org_id, k, now(), null)
      on conflict (org_id, module_key) do update set enabled_at = now(), disabled_at = null;
      insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
      values (p_org_id, 'module.enabled', 'module', k, k || ' switched on (all apps on by default)');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.core_enable_all_modules(uuid) from public, anon, authenticated;
grant execute on function public.core_enable_all_modules(uuid) to service_role;

commit;

-- Verification (read-only): signed-in users cannot run it (expect false).
select has_function_privilege('authenticated', 'public.core_enable_all_modules(uuid)', 'execute') as can_run;
