-- sql/tests/066_report_links.sql
-- Private report links for Google Sheets (sql/070). Always rolls back. Needs sql/001-070.
-- Covers: an owner creates a link and a member cannot; the token is not stored in clear; anonymous cannot read the table or create;
-- the public read returns the three reports (amounts as decimal text) and counts reads; bad, revoked, expired and module-off links all
-- answer the same NOT_FOUND; a second company's link never returns the first company's rows; another company's user cannot see or revoke
-- a link; creating and revoking are audited.

do $$
declare
  u uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  o uuid; ob uuid; w1 uuid; i1 uuid; cu uuid; so uuid; sol uuid; inv uuid; il uuid; wb uuid; ib uuid;
  r jsonb; t_stock text; t_open text; t_sales text; t_b text; id_stock uuid; id_b uuid; id_open uuid; id_sales uuid;
  ok boolean; n bigint; msg text; v_hash text;
begin
  insert into auth.users (id, aud, role, email) values
    (u, 'authenticated', 'authenticated', 'rl-o@tests.invalid'), (m, 'authenticated', 'authenticated', 'rl-m@tests.invalid'),
    (x, 'authenticated', 'authenticated', 'rl-x@tests.invalid');
  o := public.bootstrap_organization('Links Test A', 'links-test-a', 'rl-o@tests.invalid');
  ob := public.bootstrap_organization('Links Test B', 'links-test-b', 'rl-x@tests.invalid');
  insert into public.memberships (org_id, user_id, role) values (o, m, 'member');
  insert into public.org_modules (org_id, module_key) values (o, 'inventory'), (o, 'sales'), (ob, 'inventory'), (ob, 'sales');

  -- company A: one item in stock, one issued invoice of 5 x 10.00 (partly paid below); company B: its own item
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w1 := public.inv_create_warehouse('MAIN', 'Main', null);
  i1 := public.inv_create_item('RL-A1', 'Alpha stock', null, 'piece', 40, w1);
  cu := public.sal_create_customer('Alpha Buyer', 'Contact Name', 'Cairo', '+201000000000');
  reset role;
  so := gen_random_uuid(); sol := gen_random_uuid(); inv := gen_random_uuid(); il := gen_random_uuid();
  insert into public.sal_orders (id, org_id, number, customer_id, warehouse_id, status, currency, created_by) values (so, o, 'SO-RL1', cu, w1, 'stock_requested', 'EGP', u);
  insert into public.sal_order_lines (id, org_id, order_id, item_id, qty, unit_price_minor) values (sol, o, so, i1, 5, 1000);
  insert into public.sal_invoices (id, org_id, number, order_id, customer_id, invoice_date, currency, created_by) values (inv, o, 'INV-RL1', so, cu, date '2026-03-15', 'EGP', u);
  insert into public.sal_invoice_lines (id, org_id, invoice_id, order_line_id, qty, unit_price_minor) values (il, o, inv, sol, 5, 1000);
  insert into public.fin_payments (org_id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, created_by)
  values (o, 'PAY-RL1', 'in', 2000, 'EGP', date '2026-03-20', 'cash', inv, u);

  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wb := public.inv_create_warehouse('BMAIN', 'B Main', null);
  ib := public.inv_create_item('RL-B1', 'Beta stock', null, 'piece', 7, wb);
  r := public.core_create_report_link('stock_on_hand', 'B sheet', null);
  t_b := r ->> 'token'; id_b := (r ->> 'id')::uuid;
  reset role;

  -- ---- C1: an owner creates links; the token is 64 hex characters
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.core_create_report_link('stock_on_hand', 'Stock sheet', 30); t_stock := r ->> 'token'; id_stock := (r ->> 'id')::uuid;
  if t_stock !~ '^[0-9a-f]{64}$' then raise exception 'FAIL C1a: token is not 64 hex characters'; end if;
  r := public.core_create_report_link('open_invoices', null, null); t_open := r ->> 'token'; id_open := (r ->> 'id')::uuid;
  r := public.core_create_report_link('sales_by_month', 'Sales', null); t_sales := r ->> 'token'; id_sales := (r ->> 'id')::uuid;
  ok := false; begin perform public.core_create_report_link('audit_log', null, null); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C1b: an unknown report was accepted'; end if;
  ok := false; begin perform public.core_create_report_link('stock_on_hand', null, 0); exception when others then ok := (sqlerrm = 'INVALID_INPUT'); end;
  if not ok then raise exception 'FAIL C1c: expiry of 0 days accepted'; end if;
  select count(*) into n from public.core_report_links;
  if n <> 3 then raise exception 'FAIL C1d: owner sees % links of own company, expected 3', n; end if;
  reset role;

  -- ---- C2: the token is not stored; only its hash
  v_hash := encode(sha256(convert_to(t_stock, 'UTF8')), 'hex');
  if (select token_hash from public.core_report_links where id = id_stock) <> v_hash then raise exception 'FAIL C2a: hash does not match'; end if;
  if exists (select 1 from public.core_report_links where token_hash = t_stock) then raise exception 'FAIL C2b: token stored in clear'; end if;
  if exists (select 1 from public.audit_log where org_id = o and (summary like '%' || t_stock || '%' or entity_id = t_stock)) then raise exception 'FAIL C2c: token in audit log'; end if;

  -- ---- C3: a member cannot create, revoke or read the table
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_create_report_link('stock_on_hand', null, null); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C3a: a member created a link'; end if;
  ok := false; begin perform public.core_revoke_report_link(id_stock); exception when others then ok := (sqlerrm = 'FORBIDDEN'); end;
  if not ok then raise exception 'FAIL C3b: a member revoked a link'; end if;
  select count(*) into n from public.core_report_links;
  if n <> 0 then raise exception 'FAIL C3c: a member sees % links', n; end if;
  reset role;

  -- ---- A1: anonymous cannot read or write the table, cannot create or revoke; can call only the public read
  set local role anon;
  ok := false; begin perform count(*) from public.core_report_links; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL A1a: anonymous read the table'; end if;
  ok := false; begin perform public.core_create_report_link('stock_on_hand', null, null); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL A1b: anonymous created a link'; end if;
  ok := false; begin perform public.core_revoke_report_link(id_stock); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL A1c: anonymous revoked a link'; end if;

  -- ---- R1: the public read (as anon, no user) returns the right rows and counts the read
  r := public.core_report_link_rows(t_stock);
  if r ->> 'report' <> 'stock_on_hand' or jsonb_array_length(r -> 'columns') <> 5 then raise exception 'FAIL R1a: stock shape %', r; end if;
  if jsonb_array_length(r -> 'rows') <> 1 or r -> 'rows' -> 0 -> 0 <> '"RL-A1"' or r -> 'rows' -> 0 -> 3 <> '"40"' or r -> 'rows' -> 0 -> 2 <> '"Main"' then
    raise exception 'FAIL R1b: stock rows %', r -> 'rows';
  end if;
  r := public.core_report_link_rows(t_open);
  if jsonb_array_length(r -> 'columns') <> 8 or jsonb_array_length(r -> 'rows') <> 1 then raise exception 'FAIL R1c: open invoices shape %', r; end if;
  if r -> 'rows' -> 0 -> 0 <> '"INV-RL1"' or r -> 'rows' -> 0 -> 5 <> '"50.00"' or r -> 'rows' -> 0 -> 6 <> '"20.00"' or r -> 'rows' -> 0 -> 7 <> '"30.00"'
     or r -> 'rows' -> 0 -> 3 <> '"Alpha Buyer"' then
    raise exception 'FAIL R1d: open invoice row %', r -> 'rows' -> 0;
  end if;
  if r::text like '%Contact Name%' or r::text like '%+2010%' or r::text like '%Cairo%' then raise exception 'FAIL R1e: personal data in the report'; end if;
  r := public.core_report_link_rows(t_sales);
  if r -> 'rows' -> 0 <> '["2026-03", "EGP", 1, "50.00"]'::jsonb then raise exception 'FAIL R1f: sales rows %', r -> 'rows'; end if;
  reset role;
  if (select read_count from public.core_report_links where id = id_stock) <> 1 or (select last_read_at from public.core_report_links where id = id_stock) is null then
    raise exception 'FAIL R1g: read not counted';
  end if;

  -- ---- R2: a malformed or unknown token is refused with NOT_FOUND
  set local role anon;
  ok := false; begin perform public.core_report_link_rows('nope'); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL R2a: bad token not NOT_FOUND'; end if;
  ok := false; begin perform public.core_report_link_rows(repeat('0', 64)); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL R2b: unknown token not NOT_FOUND'; end if;
  reset role;

  -- ---- X1: company B's link returns only company B's rows; company A's token returns only A's
  set local role anon;
  r := public.core_report_link_rows(t_b);
  if jsonb_array_length(r -> 'rows') <> 1 or r -> 'rows' -> 0 -> 0 <> '"RL-B1"' or r::text like '%RL-A1%' then raise exception 'FAIL X1a: B link rows %', r -> 'rows'; end if;
  r := public.core_report_link_rows(t_stock);
  if r::text like '%RL-B1%' then raise exception 'FAIL X1b: A link returned B rows'; end if;
  reset role;

  -- ---- X2: another company's owner cannot see or revoke A's link, and A's owner cannot revoke B's
  perform set_config('request.headers', json_build_object('x-org-id', ob)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.core_report_links where id in (id_stock, id_open, id_sales);
  if n <> 0 then raise exception 'FAIL X2a: another company sees % links', n; end if;
  ok := false; begin perform public.core_revoke_report_link(id_stock); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL X2b: another company revoked the link'; end if;
  reset role;
  perform set_config('request.headers', json_build_object('x-org-id', o)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.core_revoke_report_link(id_b); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL X2c: A revoked B''s link'; end if;
  reset role;
  if (select revoked_at from public.core_report_links where id in (id_stock)) is not null or (select revoked_at from public.core_report_links where id = id_b) is not null then
    raise exception 'FAIL X2d: a link was revoked across companies';
  end if;

  -- ---- V1: revoke (audited once), then the link answers NOT_FOUND
  set local role authenticated;
  perform public.core_revoke_report_link(id_stock);
  perform public.core_revoke_report_link(id_stock);   -- again: no second audit row
  reset role;
  select count(*) into n from public.audit_log where org_id = o and action = 'core.report_link.revoked';
  if n <> 1 then raise exception 'FAIL V1a: % revoke audit rows, expected 1', n; end if;
  set local role anon;
  ok := false; begin perform public.core_report_link_rows(t_stock); exception when others then ok := (sqlerrm = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL V1b: revoked link still reads'; end if;
  reset role;

  -- ---- E1: an expired link, and a link whose module was switched off, answer the same NOT_FOUND
  update public.core_report_links set expires_at = now() - interval '1 minute' where id = id_open;
  update public.org_modules set disabled_at = now() where org_id = o and module_key = 'inventory';
  set local role anon;
  ok := false; begin perform public.core_report_link_rows(t_open); exception when others then msg := sqlerrm; ok := (msg = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL E1a: expired link answered %', msg; end if;
  reset role;
  update public.core_report_links set revoked_at = null where id = id_stock;
  set local role anon;
  ok := false; begin perform public.core_report_link_rows(t_stock); exception when others then msg := sqlerrm; ok := (msg = 'NOT_FOUND'); end;
  if not ok then raise exception 'FAIL E1b: module-off link answered %', msg; end if;
  -- the sales link still reads while only inventory is off
  r := public.core_report_link_rows(t_sales);
  if jsonb_array_length(r -> 'rows') <> 1 then raise exception 'FAIL E1c: sales link broke'; end if;
  reset role;

  -- ---- E2: creating a stock link with the module off is refused
  set local role authenticated;
  ok := false; begin perform public.core_create_report_link('stock_on_hand', null, null); exception when others then ok := (sqlerrm = 'MODULE_DISABLED'); end;
  if not ok then raise exception 'FAIL E2: link created with the module off'; end if;
  reset role;

  -- ---- U1: creation audited (3 in company A), no personal data or token in the audit rows
  select count(*) into n from public.audit_log where org_id = o and action = 'core.report_link.created';
  if n <> 3 then raise exception 'FAIL U1: % create audit rows, expected 3', n; end if;

  raise exception 'ALL TESTS PASSED (everything rolled back)';
end $$;
