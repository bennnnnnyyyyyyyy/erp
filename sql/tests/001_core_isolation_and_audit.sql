-- sql/tests/001_core_isolation_and_audit.sql
-- Proves the rules in sql/001 to sql/004 on a real database. Self-contained, always rolls back (see README.md).
-- Result: an ERROR whose message says "ALL TESTS PASSED" is a pass; "FAIL T<n>" names the failed check.
-- Last run: 2026-10-29, ALL TESTS PASSED.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner of org A
  ub uuid := gen_random_uuid();  -- owner of org B
  uc uuid := gen_random_uuid();  -- plain member of org A
  oa uuid;
  ob uuid;
  n  bigint;
  ok boolean;
begin
  -- ------------------------------------------------------------ setup (as postgres)
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'iso-a@tests.invalid'),
    (ub, 'authenticated', 'authenticated', 'iso-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'iso-c@tests.invalid');
  oa := public.bootstrap_organization('Isolation A', 'iso-test-a', 'iso-a@tests.invalid');
  ob := public.bootstrap_organization('Isolation B', 'iso-test-b', 'iso-b@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, uc, 'member');

  -- ------------------------------------------------------------ act as user A, in org A
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;

  -- T1: row level security hides every other organization, including real ones already in this database.
  select count(*) into n from public.organizations;
  if n <> 1 then raise exception 'FAIL T1a: user A sees % organizations, expected 1', n; end if;
  select count(*) into n from public.memberships where org_id = ob;
  if n <> 0 then raise exception 'FAIL T1b: user A sees % memberships of org B', n; end if;
  select count(*) into n from public.org_modules where org_id = ob;
  if n <> 0 then raise exception 'FAIL T1c: user A sees org B modules'; end if;
  select count(*) into n from public.audit_log;
  if n <> 1 then raise exception 'FAIL T1d: user A sees % audit rows, expected only org A''s 1', n; end if;

  -- T2: the organization header is accepted only for a real membership.
  if public.current_org_id() <> oa then raise exception 'FAIL T2a: current_org_id did not return org A'; end if;

  perform set_config('request.headers', '{}', true);
  ok := false;
  begin perform public.current_org_id(); exception when others then ok := (sqlerrm = 'ORG_REQUIRED'); end;
  if not ok then raise exception 'FAIL T2b: missing header was not refused with ORG_REQUIRED'; end if;

  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  ok := false;
  begin perform public.current_org_id(); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL T2c: org B header was not refused with NOT_A_MEMBER'; end if;

  -- T3: functions refuse to act in an organization the caller does not belong to.
  ok := false;
  begin perform public.core_set_module('inventory', true); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL T3a: core_set_module worked with org B header'; end if;
  ok := false;
  begin perform public.core_update_org(p_name => 'hacked'); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL T3b: core_update_org worked with org B header'; end if;

  -- T4: in the right organization the owner can act, and the change shows up.
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  perform public.core_set_module('inventory', true);
  select count(*) into n from public.org_modules where org_id = oa and module_key = 'inventory' and disabled_at is null;
  if n <> 1 then raise exception 'FAIL T4: module was not switched on for org A'; end if;

  -- T5: no direct writes for signed-in users (privileges, not just policies).
  ok := false;
  begin insert into public.org_modules (org_id, module_key) values (oa, 'sneaky'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T5a: direct insert into org_modules was allowed'; end if;
  ok := false;
  begin update public.organizations set name = 'x' where id = oa; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T5b: direct update of organizations was allowed'; end if;
  ok := false;
  begin delete from public.audit_log; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T5c: direct delete from audit_log was allowed'; end if;
  ok := false;
  begin insert into public.audit_log (org_id, action, entity_type) values (oa, 'forged', 'x'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T5d: direct insert into audit_log was allowed (history could be forged)'; end if;
  ok := false;
  begin truncate public.audit_log; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T5e: TRUNCATE on audit_log was allowed'; end if;

  -- T6: admin-only functions are closed to signed-in users.
  ok := false;
  begin perform public.audit_append_admin(oa, ua, 'x', 'x'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T6a: audit_append_admin callable by a signed-in user'; end if;
  ok := false;
  begin perform public.audit_verify(oa); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T6b: audit_verify callable by a signed-in user'; end if;

  -- ------------------------------------------------------------ act as user C (plain member of org A)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;

  -- T7: a member can read but not change organization settings or modules.
  ok := false;
  begin perform public.core_set_module('inventory', false); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T7a: a plain member could switch a module off'; end if;
  ok := false;
  begin perform public.core_update_org(p_name => 'renamed by member'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T7b: a plain member could change organization settings'; end if;

  -- ------------------------------------------------------------ anonymous visitors
  reset role;
  set local role anon;
  ok := false;
  begin select count(*) into n from public.organizations; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL T8: anon could read organizations'; end if;

  -- ------------------------------------------------------------ back to postgres: what really happened
  reset role;

  select count(*) into n from public.org_modules where org_id = ob;
  if n <> 0 then raise exception 'FAIL T9a: org B received a module change'; end if;
  select count(*) into n from public.organizations where id = ob and name = 'Isolation B';
  if n <> 1 then raise exception 'FAIL T9b: org B was changed'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'module.enabled';
  if n <> 1 then raise exception 'FAIL T9c: expected exactly one module.enabled audit row for org A, found %', n; end if;
  select count(*) into n from public.audit_log where action in ('forged', 'hacked');
  if n <> 0 then raise exception 'FAIL T9d: a forged audit row exists'; end if;

  -- T10: each organization has its own gapless chain and both verify clean.
  select count(*) into n from public.audit_log where org_id = oa and (seq is null or hash is null);
  if n <> 0 then raise exception 'FAIL T10a: org A has audit rows without sequence or hash'; end if;
  select count(*) into n from (select count(*) c, min(seq) lo, max(seq) hi from public.audit_log where org_id = oa) x where lo <> 1 or hi <> c;
  if n <> 0 then raise exception 'FAIL T10b: org A audit sequence is not 1..n'; end if;
  select count(*) into n from (select count(*) c, min(seq) lo, max(seq) hi from public.audit_log where org_id = ob) x where lo <> 1 or hi <> c;
  if n <> 0 then raise exception 'FAIL T10c: org B audit sequence is not 1..n (chains must be independent)'; end if;
  select count(*) into n from public.audit_verify(oa);
  if n <> 0 then raise exception 'FAIL T10d: audit_verify found a problem in org A'; end if;
  select count(*) into n from public.audit_verify(ob);
  if n <> 0 then raise exception 'FAIL T10e: audit_verify found a problem in org B'; end if;

  -- T11: even the database owner cannot edit or empty the audit log.
  ok := false;
  begin update public.audit_log set summary = 'tampered' where org_id = oa; exception when others then ok := (sqlerrm like 'audit_log is append-only%'); end;
  if not ok then raise exception 'FAIL T11a: audit_log update was not refused by the append-only rule'; end if;
  ok := false;
  begin delete from public.audit_log where org_id = oa; exception when others then ok := (sqlerrm like 'audit_log is append-only%'); end;
  if not ok then raise exception 'FAIL T11b: audit_log delete was not refused by the append-only rule'; end if;
  ok := false;
  begin truncate public.audit_log; exception when others then ok := (sqlerrm like 'audit_log is append-only%'); end;
  if not ok then raise exception 'FAIL T11c: audit_log truncate was not refused by the append-only rule'; end if;

  -- Roll everything back on purpose: nothing from this test is kept.
  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
