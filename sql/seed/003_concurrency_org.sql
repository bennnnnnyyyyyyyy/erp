-- sql/seed/003_concurrency_org.sql
-- TEST DATA, not a migration. A separate throwaway organization "Concurrency Check (test)" for scripts/concurrency-check.mjs,
-- so the race tests never touch the demo organization. Needs three existing Auth users (created by the same method as the
-- demo users; passwords live only in .temp/concurrency-credentials.txt, git-ignored):
--   conc-owner@tests.invalid (owner), conc-manager@tests.invalid (admin), conc-requester@tests.invalid (member)
-- Needs sql/001-015. Safe to rerun: does nothing if the organization exists. Never deletes anything.

do $$
declare
  uo uuid; um uuid; ur uuid; oid uuid;
begin
  select id into uo from auth.users where lower(email) = 'conc-owner@tests.invalid';
  select id into um from auth.users where lower(email) = 'conc-manager@tests.invalid';
  select id into ur from auth.users where lower(email) = 'conc-requester@tests.invalid';
  if uo is null or um is null or ur is null then raise exception 'Create the three concurrency test users first'; end if;
  if exists (select 1 from public.organizations where slug = 'concurrency-check') then raise notice 'already exists'; return; end if;
  oid := public.bootstrap_organization('Concurrency Check (test)', 'concurrency-check', 'conc-owner@tests.invalid');
  update public.organizations set default_currency = 'EGP', timezone = 'Africa/Cairo' where id = oid;
  insert into public.memberships (org_id, user_id, role, invited_by) values (oid, um, 'admin', uo), (oid, ur, 'member', uo);
  insert into public.org_modules (org_id, module_key, enabled_by) values (oid, 'inventory', uo), (oid, 'messaging', uo), (oid, 'tasks', uo);
end $$;
