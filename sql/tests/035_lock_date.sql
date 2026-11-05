-- sql/tests/035_lock_date.sql
-- S1 (SUPERFIX_WORKFLOW_PLAN): the lock date. Always rolls back. Needs sql/001-040.
-- Covers: only an owner sets it, no future date, audit row with old and new value, no-op writes no audit, a dated row on or before the
-- lock is refused and after it accepted, voiding a row from a locked period is refused, removing the lock reopens, one company never
-- affects another, the triggers exist on all four dated tables, no anonymous use.

do $$
declare
  ua uuid := gen_random_uuid();  -- owner, org A
  ub uuid := gen_random_uuid();  -- admin, org A
  uc uuid := gen_random_uuid();  -- member, org A
  ue uuid := gen_random_uuid();  -- owner, org B
  oa uuid; ob uuid; cat uuid; catb uuid; ex_old uuid; ex_new uuid;
  v text; n bigint; ok boolean; d date;
  lock_d date := current_date - 30;
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'ld-a@tests.invalid'), (ub, 'authenticated', 'authenticated', 'ld-b@tests.invalid'),
    (uc, 'authenticated', 'authenticated', 'ld-c@tests.invalid'), (ue, 'authenticated', 'authenticated', 'ld-e@tests.invalid');
  oa := public.bootstrap_organization('Lock Test A', 'lock-test-a', 'ld-a@tests.invalid');
  ob := public.bootstrap_organization('Lock Test B', 'lock-test-b', 'ld-e@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (oa, ub, 'admin'), (oa, uc, 'member');
  perform public.core_enable_all_modules(oa); perform public.core_enable_all_modules(ob);

  -- ---- T1: an expense in the old month, recorded before any lock exists
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  cat := public.fin_create_category('Rent');
  ex_old := ((public.fin_record_expense(lock_d - 5, cat, 5000, null, 'old month rent')) ->> 'id')::uuid;
  if ex_old is null then raise exception 'FAIL T1a: no expense id returned'; end if;

  -- ---- T2: who may set it
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_lock_date(lock_d); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T2a: an admin set the lock date'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_lock_date(lock_d); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T2b: a member set the lock date'; end if;

  -- ---- T3: the owner sets it; no future date; audit; no-op
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.core_set_lock_date(current_date + 1); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T3a: a future lock date was accepted'; end if;
  d := public.core_set_lock_date(lock_d);
  if d is distinct from lock_d then raise exception 'FAIL T3b: returned %, expected %', d, lock_d; end if;
  perform public.core_set_lock_date(lock_d);   -- same value: no second audit row
  reset role;
  select settings ->> 'lock_date' into v from public.organizations where id = oa;
  if v is distinct from lock_d::text then raise exception 'FAIL T3c: settings lock_date is %, expected %', v, lock_d; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'organization.lock_date_changed' and actor_user_id = ua
     and (after ->> 'lock_date') = lock_d::text and before ? 'lock_date';
  if n <> 1 then raise exception 'FAIL T3d: % audit row(s) for setting the lock, expected 1', n; end if;

  -- ---- T4: dated rows on or before the lock are refused, after it accepted
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.fin_record_expense(lock_d, cat, 100); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL T4a: an expense dated on the lock date was accepted'; end if;
  ok := false; begin perform public.fin_record_expense(lock_d - 1, cat, 100); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL T4b: an expense dated before the lock date was accepted'; end if;
  ex_new := ((public.fin_record_expense(lock_d + 1, cat, 700)) ->> 'id')::uuid;
  if ex_new is null then raise exception 'FAIL T4c: an expense after the lock date was refused'; end if;
  ok := false; begin perform public.fin_record_payment('out', 100, lock_d, 'cash', null, null, ex_new); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL T4d: a payment dated on the lock date was accepted'; end if;
  perform public.fin_record_payment('out', 100, current_date, 'cash', null, null, ex_new);

  -- ---- T5: voiding a row from the locked period is refused
  ok := false; begin perform public.fin_void_expense(ex_old); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL T5a: an expense from the locked period was voided'; end if;
  reset role;
  select count(*) into n from public.fin_expenses where id = ex_old and status = 'recorded';
  if n <> 1 then raise exception 'FAIL T5b: the locked expense changed status'; end if;

  -- ---- T6: removing the lock reopens (and is audited)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  d := public.core_set_lock_date(null);
  if d is not null then raise exception 'FAIL T6a: removing the lock returned %', d; end if;
  perform public.fin_void_expense(ex_old);
  reset role;
  select count(*) into n from public.fin_expenses where id = ex_old and status = 'void';
  if n <> 1 then raise exception 'FAIL T6b: the expense could not be voided after the lock was removed'; end if;
  select count(*) into n from public.audit_log where org_id = oa and action = 'organization.lock_date_changed' and summary = 'Lock date removed';
  if n <> 1 then raise exception 'FAIL T6c: % audit row(s) for removing the lock, expected 1', n; end if;
  select count(*) into n from public.organizations where id = oa and settings ? 'lock_date';
  if n <> 0 then raise exception 'FAIL T6d: lock_date key still present after removal'; end if;

  -- ---- T7: one company never affects another
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform public.core_set_lock_date(lock_d);
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  catb := public.fin_create_category('Rent');
  perform public.fin_record_expense(lock_d - 5, catb, 100);   -- B has no lock: accepted
  perform set_config('request.headers', json_build_object('x-org-id', oa)::text, true);   -- B's owner pointing at A
  ok := false; begin perform public.core_set_lock_date(null); exception when others then ok := (sqlerrm = 'NOT_A_MEMBER'); end;
  if not ok then raise exception 'FAIL T7a: a person outside org A changed its lock date'; end if;
  reset role;
  select count(*) into n from public.organizations where id = ob and settings ? 'lock_date';
  if n <> 0 then raise exception 'FAIL T7b: org A''s lock leaked into org B'; end if;

  -- ---- T8: triggers on all four dated tables; no anonymous use; helper closed
  select count(*) into n from pg_trigger where not tgisinternal and tgname in
    ('sal_invoices_lock_date', 'pur_supplier_invoices_lock_date', 'fin_expenses_lock_date', 'fin_payments_lock_date');
  if n <> 4 then raise exception 'FAIL T8a: % lock-date triggers, expected 4', n; end if;
  if has_function_privilege('anon', 'public.core_set_lock_date(date)', 'execute') then raise exception 'FAIL T8b: anonymous can set the lock date'; end if;
  if has_function_privilege('authenticated', 'public.core__assert_open(uuid, date)', 'execute') then raise exception 'FAIL T8c: the helper is callable by users'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
