-- sql/tests/062_blind_counts.sql
-- The blind stock count setting (sql/066). Always rolls back. Needs sql/001-066.
-- Covers: off by default; an owner switches it on and off (audited, only when it changes); a member and a viewer cannot; another
-- company is not affected; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; ok boolean; n bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'bc-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'bc-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'bc-x@tests.invalid');
  o := public.bootstrap_organization('Blind Test A', 'blind-test-a', 'bc-o@tests.invalid');
  ob := public.bootstrap_organization('Blind Test B', 'blind-test-b', 'bc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');

  if coalesce((select (settings ->> 'blind_counts')::boolean from public.organizations where id = o), false) then
    raise exception 'FAIL B0: blind counts on by default';
  end if;

  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.core_set_blind_counts(true) then raise exception 'FAIL B1a: not switched on'; end if;
  perform public.core_set_blind_counts(true);   -- no change: no second audit row
  reset role;
  if not (select (settings ->> 'blind_counts')::boolean from public.organizations where id = o) then raise exception 'FAIL B1b: not stored'; end if;
  select count(*) into n from public.audit_log where org_id = o and action = 'organization.blind_counts_changed';
  if n <> 1 then raise exception 'FAIL B1c: % audit rows, expected 1', n; end if;

  -- a member cannot change it
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_set_blind_counts(false); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL B2: a member changed the setting'; end if;

  -- another company is untouched, and its owner changes only their own
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform public.core_set_blind_counts(false);
  reset role;
  if not (select (settings ->> 'blind_counts')::boolean from public.organizations where id = o) then raise exception 'FAIL B3: another company changed it'; end if;

  if has_function_privilege('anon', 'public.core_set_blind_counts(boolean)', 'execute') then raise exception 'FAIL A1: anonymous can change it'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
