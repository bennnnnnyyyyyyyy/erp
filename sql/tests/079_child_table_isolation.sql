-- sql/tests/079_child_table_isolation.sql
-- Audit response 2026-11-11, finding 15: sixteen tables had no isolation test of their own (they relied on their parent's test).
-- Row level security is per table, so each one is proven here: company A creates rows through its normal database functions, then
-- company B's owner (company B selected) must see none of them and must not be able to write the table directly. Company A's own
-- owner is checked too, so a pass is not trivial (A sees its rows, or the table is closed to reads) and so that direct writes are
-- refused for A as well. Then a generic check over every public table that has an org_id column: row level security is on, and
-- neither `authenticated` nor `anon` holds INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER (table or column level).
-- Always rolls back. Needs sql/001-083.

do $$
declare
  u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w uuid; i_box uuid; i_bat uuid; i_low uuid; sup uuid; cus uuid; po uuid; so uuid; rq uuid; inv uuid; team uuid;
  bank uuid; bank_ledger uuid; e1 uuid; l1 bigint; s1 uuid; v_move bigint; j jsonb; fy uuid; reason uuid; acc_exp uuid; cash_acc uuid; bank_acc uuid;
  t text; n bigint; ok boolean; bad text := ''; actor uuid; d date := current_date - 10; r text; p text;
  -- the sixteen tables of the finding
  tbl text[] := array['acc_fiscal_years', 'acc_issue_reasons', 'acc_manual_journal_lines', 'acc_receipt_costs', 'acc_entry_lines',
    'trs_statement_formats', 'trs_statement_imports', 'trs_statement_matches', 'alr_teams', 'alr_firings', 'pur_order_lines',
    'pur_supplier_invoice_lines', 'sal_order_lines', 'sal_invoice_lines', 'inv_batch_balances', 'inv_batch_moves'];
  readable text[] := '{}'; closed text[] := '{}';
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'ct-o@tests.invalid'), (a, 'authenticated', 'authenticated', 'ct-a@tests.invalid'),
    (m, 'authenticated', 'authenticated', 'ct-m@tests.invalid'), (x, 'authenticated', 'authenticated', 'ct-x@tests.invalid');
  o  := public.bootstrap_organization('Child Tables A', 'child-tables-a', 'ct-o@tests.invalid');
  ob := public.bootstrap_organization('Child Tables B', 'child-tables-b', 'ct-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, a, 'admin'), (o, m, 'member');
  update public.organizations set default_currency = 'EGP' where id in (o, ob);
  perform public.core_enable_all_modules(o); perform public.core_enable_all_modules(ob);

  -- ======================================================== company A fills the tables through its own functions
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- stock side, accounting still off (opening stock with no cost is allowed then: it becomes an uncosted receipt)
  w := public.inv_create_warehouse('CT', 'Child tables warehouse', null);
  i_box := public.inv_create_item('CT-BOX', 'Boxes', null, 'piece', 20, w);
  i_low := public.inv_create_item('CT-LOW', 'Low item', null, 'piece', 2, w);
  i_bat := public.inv_create_item('CT-BAT', 'Batch item', null, 'piece', 0, w);
  perform public.inv_set_item_batching(i_bat, true);
  perform public.inv_receive_batch(i_bat, w, 5, 'LOT-1', null, current_date + 60);                       -- inv_batch_balances, inv_batch_moves
  sup := public.pur_create_supplier('Child supplier', null, null, null);
  cus := public.sal_create_customer('Child customer', null, null, null);
  perform public.pur_set_po_approval(false, 0);
  po := (public.pur_create_order(sup, w, jsonb_build_array(jsonb_build_object('itemId', i_box, 'qty', 10, 'unitCostMinor', 300))) ->> 'id')::uuid;   -- pur_order_lines
  perform public.pur_receive_order(po);
  so := (public.sal_create_order(cus, w, jsonb_build_array(jsonb_build_object('itemId', i_box, 'qty', 3, 'unitPriceMinor', 1000))) ->> 'id')::uuid;   -- sal_order_lines
  rq := (public.sal_request_stock(so) ->> 'id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_decide_request(rq, 'approved'); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated; perform public.inv_post_issue(rq); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := (public.sal_create_invoice(so, current_date, (select jsonb_agg(jsonb_build_object('orderLineId', ol.id, 'qty', ol.qty))
                                                        from public.sal_order_lines ol where ol.order_id = so)) ->> 'id')::uuid;   -- sal_invoice_lines
  perform public.pur_record_supplier_invoice(sup, po, 'CT-1', current_date,
            (select jsonb_agg(jsonb_build_object('orderLineId', pl.id, 'qty', pl.qty)) from public.pur_order_lines pl where pl.order_id = po));   -- pur_supplier_invoice_lines

  -- alert teams and one firing (stock_below 10 fires for the item with 2 on hand)
  perform public.alr_ensure_default_teams();
  select id into team from public.alr_teams where name = 'Purchasing';                                   -- alr_teams
  perform public.alr_create_rule('Child low stock', 'stock_below', null, 10, 24, jsonb_build_array(jsonb_build_object('type', 'team', 'id', team)));
  reset role;
  j := public.alr_run(o);                                                                                -- alr_firings

  -- every receipt with no cost (the opening stock, the first batch) is documented by the owner (acc_receipt_costs), then accounting is
  -- switched on the normal way (as sql/tests/042), which posts the history; treasury follows (as sql/tests/063)
  set local role authenticated;
  for v_move in select move_id from public.acc_uncosted_receipts() order by move_id loop
    perform public.acc_set_receipt_cost(v_move, 250, 'Supplier invoice of the opening stock');          -- acc_receipt_costs
  end loop;
  perform public.acc_switch_on();
  reset role;
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate';
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  insert into public.org_modules (org_id, module_key) values (o, 'treasury');
  set local role authenticated; perform public.trs_prepare(); reset role;
  select id, ledger_account_id into bank, bank_ledger from public.trs_accounts where org_id = o and code = 'BANK-MAIN';
  select id into cash_acc from public.acc_accounts where org_id = o and code = '191';
  select id into bank_acc from public.acc_accounts where org_id = o and code = '192';
  select id into acc_exp from public.acc_accounts where org_id = o and code = '331';

  set local role authenticated;
  fy := public.acc_create_fiscal_year('FY child', date '2026-01-01', date '2026-12-31');                 -- acc_fiscal_years
  reason := public.acc_save_issue_reason(null, 'Child samples', null, acc_exp);                          -- acc_issue_reasons
  perform public.acc_save_journal(null, current_date, 'Child journal', jsonb_build_array(
    jsonb_build_object('accountId', cash_acc, 'debitMinor', 500), jsonb_build_object('accountId', bank_acc, 'creditMinor', 500)),
    'manual', null, true);                                                                               -- acc_manual_journal_lines, acc_entry_lines
  perform public.trs_save_statement_format(bank, '{"date": 0, "amount": 1}'::jsonb);                    -- trs_statement_formats
  reset role;
  e1 := public.acc__post(o, d, 'EGP', 'test', 'ct-in-1500', 'posted', 'customer 1500', jsonb_build_array(
          jsonb_build_object('account', bank_ledger, 'debit', 150000), jsonb_build_object('role', 'opening_balance', 'credit', 150000)));
  execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced immediate'; execute 'set constraints public.acc_entries_balanced, public.acc_entry_lines_balanced deferred';
  select id into l1 from public.acc_entry_lines where entry_id = e1 and account_id = bank_ledger;
  set local role authenticated;
  j := public.trs_import_statement(bank, 'ct.csv', repeat('c', 64), 'csv', 0, 150000, jsonb_build_array(
         jsonb_build_object('bookingDate', d, 'amountMinor', 150000, 'description', 'Transfer', 'fingerprint', 'ct1')));   -- trs_statement_imports
  select id into s1 from public.trs_statement_lines where fingerprint = 'ct1';
  perform public.trs_match_line(s1, array[l1]);                                                          -- trs_statement_matches
  reset role;

  -- ======================================================== T1: every table really has rows for company A (checked as the database owner)
  foreach t in array tbl loop
    execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
    if n = 0 then raise exception 'FAIL T1: setup created no rows for company A in %', t; end if;
  end loop;

  -- ======================================================== T2: company A's own owner: reads work or the table is closed
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach t in array tbl loop
    begin
      execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
      if n = 0 then raise exception 'FAIL T2: company A''s own owner sees none of its rows in % (policy too strict?)', t; end if;
      readable := readable || t;
    exception when insufficient_privilege then closed := closed || t;
    end;
  end loop;
  reset role;
  raise notice 'T2: readable by app users: %; closed to direct reads: %', readable, closed;

  -- ======================================================== T3 to T4: company B's owner, then company A's own owner
  foreach actor in array array[x, u] loop
    if actor = x then perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
    else perform set_config('request.headers', json_build_object('x-org-id', o)::text, true); end if;
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    set local role authenticated;

    if actor = x then
      -- T3: company B sees none of company A's rows (or may not read the table at all), and no foreign rows of any kind
      foreach t in array tbl loop
        begin execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
        exception when insufficient_privilege then n := 0;
        end;
        if n <> 0 then raise exception 'FAIL T3a: company B sees % of company A''s rows in %', n, t; end if;
        begin execute format('select count(*) from public.%I where org_id <> $1', t) into n using ob;
        exception when insufficient_privilege then n := 0;
        end;
        if n <> 0 then raise exception 'FAIL T3b: company B sees % rows of other companies in %', n, t; end if;
      end loop;
    end if;

    -- T4: no direct insert, update, delete or truncate by an application user, whoever they are
    foreach t in array tbl loop
      ok := false;
      begin execute format('insert into public.%I (org_id) values ($1)', t) using ob; exception when insufficient_privilege then ok := true; end;
      if not ok then raise exception 'FAIL T4a: direct insert into % was not refused by privileges (actor %)', t, case when actor = x then 'B' else 'A' end; end if;
      ok := false;
      begin execute format('update public.%I set org_id = org_id where org_id = $1', t) using o; exception when insufficient_privilege then ok := true; end;
      if not ok then raise exception 'FAIL T4b: direct update of % was not refused (actor %)', t, case when actor = x then 'B' else 'A' end; end if;
      ok := false;
      begin execute format('delete from public.%I where org_id = $1', t) using o; exception when insufficient_privilege then ok := true; end;
      if not ok then raise exception 'FAIL T4c: direct delete from % was not refused (actor %)', t, case when actor = x then 'B' else 'A' end; end if;
      ok := false;
      begin execute format('truncate public.%I', t); exception when insufficient_privilege then ok := true; end;
      if not ok then raise exception 'FAIL T4d: truncate of % was not refused (actor %)', t, case when actor = x then 'B' else 'A' end; end if;
    end loop;
    reset role;
  end loop;

  -- T5: company B cannot read company A's rows by sending company A's id in the header (not a member there)
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach t in array tbl loop
    begin execute format('select count(*) from public.%I where org_id = $1', t) into n using o;
    exception when others then n := 0;   -- refused outright is also a pass
    end;
    if n <> 0 then raise exception 'FAIL T5: company B read % rows of % by sending company A''s id', n, t; end if;
  end loop;
  reset role;

  -- T6: anonymous callers see and write nothing
  set local role anon;
  foreach t in array tbl loop
    begin execute format('select count(*) from public.%I', t) into n; exception when insufficient_privilege then n := 0; end;
    if n <> 0 then raise exception 'FAIL T6a: anon sees % rows in %', n, t; end if;
    ok := false;
    begin execute format('insert into public.%I (org_id) values ($1)', t) using o; exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL T6b: anon insert into % was not refused', t; end if;
  end loop;
  reset role;

  -- ======================================================== T7: generic check over every public table that has an org_id column
  for t in
    select c.table_name::text from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'org_id' order by 1
  loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || quote_ident(t))::regclass) then
      bad := bad || format(' [%s: row level security is OFF]', t);
    end if;
    foreach r in array array['authenticated', 'anon'] loop
      foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, ('public.' || quote_ident(t))::regclass, p) then
          bad := bad || format(' [%s: %s holds %s]', t, r, p);
        end if;
      end loop;
      if has_any_column_privilege(r, ('public.' || quote_ident(t))::regclass, 'INSERT') or has_any_column_privilege(r, ('public.' || quote_ident(t))::regclass, 'UPDATE')
         or has_any_column_privilege(r, ('public.' || quote_ident(t))::regclass, 'REFERENCES') then
        bad := bad || format(' [%s: %s holds a column-level write privilege]', t, r);
      end if;
    end loop;
  end loop;
  if bad <> '' then raise exception 'FAIL T7: tables with an org_id column that are not closed:%', bad; end if;
  -- the check is not vacuous: the sixteen tables are among the tables it looked at
  select count(*) into n from information_schema.columns where table_schema = 'public' and column_name = 'org_id' and table_name = any (tbl);
  if n <> array_length(tbl, 1) then raise exception 'FAIL T7b: only % of the % tables have an org_id column', n, array_length(tbl, 1); end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
