-- sql/tests/043_accounting_manual_journals.sql
-- Accounting slice 4 (sql/048). Always rolls back. Needs sql/001-048.
-- Covers: accounting must be on; members cannot draft; line validation (balance, one side, leaf, active, party, lock date); a plain
-- admin cannot post directly or approve their own draft (also blocked by the check constraint); the owner approves -> posted entry with
-- approved_by; the owner and a head accountant post directly; only the author edits or withdraws a draft; rejection is final;
-- reversal (owner/head only, once, linked); opening balances only on a fiscal year's first day; the accounts-in-use fix (category and
-- reason accounts cannot be deactivated or given sub-accounts); isolation; audit; no anonymous use.

do $$
declare
  u uuid := gen_random_uuid();  -- owner
  a uuid := gen_random_uuid();  -- admin (later head accountant)
  a2 uuid := gen_random_uuid(); -- second admin
  m uuid := gen_random_uuid();  -- member
  x uuid := gen_random_uuid();  -- owner of another company
  o uuid; ob uuid; v_ma uuid; cash uuid; bank uuid; exp331 uuid; grp33 uuid; capital uuid; cust uuid; cat uuid; reason uuid; new_acc uuid;
  r jsonb; j1 uuid; j2 uuid; j3 uuid; e uuid; n bigint; ok boolean; v_lines jsonb;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'accj-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'accj-a@tests.invalid'),
    (a2, 'authenticated', 'authenticated', 'accj-a2@tests.invalid'), (m, 'authenticated', 'authenticated', 'accj-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'accj-x@tests.invalid');
  o := public.bootstrap_organization('Journal Test A', 'journal-test-a', 'accj-o@tests.invalid');
  ob := public.bootstrap_organization('Journal Test B', 'journal-test-b', 'accj-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin') returning id into v_ma;
  insert into public.memberships (org_id, user_id, role) values (o, a2, 'admin'), (o, m, 'member');
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- ---- J0: accounting must be on
  set local role authenticated;
  perform public.acc_prepare();
  reset role;
  select id into cash from public.acc_accounts where org_id = o and code = '191';
  select id into bank from public.acc_accounts where org_id = o and code = '192';
  select id into exp331 from public.acc_accounts where org_id = o and code = '331';
  select id into grp33 from public.acc_accounts where org_id = o and code = '33';
  select id into capital from public.acc_accounts where org_id = o and code = '211';
  v_lines := jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100000), jsonb_build_object('accountId', capital, 'creditMinor', 100000));
  set local role authenticated;
  ok := false; begin perform public.acc_save_journal(null, current_date, 'Capital paid in', v_lines); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL J0a: a journal was saved with accounting off'; end if;
  reset role;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);

  -- ---- J1: who may draft; validation
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', v_lines); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL J1a: a member drafted a journal'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100), jsonb_build_object('accountId', capital, 'creditMinor', 99))); exception when others then ok := (sqlerrm = 'UNBALANCED'); end;
  if not ok then raise exception 'FAIL J1b: an unbalanced journal was saved'; end if;
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL J1c: a one-line journal was saved'; end if;
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100, 'creditMinor', 100), jsonb_build_object('accountId', capital, 'creditMinor', 0))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL J1d: a two-sided line was saved'; end if;
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', jsonb_build_array(jsonb_build_object('accountId', grp33, 'debitMinor', 100), jsonb_build_object('accountId', capital, 'creditMinor', 100))); exception when others then ok := (sqlerrm = 'NOT_LEAF'); end;
  if not ok then raise exception 'FAIL J1e: a group account was used'; end if;
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', jsonb_build_array(jsonb_build_object('accountId', bank, 'debitMinor', 100, 'partyType', 'customer', 'partyId', gen_random_uuid()), jsonb_build_object('accountId', capital, 'creditMinor', 100))); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL J1f: an unknown customer was accepted'; end if;

  -- ---- J2: a plain admin drafts; cannot post directly or approve their own; the owner approves
  ok := false; begin perform public.acc_save_journal(null, current_date, 'x', v_lines, 'manual', null, true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL J2a: a plain admin posted without approval'; end if;
  r := public.acc_save_journal(null, current_date, 'Capital paid in', v_lines);
  j1 := (r ->> 'id')::uuid;
  if r ->> 'status' <> 'draft' or r ->> 'number' <> 'MJ-000001' then raise exception 'FAIL J2b: %', r; end if;
  ok := false; begin perform public.acc_decide_journal(j1, 'approved'); exception when others then ok := (sqlerrm = 'SELF_APPROVAL'); end;
  if not ok then raise exception 'FAIL J2c: an author approved their own journal'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_save_journal(j1, current_date, 'Changed by someone else', v_lines); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL J2d: someone else edited a draft'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  r := public.acc_decide_journal(j1, 'approved', 'Bank statement seen');
  if r ->> 'status' <> 'posted' then raise exception 'FAIL J2e: %', r; end if;
  reset role;
  select entry_id into e from public.acc_manual_journals where id = j1;
  if (select approved_by from public.acc_entries where id = e) is distinct from u then raise exception 'FAIL J2f: the entry does not record its approver'; end if;
  select count(*) into n from public.acc_entry_lines where entry_id = e;
  if n <> 2 then raise exception 'FAIL J2g: % lines posted', n; end if;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  -- the data itself refuses an author as decider
  ok := false; begin update public.acc_manual_journals set decided_by = created_by where id = j1; exception when others then ok := (sqlstate = '23514'); end;
  if not ok then raise exception 'FAIL J2h: the check constraint let the author be the decider'; end if;
  set local role authenticated;
  ok := false; begin perform public.acc_decide_journal(j1, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL J2i: a posted journal was decided again'; end if;

  -- ---- J3: direct posting by the owner and by a head accountant; rejection is final; withdrawal by the author only
  r := public.acc_save_journal(null, current_date, 'Owner direct', jsonb_build_array(jsonb_build_object('accountId', cash, 'debitMinor', 500), jsonb_build_object('accountId', bank, 'creditMinor', 500)), 'manual', null, true);
  if r ->> 'status' <> 'posted' or (r ->> 'entryId') is null then raise exception 'FAIL J3a: owner direct post %', r; end if;
  perform public.acc_set_head_accountant(v_ma, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := public.acc_save_journal(null, current_date, 'Head accountant direct', jsonb_build_array(jsonb_build_object('accountId', cash, 'debitMinor', 300), jsonb_build_object('accountId', bank, 'creditMinor', 300)), 'manual', null, true);
  if r ->> 'status' <> 'posted' then raise exception 'FAIL J3b: head accountant direct post %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  j2 := (public.acc_save_journal(null, current_date, 'To be rejected', v_lines) ->> 'id')::uuid;
  j3 := (public.acc_save_journal(null, current_date, 'To be withdrawn', v_lines) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_cancel_journal(j3); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL J3c: someone else withdrew a draft'; end if;
  perform public.acc_decide_journal(j2, 'rejected', 'No evidence');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_decide_journal(j2, 'approved'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL J3d: a rejected journal was approved'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  perform public.acc_cancel_journal(j3);

  -- ---- J4: reversal
  ok := false; begin perform public.acc_reverse_journal(j1, current_date, 'Wrong account'); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL J4a: a plain admin reversed a journal'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  e := public.acc_reverse_journal(j1, current_date, 'Wrong account');
  ok := false; begin perform public.acc_reverse_journal(j1, current_date, 'Again'); exception when others then ok := (sqlerrm = 'INVALID_STATE'); end;
  if not ok then raise exception 'FAIL J4b: a journal was reversed twice'; end if;
  reset role;
  if (select reverses_entry_id from public.acc_entries where id = e) is distinct from (select entry_id from public.acc_manual_journals where id = j1) then
    raise exception 'FAIL J4c: the reversal is not linked';
  end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into n from public.acc_entry_lines l where l.org_id = o and l.account_id = capital;
  if n <> 0 then raise exception 'FAIL J4d: capital after reversal %, expected 0', n; end if;

  -- ---- J5: opening balances need a fiscal year's first day; the lock date applies
  set local role authenticated;
  ok := false; begin perform public.acc_save_journal(null, date '2026-01-01', 'Opening', v_lines, 'opening', null, true); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL J5a: opening balances without a fiscal year'; end if;
  perform public.acc_create_fiscal_year('FY2026', date '2026-01-01', date '2026-12-31');
  r := public.acc_save_journal(null, date '2026-01-01', 'Opening balances', v_lines, 'opening', null, true);
  if r ->> 'status' <> 'posted' then raise exception 'FAIL J5b: %', r; end if;
  perform public.core_set_lock_date(current_date - 1);
  ok := false; begin perform public.acc_save_journal(null, current_date - 1, 'Back-dated', v_lines); exception when others then ok := (sqlerrm = 'PERIOD_LOCKED'); end;
  if not ok then raise exception 'FAIL J5c: a journal in a locked period was saved'; end if;
  perform public.core_set_lock_date(null);

  -- ---- J6: the accounts-in-use fix
  cat := public.fin_create_category('Rent');
  perform public.acc_set_category_account(cat, exp331);
  perform public.acc_set_account_role('expense_default', cash);   -- free 331 from its role, so only the category holds it
  ok := false; begin perform public.acc_update_account(exp331, 'General expenses', null, false); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL J6a: an account used by an expense category was made inactive'; end if;
  ok := false; begin perform public.acc_create_account(exp331, '3311', 'Sub'); exception when others then ok := (sqlerrm in ('IN_USE', 'HAS_ENTRIES')); end;
  if not ok then raise exception 'FAIL J6b: an account used by an expense category got a sub-account'; end if;
  new_acc := public.acc_create_account(grp33, '336', 'Donations', 'تبرعات');
  reason := public.acc_save_issue_reason(null, 'Donations', 'تبرعات', new_acc);
  ok := false; begin perform public.acc_update_account(new_acc, 'Donations', null, false); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL J6c: an account used by a reason was made inactive'; end if;
  ok := false; begin perform public.acc_create_account(new_acc, '3361', 'Sub'); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL J6d: an account used by a reason got a sub-account'; end if;

  -- ---- J7: isolation, members, audit, anonymous
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_manual_journals;
  if n <> 0 then raise exception 'FAIL J7a: a member sees % journals', n; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_manual_journals where org_id = o;
  if n <> 0 then raise exception 'FAIL J7b: another company sees % journals', n; end if;
  ok := false; begin perform public.acc_decide_journal(j2, 'approved'); exception when others then ok := (sqlerrm in ('MODULE_DISABLED', 'NOT_FOUND')); end;
  if not ok then raise exception 'FAIL J7c: another company touched a journal'; end if;
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action like 'accounting.journal.%';
  if n < 9 then raise exception 'FAIL J7d: only % journal audit rows', n; end if;
  if has_function_privilege('anon', 'public.acc_save_journal(uuid, date, text, jsonb, text, text, boolean)', 'execute') then raise exception 'FAIL J7e: anonymous can save journals'; end if;
  if has_function_privilege('authenticated', 'public.acc__post_journal(uuid, uuid, uuid)', 'execute') then raise exception 'FAIL J7f: users can post journals directly'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
