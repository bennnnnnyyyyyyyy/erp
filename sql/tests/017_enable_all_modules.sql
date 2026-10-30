-- sql/tests/017_enable_all_modules.sql
-- core_enable_all_modules: switches on all five apps, audited, repeat is a no-op, re-enables a disabled one, unknown
-- organization refused, closed to signed-in users. Always rolls back. Needs sql/001-021.

do $$
declare
  ua uuid := gen_random_uuid();
  oa uuid; n int; c bigint; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values (ua, 'authenticated', 'authenticated', 'allmods@tests.invalid');
  oa := public.bootstrap_organization('All Modules Test', 'all-modules-test', 'allmods@tests.invalid');

  n := public.core_enable_all_modules(oa);
  select count(*) into c from public.org_modules where org_id = oa and disabled_at is null and module_key in ('inventory', 'tasks', 'messaging', 'purchasing', 'sales');
  if c <> 5 then raise exception 'FAIL S1a: % of 5 apps on (changed %)', c, n; end if;
  select count(*) into c from public.audit_log where org_id = oa and action = 'module.enabled';
  if c < n then raise exception 'FAIL S1b: changes not audited'; end if;

  -- S2: repeat changes nothing
  if public.core_enable_all_modules(oa) <> 0 then raise exception 'FAIL S2: repeat changed something'; end if;

  -- S3: a disabled app is switched back on
  update public.org_modules set disabled_at = now() where org_id = oa and module_key = 'sales';
  if public.core_enable_all_modules(oa) <> 1 then raise exception 'FAIL S3: disabled app not re-enabled'; end if;

  -- S4: unknown organization refused; signed-in users cannot call it; audit chain intact
  ok := false; begin perform public.core_enable_all_modules(gen_random_uuid()); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL S4a: unknown organization accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_enable_all_modules(oa); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL S4b: a signed-in user could call it'; end if;
  select count(*) into c from public.audit_verify(oa);
  if c <> 0 then raise exception 'FAIL S4c: audit chain broken'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
