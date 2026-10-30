-- sql/tests/010_audit_check.sql
-- O3: scheduled audit-chain check and alert. Always rolls back. Needs sql/001-014.
-- Tampering is simulated by switching off the append-only trigger inside this rolled-back test only.

do $$
declare
  ua uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  oa uuid;
  j jsonb;
  n bigint;
  v_runs bigint;
  v_seq bigint;
  ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'aud-a@tests.invalid'), (uc, 'authenticated', 'authenticated', 'aud-c@tests.invalid');
  oa := public.bootstrap_organization('Audit Test A', 'aud-test-a', 'aud-a@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, uc, 'member');
  insert into public.org_modules (org_id, module_key) values (oa, 'messaging'), (oa, 'inventory');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  perform public.inv_create_warehouse('MAIN', 'Main');
  perform public.inv_create_warehouse('SIDE', 'Side');
  reset role;

  -- ---- S1: a clean run checks every organization and finds nothing; it is recorded
  select count(*) into v_runs from public.audit_check_runs;
  j := public.audit_check_all(true);
  if (j ->> 'skipped')::boolean or jsonb_array_length(j -> 'broken') <> 0 then raise exception 'FAIL S1a: a clean database reported a problem: %', j; end if;
  if (j ->> 'orgs_checked')::int < 1 then raise exception 'FAIL S1b: no organizations were checked'; end if;
  select count(*) into n from public.audit_check_runs;
  if n <> v_runs + 1 then raise exception 'FAIL S1c: the run was not recorded'; end if;
  select count(*) into n from public.msg_outbox where org_id = oa and kind = 'alert';
  if n <> 0 then raise exception 'FAIL S1d: an alert was queued for a clean chain'; end if;

  -- ---- S2: it does not run again within the hour unless forced
  j := public.audit_check_all(false);
  if not (j ->> 'skipped')::boolean then raise exception 'FAIL S2: the check ran twice within an hour'; end if;

  -- ---- S3: a tampered entry is detected and the owner is alerted exactly once
  select min(seq) + 1 into v_seq from public.audit_log where org_id = oa and seq is not null;
  alter table public.audit_log disable trigger audit_log_append_only;
  update public.audit_log set summary = 'tampered' where org_id = oa and seq = v_seq;
  alter table public.audit_log enable trigger audit_log_append_only;
  j := public.audit_check_all(true);
  if jsonb_array_length(j -> 'broken') < 1 or not (j -> 'broken') @> jsonb_build_array(jsonb_build_object('org_id', oa, 'first_bad_seq', v_seq)) then
    raise exception 'FAIL S3a: the tampered entry (seq %) was not reported: %', v_seq, j;
  end if;
  select count(*) into n from public.msg_outbox where org_id = oa and kind = 'alert' and recipient_id = ua;
  if n <> 1 then raise exception 'FAIL S3b: expected one alert to the owner, found %', n; end if;
  select count(*) into n from public.msg_outbox where org_id = oa and kind = 'alert' and recipient_id = uc;
  if n <> 0 then raise exception 'FAIL S3c: a plain member was alerted'; end if;
  j := public.audit_check_all(true);
  select count(*) into n from public.msg_outbox where org_id = oa and kind = 'alert';
  if n <> 1 then raise exception 'FAIL S3d: the same break queued a second alert (%)', n; end if;
  select count(*) into n from public.audit_check_runs where broken_orgs >= 1;
  if n < 2 then raise exception 'FAIL S3e: the runs that found a break were not recorded'; end if;

  -- ---- S4: closed to signed-in users
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.audit_check_all(true); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S4a: a signed-in user could run the audit check'; end if;
  ok := false;
  begin perform 1 from public.audit_check_runs; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL S4b: a signed-in user could read the run records'; end if;
  reset role;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
