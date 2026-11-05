-- sql/tests/040_accounting_core.sql
-- Accounting phase 1, slice 1 (sql/045). Always rolls back. Needs sql/001-045.
-- Covers: who may seed and edit the chart (owner, head accountant; not a plain admin or a member); the head-accountant flag (owner
-- only, owners and admins only); account rules (code under the parent, duplicates, role and leaf protection, kinds); the internal
-- posting function (balanced at commit, idempotent, leaf and active accounts only, missing role named); append-only entries and
-- lines; the lock date (refused unless backfill); reversals; the accounting module can only be switched on by switch-on and never
-- off; fiscal years do not overlap; isolation; no direct writes; no anonymous use; audit rows.
-- Deferred balance checks run at commit, and this test never commits, so it forces them with SET CONSTRAINTS ... IMMEDIATE.

do $$
declare
  u uuid := gen_random_uuid();  -- owner, org A
  a uuid := gen_random_uuid();  -- admin, org A (becomes head accountant)
  m uuid := gen_random_uuid();  -- member, org A
  x uuid := gen_random_uuid();  -- owner, org B
  o uuid; ob uuid; v_ma uuid; v_mm uuid; r jsonb; n bigint; ok boolean;
  acc_inv uuid; acc_grni uuid; acc_group uuid; acc_new uuid; acc_eq uuid; e1 uuid; e2 uuid; e3 uuid; v_dr bigint; v_cr bigint;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'acc-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'acc-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'acc-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'acc-x@tests.invalid');
  o := public.bootstrap_organization('Accounting Test A', 'accounting-test-a', 'acc-o@tests.invalid');
  ob := public.bootstrap_organization('Accounting Test B', 'accounting-test-b', 'acc-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin') returning id into v_ma;
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member') returning id into v_mm;
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  set local role authenticated;

  -- ---- T1: who may seed the chart
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_prepare(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T1a: a member seeded the chart'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_prepare(); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T1b: a plain admin seeded the chart'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  r := public.acc_prepare();
  if (r ->> 'accountsAdded')::int <> 37 then raise exception 'FAIL T1c: seeded % accounts, expected 37', r ->> 'accountsAdded'; end if;
  select count(*) into n from public.acc_account_roles where org_id = o;
  if n <> 19 then raise exception 'FAIL T1d: % roles seeded, expected 19', n; end if;
  r := public.acc_prepare();
  if (r ->> 'accountsAdded')::int <> 0 then raise exception 'FAIL T1e: a second prepare added accounts'; end if;
  -- every role points at a leaf
  select count(*) into n from public.acc_account_roles ar
   where ar.org_id = o and exists (select 1 from public.acc_accounts c where c.org_id = o and c.parent_id = ar.account_id);
  if n <> 0 then raise exception 'FAIL T1f: % roles point at accounts with sub-accounts', n; end if;

  -- ---- T2: the head-accountant flag
  ok := false; begin perform public.acc_set_head_accountant(v_mm, true); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T2a: a member was made head accountant'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := false; begin perform public.acc_set_head_accountant(v_ma, true); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T2b: an admin made themselves head accountant'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.acc_set_head_accountant(v_ma, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select id into acc_group from public.acc_accounts where org_id = o and code = '11';
  acc_new := public.acc_create_account(acc_group, '111', 'Vehicles', 'سيارات');   -- the head accountant may edit the chart
  if acc_new is null then raise exception 'FAIL T2c: the head accountant could not add an account'; end if;

  -- ---- T3: account rules
  ok := false; begin perform public.acc_create_account(acc_group, '211', 'Wrong place'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T3a: a code outside its parent was accepted'; end if;
  ok := false; begin perform public.acc_create_account(acc_group, '11', 'Same as parent'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T3b: a code equal to the parent was accepted'; end if;
  ok := false; begin perform public.acc_create_account(acc_group, '111', 'Duplicate'); exception when others then ok := (sqlerrm = 'DUPLICATE'); end;
  if not ok then raise exception 'FAIL T3c: a duplicate code was accepted'; end if;
  select id into acc_inv from public.acc_accounts where org_id = o and code = '161';
  ok := false; begin perform public.acc_create_account(acc_inv, '1611', 'Under a role'); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL T3d: a sub-account was added under a role account'; end if;
  ok := false; begin perform public.acc_update_account(acc_inv, 'Goods for resale', null, false); exception when others then ok := (sqlerrm = 'IN_USE'); end;
  if not ok then raise exception 'FAIL T3e: a role account was made inactive'; end if;
  ok := false; begin perform public.acc_create_account(acc_group, '112', 'Bad kind', null, 'revenue'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T3f: an asset group accepted a revenue sub-account'; end if;
  select id into acc_eq from public.acc_accounts where org_id = o and code = '28';
  acc_eq := public.acc_create_account(acc_eq, '287', 'Partner loan (equity)', null, 'equity');   -- either kind inside group 2
  if (select kind from public.acc_accounts where id = acc_eq) <> 'equity' then raise exception 'FAIL T3g: group 2 kind choice ignored'; end if;
  ok := false; begin perform public.acc_set_account_role('grni', acc_group); exception when others then ok := (sqlerrm = 'NOT_LEAF'); end;
  if not ok then raise exception 'FAIL T3h: a role was pointed at a group account'; end if;

  -- ---- T4: fiscal years
  perform public.acc_create_fiscal_year('FY2026', date '2026-01-01', date '2026-12-31');
  ok := false; begin perform public.acc_create_fiscal_year('Overlap', date '2026-07-01', date '2027-06-30'); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL T4a: overlapping fiscal years were accepted'; end if;

  -- ---- T5: isolation and no direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_accounts where org_id = o;
  if n <> 0 then raise exception 'FAIL T5a: a member can read the chart (% rows)', n; end if;
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.acc_accounts where org_id = o;
  if n <> 0 then raise exception 'FAIL T5b: another company can read the chart (% rows)', n; end if;
  ok := false; begin insert into public.acc_accounts (org_id, code, name, kind) values (ob, '9', 'Direct', 'asset'); exception when others then ok := (sqlstate = '42501'); end;
  if not ok then raise exception 'FAIL T5c: a direct insert into the chart was allowed'; end if;
  ok := false; begin perform public.acc__post(ob, current_date, 'EGP', 'test', '1', 'x', null, '[]'::jsonb); exception when others then ok := (sqlstate = '42501'); end;
  if not ok then raise exception 'FAIL T5d: a signed-in user called the internal posting function'; end if;

  -- ---- T6: the internal posting function (as the database owner, as posting triggers will)
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  e1 := public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-1', 'received', 'Test receipt',
          jsonb_build_array(jsonb_build_object('role', 'inventory', 'debit', 120000), jsonb_build_object('role', 'grni', 'credit', 120000)));
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  if public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-1', 'received', null, '[]'::jsonb) <> e1 then
    raise exception 'FAIL T6a: posting the same event twice made a second entry';
  end if;
  select count(*) into n from public.acc_entries where org_id = o and source_type = 'test_doc';
  if n <> 1 then raise exception 'FAIL T6b: % entries for one event', n; end if;
  ok := false;
  begin
    perform public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-2', 'received', null,
      jsonb_build_array(jsonb_build_object('role', 'inventory', 'debit', 100), jsonb_build_object('role', 'grni', 'credit', 99)));
    execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  exception when others then ok := (sqlerrm = 'UNBALANCED');
  end;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  if not ok then raise exception 'FAIL T6c: an unbalanced entry was accepted'; end if;
  ok := false;
  begin
    perform public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-3', 'received', null,
      jsonb_build_array(jsonb_build_object('role', 'inventory', 'debit', 100)));
    execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  exception when others then ok := (sqlerrm = 'UNBALANCED');
  end;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  if not ok then raise exception 'FAIL T6d: a one-line entry was accepted'; end if;
  select id into acc_group from public.acc_accounts where org_id = o and code = '16';
  ok := false;
  begin
    perform public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-4', 'received', null,
      jsonb_build_array(jsonb_build_object('account', acc_group, 'debit', 100), jsonb_build_object('role', 'grni', 'credit', 100)));
  exception when others then ok := (sqlerrm = 'NOT_LEAF');
  end;
  if not ok then raise exception 'FAIL T6e: a group account took a posting'; end if;
  perform public.acc_update_account(acc_new, 'Vehicles', 'سيارات', false);
  ok := false;
  begin
    perform public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-5', 'received', null,
      jsonb_build_array(jsonb_build_object('account', acc_new, 'debit', 100), jsonb_build_object('role', 'grni', 'credit', 100)));
  exception when others then ok := (sqlerrm = 'ACCOUNT_INACTIVE');
  end;
  if not ok then raise exception 'FAIL T6f: an inactive account took a posting'; end if;
  delete from public.acc_account_roles where org_id = o and role_key = 'price_variance';
  ok := false;
  begin
    perform public.acc__post(o, current_date, 'EGP', 'test_doc', 'doc-6', 'billed', null,
      jsonb_build_array(jsonb_build_object('role', 'price_variance', 'debit', 100), jsonb_build_object('role', 'payables', 'credit', 100)));
  exception when others then ok := (sqlerrm = 'ACCOUNT_ROLE_MISSING');
  end;
  if not ok then raise exception 'FAIL T6g: a missing role did not stop the posting'; end if;

  -- ---- T7: append-only, even for the database owner
  ok := false; begin update public.acc_entries set memo = 'changed' where id = e1; exception when others then ok := (sqlerrm = 'APPEND_ONLY'); end;
  if not ok then raise exception 'FAIL T7a: an entry was changed'; end if;
  ok := false; begin delete from public.acc_entry_lines where entry_id = e1; exception when others then ok := (sqlerrm = 'APPEND_ONLY'); end;
  if not ok then raise exception 'FAIL T7b: entry lines were deleted'; end if;
  ok := false; begin delete from public.acc_entries where id = e1; exception when others then ok := (sqlerrm = 'APPEND_ONLY'); end;
  if not ok then raise exception 'FAIL T7c: an entry was deleted'; end if;

  -- ---- T8: reversal
  e2 := public.acc__reverse(o, e1, current_date, 'reversed', null);
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into v_dr, v_cr
    from public.acc_entry_lines l join public.acc_entries e on e.id = l.entry_id
   where e.org_id = o and e.source_type = 'test_doc' and e.source_id = 'doc-1' and l.account_id = acc_inv;
  if v_dr <> 120000 or v_cr <> 120000 then raise exception 'FAIL T8a: inventory after reversal dr % cr %, expected 120000 each', v_dr, v_cr; end if;
  if (select reverses_entry_id from public.acc_entries where id = e2) is distinct from e1 then raise exception 'FAIL T8b: the reversal is not linked'; end if;

  -- ---- T9: the lock date (refused for normal entries, allowed for backfill)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.core_set_lock_date(current_date - 1);
  reset role;
  ok := false;
  begin
    perform public.acc__post(o, current_date - 1, 'EGP', 'test_doc', 'doc-7', 'received', null,
      jsonb_build_array(jsonb_build_object('role', 'inventory', 'debit', 100), jsonb_build_object('role', 'grni', 'credit', 100)));
  exception when others then ok := (sqlerrm = 'PERIOD_LOCKED');
  end;
  if not ok then raise exception 'FAIL T9a: an entry in a locked period was accepted'; end if;
  e3 := public.acc__post(o, current_date - 1, 'EGP', 'test_doc', 'doc-8', 'received', null,
          jsonb_build_array(jsonb_build_object('role', 'inventory', 'debit', 100), jsonb_build_object('role', 'grni', 'credit', 100)), true);
  if e3 is null then raise exception 'FAIL T9b: a backfill entry in a locked period was refused'; end if;

  -- ---- T10: the accounting module is switched on only by switch-on, and never off
  set local role authenticated;
  ok := false; begin perform public.core_set_module('accounting', true); exception when others then ok := (sqlerrm = 'USE_SWITCH_ON'); end;
  if not ok then raise exception 'FAIL T10a: accounting was switched on from Settings'; end if;
  reset role;
  ok := false; begin insert into public.org_modules (org_id, module_key) values (o, 'accounting'); exception when others then ok := (sqlerrm = 'USE_SWITCH_ON'); end;
  if not ok then raise exception 'FAIL T10b: accounting was switched on by a direct insert'; end if;
  perform set_config('acc.switch_on', 'on', true);
  insert into public.org_modules (org_id, module_key) values (o, 'accounting');
  perform set_config('acc.switch_on', '', true);
  ok := false; begin update public.org_modules set disabled_at = now() where org_id = o and module_key = 'accounting'; exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T10c: accounting was switched off'; end if;
  ok := false; begin delete from public.org_modules where org_id = o and module_key = 'accounting'; exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL T10d: the accounting module row was deleted'; end if;
  if not public.acc__enabled(o) or public.acc__enabled(ob) then raise exception 'FAIL T10e: acc__enabled is wrong'; end if;

  -- ---- T11: audit rows
  select count(*) into n from public.audit_log where org_id = o and action in
    ('accounting.chart.seeded', 'accounting.account.added', 'accounting.head_accountant.changed', 'accounting.fiscal_year.added', 'accounting.account.changed');
  if n < 6 then raise exception 'FAIL T11a: only % accounting audit rows', n; end if;

  -- ---- T12: no anonymous use
  if has_function_privilege('anon', 'public.acc_prepare()', 'execute') then raise exception 'FAIL T12a: anonymous can seed a chart'; end if;
  if has_function_privilege('anon', 'public.acc_create_account(uuid, text, text, text, text)', 'execute') then raise exception 'FAIL T12b: anonymous can add accounts'; end if;
  if has_function_privilege('authenticated', 'public.acc__reverse(uuid, uuid, date, text, text, boolean)', 'execute') then raise exception 'FAIL T12c: users can reverse directly'; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
